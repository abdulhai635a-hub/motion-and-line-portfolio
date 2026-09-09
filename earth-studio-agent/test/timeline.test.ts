import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/parser.ts';
import { buildTimeline, resolveSteps } from '../src/timeline.ts';
import { Geocoder } from '../src/geocode/index.ts';
import { makeConfig, type SessionConfig } from '../src/config.ts';
import { AgentError } from '../src/errors.ts';
import type { CameraPath } from '../src/types.ts';

async function build(command: string, overrides: Parameters<typeof makeConfig>[0] = {}, options = {}): Promise<CameraPath> {
  const config: SessionConfig = makeConfig(overrides);
  const { steps } = parseCommand(command);
  const resolved = await resolveSteps(steps, new Geocoder(), config, options);
  return buildTimeline(resolved.steps, config, command, resolved.warnings);
}

describe('resolveSteps', () => {
  test('a hold inherits the place and altitude of the step before it', async () => {
    const path = await build('fly to Rome at city level. hold 3 seconds');
    const hold = path.steps.at(-1);
    assert.equal(hold?.action, 'hold');
    assert.equal(hold?.place?.name, 'Rome');
    assert.equal(hold?.altitude, 15_000);
    assert.equal(hold?.altitudeSource, 'inherited');
  });

  test('a leading start with no place borrows the first named place', async () => {
    const path = await build('start from space, zoom into Japan');
    assert.equal(path.steps[0]?.action, 'start');
    assert.equal(path.steps[0]?.place?.name, 'Japan');
    assert.equal(path.steps[0]?.altitude, 10_000_000);
  });

  test('an establishing pose is added when the command does not open with one', async () => {
    const path = await build('fly to Rome');
    assert.equal(path.steps.length, 2);
    assert.equal(path.steps[0]?.action, 'start');
    assert.equal(path.steps[0]?.source, '(implicit establishing pose)');
    assert.equal(path.steps[0]?.altitude, 10_000_000);
  });

  test('--no-implicit-start leaves the command exactly as written', async () => {
    const path = await build('fly to Rome', {}, { implicitStart: false });
    assert.equal(path.steps.length, 1);
    assert.equal(path.steps[0]?.action, 'fly_to');
  });

  test('altitude comes from the descriptor when one is given', async () => {
    const path = await build('fly to Rome at street level');
    const step = path.steps.at(-1);
    assert.equal(step?.altitude, 150);
    assert.equal(step?.altitudeSource, 'descriptor');
  });

  test('an explicit altitude beats the descriptor table', async () => {
    const path = await build('zoom into Rome to 500 meters');
    const step = path.steps.at(-1);
    assert.equal(step?.altitude, 500);
    assert.equal(step?.altitudeSource, 'explicit');
  });

  test('altitude falls back to the kind of place (PRD 6, Geocoder row)', async () => {
    const country = await build('fly to Japan');
    assert.equal(country.steps.at(-1)?.altitude, 800_000);
    assert.equal(country.steps.at(-1)?.altitudeSource, 'place-kind');

    const city = await build('fly to Tokyo');
    assert.equal(city.steps.at(-1)?.altitude, 15_000);

    const landmark = await build('fly to Mount Fuji');
    assert.equal(landmark.steps.at(-1)?.altitude, 1_500);
  });

  test('a bare zoom out climbs one rung of the altitude table', async () => {
    const path = await build('fly to Tokyo. zoom out');
    assert.equal(path.steps.at(-2)?.altitude, 15_000);
    assert.equal(path.steps.at(-1)?.altitude, 150_000);
  });

  test('a bare zoom in drops one rung when the place default is not closer', async () => {
    const path = await build('fly to Tokyo. zoom in');
    assert.equal(path.steps.at(-1)?.altitude, 1_500);
  });

  test('durations come from the command or from the configured defaults', async () => {
    const path = await build('fly to Rome. hold 7 seconds. fly to Paris', {
      defaultTransitionSeconds: 5,
      defaultHoldSeconds: 1,
    });
    const [, move, hold, second] = path.steps;
    assert.equal(move?.duration, 5);
    assert.equal(move?.durationSource, 'default');
    assert.equal(hold?.duration, 7);
    assert.equal(hold?.durationSource, 'explicit');
    assert.equal(second?.duration, 5);
  });

  test('an ambiguous place produces a warning naming the step (FR2)', async () => {
    const path = await build('fly to Georgia');
    const warning = path.warnings.find((entry) => entry.code === 'AMBIGUOUS_PLACE');
    assert.ok(warning, 'expected an ambiguity warning');
    assert.equal(warning?.stepIndex, 2);
    assert.match(warning?.message ?? '', /Georgia/);
    assert.match(warning?.message ?? '', /alternative/);
  });

  test('the ambiguity hook can override the automatic choice (PRD 12)', async () => {
    const config = makeConfig();
    const { steps } = parseCommand('fly to Georgia');
    const resolved = await resolveSteps(steps, new Geocoder(), config, {
      onAmbiguous: async (place) => {
        const alternative = place.alternatives.find((alt) => alt.kind === 'region');
        assert.ok(alternative);
        return { ...place, ...alternative, ambiguous: false, alternatives: [] };
      },
    });
    assert.equal(resolved.steps.at(-1)?.place?.kind, 'region');
    assert.equal(resolved.warnings.length, 0);
  });

  test('stops when no place in the whole command can be resolved (FR6)', async () => {
    const config = makeConfig();
    const { steps } = parseCommand('fly to Qqqqzzz Nowhere');
    await assert.rejects(() => resolveSteps(steps, new Geocoder(), config), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'PLACE_NOT_FOUND');
      assert.equal(error.stepIndex, 2);
      return true;
    });
  });

  test('one line that is not a place does not throw the rest of a plan away', async () => {
    // Pasted shot plans carry headings and notes. They are not places, and
    // failing the whole run over them makes the agent useless for real briefs.
    const config = makeConfig();
    const { steps, ignored } = parseCommand('fly to Rome. Link: Google Earth Studio. then fly to Cairo');
    // The heading never becomes a step at all: nothing in it names anywhere.
    assert.deepEqual(ignored, ['Link: Google Earth Studio']);
    const { steps: out } = await resolveSteps(steps, new Geocoder(), config);
    assert.deepEqual(out.map((step) => step.place?.name), ['Rome', 'Rome', 'Cairo']);
  });

  test('a line that is not a place but reaches the geocoder is dropped, not fatal', async () => {
    const config = makeConfig();
    const { steps } = parseCommand('fly to Rome. then fly to Qqqqzzz. then fly to Cairo');
    const { steps: out, warnings } = await resolveSteps(steps, new Geocoder(), config);
    assert.deepEqual(out.map((step) => step.place?.name), ['Rome', 'Rome', 'Cairo']);
    assert.ok(warnings.some((warning) => warning.code === 'PLACE_NOT_FOUND' && /left out/.test(warning.message)));
  });

  test('a line that describes the camera keeps the place it followed', async () => {
    const config = makeConfig();
    const { steps } = parseCommand('fly to Rome. a slow push-in to street level over the qqqqzzz nowhere');
    const { steps: out, warnings } = await resolveSteps(steps, new Geocoder(), config);
    assert.equal(out.length, 3);
    assert.equal(out[2]?.place?.name, 'Rome');
    assert.equal(out[2]?.altitude, 150);
    assert.ok(warnings.some((warning) => /stays where the one before it left off/.test(warning.message)));
  });

  test('a step with no place and nothing to inherit is reported, not skipped', async () => {
    const config = makeConfig();
    await assert.rejects(
      () => resolveSteps(
        [{ index: 1, action: 'hold', placeQuery: null, zoom: null, fromZoom: null, altitudeMeters: null, durationSeconds: 2, atSeconds: null, tiltDegrees: null, panDegrees: null, rollDegrees: null, fieldOfViewDegrees: null, speedScale: null, source: 'hold 2s' }],
        new Geocoder(),
        config,
        { implicitStart: false },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'NO_PLACE_FOR_STEP');
        assert.equal(error.stepIndex, 1);
        return true;
      },
    );
  });

  test('rejects a zero or negative duration', async () => {
    const config = makeConfig();
    await assert.rejects(
      () => resolveSteps(
        [{ index: 1, action: 'fly_to', placeQuery: 'Rome', zoom: null, fromZoom: null, altitudeMeters: null, durationSeconds: 0, atSeconds: null, tiltDegrees: null, panDegrees: null, rollDegrees: null, fieldOfViewDegrees: null, speedScale: null, source: 'x' }],
        new Geocoder(),
        config,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'INVALID_DURATION');
        return true;
      },
    );
  });
});

describe('buildTimeline', () => {
  test('reproduces the PRD worked example', async () => {
    const path = await build(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.\nHold for 2 seconds.',
    );
    // The altitudes are the PRD's; the move durations are worked out from each
    // move, so the frames they land on are not fixed in advance.
    assert.deepEqual(
      path.keyframes.map((keyframe) => Math.round(keyframe.camera.altitude)),
      [10_000_000, 800_000, 800_000, 1_500, 1_500],
    );
    // The holds are exactly as commanded: 3 seconds, then 2.
    const frames = path.keyframes.map((keyframe) => keyframe.frame);
    assert.equal((frames[2] ?? 0) - (frames[1] ?? 0), 90);
    assert.equal((frames[4] ?? 0) - (frames[3] ?? 0), 60);
    assert.deepEqual(frames, [...frames].sort((a, b) => a - b));
  });

  test('with the durations pinned, the frames are exactly the PRD example', async () => {
    const path = await build(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.\nHold for 2 seconds.',
      { defaultTransitionSeconds: 4 },
    );
    assert.deepEqual(path.keyframes.map((keyframe) => keyframe.frame), [0, 120, 210, 330, 390]);
    assert.equal(path.totalFrames, 391);
    assert.equal(path.durationSeconds, 13);
  });

  test('a long move takes longer than a short one, without being asked', async () => {
    const short = await build('fly to Tokyo. fly to Kyoto');
    const long = await build('fly to Tokyo. fly to Lima');
    const lastOf = (p: CameraPath): number => (p.steps.at(-1)?.duration ?? 0);
    assert.ok(lastOf(long) > lastOf(short) + 1, `${lastOf(short)}s then ${lastOf(long)}s`);
    assert.equal(short.steps.at(-1)?.durationSource, 'automatic');
  });

  test('the camera looks down from orbit and angles in close', async () => {
    const path = await build('start from space, zoom into Japan. then fly to Mount Fuji and zoom in close');
    assert.equal(path.keyframes[0]?.camera.tilt, 0);
    assert.ok((path.keyframes.at(-1)?.camera.tilt ?? 0) >= 50, 'a close pass should be angled');
    assert.equal(path.steps.at(-1)?.tiltSource, 'automatic');
  });

  test('a tilt in the command wins and carries forward', async () => {
    const path = await build('fly to Tokyo with tilt 30. then fly to Kyoto');
    assert.equal(path.steps[1]?.tilt, 30);
    assert.equal(path.steps[1]?.tiltSource, 'explicit');
    assert.equal(path.steps[2]?.tilt, 30, 'an angle named once should hold');
  });

  test('"slowly" and "quickly" stretch and shorten the moves', async () => {
    const plain = await build('fly to Tokyo. fly to Kyoto');
    const slow = await build('fly to Tokyo. slowly fly to Kyoto');
    const quick = await build('fly to Tokyo. quickly fly to Kyoto');
    const last = (p: CameraPath): number => p.steps.at(-1)?.duration ?? 0;
    assert.ok(last(slow) > last(plain), `${last(plain)}s then ${last(slow)}s`);
    assert.ok(last(quick) < last(plain), `${last(plain)}s then ${last(quick)}s`);
  });

  test('the lens is left alone unless the command names one', async () => {
    const untouched = await build('fly to Tokyo');
    assert.equal(untouched.writeFieldOfView, false);

    const named = await build('fly to Tokyo with field of view 30');
    assert.equal(named.writeFieldOfView, true);
    assert.equal(named.keyframes.at(-1)?.camera.fieldOfView, 30);
  });

  test('a lens named part-way through applies from the first keyframe', async () => {
    // Otherwise the shot opens at the default 60 and zooms to 30 on its own -
    // a lens move nobody asked for.
    const path = await build('fly to Tokyo. then fly to Kyoto with field of view 30');
    assert.equal(path.writeFieldOfView, true);
    assert.deepEqual(
      path.keyframes.map((keyframe) => keyframe.camera.fieldOfView),
      path.keyframes.map(() => 30),
    );
  });

  test('a push-in "from high orbit" descends, instead of climbing to orbit', async () => {
    // Read as a target, "from high orbit" sent the camera up and away from the
    // subject - the opposite of the shot described.
    const path = await build('fly to Rome. a slow steady push-in from high orbit');
    const altitudes = path.keyframes.map((keyframe) => keyframe.camera.altitude);
    assert.equal(altitudes.at(0), 10_000_000, 'it opens at orbit');
    assert.ok((altitudes.at(-1) ?? 0) < 100_000, `it should end low, ended at ${altitudes.at(-1)}`);
    assert.deepEqual([...altitudes].sort((a, b) => b - a), altitudes, 'every step goes downwards');
  });

  test('reads a pasted shot plan: coordinates, headings and a line of prose', async () => {
    const path = await build(
      'Shot 1 - Carajas mine (6°00\'44"S, 50°10\'37"W)\n' +
        'Type: map\n' +
        'Link: Google Earth Studio\n' +
        'What to take: a slow steady downward push-in from high orbit - no zoom-cut',
    );
    for (const keyframe of path.keyframes) {
      assert.equal(keyframe.camera.latitude, -6.012222);
      assert.equal(keyframe.camera.longitude, -50.176944);
    }
    const altitudes = path.keyframes.map((keyframe) => keyframe.camera.altitude);
    assert.equal(altitudes.at(0), 10_000_000);
    assert.ok((altitudes.at(-1) ?? 0) <= 15_000, `should end close in, ended at ${altitudes.at(-1)}`);
    // "slow" stretches the descent rather than leaving it at the default.
    assert.ok((path.steps.at(-1)?.duration ?? 0) > 5, `the push-in should be slow, was ${path.steps.at(-1)?.duration}s`);
  });

  test('a stray match is pulled back to where the rest of the command is', async () => {
    // A brief about the LaBarge/Shute Creek area of Wyoming resolved a step to
    // Shute Harbour in Queensland, and the shot opened twelve thousand
    // kilometres from everything else in it.
    const provider = {
      name: 'test',
      async lookup(query: string) {
        if (query.includes('shute')) {
          return [
            { name: 'Shute Harbour', latitude: -20.286, longitude: 148.7458, kind: 'city' as const, score: 10, context: 'Queensland, Australia' },
            { name: 'Shute Creek', latitude: 41.8806, longitude: -110.0903, kind: 'landmark' as const, score: 1, context: 'Wyoming' },
          ];
        }
        return [{ name: 'Wyoming', latitude: 43.076, longitude: -107.29, kind: 'region' as const, score: 5 }];
      },
    };
    const { steps } = parseCommand('fly to Wyoming. then fly to Shute Creek. hold 2 seconds');
    const { steps: out, warnings } = await resolveSteps(steps, new Geocoder({ providers: [provider] }), makeConfig());

    const shute = out.find((step) => step.place?.query.includes('shute'));
    assert.equal(shute?.place?.name, 'Shute Creek', 'the far match should have been swapped for the near one');
    assert.ok(warnings.some((warning) => warning.code === 'PLACE_MOVED_NEARER'));
  });

  test('but says so when no nearer reading of the name exists', async () => {
    const provider = {
      name: 'test',
      async lookup(query: string) {
        return query.includes('sydney')
          ? [{ name: 'Sydney', latitude: -33.8688, longitude: 151.2093, kind: 'city' as const, score: 10 }]
          : [{ name: 'Wyoming', latitude: 43.076, longitude: -107.29, kind: 'region' as const, score: 5 }];
      },
    };
    const { steps } = parseCommand('fly to Wyoming. then fly to Sydney. hold 2 seconds');
    const { steps: out, warnings } = await resolveSteps(steps, new Geocoder({ providers: [provider] }), makeConfig());

    // Nothing is moved: the command really does cross the world.
    assert.ok(out.some((step) => step.place?.name === 'Sydney'));
    assert.ok(warnings.some((warning) => warning.code === 'PLACE_FAR_AWAY'));
  });

  test('holds repeat the previous camera exactly, so nothing drifts', async () => {
    const path = await build('fly to Rome. hold 2 seconds');
    const [, move, hold] = path.keyframes;
    assert.deepEqual(move?.camera, hold?.camera);
    assert.equal((hold?.frame ?? 0) - (move?.frame ?? 0), 60);
  });

  test('frame numbers follow the configured frame rate (FR3)', async () => {
    for (const fps of [24, 25, 30, 60]) {
      const path = await build('fly to Rome. hold 2 seconds', { frameRate: fps, defaultTransitionSeconds: 1 });
      assert.equal(path.frameRate, fps);
      assert.deepEqual(path.keyframes.map((keyframe) => keyframe.frame), [0, fps, fps * 3]);
    }
  });

  test('frames are whole numbers and strictly increasing', async () => {
    const path = await build('fly to Rome. hold 1.7 seconds. fly to Paris. hold 0.4 seconds', { frameRate: 29.97 });
    let previous = -1;
    for (const keyframe of path.keyframes) {
      assert.ok(Number.isInteger(keyframe.frame), `${keyframe.frame} is not an integer`);
      assert.ok(keyframe.frame > previous, `${keyframe.frame} did not advance past ${previous}`);
      previous = keyframe.frame;
    }
  });

  test('a duration under one frame is widened and warned about', async () => {
    const path = await build('fly to Rome. hold 0.01 seconds', { frameRate: 30 });
    const warning = path.warnings.find((entry) => entry.code === 'DURATION_ROUNDED_UP');
    assert.ok(warning);
    assert.equal(path.keyframes.at(-1)?.frame, (path.keyframes.at(-2)?.frame ?? 0) + 1);
  });

  test('every keyframe carries a full camera state', async () => {
    const path = await build('fly to Rome', { defaultTilt: 12, defaultFieldOfView: 45 });
    for (const keyframe of path.keyframes) {
      for (const key of ['latitude', 'longitude', 'altitude', 'pan', 'tilt', 'roll', 'fieldOfView'] as const) {
        assert.equal(typeof keyframe.camera[key], 'number', key);
        assert.ok(Number.isFinite(keyframe.camera[key]), key);
      }
      assert.equal(keyframe.camera.tilt, 12);
      assert.equal(keyframe.camera.fieldOfView, 45);
    }
  });

  test('an opening hold keeps the establishing pose on screen', async () => {
    const path = await build('start from space and hold 2 seconds, then fly to Rome');
    assert.equal(path.keyframes[0]?.frame, 0);
    assert.equal(path.keyframes[1]?.frame, 60);
    assert.deepEqual(path.keyframes[0]?.camera, path.keyframes[1]?.camera);
  });

  test('visits multiple places in the order given (success criterion, PRD 10)', async () => {
    const path = await build('fly to Rome. then fly to Cairo. then fly to Tokyo');
    assert.deepEqual(
      path.steps.map((step) => step.place?.name),
      ['Rome', 'Rome', 'Cairo', 'Tokyo'],
    );
    const latitudes = path.keyframes.map((keyframe) => Number(keyframe.camera.latitude.toFixed(4)));
    assert.deepEqual(latitudes, [41.9028, 41.9028, 30.0444, 35.6762]);
  });

  test('refuses to build from no steps', () => {
    assert.throws(() => buildTimeline([], makeConfig(), 'x'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'NO_STEPS_PARSED');
      return true;
    });
  });
});
