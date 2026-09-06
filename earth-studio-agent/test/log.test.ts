import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planCameraPath } from '../src/agent.ts';
import { renderCsv, renderDriveReport, renderLayoutReport, renderPathLog } from '../src/log.ts';

describe('run log (FR5)', () => {
  test('lists every keyframe with its frame, time and camera values', async () => {
    const { path } = await planCameraPath(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.',
    );
    const log = renderPathLog(path);
    for (const keyframe of path.keyframes) {
      const line = log.split('\n').find((row) => row.trim().startsWith(String(keyframe.frame)));
      assert.ok(line, `no log line for frame ${keyframe.frame}`);
      assert.match(line, new RegExp(keyframe.camera.latitude.toFixed(6)));
    }
    assert.match(log, /Mount Fuji/);
    assert.match(log, /30fps/);
    assert.match(log, new RegExp(`${path.totalFrames} frames`));
  });

  test('echoes the original command so the log stands alone', async () => {
    const { path } = await planCameraPath('fly to Rome\nhold 2 seconds');
    const log = renderPathLog(path);
    assert.match(log, /> fly to Rome/);
    assert.match(log, /> hold 2 seconds/);
  });

  test('explains where each altitude and duration came from', async () => {
    const { path } = await planCameraPath('fly to Rome at street level. hold 4 seconds');
    const log = renderPathLog(path);
    assert.match(log, /altitude=descriptor/);
    assert.match(log, /duration=explicit/);
    assert.match(log, /altitude=inherited/);
  });

  test('shows warnings rather than hiding them', async () => {
    const { path } = await planCameraPath('fly to Georgia');
    const log = renderPathLog(path);
    assert.match(log, /Warnings/);
    assert.match(log, /AMBIGUOUS_PLACE/);
  });

  test('csv has one header and one row per keyframe', async () => {
    const { path } = await planCameraPath('fly to Rome. hold 2s. fly to Paris');
    const rows = renderCsv(path).trim().split('\n');
    assert.equal(rows.length, path.keyframes.length + 1);
    assert.equal(rows[0], 'frame,time,step,latitude,longitude,altitude,pan,tilt,roll,fieldOfView,label');
    assert.match(rows[1] ?? '', /^0,0,/);
  });
});

describe('driver reports', () => {
  test('a layout report names the matched selector for each field', () => {
    const text = renderLayoutReport({
      version: '1.0.0',
      verifiedOn: 'unverified',
      ok: false,
      missing: ['camera altitude'],
      fields: [
        { name: 'latitude', label: 'camera latitude', required: true, matched: '#lat', candidates: ['#lat'] },
        { name: 'altitude', label: 'camera altitude', required: true, matched: null, candidates: ['#alt'] },
        { name: 'roll', label: 'camera roll', required: false, matched: null, candidates: ['#roll'] },
      ],
    });
    assert.match(text, /Missing required fields: camera altitude/);
    assert.match(text, /ok\s+camera latitude\s+#lat/);
    assert.match(text, /MISSING\s+camera altitude/);
    assert.match(text, /absent\s+camera roll/);
  });

  test('a drive report shows what was written and what failed', () => {
    const text = renderDriveReport({
      total: 2,
      applied: 1,
      results: [
        { frame: 0, stepIndex: 1, label: 'start', written: { latitude: 1, altitude: 100 }, skipped: ['roll'], ok: true, details: [] },
        { frame: 30, stepIndex: 2, label: 'fly_to Rome (end)', written: {}, skipped: [], ok: false, error: 'altitude rejected', details: [] },
      ],
      failures: [
        { frame: 30, stepIndex: 2, label: 'fly_to Rome (end)', written: {}, skipped: [], ok: false, error: 'altitude rejected', details: [] },
      ],
    });
    assert.match(text, /Wrote 1 of 2 keyframes/);
    assert.match(text, /ok\s+frame\s+0/);
    assert.match(text, /FAIL frame\s+30/);
    assert.match(text, /altitude rejected/);
    assert.match(text, /skipped optional fields: roll/);
  });
});
