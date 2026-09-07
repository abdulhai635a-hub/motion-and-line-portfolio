/**
 * Shot plans that arrive already solved: a keyframe table.
 *
 * There is nothing to work out in one of these, so the only failure worth
 * having is typing it in wrong. These check that every number survives the
 * journey - including from a table still in the language it was written in.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeyframeRow, parseProjectSettings } from '../src/keyframe-row.ts';
import { parseCommand } from '../src/parser.ts';
import { planCameraPath } from '../src/agent.ts';

const ROW = 'Keyframe 2 — 4.0s : lat -6.0586 · lon -50.1769 · altitude 15,000 m · pan 300° · tilt 65° · roll 0°';

describe('parseKeyframeRow', () => {
  test('reads every value in a row', () => {
    assert.deepEqual(parseKeyframeRow(ROW), {
      atSeconds: 4,
      latitude: -6.0586,
      longitude: -50.1769,
      altitudeMeters: 15_000,
      panDegrees: 300,
      tiltDegrees: 65,
      rollDegrees: 0,
      fieldOfViewDegrees: null,
    });
  });

  test('reads a row still in the language it was written in', () => {
    // These plans reach the agent through a translator, and a translator may
    // render "keyframe" or "height" as anything. "lat", "lon" and the numbers
    // do not change, and neither does the unit beside the altitude.
    const row = parseKeyframeRow('কীফ্রেম ২ — 4.0s : lat -6.0586 · lon -50.1769 · উচ্চতা 15,000 m · pan 300° · tilt 65° · roll 0°');
    assert.equal(row?.atSeconds, 4);
    assert.equal(row?.latitude, -6.0586);
    assert.equal(row?.altitudeMeters, 15_000);
    assert.equal(row?.panDegrees, 300);
  });

  test('takes the time from the head of the row, not from a value in it', () => {
    assert.equal(parseKeyframeRow('at 12s: lat 1.5 · lon 2.5 · altitude 300 m')?.atSeconds, 12);
    assert.equal(parseKeyframeRow('lat 1.5 · lon 2.5 · altitude 300 m')?.atSeconds, null);
  });

  test('an ordinary instruction is not a row', () => {
    for (const line of ['fly to Rome for 3 seconds', 'hold 2 seconds', 'Easing: ease in-out']) {
      assert.equal(parseKeyframeRow(line), null, line);
    }
  });

  test('refuses coordinates that are not on the planet', () => {
    assert.equal(parseKeyframeRow('lat 120 · lon 500 · altitude 1 m'), null);
  });
});

describe('parseProjectSettings', () => {
  test('reads the frame rate and the frame size', () => {
    assert.deepEqual(parseProjectSettings('Project: 4 seconds · 30 fps · 1920×1080'), {
      frameRate: 30,
      width: 1920,
      height: 1080,
    });
  });

  test('says nothing about a line that states nothing', () => {
    assert.equal(parseProjectSettings('fly to Rome'), null);
  });
});

describe('a table as a whole command', () => {
  const TABLE = [
    'Place: Carajas Mine, Serra Norte, Para, Brazil',
    'Project: 4 seconds · 30 fps · 1920×1080',
    'Keyframe 1 — 0.0s : lat -10.0000 · lon -55.0000 · altitude 800,000 m · pan 0° · tilt 0° · roll 0°',
    ROW,
    'Easing: ease in-out on both keyframes',
    'What you will see: South America from space at the start, a low-angle look over the mine at the end',
  ].join('\n');

  test('the rows are the shot, and the prose beside them is not', () => {
    const { steps } = parseCommand(TABLE);
    assert.equal(steps.length, 2, steps.map((step) => step.source).join(' | '));
    assert.equal(steps[0]?.action, 'start');
    assert.equal(steps[1]?.atSeconds, 4);
  });

  test('every value lands on the keyframe the table put it on', async () => {
    const { path } = await planCameraPath(TABLE);
    assert.equal(path.keyframes.length, 2);
    assert.deepEqual(path.keyframes[0], {
      frame: 0,
      time: 0,
      stepIndex: 1,
      label: 'start -10.000000, -55.000000 (start)',
      camera: {
        latitude: -10,
        longitude: -55,
        altitude: 800_000,
        pan: 0,
        tilt: 0,
        roll: 0,
        fieldOfView: 60,
      },
    });
    assert.deepEqual(path.keyframes[1]?.camera, {
      latitude: -6.0586,
      longitude: -50.1769,
      altitude: 15_000,
      pan: 300,
      tilt: 65,
      roll: 0,
      fieldOfView: 60,
    });
    // 4 seconds at 30fps, and no establishing pose invented in front of it.
    assert.equal(path.keyframes[1]?.frame, 120);
    assert.equal(path.totalFrames, 121);
    // The lens is not part of this table, so the project keeps its own.
    assert.equal(path.writeFieldOfView, false);
  });

  test('the prose is reported once, not once per clause', async () => {
    const { path } = await planCameraPath(TABLE);
    const notes = path.warnings.filter((warning) => warning.code === 'TABLE_IS_THE_SHOT');
    assert.equal(notes.length, 1);
    assert.match(notes[0]?.message ?? '', /read as a note/);
    assert.equal(path.warnings.some((warning) => warning.code === 'PLACE_NOT_FOUND'), false);
  });

  test('a plan that states its own frame rate is counted in that', async () => {
    const { path, config } = await planCameraPath(TABLE.replace('30 fps', '60 fps'));
    assert.equal(config.frameRate, 60);
    assert.equal(path.keyframes[1]?.frame, 240);
    assert.ok(path.warnings.some((warning) => warning.code === 'PROJECT_FROM_COMMAND'));
  });

  test('a row timed before the one above it is kept where it is, with a warning', async () => {
    const { path } = await planCameraPath(
      'Keyframe 1 — 4.0s : lat 1.5 · lon 2.5 · altitude 300 m\nKeyframe 2 — 1.0s : lat 3.5 · lon 4.5 · altitude 300 m',
    );
    assert.ok(path.warnings.some((warning) => warning.code === 'KEYFRAME_OUT_OF_ORDER'));
  });
});
