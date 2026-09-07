import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planCameraPath } from '../src/agent.ts';
import { Geocoder, offlineProvider } from '../src/geocode/index.ts';
import { AgentError } from '../src/errors.ts';
import type { GeocodeProvider } from '../src/geocode/index.ts';

describe('planCameraPath', () => {
  test('meets the PRD 10 success criterion for a two-place command', async () => {
    const { path } = await planCameraPath('zoom into Japan, hold 3 seconds, then fly to Mount Fuji and zoom in close');
    const visited = path.steps.map((step) => step.place?.name);
    assert.ok(visited.indexOf('Japan') < visited.lastIndexOf('Mount Fuji'), 'places are out of order');
    assert.equal(path.keyframes.length, path.steps.length);
    assert.ok(path.durationSeconds > 0);
  });

  test('the plan is self-describing: command, project settings and steps', async () => {
    const { path } = await planCameraPath('fly to Rome', { config: { frameRate: 25, width: 3840, height: 2160 } });
    assert.equal(path.formatVersion, 1);
    assert.equal(path.command, 'fly to Rome');
    assert.equal(path.frameRate, 25);
    assert.equal(path.width, 3840);
    assert.equal(path.height, 2160);
    assert.ok(Date.parse(path.generatedAt) > 0);
  });

  test('is deterministic: the same command yields the same keyframes', async () => {
    const first = await planCameraPath('fly to Cairo. hold 2s. fly to Petra and zoom in close');
    const second = await planCameraPath('fly to Cairo. hold 2s. fly to Petra and zoom in close');
    assert.deepEqual(first.path.keyframes, second.path.keyframes);
  });

  test('a custom geocoder is used instead of the built-in table', async () => {
    const fixed: GeocodeProvider = {
      name: 'fixed',
      async lookup() {
        return [{ name: 'Nowhere', latitude: 1, longitude: 2, kind: 'city', score: 1 }];
      },
    };
    const { path } = await planCameraPath('fly to anywhere', { geocoder: new Geocoder({ providers: [fixed] }) });
    assert.equal(path.keyframes.at(-1)?.camera.latitude, 1);
    assert.equal(path.keyframes.at(-1)?.camera.longitude, 2);
  });

  test('carries ambiguity warnings through to the plan', async () => {
    const { path } = await planCameraPath('fly to Georgia');
    assert.ok(path.warnings.some((warning) => warning.code === 'AMBIGUOUS_PLACE'));
  });

  test('fails with the offending step when a place cannot be resolved (FR6)', async () => {
    await assert.rejects(
      // Nothing here resolves, so there is no path to build at all.
      () => planCameraPath('fly to Qqqqzzz Nowhere. hold 2s', {
        geocoder: new Geocoder({ providers: [offlineProvider] }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'PLACE_NOT_FOUND');
        assert.equal(error.stepIndex, 2);
        assert.match(error.format(), /step 2/);
        return true;
      },
    );
  });

  test('handles a single-word command', async () => {
    const { path } = await planCameraPath('Tokyo');
    assert.equal(path.keyframes.length, 2);
    assert.equal(path.keyframes.at(-1)?.camera.altitude, 15_000);
  });

  test('handles a long realistic script without warnings', async () => {
    const command = [
      'Start from space and zoom into Egypt.',
      'Hold for 2 seconds.',
      'Then fly to the Pyramids of Giza and zoom in close.',
      'Hold for 3 seconds.',
      'Then fly to Petra at city level.',
      'Hold 2 seconds.',
      'Then zoom out to country level.',
      'Hold 1 second.',
    ].join('\n');
    const { path } = await planCameraPath(command);
    assert.equal(path.warnings.length, 0, JSON.stringify(path.warnings));
    assert.equal(path.steps.length, 9);
    assert.deepEqual(
      path.steps.map((step) => step.action),
      ['start', 'zoom_in', 'hold', 'fly_to', 'hold', 'fly_to', 'hold', 'zoom_out', 'hold'],
    );
  });

  test('every keyframe frame is unique and ascending', async () => {
    const { path } = await planCameraPath(
      'fly to Rome. hold 1s. fly to Paris. hold 1s. fly to Berlin. hold 1s. fly to Madrid',
    );
    const frames = path.keyframes.map((keyframe) => keyframe.frame);
    assert.deepEqual(frames, [...new Set(frames)].sort((a, b) => a - b));
  });

  test('the plan survives a JSON round trip unchanged', async () => {
    const { path } = await planCameraPath('fly to Rome and zoom in close');
    assert.deepEqual(JSON.parse(JSON.stringify(path)), JSON.parse(JSON.stringify(path)));
    const restored = JSON.parse(JSON.stringify(path));
    assert.deepEqual(restored.keyframes, JSON.parse(JSON.stringify(path.keyframes)));
  });
});
