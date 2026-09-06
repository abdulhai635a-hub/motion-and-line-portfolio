import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EarthStudioDriver, formatNumber } from '../src/driver/earth-studio-driver.ts';
import { CAMERA_FIELD_ORDER, DEFAULT_SELECTORS, mergeSelectors } from '../src/driver/selectors.ts';
import { AgentError } from '../src/errors.ts';
import type { PageLike } from '../src/driver/page.ts';
import type { CameraPath } from '../src/types.ts';

/** A page that records writes, so driver behaviour can be checked without a browser. */
function fakePage(options: { missing?: string[]; rejects?: string[] } = {}): PageLike & {
  writes: Array<{ selector: string; value: string }>;
} {
  const missing = new Set(options.missing ?? []);
  const rejects = new Set(options.rejects ?? []);
  const values = new Map<string, string>();
  const writes: Array<{ selector: string; value: string }> = [];

  const known = (selector: string): boolean =>
    ![...missing].some((entry) => selector.includes(entry)) && selector.includes('data-attribute');

  return {
    writes,
    async goto() {
      return null;
    },
    async waitForSelector() {
      return null;
    },
    async $(selector: string) {
      if (selector === 'body' || selector === '[data-earth-studio-app]') return {};
      return known(selector) ? {} : null;
    },
    async fill(selector: string, value: string) {
      writes.push({ selector, value });
      const rejected = [...rejects].some((entry) => selector.includes(entry));
      values.set(selector, rejected ? '0' : value);
    },
    async press() {
      return undefined;
    },
    async inputValue(selector: string) {
      return values.get(selector) ?? '';
    },
  };
}

function samplePath(): CameraPath {
  const camera = { latitude: 35.36, longitude: 138.72, altitude: 1500, pan: 0, tilt: 0, roll: 0, fieldOfView: 60 };
  return {
    formatVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    command: 'fly to Mount Fuji',
    frameRate: 30,
    width: 1920,
    height: 1080,
    totalFrames: 121,
    durationSeconds: 4,
    steps: [],
    keyframes: [
      { frame: 0, time: 0, stepIndex: 1, label: 'start', camera: { ...camera, altitude: 10_000_000 } },
      { frame: 120, time: 4, stepIndex: 2, label: 'fly_to Mount Fuji (end)', camera },
    ],
    warnings: [],
  };
}

describe('formatNumber', () => {
  test('never uses exponent notation, which the fields reject', () => {
    assert.equal(formatNumber(10_000_000), '10000000');
    assert.equal(formatNumber(0.0000001), '0.0000001');
    assert.equal(formatNumber(1e-7), '0.0000001');
    assert.ok(!formatNumber(1e21).includes('e'));
  });

  test('keeps precision without trailing zeros', () => {
    assert.equal(formatNumber(35.3606), '35.3606');
    assert.equal(formatNumber(-118.2437), '-118.2437');
    assert.equal(formatNumber(1500), '1500');
  });

  test('survives non-finite input', () => {
    assert.equal(formatNumber(Number.NaN), '0');
    assert.equal(formatNumber(Number.POSITIVE_INFINITY), '0');
  });
});

describe('selectors', () => {
  test('every camera attribute has at least one candidate', () => {
    for (const field of CAMERA_FIELD_ORDER) {
      assert.ok(DEFAULT_SELECTORS.camera[field].candidates.length > 0, field);
      assert.notEqual(DEFAULT_SELECTORS.camera[field].label, '');
    }
  });

  test('position and altitude are required, orientation is optional', () => {
    assert.equal(DEFAULT_SELECTORS.camera.latitude.required, true);
    assert.equal(DEFAULT_SELECTORS.camera.altitude.required, true);
    assert.equal(DEFAULT_SELECTORS.camera.roll.required, false);
  });

  test('an override file replaces only what it names', () => {
    const merged = mergeSelectors({
      version: '2.0.0',
      camera: { latitude: { candidates: ['#lat'] } },
    });
    assert.equal(merged.version, '2.0.0');
    assert.deepEqual(merged.camera.latitude.candidates, ['#lat']);
    assert.equal(merged.camera.latitude.label, DEFAULT_SELECTORS.camera.latitude.label);
    assert.deepEqual(merged.camera.longitude, DEFAULT_SELECTORS.camera.longitude);
  });

  test('garbage in the override file falls back to the defaults', () => {
    assert.deepEqual(mergeSelectors(null), DEFAULT_SELECTORS);
    assert.deepEqual(mergeSelectors('nope'), DEFAULT_SELECTORS);
  });
});

describe('EarthStudioDriver', () => {
  test('reports which selectors matched and which are missing', async () => {
    const driver = new EarthStudioDriver(fakePage({ missing: ['altitude'] }));
    const report = await driver.verifyLayout();
    assert.equal(report.ok, false);
    assert.deepEqual(report.missing, ['camera altitude']);
    assert.equal(report.fields.find((field) => field.name === 'latitude')?.matched, '[data-attribute="latitude"] input');
  });

  test('refuses to type anything when a required field is missing (PRD 11)', async () => {
    const driver = new EarthStudioDriver(fakePage({ missing: ['longitude'] }));
    await assert.rejects(() => driver.applyPath(samplePath()), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'DRIVER_LAYOUT_MISMATCH');
      assert.match(error.detail ?? '', /camera longitude/);
      return true;
    });
  });

  test('writes the frame first, then every camera attribute', async () => {
    const page = fakePage();
    const driver = new EarthStudioDriver(page);
    const report = await driver.applyPath(samplePath());
    assert.equal(report.applied, 2);
    assert.equal(report.failures.length, 0);

    const order = page.writes.map((write) => write.selector);
    assert.match(order[0] ?? '', /currentFrame/);
    assert.match(order[1] ?? '', /latitude/);
    assert.equal(page.writes[0]?.value, '0');
    assert.equal(page.writes.filter((w) => w.selector.includes('currentFrame')).at(-1)?.value, '120');
  });

  test('writes exactly the values from the plan', async () => {
    const page = fakePage();
    await new EarthStudioDriver(page).applyPath(samplePath());
    const altitudes = page.writes.filter((write) => write.selector.includes('altitude')).map((w) => w.value);
    assert.deepEqual(altitudes, ['10000000', '1500']);
  });

  test('stops at the first field that will not accept a value, and says which (FR6)', async () => {
    const driver = new EarthStudioDriver(fakePage({ rejects: ['altitude'] }));
    await assert.rejects(() => driver.applyPath(samplePath()), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'DRIVER_FIELD_WRITE_FAILED');
      assert.equal(error.stepIndex, 1);
      assert.match(error.message, /frame 0/);
      return true;
    });
  });

  test('continueOnError records every failure instead of stopping', async () => {
    const driver = new EarthStudioDriver(fakePage({ rejects: ['altitude'] }));
    const report = await driver.applyPath(samplePath(), { continueOnError: true });
    assert.equal(report.total, 2);
    assert.equal(report.applied, 0);
    assert.equal(report.failures.length, 2);
    assert.match(report.failures[0]?.error ?? '', /altitude/);
  });

  test('reports progress for each seek and field write', async () => {
    const events: string[] = [];
    const driver = new EarthStudioDriver(fakePage(), {
      onProgress: (event) => events.push(`${event.kind}:${event.frame}${event.field ? `:${event.field}` : ''}`),
    });
    await driver.applyPath(samplePath());
    assert.ok(events.includes('seek:0'));
    assert.ok(events.includes('field:0:latitude'));
    assert.ok(events.includes('keyframe:120'));
  });

  test('open() fails clearly when the editor never appears', async () => {
    const blank: PageLike = {
      async goto() { return null; },
      async waitForSelector() { return null; },
      async $() { return null; },
      async fill() { return undefined; },
      async press() { return undefined; },
      async inputValue() { return ''; },
    };
    const driver = new EarthStudioDriver(blank);
    await assert.rejects(() => driver.open('about:blank'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'DRIVER_NOT_READY');
      assert.match(error.hint ?? '', /sign in/i);
      return true;
    });
  });
});
