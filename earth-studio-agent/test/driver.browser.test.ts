/**
 * End-to-end driver test against a real Chromium.
 *
 * Google Earth Studio needs a signed-in Google account and cannot be automated
 * in CI, so the driver is exercised against test/fixtures/mock-earth-studio.html,
 * which reproduces the one behaviour the driver relies on: committing a value in
 * an attribute field creates a keyframe for that attribute at the current frame.
 *
 * This checks the parts that are ours to get right - selector resolution, frame
 * seeking, value formatting, read-back verification and error reporting. It
 * cannot check that the real Earth Studio DOM matches DEFAULT_SELECTORS; that is
 * what `earth-studio-agent verify-layout` is for.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { EarthStudioDriver } from '../src/driver/earth-studio-driver.ts';
import { AgentError } from '../src/errors.ts';
import { planCameraPath } from '../src/agent.ts';
import { findChromium } from './helpers/chromium.ts';
import type { PageLike } from '../src/driver/page.ts';
import type { CameraPath } from '../src/types.ts';

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/mock-earth-studio.html')).href;

let browser: Browser | undefined;
let launchError: string | undefined;

before(async () => {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: findChromium() });
  } catch (error) {
    // Playwright's install banner is several lines long; the first line says what happened.
    const message = error instanceof Error ? error.message : String(error);
    launchError = message.split('\n')[0];
  }
});

after(async () => {
  await browser?.close();
});

async function openMock(query = ''): Promise<Page> {
  assert.ok(browser, `Chromium is unavailable: ${launchError ?? 'unknown reason'}`);
  const page = await browser.newPage();
  await page.goto(`${FIXTURE}${query}`);
  return page;
}

/** keyframes recorded by the mock: attribute -> frame -> value. */
async function recorded(page: Page): Promise<Record<string, Record<string, number>>> {
  return page.evaluate(() => (window as unknown as { __keyframes: Record<string, Record<string, number>> }).__keyframes);
}

const skip = (): string | false => (browser === undefined ? `Chromium unavailable: ${launchError}` : false);

describe('driver against a real browser', () => {
  test('finds every field on a page that matches the default selectors', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock();
    const report = await new EarthStudioDriver(page as unknown as PageLike).verifyLayout();
    assert.equal(report.ok, true);
    assert.equal(report.missing.length, 0);
    assert.equal(report.fields.every((field) => field.matched !== null), true);
    await page.close();
  });

  test('writes the PRD example into the page, keyframe by keyframe', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock();
    const { path } = await planCameraPath(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.\nHold for 2 seconds.',
    );

    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    assert.equal(report.failures.length, 0);
    assert.equal(report.applied, path.keyframes.length);

    const keyframes = await recorded(page);
    // One keyframe per attribute per frame, at exactly the planned frames.
    const frames = Object.keys(keyframes.latitude ?? {}).map(Number).sort((a, b) => a - b);
    assert.deepEqual(frames, path.keyframes.map((keyframe) => keyframe.frame));

    for (const keyframe of path.keyframes) {
      assert.ok(
        Math.abs((keyframes.latitude?.[keyframe.frame] ?? 0) - keyframe.camera.latitude) < 1e-6,
        `latitude at frame ${keyframe.frame}`,
      );
      assert.ok(
        Math.abs((keyframes.longitude?.[keyframe.frame] ?? 0) - keyframe.camera.longitude) < 1e-6,
        `longitude at frame ${keyframe.frame}`,
      );
      assert.equal(keyframes.altitude?.[keyframe.frame], keyframe.camera.altitude, `altitude at frame ${keyframe.frame}`);
    }
    await page.close();
  });

  test('writes 10,000,000 m without exponent notation', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock();
    const { path } = await planCameraPath('start from space, fly to Tokyo');
    await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    const value = await page.locator('[data-attribute="altitude"] input').inputValue();
    assert.ok(!value.includes('e'), `altitude field reads "${value}"`);
    const keyframes = await recorded(page);
    assert.equal(keyframes.altitude?.['0'], 10_000_000);
    await page.close();
  });

  test('writes negative and high-precision coordinates exactly', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock();
    const { path } = await planCameraPath('fly to Machu Picchu');
    await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    const keyframes = await recorded(page);
    const lastFrame = String(path.keyframes.at(-1)?.frame);
    assert.ok(Math.abs((keyframes.latitude?.[lastFrame] ?? 0) - -13.1631) < 1e-9);
    assert.ok(Math.abs((keyframes.longitude?.[lastFrame] ?? 0) - -72.545) < 1e-9);
    await page.close();
  });

  test('the playhead is moved before each keyframe is typed', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock();
    const { path } = await planCameraPath('fly to Rome. hold 2 seconds');
    await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    const order = await page.evaluate(
      () => (window as unknown as { __writeOrder: Array<{ attribute: string; frame: number }> }).__writeOrder,
    );
    // Every attribute of a keyframe lands on the same frame, and frames only advance.
    let previous = -1;
    for (const entry of order) {
      assert.ok(entry.frame >= previous, `frame went backwards: ${entry.frame} after ${previous}`);
      previous = entry.frame;
    }
    assert.equal(previous, path.keyframes.at(-1)?.frame);
    await page.close();
  });

  test('a missing required field stops the run before anything is typed (PRD 11)', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock('?missing=altitude');
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
    assert.deepEqual(await recorded(page), {});
    await page.close();
  });

  test('a field that silently rewrites its value is caught by the read-back check (FR6)', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock('?clamp=altitude&clampMax=1000');
    const { path } = await planCameraPath('fly to Rome');
    await assert.rejects(
      () => new EarthStudioDriver(page as unknown as PageLike).applyPath(path),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FIELD_WRITE_FAILED');
        assert.equal(error.stepIndex, 1);
        assert.match(error.detail ?? '', /altitude/i);
        return true;
      },
    );
    await page.close();
  });

  test('continueOnError reports every bad keyframe instead of the first', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock('?clamp=altitude&clampMax=1000');
    const { path } = await planCameraPath('fly to Rome. hold 2 seconds');
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path, { continueOnError: true });
    assert.equal(report.total, path.keyframes.length);
    assert.equal(report.failures.length, path.keyframes.length);
    for (const failure of report.failures) assert.match(failure.error ?? '', /altitude/i);
    await page.close();
  });

  test('open() waits for the editor and reports when it never appears', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    assert.ok(browser);
    const page = await browser.newPage();
    const driver = new EarthStudioDriver(page as unknown as PageLike, {
      selectors: {
        ...(await import('../src/driver/selectors.ts')).DEFAULT_SELECTORS,
        appReady: { label: 'editor root', required: true, candidates: ['#definitely-not-here'] },
      },
    });
    await assert.rejects(() => driver.open(FIXTURE), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'DRIVER_NOT_READY');
      return true;
    });
    await page.close();
  });

  test('open() succeeds on a page that looks like the editor', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    assert.ok(browser);
    const page = await browser.newPage();
    await new EarthStudioDriver(page as unknown as PageLike).open(FIXTURE);
    await page.close();
  });

  test('inspect describes a layout the default selectors do not know', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    assert.ok(browser);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(resolve(import.meta.dirname, 'fixtures/unknown-layout.html')).href);

    const { inspectPage, renderInspection } = await import('../src/driver/inspect.ts');
    const inspection = await inspectPage(page as unknown as PageLike);

    assert.equal(inspection.fieldCount, 5);
    assert.equal(inspection.iframeCount, 0);
    assert.deepEqual(
      inspection.fields.map((field) => field.label),
      ['Frame', 'Latitude', 'Longitude', 'Altitude', 'Pan'],
    );

    // Every reported selector must actually reach exactly the field it describes:
    // a selector that does not resolve is worse than no report at all.
    for (const field of inspection.fields) {
      const count = await page.locator(field.selector).count();
      assert.equal(count, 1, `${field.selector} matched ${count} elements`);
    }

    const text = renderInspection(inspection);
    assert.match(text, /#playhead-frame/);
    assert.match(text, /aria-label="Altitude"/);
    await page.close();
  });

  test('deep inspection surfaces the fields the shallow pass cannot see', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    assert.ok(browser);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(resolve(import.meta.dirname, 'fixtures/checkbox-layout.html')).href);

    const { inspectPage, renderInspection } = await import('../src/driver/inspect.ts');
    const shallow = await inspectPage(page as unknown as PageLike);
    // The shallow pass sees only the timeline checkboxes, exactly as it did
    // against the live product - which is why --deep exists.
    assert.equal(shallow.fieldCount, 2);
    assert.equal(shallow.deep, undefined);

    const deep = await inspectPage(page as unknown as PageLike, 60, true);
    assert.ok(deep.deep);
    assert.deepEqual(deep.deep.ids, ['rotationZ', 'altitude']);
    assert.ok(
      deep.deep.numericLike.some((entry) => entry.text === '1500'),
      'the altitude readout should be reported as a numeric element',
    );
    assert.ok(
      deep.deep.samples.some((sample) => sample.html.includes('data-attr="rotationZ"')),
      'the raw row HTML should show how the value field is built',
    );

    const text = renderInspection(deep);
    assert.match(text, /Element ids \(2\)/);
    assert.match(text, /Raw HTML of the row around #rotationZ/);
    await page.close();
  });

  test('inspect says why a page with no fields has none', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    assert.ok(browser);
    const page = await browser.newPage();
    await page.setContent('<h1>Sign in to continue</h1>');
    const { inspectPage } = await import('../src/driver/inspect.ts');
    const inspection = await inspectPage(page as unknown as PageLike);
    assert.equal(inspection.fieldCount, 0);
    assert.match(inspection.note ?? '', /not the editor page/);
    await page.close();
  });

  test('a long multi-place path is written in full', async (t) => {
    const reason = skip();
    if (reason !== false) return t.skip(reason);
    const page = await openMock();
    const command = [
      'Start from space.',
      'Fly to Iceland and zoom to country level.',
      'Hold 2 seconds.',
      'Then fly to the Blue Lagoon and zoom in close.',
      'Hold 1 second.',
      'Then fly to Reykjavik at city level.',
      'Hold 3 seconds.',
      'Then zoom out to country level.',
    ].join('\n');
    const { path }: { path: CameraPath } = await planCameraPath(command);
    const report = await new EarthStudioDriver(page as unknown as PageLike).applyPath(path);
    assert.equal(report.failures.length, 0);
    assert.equal(report.applied, path.keyframes.length);
    assert.ok(path.keyframes.length >= 7, `only ${path.keyframes.length} keyframes`);

    const keyframes = await recorded(page);
    for (const keyframe of path.keyframes) {
      assert.equal(keyframes.altitude?.[keyframe.frame], keyframe.camera.altitude, `frame ${keyframe.frame}`);
    }
    await page.close();
  });
});
