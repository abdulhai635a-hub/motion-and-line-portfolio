/**
 * The whole driver, end to end, against a real Chromium.
 *
 * Google Earth Studio needs a signed-in account and cannot be automated in CI,
 * so the driver runs against test/fixtures/earth-studio-attributes.html - a
 * copy of the markup and behaviour read off a live session with
 * `earth-studio-agent probe`: attribute rows keyed by data-attribute-type,
 * values behind a scrub widget that opens a contenteditable on click, a
 * kilometre-denominated altitude, per-row keyframe buttons, and a timeline
 * driven by arrow keys and transport buttons.
 *
 * This verifies what is ours to get right: seeking, the editing gesture, unit
 * conversion, read-back and error reporting. It cannot verify that the live DOM
 * still matches selectors.ts - that is what `verify-layout` and `probe` are for.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { EarthStudioDriver } from '../src/driver/earth-studio-driver.ts';
import { DEFAULT_SELECTORS } from '../src/driver/selectors.ts';
import { AgentError } from '../src/errors.ts';
import { planCameraPath } from '../src/agent.ts';
import { findChromium } from './helpers/chromium.ts';
import type { PageLike } from '../src/driver/page.ts';

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/earth-studio-attributes.html')).href;

let browser: Browser | undefined;
let launchError: string | undefined;

before(async () => {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: findChromium() });
  } catch (error) {
    launchError = (error instanceof Error ? error.message : String(error)).split('\n')[0];
  }
});

after(async () => {
  await browser?.close();
});

const skip = (): string | false => (browser === undefined ? `Chromium unavailable: ${launchError}` : false);

async function open(): Promise<Page> {
  assert.ok(browser);
  const page = await browser.newPage();
  await page.goto(FIXTURE);
  return page;
}

/** Keyframes the fixture recorded: one per attribute per click of its button. */
const recorded = (page: Page): Promise<Array<{ type: string; frame: number; value: string }>> =>
  page.evaluate(
    () => (window as unknown as { __keyframesAdded: Array<{ type: string; frame: number; value: string }> }).__keyframesAdded,
  );

describe('driver against a real browser', () => {
  test('finds every field the selector set names', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const report = await new EarthStudioDriver(page as unknown as PageLike).verifyLayout();
    assert.equal(report.ok, true, `missing: ${report.missing.join(', ')}`);
    assert.ok(report.fields.every((field) => field.matched !== null));
    await page.close();
  });

  test('writes the PRD example, keyframe by keyframe, at the right frames', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const { path } = await planCameraPath(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.',
    );

    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
    assert.equal(report.applied, path.keyframes.length);

    const added = await recorded(page);
    // One keyframe per camera attribute per planned keyframe.
    const frames = [...new Set(added.map((entry) => entry.frame))].sort((a, b) => a - b);
    assert.deepEqual(frames, path.keyframes.map((keyframe) => keyframe.frame));

    for (const keyframe of path.keyframes) {
      const latitude = added.find((entry) => entry.frame === keyframe.frame && entry.type === 'latitude');
      assert.ok(latitude, `no latitude keyframe at frame ${keyframe.frame}`);
      assert.ok(
        Math.abs(Number(latitude.value) - keyframe.camera.latitude) < 0.001,
        `latitude at frame ${keyframe.frame}: ${latitude.value}`,
      );
    }
    await page.close();
  });

  test('altitude is converted into the unit the field displays', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const { path } = await planCameraPath('fly to Mount Fuji and zoom in close');
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);

    // The plan asks for 1500 m. The field reads in kilometres but its edit box
    // holds metres, so 1500 is typed and 1.5 appears on screen.
    const altitude = report.results.at(-1)?.details.find((detail) => detail.attributeType === 'altitude');
    assert.equal(altitude?.planned, 1500);
    assert.equal(altitude?.typed, 1500);
    assert.equal(altitude?.metresPerEditUnit, 1);
    assert.equal(altitude?.displayUnit, 'Kilometers');

    // 1500 m is below the size at which the field switches to kilometres, so
    // the value on screen is in metres.
    const added = await recorded(page);
    const last = added.filter((entry) => entry.type === 'altitude').at(-1);
    assert.equal(last?.value, '1500');
    await page.close();
  });

  test('the establishing altitude of 10,000,000 m lands without exponent notation', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const { path } = await planCameraPath('start from space, fly to Tokyo');
    await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);

    const added = await recorded(page);
    const first = added.find((entry) => entry.type === 'altitude');
    assert.equal(first?.value, '10000');
    assert.ok(!(first?.value ?? '').includes('e'));
    await page.close();
  });

  test('negative and high-precision coordinates survive the round trip', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const { path } = await planCameraPath('fly to Machu Picchu');
    await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);

    const added = await recorded(page);
    const latitude = added.filter((entry) => entry.type === 'latitude').at(-1);
    const longitude = added.filter((entry) => entry.type === 'longitude').at(-1);
    assert.ok(Math.abs(Number(latitude?.value) - -13.1631) < 0.001);
    assert.ok(Math.abs(Number(longitude?.value) - -72.545) < 0.001);
    await page.close();
  });

  test('the playhead is moved before each keyframe is written', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const { path } = await planCameraPath('fly to Rome. hold 2 seconds');
    const seeks: number[] = [];
    const driver = new EarthStudioDriver(page as unknown as PageLike, {
      onProgress: (event) => {
        if (event.kind === 'seek') seeks.push(event.frame);
      },
    });
    await driver.applyPath(path);

    assert.deepEqual(seeks, path.keyframes.map((keyframe) => keyframe.frame));
    assert.equal(await driver.currentFrame(), path.keyframes.at(-1)?.frame);
    await page.close();
  });

  test('optional attributes are skipped, not failed, when a project omits them', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    // A project without the lens attributes on its timeline.
    await page.evaluate(() => document.querySelector('[data-attribute-type="fov"]')?.remove());

    const { path } = await planCameraPath('fly to Rome');
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    assert.equal(report.failures.length, 0);
    assert.ok(report.results[0]?.skipped.includes('fieldOfView'));
    await page.close();
  });

  test('an attribute present but not shown is skipped, not clicked at', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    // Exactly what the live project did with Roll: the row is in the DOM but
    // was never added to the timeline, so it renders to nothing. Clicking it
    // hung until the timeout and failed the whole run.
    await page.addStyleTag({ content: '[data-attribute-type="rotationZ"] { display: none !important; }' });

    const { path } = await planCameraPath('fly to Rome');
    const started = Date.now();
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);

    assert.equal(report.failures.length, 0);
    assert.ok(report.results[0]?.skipped.includes('roll'));
    // It must be skipped outright, not waited on.
    assert.ok(Date.now() - started < 20_000, 'the hidden row should not be waited for');
    await page.close();
  });

  test('a required attribute that is present but hidden is a clear failure', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    await page.addStyleTag({ content: '[data-attribute-type="altitude"] { display: none !important; }' });

    const { path } = await planCameraPath('fly to Rome');
    await assert.rejects(
      () => new EarthStudioDriver(page as unknown as PageLike).applyPath(path),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_LAYOUT_MISMATCH');
        assert.match(error.detail ?? '', /camera altitude/);
        return true;
      },
    );
    await page.close();
  });

  test('the layout report says when a field is there but not shown', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    await page.addStyleTag({ content: '[data-attribute-type="rotationZ"] { display: none !important; }' });

    const report = await new EarthStudioDriver(page as unknown as PageLike).verifyLayout();
    assert.equal(report.ok, true, 'an optional hidden field must not fail the check');
    const roll = report.fields.find((field) => field.name === 'roll');
    assert.equal(roll?.matched, null);
    assert.equal(roll?.note, 'on the page but not shown');
    await page.close();
  });

  test('a missing required row stops the run before anything is written', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    await page.evaluate(() => document.querySelector('[data-attribute-type="altitude"]')?.remove());

    const { path } = await planCameraPath('fly to Rome');
    await assert.rejects(
      () => new EarthStudioDriver(page as unknown as PageLike).applyPath(path),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_LAYOUT_MISMATCH');
        assert.match(error.detail ?? '', /camera altitude/);
        assert.match(error.hint ?? '', /probe/);
        return true;
      },
    );
    assert.deepEqual(await recorded(page), []);
    await page.close();
  });

  test('a field that will not take the value is reported with its step and frame', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    // Stand in for a field that silently refuses what it is given.
    await page.evaluate(() => {
      const row = document.querySelector('[data-attribute-type="altitude"] .presentedValue');
      const observer = new MutationObserver(() => {
        if (row !== null && row.textContent !== '999999') row.textContent = '999999';
      });
      if (row !== null) observer.observe(row, { childList: true, characterData: true, subtree: true });
    });

    const { path } = await planCameraPath('fly to Rome');
    await assert.rejects(
      () => new EarthStudioDriver(page as unknown as PageLike).applyPath(path),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FIELD_WRITE_FAILED');
        assert.match(error.message, /frame 0/);
        assert.match(error.detail ?? '', /altitude/i);
        return true;
      },
    );
    await page.close();
  });

  test('continueOnError reports every bad keyframe instead of only the first', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    await page.evaluate(() => {
      const row = document.querySelector('[data-attribute-type="altitude"] .presentedValue');
      const observer = new MutationObserver(() => {
        if (row !== null && row.textContent !== '999999') row.textContent = '999999';
      });
      if (row !== null) observer.observe(row, { childList: true, characterData: true, subtree: true });
    });

    const { path } = await planCameraPath('fly to Rome. hold 2 seconds');
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path, { continueOnError: true });
    assert.equal(report.total, path.keyframes.length);
    assert.equal(report.failures.length, path.keyframes.length);
    for (const failure of report.failures) assert.match(failure.error ?? '', /altitude/i);
    await page.close();
  });

  test('open() rejects a page that is not the editor', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    assert.ok(browser);
    const page = await browser.newPage();
    await page.setContent('<h1>Sign in to continue</h1>');
    await assert.rejects(
      () => new EarthStudioDriver(page as unknown as PageLike).open(FIXTURE, { navigate: false }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_NOT_READY');
        assert.match(error.hint ?? '', /probe/);
        return true;
      },
    );
    await page.close();
  });

  test('open() accepts the editor itself', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    await new EarthStudioDriver(page as unknown as PageLike).open(FIXTURE, { navigate: false });
    await page.close();
  });

  test('a long multi-place path is written in full', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const command = [
      'Start from space.',
      'Fly to Iceland and zoom to country level.',
      'Hold 2 seconds.',
      'Then fly to the Blue Lagoon and zoom in close.',
      'Hold 1 second.',
      'Then fly to Reykjavik at city level.',
    ].join('\n');
    const { path } = await planCameraPath(command);
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);

    assert.equal(report.failures.length, 0);
    assert.equal(report.applied, path.keyframes.length);
    assert.ok(path.keyframes.length >= 5);

    const added = await recorded(page);
    const frames = [...new Set(added.map((entry) => entry.frame))].sort((a, b) => a - b);
    assert.deepEqual(frames, path.keyframes.map((keyframe) => keyframe.frame));
    await page.close();
  });

  test('every camera attribute the selector set names is written', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await open();
    const { path } = await planCameraPath('fly to Rome', { config: { defaultTilt: 30, defaultFieldOfView: 45 } });
    await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);

    const added = await recorded(page);
    const types = new Set(added.map((entry) => entry.type));
    for (const field of Object.values(DEFAULT_SELECTORS.camera)) {
      assert.ok(types.has(field.attributeType), `${field.label} was never written`);
    }
    assert.equal(added.filter((entry) => entry.type === 'rotationY').at(-1)?.value, '30');
    assert.equal(added.filter((entry) => entry.type === 'fov').at(-1)?.value, '45');
    await page.close();
  });
});
