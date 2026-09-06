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
}

export async function resolveSteps(
  parsed: ParsedStep[],
  geocoder: Geocoder,
  config: SessionConfig,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const { implicitStart = true, onAmbiguous } = options;
  const warnings: Warning[] = [];

  const steps: ParsedStep[] =
    implicitStart && parsed[0]?.action !== 'start'
      ? [{
          index: 0,
          action: 'start',
          placeQuery: null,
          zoom: null,
          altitudeMeters: null,
          durationSeconds: null,
          source: '(implicit establishing pose)',
        }, ...parsed]
      : [...parsed];

  // Renumber so indices stay 1-based and contiguous after any implicit step.
  steps.forEach((step, i) => { step.index = i + 1; });

  // Pass 1: geocode every named place, keeping failures attached to their step.
  const places = new Map<number, Awaited<ReturnType<Geocoder['resolve']>>>();
  for (const step of steps) {
    if (step.placeQuery === null) continue;
    let place = await geocoder.resolve(step.placeQuery, step.index);
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

  // Pass 2: fill in places, altitudes and durations in order.
  const resolved: ResolvedStep[] = [];
  let previousAltitude: number | null = null;

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
    const duration = decideDuration(step, config);

    resolved.push({
      index: step.index,
      action: step.action,
      place,
      altitude: altitude.value,
      duration: duration.value,
      altitudeSource: altitude.source,
      durationSource: duration.source,
      zoom: step.zoom,
      source: step.source,
    });
    previousAltitude = altitude.value;
  }

  return { steps: resolved, warnings };
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

function decideDuration(step: ParsedStep, config: SessionConfig): {
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
  const value = step.action === 'hold' ? config.defaultHoldSeconds : config.defaultTransitionSeconds;
  return { value, source: 'default' };
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
    altitude: step.altitude,
    pan: config.defaultPan,
    tilt: config.defaultTilt,
    roll: config.defaultRoll,
    fieldOfView: config.defaultFieldOfView,
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
