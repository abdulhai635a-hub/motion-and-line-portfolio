/**
 * Step resolution and Timeline Builder (PRD 6, FR3).
 *
 * `resolveSteps` fills in every default a step left open: the place (geocoded or
 * inherited), the altitude (explicit, descriptor, or the default for the kind of
 * place), and the duration. `buildTimeline` turns the resolved steps into
 * absolute frame numbers and the keyframes that will be entered into Earth Studio.
 */
import type {
  CameraPath,
  CameraState,
  GeoPlace,
  Keyframe,
  ParsedStep,
  PlaceKind,
  ResolvedStep,
  Warning,
  ZoomDescriptor,
} from './types.ts';
import type { SessionConfig } from './config.ts';
import { AgentError } from './errors.ts';
import type { Geocoder } from './geocode/index.ts';
import { groundDistanceKm, smartDuration, smartTilt } from './smart.ts';
import type { ElevationProvider } from './geocode/elevation.ts';

export interface ResolveResult {
  steps: ResolvedStep[];
  warnings: Warning[];
}

export interface ResolveOptions {
  /**
   * Prepend a wide establishing pose when the command does not open with one.
   * Without it a single-step command produces two identical keyframes and the
   * camera never moves.
   */
  implicitStart?: boolean;
  /**
   * Called for every place the geocoder flagged as ambiguous, so a caller can
   * ask the user which one they meant. Returning the place unchanged keeps the
   * automatic choice. PRD 12 leaves this open; both behaviours are supported.
   */
  onAmbiguous?: (place: GeoPlace, stepIndex: number) => Promise<GeoPlace>;
  /**
   * How high the ground is under each step. Earth Studio measures altitude from
   * sea level; a shot is described from the ground. Without this the camera
   * ends up underground anywhere the land is high, and the frame comes out
   * black.
   */
  elevation?: ElevationProvider;
}

export async function resolveSteps(
  parsed: ParsedStep[],
  geocoder: Geocoder,
  config: SessionConfig,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const { implicitStart = true, onAmbiguous, elevation } = options;
  const warnings: Warning[] = [];

  // A keyframe table already says where the shot opens, so nothing is put in
  // front of it. Turning its absolute times into durations is all it needs:
  // every step below then works the way it always has.
  const tabled = parsed.some((step) => step.atSeconds !== null);
  if (tabled) {
    let previousAt = 0;
    for (const step of parsed) {
      if (step.atSeconds === null) continue;
      const span = round(step.atSeconds - previousAt, 3);
      if (span < 0) {
        warnings.push({
          code: 'KEYFRAME_OUT_OF_ORDER',
          stepIndex: step.index,
          message: `This keyframe is timed at ${step.atSeconds}s, before the one above it; it was kept where it is.`,
        });
      }
      step.durationSeconds = span > 0 ? span : null;
      previousAt = step.atSeconds;
    }
  }

  const steps: ParsedStep[] =
    implicitStart && !tabled && parsed[0]?.action !== 'start'
      ? [{
          index: 0,
          action: 'start',
          placeQuery: null,
          zoom: null,
          fromZoom: null,
          altitudeMeters: null,
          durationSeconds: null,
          atSeconds: null,
          tiltDegrees: null,
          panDegrees: null,
          rollDegrees: null,
          fieldOfViewDegrees: null,
          speedScale: null,
          source: '(implicit establishing pose)',
        }, ...parsed]
      : [...parsed];

  // Renumber so indices stay 1-based and contiguous after any implicit step.
  steps.forEach((step, i) => { step.index = i + 1; });

  // Pass 1: geocode every named place, keeping failures attached to their step.
  const places = new Map<number, Awaited<ReturnType<Geocoder['resolve']>>>();
  const dropped = new Set<number>();
  let firstFailure: AgentError | null = null;
  for (const step of steps) {
    if (step.placeQuery === null) continue;
    let place: GeoPlace;
    try {
      place = await geocoder.resolve(step.placeQuery, step.index);
    } catch (error) {
      // People paste whole shot plans - headings, "Link: ...", a line of prose -
      // and one line that is not a place must not throw the rest away. What the
      // step says about the camera decides: a line that says nothing else is
      // dropped, a line that describes a move keeps the place it followed.
      if (!(error instanceof AgentError) || error.code !== 'PLACE_NOT_FOUND') throw error;
      firstFailure = firstFailure ?? error;
      const describesCamera =
        step.action !== 'fly_to' ||
        step.zoom !== null ||
        step.altitudeMeters !== null ||
        step.durationSeconds !== null ||
        step.tiltDegrees !== null ||
        step.fieldOfViewDegrees !== null ||
        step.speedScale !== null;
      warnings.push({
        code: 'PLACE_NOT_FOUND',
        stepIndex: step.index,
        message: describesCamera
          ? `"${step.placeQuery}" is not a place, so this step stays where the one before it left off.`
          : `"${step.placeQuery}" is not a place and the step says nothing else, so it was left out.`,
      });
      step.placeQuery = null;
      if (!describesCamera) dropped.add(step.index);
      continue;
    }
    if (place.ambiguous && onAmbiguous !== undefined) {
      place = await onAmbiguous(place, step.index);
    }
    places.set(step.index, place);
    if (place.ambiguous) {
      const alt = place.alternatives[0];
      warnings.push({
        code: 'AMBIGUOUS_PLACE',
        stepIndex: step.index,
        message:
          `"${step.placeQuery}" is ambiguous: used ${describe(place.name, place.context)} ` +
          `(confidence ${place.confidence}); the closest alternative was ` +
          `${alt ? describe(alt.name, alt.context) : 'none'}.`,
      });
    }
  }

  keepPlacesTogether(places, warnings);

  if (places.size === 0 && firstFailure !== null) {
    // Nothing at all resolved: there is no path to build. Naming only the first
    // line that failed hides the one the person actually meant as a place, so
    // every attempt is listed.
    const queries = warnings
      .filter((warning) => warning.code === 'PLACE_NOT_FOUND')
      .map((warning) => warning.message.split('"')[1] ?? '')
      .filter((query) => query !== '');
    throw new AgentError('PLACE_NOT_FOUND', 'None of the places in this command could be found.', {
      stepIndex: firstFailure.stepIndex,
      detail: queries.length > 0 ? `Looked for: ${queries.map((query) => `"${query}"`).join(', ')}.` : firstFailure.detail,
      hint: firstFailure.hint,
    });
  }
  for (const index of dropped) {
    const at = steps.findIndex((step) => step.index === index);
    if (at !== -1) steps.splice(at, 1);
  }
  steps.forEach((step, i) => {
    const place = places.get(step.index);
    if (place !== undefined) {
      places.delete(step.index);
      places.set(i + 1, place);
    }
    step.index = i + 1;
  });

  // "Push in from high orbit" says where the move begins. The level belongs to
  // the keyframe before it, so the move itself can go the way it was described.
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined || step.fromZoom === null) continue;
    const previous = steps[i - 1];
    if (previous === undefined) {
      // Nothing precedes it, so the step opens there itself.
      step.zoom = step.zoom ?? step.fromZoom;
      continue;
    }
    // A hold has no level of its own - it repeats what came before - and a step
    // that states its own level has already said where it starts.
    if (previous.action === 'hold' || previous.zoom !== null || previous.altitudeMeters !== null) continue;
    previous.zoom = step.fromZoom;
  }

  // Pass 2: fill in places, altitudes, angles and durations in order.
  const resolved: ResolvedStep[] = [];
  let previousAltitude: number | null = null;
  // An angle, lens or pace named once holds until it is named again, which is
  // how people write: "then fly to Kyoto, slowly" means the rest is slow too.
  let stickyTilt: number | null = null;
  let stickyPan: number | null = null;
  let stickyRoll: number | null = null;
  let stickyFieldOfView: number | null = null;
  let stickySpeed: number | null = null;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    let place = places.get(step.index) ?? null;

    if (place === null) {
      // Inherit backwards ("hold" after a move), or forwards for a leading start.
      for (let j = i - 1; j >= 0 && place === null; j -= 1) {
        place = resolved[j]?.place ?? null;
      }
      if (place === null && step.action === 'start') {
        for (let j = i + 1; j < steps.length && place === null; j += 1) {
          const next = steps[j];
          if (next !== undefined) place = places.get(next.index) ?? null;
        }
      }
    }

    if (place === null) {
      throw new AgentError('NO_PLACE_FOR_STEP', `Step ${step.index} names no place and none can be inherited.`, {
        stepIndex: step.index,
        detail: `Step text: "${step.source}"`,
        hint: 'Name a place in this step, or put it after a step that does.',
      });
    }

    const altitude = decideAltitude(step, place.kind, previousAltitude, config);
    if (step.tiltDegrees !== null) stickyTilt = step.tiltDegrees;
    if (step.panDegrees !== null) stickyPan = step.panDegrees;
    if (step.rollDegrees !== null) stickyRoll = step.rollDegrees;
    if (step.fieldOfViewDegrees !== null) stickyFieldOfView = step.fieldOfViewDegrees;
    if (step.speedScale !== null) stickySpeed = step.speedScale;

    const previous = resolved.at(-1);
    const duration = decideDuration(step, config, previous, { ...place, altitude: altitude.value }, stickySpeed);
    const tilt = decideTilt(stickyTilt, altitude.value, config);

    resolved.push({
      index: step.index,
      action: step.action,
      place,
      altitude: altitude.value,
      duration: duration.value,
      altitudeSource: altitude.source,
      groundElevation: null,
      durationSource: duration.source,
      tilt: tilt.value,
      tiltSource: tilt.source,
      pan: stickyPan ?? config.defaultPan,
      roll: stickyRoll ?? config.defaultRoll,
      fieldOfView: stickyFieldOfView,
      zoom: step.zoom,
      source: step.source,
    });
    previousAltitude = altitude.value;
  }

  // A lens named part-way through applies from the start too. Otherwise the
  // steps before it keep the default and the shot opens with an unasked-for
  // zoom as the field of view slides from 60 to what was asked for.
  const firstLens = resolved.find((step) => step.fieldOfView !== null)?.fieldOfView ?? null;
  if (firstLens !== null) {
    for (const step of resolved) {
      if (step.fieldOfView === null) step.fieldOfView = firstLens;
      else break;
    }
  }

  await addGroundElevation(resolved, warnings, elevation);
  return { steps: resolved, warnings };
}

/**
 * Puts each step's altitude above the ground rather than above the sea.
 *
 * An altitude the command stated is left exactly as written - a plan that says
 * "800,000 m" means the number that goes in the field - but if that number is
 * under the ground it is worth saying so, because Earth Studio's answer to a
 * camera below the surface is a black frame and no other clue.
 */
async function addGroundElevation(
  resolved: ResolvedStep[],
  warnings: Warning[],
  elevation: ElevationProvider | undefined,
): Promise<void> {
  const needsGround = resolved.some((step) => step.place !== null);
  if (!needsGround) return;

  if (elevation === undefined) {
    if (resolved.some((step) => step.altitudeSource !== 'explicit' && step.altitude < 5_000)) {
      warnings.push({
        code: 'GROUND_UNKNOWN',
        message:
          'The height of the ground could not be looked up, so altitudes are written as if the ground were at ' +
          'sea level. Over high ground that puts the camera underground, and Earth Studio shows a black frame.',
      });
    }
    return;
  }

  const heights = await elevation(
    resolved.map((step) => ({ latitude: step.place?.latitude ?? 0, longitude: step.place?.longitude ?? 0 })),
  );

  let unknown = 0;
  for (const [index, step] of resolved.entries()) {
    const ground = heights[index] ?? null;
    if (ground === null) {
      unknown += 1;
      continue;
    }
    step.groundElevation = ground;
    if (step.altitudeSource === 'explicit') {
      if (step.altitude < ground) {
        warnings.push({
          code: 'ALTITUDE_UNDERGROUND',
          stepIndex: step.index,
          message:
            `Step ${step.index} asks for ${Math.round(step.altitude)} m, but the ground at ` +
            `${step.place?.name ?? 'this place'} is about ${Math.round(ground)} m above sea level. ` +
            'Earth Studio measures altitude from sea level, so this keyframe is underground - the frame will be black.',
        });
      }
    }
  }
  if (unknown > 0 && resolved.some((step) => step.altitudeSource !== 'explicit' && step.altitude < 5_000)) {
    warnings.push({
      code: 'GROUND_UNKNOWN',
      message:
        `The height of the ground could not be looked up for ${unknown} of ${resolved.length} steps, so those ` +
        'altitudes are written as if the ground were at sea level.',
    });
  }
}

/**
 * Pulls a stray place back to where the rest of the command is.
 *
 * A name on its own is often ambiguous, and an online search answers with the
 * one it finds most important rather than the one meant: a brief about the
 * LaBarge/Shute Creek area of Wyoming resolved a step to Shute Harbour in
 * Queensland, twelve thousand kilometres away, and the shot opened there.
 *
 * Where a place sits far from every other place in the same command, its own
 * runner-up candidates are checked for one that does not. That is the standard
 * way to read an ambiguous name - near the others, unless the command says
 * otherwise - and where no candidate is nearer, the plan says so rather than
 * quietly crossing an ocean.
 */
function keepPlacesTogether(places: Map<number, GeoPlace>, warnings: Warning[]): void {
  if (places.size < 2) return;
  // Far enough that no shot list means both by accident, near enough that a
  // plan crossing one country is left alone.
  const farKm = 2_000;

  /** Where the command is, judged without the step being judged. */
  const restOf = (index: number): { latitude: number; longitude: number } => {
    const others = [...places.entries()].filter(([at]) => at !== index).map(([, place]) => place);
    return {
      latitude: median(others.map((place) => place.latitude)),
      longitude: median(others.map((place) => place.longitude)),
    };
  };

  // First the mistakes: a name whose own runner-up sits with the rest of the
  // command was almost certainly read as the wrong one of two places.
  for (const [index, place] of [...places.entries()]) {
    const rest = restOf(index);
    if (groundDistanceKm(place, rest) <= farKm) continue;
    const nearer = place.alternatives.find((candidate) => groundDistanceKm(candidate, rest) <= farKm);
    if (nearer === undefined) continue;
    places.set(index, {
      ...place,
      name: nearer.name,
      latitude: nearer.latitude,
      longitude: nearer.longitude,
      kind: nearer.kind,
      context: nearer.context,
      ambiguous: true,
      alternatives: [
        {
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          kind: place.kind,
          score: 0,
          context: place.context,
        },
        ...place.alternatives.filter((candidate) => candidate !== nearer),
      ],
    });
    warnings.push({
      code: 'PLACE_MOVED_NEARER',
      stepIndex: index,
      message:
        `"${place.query}" first matched ${describe(place.name, place.context)}, ` +
        `${Math.round(groundDistanceKm(place, rest))} km from the rest of this command; ` +
        `${describe(nearer.name, nearer.context)} was used instead.`,
    });
  }

  // Then what is left: a command really can cross the world, so this is said
  // once, about the furthest step, rather than repeated for every place in it.
  let worst: { index: number; place: GeoPlace; km: number } | null = null;
  for (const [index, place] of places.entries()) {
    const km = groundDistanceKm(place, restOf(index));
    if (km > farKm && (worst === null || km > worst.km)) worst = { index, place, km };
  }
  if (worst !== null) {
    warnings.push({
      code: 'PLACE_FAR_AWAY',
      stepIndex: worst.index,
      message:
        `"${worst.place.query}" resolved to ${describe(worst.place.name, worst.place.context)}, about ` +
        `${Math.round(worst.km)} km from the rest of this command. ` +
        'If that is not the one you meant, name it more fully.',
    });
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

interface AltitudeDecision {
  value: number;
  source: ResolvedStep['altitudeSource'];
}

function decideAltitude(
  step: ParsedStep,
  placeKind: PlaceKind,
  previous: number | null,
  config: SessionConfig,
): AltitudeDecision {
  if (step.altitudeMeters !== null) {
    if (!Number.isFinite(step.altitudeMeters) || step.altitudeMeters <= 0) {
      throw new AgentError('INVALID_ALTITUDE', `Step ${step.index} asks for an altitude of ${step.altitudeMeters} m.`, {
        stepIndex: step.index,
        hint: 'Altitude must be greater than zero, e.g. "zoom to 500 meters".',
      });
    }
    return { value: step.altitudeMeters, source: 'explicit' };
  }

  if (step.zoom !== null) {
    return { value: config.altitudeTable[step.zoom], source: 'descriptor' };
  }

  if (step.action === 'start') {
    return { value: config.startAltitude, source: 'descriptor' };
  }

  if (step.action === 'hold' && previous !== null) {
    return { value: previous, source: 'inherited' };
  }

  const ladder = altitudeLadder(config);
  const byKind = config.altitudeTable[defaultDescriptorFor(placeKind, config)];

  if (step.action === 'zoom_out') {
    const target = previous === null ? byKind : nextLarger(ladder, previous);
    return { value: target, source: previous === null ? 'place-kind' : 'descriptor' };
  }

  if (step.action === 'zoom_in') {
    if (previous === null || byKind < previous) return { value: byKind, source: 'place-kind' };
    return { value: nextSmaller(ladder, previous), source: 'descriptor' };
  }

  return { value: byKind, source: 'place-kind' };
}

function defaultDescriptorFor(kind: PlaceKind, config: SessionConfig): ZoomDescriptor {
  return config.descriptorByPlaceKind[kind];
}

/** Table altitudes, largest first. */
function altitudeLadder(config: SessionConfig): number[] {
  return [...new Set(Object.values(config.altitudeTable))].sort((a, b) => b - a);
}

function nextLarger(ladder: number[], current: number): number {
  const larger = [...ladder].reverse().find((value) => value > current * 1.001);
  return larger ?? current * 10;
}

function nextSmaller(ladder: number[], current: number): number {
  const smaller = ladder.find((value) => value < current * 0.999);
  return smaller ?? current / 10;
}

/** The angle to hold: what the command asked for, or what the height suggests. */
function decideTilt(
  explicit: number | null,
  altitude: number,
  config: SessionConfig,
): { value: number; source: ResolvedStep['tiltSource'] } {
  if (explicit !== null) return { value: explicit, source: 'explicit' };
  if (config.automaticTilt) return { value: smartTilt(altitude), source: 'automatic' };
  return { value: config.defaultTilt, source: 'default' };
}

function decideDuration(
  step: ParsedStep,
  config: SessionConfig,
  previous: ResolvedStep | undefined,
  here: { latitude: number; longitude: number; altitude: number },
  speedScale: number | null,
): {
  value: number;
  source: ResolvedStep['durationSource'];
} {
  if (step.durationSeconds !== null) {
    if (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0) {
      throw new AgentError('INVALID_DURATION', `Step ${step.index} asks for a duration of ${step.durationSeconds}s.`, {
        stepIndex: step.index,
        hint: 'Duration must be greater than zero, e.g. "hold for 3 seconds".',
      });
    }
    return { value: step.durationSeconds, source: 'explicit' };
  }
  // A start is an instantaneous pose at frame 0 unless the user asked it to
  // linger, so it costs no time of its own by default.
  if (step.action === 'start') return { value: 0, source: 'default' };

  const scale = speedScale ?? 1;
  if (step.action === 'hold') {
    return { value: round(config.defaultHoldSeconds * scale, 2), source: scale === 1 ? 'default' : 'automatic' };
  }

  // A move's length comes from the move itself, so a hop and a dive from orbit
  // are not given the same four seconds.
  const from = previous?.place;
  if (config.automaticTiming && previous !== undefined && from !== null && from !== undefined) {
    const seconds = smartDuration(
      { latitude: from.latitude, longitude: from.longitude, altitude: previous.altitude },
      here,
      config.autoDuration,
    );
    return { value: round(seconds * scale, 2), source: 'automatic' };
  }
  return { value: round(config.defaultTransitionSeconds * scale, 2), source: scale === 1 ? 'default' : 'automatic' };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Converts resolved steps into absolute frame numbers and keyframes (FR3). */
export function buildTimeline(
  resolved: ResolvedStep[],
  config: SessionConfig,
  command: string,
  warnings: Warning[] = [],
): CameraPath {
  if (resolved.length === 0) {
    throw new AgentError('NO_STEPS_PARSED', 'There are no steps to build a timeline from.');
  }

  const keyframes: Keyframe[] = [];
  const allWarnings = [...warnings];
  let frame = 0;

  const first = resolved[0];
  if (first === undefined || first.place === null) {
    throw new AgentError('NO_PLACE_FOR_STEP', 'The first step has no resolved place.');
  }

  keyframes.push(makeKeyframe(0, first, config, 'start'));

  // "start from space and hold 2 seconds" opens on a static pose: repeat the
  // frame-0 camera at the end of that hold so Earth Studio holds it.
  if (first.durationSource === 'explicit' && first.duration > 0) {
    frame = Math.max(1, Math.round(first.duration * config.frameRate));
    keyframes.push(makeKeyframe(frame, first, config, 'end'));
  }

  for (let i = 1; i < resolved.length; i += 1) {
    const step = resolved[i];
    if (step === undefined || step.place === null) continue;
    const span = Math.round(step.duration * config.frameRate);
    if (span < 1) {
      allWarnings.push({
        code: 'DURATION_ROUNDED_UP',
        stepIndex: step.index,
        message:
          `Step ${step.index} lasts ${step.duration}s, which is under one frame at ` +
          `${config.frameRate}fps; it was extended to a single frame.`,
      });
    }
    frame += Math.max(1, span);
    keyframes.push(makeKeyframe(frame, step, config, 'end'));
  }

  const lastFrame = keyframes.at(-1)?.frame ?? 0;
  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    command,
    frameRate: config.frameRate,
    width: config.width,
    height: config.height,
    totalFrames: lastFrame + 1,
    durationSeconds: Number((lastFrame / config.frameRate).toFixed(3)),
    writeFieldOfView: config.writeFieldOfView || resolved.some((step) => step.fieldOfView !== null),
    steps: resolved,
    keyframes,
    warnings: allWarnings,
  };
}

function makeKeyframe(
  frame: number,
  step: ResolvedStep,
  config: SessionConfig,
  role: 'start' | 'end',
): Keyframe {
  const place = step.place;
  if (place === null) {
    throw new AgentError('NO_PLACE_FOR_STEP', `Step ${step.index} has no resolved place.`, { stepIndex: step.index });
  }
  const camera: CameraState = {
    latitude: place.latitude,
    longitude: place.longitude,
    // Above the ground, as the shot was described; Earth Studio's field is
    // measured from sea level, so the ground is added on the way in.
    altitude: step.altitudeSource === 'explicit' ? step.altitude : step.altitude + (step.groundElevation ?? 0),
    pan: step.pan,
    tilt: step.tilt,
    roll: step.roll,
    fieldOfView: step.fieldOfView ?? config.defaultFieldOfView,
  };
  return {
    frame,
    time: Number((frame / config.frameRate).toFixed(3)),
    stepIndex: step.index,
    label: `${step.action} ${place.name} (${role})`,
    camera,
  };
}

function describe(name: string, context?: string): string {
  return context === undefined || context === '' ? name : `${name} - ${context}`;
}
