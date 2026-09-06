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

  test('an unresolvable place names its step and stops (FR6)', async () => {
    const config = makeConfig();
    const { steps } = parseCommand('fly to Rome. fly to Qqqqzzz Nowhere');
    await assert.rejects(() => resolveSteps(steps, new Geocoder(), config), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'PLACE_NOT_FOUND');
      assert.equal(error.stepIndex, 3);
      return true;
    });
  });

  test('a step with no place and nothing to inherit is reported, not skipped', async () => {
    const config = makeConfig();
    await assert.rejects(
      () => resolveSteps(
        [{ index: 1, action: 'hold', placeQuery: null, zoom: null, altitudeMeters: null, durationSeconds: 2, source: 'hold 2s' }],
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
        [{ index: 1, action: 'fly_to', placeQuery: 'Rome', zoom: null, altitudeMeters: null, durationSeconds: 0, source: 'x' }],
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
  test('reproduces the PRD worked example frame for frame', async () => {
    const path = await build(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.\nHold for 2 seconds.',
    );
    assert.deepEqual(
      path.keyframes.map((keyframe) => [keyframe.frame, Math.round(keyframe.camera.altitude)]),
      [
        [0, 10_000_000],
        [120, 800_000],
        [210, 800_000],
        [330, 1_500],
        [390, 1_500],
      ],
    );
    assert.equal(path.totalFrames, 391);
    assert.equal(path.durationSeconds, 13);
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
