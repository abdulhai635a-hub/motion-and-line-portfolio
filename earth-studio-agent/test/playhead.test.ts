/**
 * Moving the playhead, against a fixture built from the live editor's timeline
 * controls: arrow keys step one frame, Shift+arrow five, and the transport
 * buttons (`click:jumpWorkspaceStart`, `click:forward`) do the same by click.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { readFrame, releaseFocus, seekToFrame } from '../src/driver/playhead.ts';
import { AgentError } from '../src/errors.ts';
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

const actualFrame = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __frame: () => number }).__frame());

describe('seekToFrame', () => {
  test('reaches an exact frame and says so', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const result = await seekToFrame(page as unknown as PageLike, 120);
    assert.equal(result.to, 120);
    assert.equal(await actualFrame(page), 120);
    await page.close();
  });

  test('uses coarse steps, so a long move is not one press per frame', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const result = await seekToFrame(page as unknown as PageLike, 390);
    assert.equal(result.to, 390);
    // 390 frames is 78 Shift presses, not 390 taps.
    assert.ok(result.presses <= 82, `took ${result.presses} presses`);
    await page.close();
  });

  test('moves backwards as well as forwards', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await seekToFrame(page as unknown as PageLike, 200);
    const result = await seekToFrame(page as unknown as PageLike, 47);
    assert.equal(result.from, 200);
    assert.equal(result.to, 47);
    assert.equal(await actualFrame(page), 47);
    await page.close();
  });

  test('a seek to where it already is costs nothing', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await seekToFrame(page as unknown as PageLike, 30);
    const result = await seekToFrame(page as unknown as PageLike, 30);
    assert.equal(result.presses, 0);
    await page.close();
  });

  test('a sequence of ascending frames all land exactly', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    for (const frame of [0, 120, 210, 330, 390]) {
      const result = await seekToFrame(page as unknown as PageLike, frame);
      assert.equal(result.to, frame, `wanted ${frame}, landed ${result.to}`);
    }
    await page.close();
  });

  test('falls back to the transport buttons when the keyboard is ignored', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // Stand in for a session where the shortcuts never reach the application -
    // which is exactly what the first live probe run looked like.
    await page.evaluate(() => {
      (window as unknown as { __keyboardEnabled: boolean }).__keyboardEnabled = false;
    });

    const result = await seekToFrame(page as unknown as PageLike, 4);
    assert.equal(result.to, 4);
    assert.equal(result.corrected, true, 'the fallback should be reported as a correction');
    assert.equal(await actualFrame(page), 4);
    await page.close();
  });

  test('reads the frame back even when the readout shows a timecode', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await page.click('li.control.timecode'); // switch to timecode format
    assert.match((await page.locator('li.control.timecode').textContent()) ?? '', /:/);

    assert.equal(await readFrame(page as unknown as PageLike), 0);
    await page.close();
  });

  test('refuses a frame number that is not one', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    for (const bad of [-1, 1.5]) {
      await assert.rejects(() => seekToFrame(page as unknown as PageLike, bad), (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FRAME_SEEK_FAILED');
        return true;
      });
    }
    await page.close();
  });

  test('refuses a move that would take absurdly many presses', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await assert.rejects(
      () => seekToFrame(page as unknown as PageLike, 400, { maxPresses: 10 }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FRAME_SEEK_FAILED');
        assert.match(error.hint ?? '', /maxPresses/);
        return true;
      },
    );
    await page.close();
  });

  test('gives up with the frame it reached, rather than pretending', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // Nothing works: no keyboard, and the transport button is gone.
    await page.evaluate(() => {
      (window as unknown as { __keyboardEnabled: boolean }).__keyboardEnabled = false;
      document.querySelector('[data-action="click:forward"]')?.remove();
    });

    await assert.rejects(
      () => seekToFrame(page as unknown as PageLike, 4),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FRAME_SEEK_FAILED');
        assert.match(error.detail ?? '', /sits at frame 0/);
        assert.match(error.hint ?? '', /probe --playhead/);
        return true;
      },
    );
    await page.close();
  });

  test('releaseFocus takes focus off a control', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await page.click('li.control.timecode');
    assert.match(await page.evaluate(() => document.activeElement?.className ?? ''), /timecode/);

    await releaseFocus(page as unknown as PageLike);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? ''), 'body');
    await page.close();
  });
});
