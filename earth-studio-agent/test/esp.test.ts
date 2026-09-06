import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planCameraPath } from '../src/agent.ts';
import { buildEspProject } from '../src/esp.ts';

describe('experimental .esp writer (PRD 4.2)', () => {
  test('says loudly that the format is unverified', async () => {
    const { path } = await planCameraPath('fly to Rome');
    const project = buildEspProject(path);
    assert.match(project.__warning, /[Ee]xperimental/);
    assert.match(project.__warning, /undocumented/);
  });

  test('carries the project settings from the plan', async () => {
    const { path } = await planCameraPath('fly to Rome', { config: { frameRate: 24, width: 1280, height: 720 } });
    const project = buildEspProject(path);
    assert.equal(project.frameRate, 24);
    assert.equal(project.width, 1280);
    assert.equal(project.height, 720);
    assert.equal(project.numFrames, path.totalFrames);
  });

  test('every camera attribute gets one keyframe per planned keyframe', async () => {
    const { path } = await planCameraPath('fly to Rome. hold 2s. fly to Paris');
    const scene = buildEspProject(path).scenes[0];
    assert.ok(scene);
    const position = scene.attributes.cameraPositionAbsolute.attributes;
    for (const attribute of [position.latitude, position.longitude, position.altitude]) {
      assert.equal(attribute.keyframes.length, path.keyframes.length);
    }
    assert.equal(scene.attributes.fieldOfView.keyframes.length, path.keyframes.length);
  });

  test('keyframe values match the plan', async () => {
    const { path } = await planCameraPath('fly to Mount Fuji');
    const scene = buildEspProject(path).scenes[0];
    const latitudes = scene?.attributes.cameraPositionAbsolute.attributes.latitude.keyframes.map((k) => k.value);
    assert.deepEqual(latitudes, path.keyframes.map((keyframe) => keyframe.camera.latitude));
  });

  test('keyframe times are normalised to 0..1 in order', async () => {
    const { path } = await planCameraPath('fly to Rome. hold 2s. fly to Paris');
    const times = buildEspProject(path).scenes[0]?.attributes.cameraPositionAbsolute.attributes.altitude.keyframes.map((k) => k.time) ?? [];
    assert.equal(times[0], 0);
    assert.ok((times.at(-1) ?? 0) <= 1);
    for (let i = 1; i < times.length; i += 1) {
      assert.ok((times[i] ?? 0) > (times[i - 1] ?? 0), `time ${i} did not advance`);
    }
  });

  test('uses linear transitions, as PRD 11 scopes for v1', async () => {
    const { path } = await planCameraPath('fly to Rome');
    const keyframe = buildEspProject(path).scenes[0]?.attributes.cameraRotation.attributes.pan.keyframes[0];
    assert.equal(keyframe?.transitionIn.type, 'linear');
    assert.equal(keyframe?.transitionOut.type, 'linear');
  });

  test('serialises to valid JSON', async () => {
    const { path } = await planCameraPath('fly to Rome and zoom in close');
    const json = JSON.stringify(buildEspProject(path, 'My path'));
    const parsed = JSON.parse(json) as { name: string };
    assert.equal(parsed.name, 'My path');
  });
});
