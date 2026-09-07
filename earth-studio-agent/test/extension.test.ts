/**
 * The extension's half of the agent, run the way the extension runs it.
 *
 * Inside a content script there is no Playwright: the code is already in the
 * page and drives the DOM directly. So these tests build the same bundle the
 * extension ships, inject it into the Earth Studio fixture, and call it exactly
 * as the content script does - which is the only way to know that synthetic
 * clicks and keystrokes reach the editor at all.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser, Page } from 'playwright';
import { findChromium } from './helpers/chromium.ts';

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/earth-studio-attributes.html')).href;
const ENTRY = resolve(import.meta.dirname, '../src/extension/run-in-page.ts');
const PANEL_ENTRY = resolve(import.meta.dirname, '../src/extension/panel.ts');
const PANEL_HTML = resolve(import.meta.dirname, '../extension/panel.html');

let browser: Browser | undefined;
let bundle = '';
let workspace: string | undefined;
let reason = 'not built';
let panelUrl = '';

before(async () => {
  try {
    workspace = await mkdtemp(join(tmpdir(), 'es-ext-'));
    const outfile = join(workspace, 'agent.js');
    const { build } = await import('esbuild');
    await build({
      entryPoints: [ENTRY],
      bundle: true,
      format: 'iife',
      globalName: 'EarthStudioAgent',
      target: 'chrome120',
      outfile,
      logLevel: 'silent',
    });
    bundle = await readFile(outfile, 'utf8');

    // The side panel, built and laid out the way the extension folder is, so
    // the real panel.html drives the real panel.js.
    await build({
      entryPoints: [PANEL_ENTRY],
      bundle: true,
      format: 'iife',
      target: 'chrome120',
      outfile: join(workspace, 'panel.js'),
      logLevel: 'silent',
    });
    await writeFile(join(workspace, 'panel.html'), await readFile(PANEL_HTML, 'utf8'));
    panelUrl = pathToFileURL(join(workspace, 'panel.html')).href;

    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: findChromium() });
  } catch (error) {
    reason = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown';
  }
});

after(async () => {
  await browser?.close();
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
});

const skip = (): string | false =>
  browser === undefined || bundle === '' ? `Cannot run the extension bundle: ${reason}` : false;

/** A page holding the fixture with the agent bundle injected, as a tab would. */
async function openStudio(options: { hideOptional?: boolean } = {}): Promise<Page> {
  assert.ok(browser);
  const page = await browser.newPage();
  await page.goto(FIXTURE);
  if (options.hideOptional === true) {
    // Most projects do not have Roll or Field of View on their timeline.
    await page.addStyleTag({
      content: '[data-attribute-type="rotationZ"],[data-attribute-type="fov"]{display:none !important;}',
    });
  }
  await page.addScriptTag({ content: bundle });
  return page;
}

interface RunSummary {
  applied: number;
  total: number;
  via: string;
  detected?: string;
  english: string;
  frames: number[];
  altitudes: string[];
  messages: string[];
  skipped: string[];
}

async function run(page: Page, command: string, options: Record<string, unknown> = {}): Promise<RunSummary> {
  return page.evaluate(
    async ([text, opts]) => {
      const messages: string[] = [];
      const api = (window as unknown as {
        EarthStudioAgent: {
          runCommandInPage(command: string, options: unknown): Promise<{
            report?: { applied: number; total: number; results: Array<{ skipped: string[] }> };
            path: { keyframes: Array<{ frame: number }> };
            translation: { via: string; detected?: string; english: string };
          }>;
        };
      }).EarthStudioAgent;

      const parsed = JSON.parse(opts as string) as Record<string, unknown>;
      const result = await api.runCommandInPage(text as string, {
        ...parsed,
        onProgress: (event: { message: string }) => messages.push(event.message),
      });

      const added = (window as unknown as { __keyframesAdded: Array<{ type: string; frame: number; value: string }> })
        .__keyframesAdded;
      return {
        applied: result.report?.applied ?? 0,
        total: result.report?.total ?? 0,
        via: result.translation.via,
        detected: result.translation.detected,
        english: result.translation.english,
        frames: result.path.keyframes.map((keyframe) => keyframe.frame),
        altitudes: added.filter((entry) => entry.type === 'altitude').map((entry) => entry.value),
        messages,
        skipped: result.report?.results[0]?.skipped ?? [],
      };
    },
    [command, JSON.stringify(options)] as const,
  );
}

describe('the bundle a Chrome extension can actually run', () => {
  test('never builds a function from a string', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    // Manifest V3 forbids eval and new Function in extension code. The driver
    // used to build page functions from strings for Playwright, and the panel
    // refused to run at all: "Evaluating a string as JavaScript violates the
    // following Content Security Policy directive".
    assert.doesNotMatch(bundle, /\bnew Function\b/);
    assert.doesNotMatch(bundle, /(?<![.\w])eval\s*\(/);
  });

  test('runs under a policy that forbids eval, as an extension does', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    assert.ok(browser);

    // The real constraint, served the way a browser really receives it: a
    // Content-Security-Policy header with no 'unsafe-eval', which is what
    // Manifest V3 imposes on extension code.
    //
    // The bundle is served as a file and loaded by the document, and the run is
    // started by the document's own script. Scripts added through the debugging
    // protocol are not subject to the page's policy, so injecting them the
    // usual way would prove nothing.
    const fixture = await readFile(new URL(FIXTURE), 'utf8');
    const html = fixture.replace(
      '</body>',
      '<script src="/agent.js"></script>' +
        '<script>window.__run = EarthStudioAgent.runCommandInPage("fly to Rome. hold 2 seconds", {})' +
        '.then(function (r) { return { ok: true, applied: r.report.applied }; })' +
        '.catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });</script>' +
        '</body>',
    );

    const server = createServer((request, response) => {
      if ((request.url ?? '').startsWith('/agent.js')) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end(bundle);
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "script-src 'self' 'unsafe-inline'",
      });
      response.end(html);
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as AddressInfo;

    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0] ?? error.message));
    try {
      await page.goto(`http://127.0.0.1:${port}/`);

      const outcome = (await page.evaluate(
        () => (window as unknown as { __run?: Promise<{ ok: boolean; applied?: number; error?: string }> }).__run,
      )) as { ok: boolean; applied?: number; error?: string } | undefined;

      assert.ok(outcome, `the bundle did not load under the policy: ${pageErrors.join('; ')}`);
      assert.equal(outcome.ok, true, `the run failed under the policy: ${outcome.error}`);
      assert.equal(outcome.applied, 3);
      assert.deepEqual(pageErrors, [], 'nothing should have been refused by the policy');
    } finally {
      await page.close();
      await new Promise<void>((closed) => server.close(() => closed()));
    }
  });
});

describe('the side panel, where the settings live', () => {
  /** The panel with a stubbed extension API, capturing what it sends to the tab. */
  async function openPanel(): Promise<Page> {
    assert.ok(browser);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const sent: unknown[] = [];
      (window as unknown as { __sent: unknown[] }).__sent = sent;
      (window as unknown as { chrome: unknown }).chrome = {
        tabs: {
          query: async () => [{ id: 1, url: 'https://earth.google.com/studio/project' }],
          // Round-tripped through JSON, as Chrome's messaging does, so a key
          // whose value is undefined arrives as absent - which is the whole
          // point of leaving a setting blank.
          sendMessage: async (_tabId: number, message: unknown) => {
            sent.push(JSON.parse(JSON.stringify(message)));
            return { ok: true, applied: 0, total: 0, steps: [], warnings: [] };
          },
        },
        runtime: { onMessage: { addListener: () => {} } },
      };
    });
    await page.goto(panelUrl);
    return page;
  }

  const settingsSent = async (page: Page): Promise<Record<string, unknown>> => {
    await page.fill('#command', 'fly to Rome');
    await page.click('#run');
    await page.waitForFunction(() => (window as unknown as { __sent: unknown[] }).__sent.length > 0);
    const [message] = (await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent)) as Array<{
      options: { config: Record<string, unknown> };
    }>;
    assert.ok(message);
    return message.options.config;
  };

  test('asks for nothing the user did not set, so the agent decides', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openPanel();
    // The four settings the panel used to pre-fill. Blank is what makes the
    // move length, the tilt and the lens follow the command.
    for (const id of ['transition', 'hold', 'tilt', 'fov']) {
      assert.equal(await page.inputValue(`#${id}`), '', `#${id} should start empty`);
    }

    const config = await settingsSent(page);
    assert.equal(config.frameRate, 30);
    for (const key of ['defaultTransitionSeconds', 'defaultHoldSeconds', 'defaultTilt', 'defaultFieldOfView']) {
      assert.ok(!(key in config), `${key} should not have been sent: ${JSON.stringify(config)}`);
    }
    await page.close();
  });

  test('sends a setting the user does fill in', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openPanel();
    await page.click('summary'); // the settings are folded away by default
    await page.fill('#tilt', '45');
    await page.fill('#fov', '24');

    const config = await settingsSent(page);
    assert.equal(config.defaultTilt, 45);
    assert.equal(config.defaultFieldOfView, 24);
    assert.ok(!('defaultTransitionSeconds' in config), 'an untouched box stays automatic');
    await page.close();
  });
});

describe('running inside the page, as the extension does', () => {
  test('writes the PRD example with no browser automation at all', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openStudio();
    const result = await run(page, 'Start from space, zoom into Japan. Hold 3 seconds. Then fly to Mount Fuji and zoom in close.');

    assert.equal(result.applied, 4);
    assert.equal(result.total, 4);
    assert.equal(result.frames.length, 4);
    assert.deepEqual(result.frames, [...result.frames].sort((a, b) => a - b));
    // Synthetic clicks and keystrokes have to reach the editor for this to hold.
    assert.deepEqual(result.altitudes, ['10000', '800', '800', '1500']);
    await page.close();
  });

  test('reports progress the panel can show', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openStudio();
    const result = await run(page, 'fly to Rome. hold 2 seconds');

    assert.ok(result.messages.some((message) => message.includes('camera path')));
    assert.ok(result.messages.some((message) => /Wrote keyframe 1 of/.test(message)));
    assert.ok(result.messages.at(-1)?.startsWith('Wrote '));
    await page.close();
  });

  test('skips attributes this project does not have on its timeline', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openStudio({ hideOptional: true });
    const result = await run(page, 'fly to Rome');

    assert.equal(result.applied, result.total);
    assert.deepEqual(result.skipped.sort(), ['fieldOfView', 'roll']);
    await page.close();
  });

  test('takes a command in another language through a translator', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openStudio();
    const result = await page.evaluate(async () => {
      const api = (window as unknown as {
        EarthStudioAgent: { runCommandInPage(command: string, options: unknown): Promise<unknown> };
      }).EarthStudioAgent;
      const bengali = 'মহাকাশ থেকে শুরু করে জাপানে জুম করো। ৩ সেকেন্ড থামো।';
      const outcome = (await api.runCommandInPage(bengali, {
        language: {
          detectLanguage: async () => 'bn',
          translate: async () => 'Start from space, zoom into Japan. Hold 3 seconds.',
        },
      })) as {
        report: { applied: number };
        translation: { via: string; detected?: string; english: string };
        path: { steps: Array<{ place: { name: string } | null }> };
      };
      return {
        via: outcome.translation.via,
        detected: outcome.translation.detected,
        english: outcome.translation.english,
        applied: outcome.report.applied,
        places: outcome.path.steps.map((step) => step.place?.name ?? ''),
      };
    });

    assert.equal(result.via, 'supplied');
    assert.equal(result.detected, 'bn');
    assert.equal(result.applied, 3);
    // The place name survives translation, which is why translating beats a
    // keyword table per language.
    assert.ok(result.places.includes('Japan'));
    await page.close();
  });

  test('a dry run plans without touching the project', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openStudio();
    const result = await run(page, 'fly to Rome. hold 2 seconds', { dryRun: true });

    assert.equal(result.frames.length, 3);
    assert.deepEqual(result.altitudes, [], 'a dry run must write nothing');
    assert.ok(result.messages.at(-1)?.includes('nothing was written'));
    await page.close();
  });

  test('an unresolvable place fails with the step it belongs to', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await openStudio();
    const failure = await page.evaluate(async () => {
      const api = (window as unknown as {
        EarthStudioAgent: { runCommandInPage(command: string, options: unknown): Promise<unknown> };
      }).EarthStudioAgent;
      try {
        await api.runCommandInPage('fly to Rome. fly to Qqqqzzz Nowhere', {});
        return 'no error';
      } catch (error) {
        return (error as { format?: () => string }).format?.() ?? String(error);
      }
    });

    assert.match(failure, /PLACE_NOT_FOUND/);
    assert.match(failure, /step 3/);
    await page.close();
  });

  test('a page that is not the editor is refused before anything is written', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    assert.ok(browser);
    const page = await browser.newPage();
    await page.setContent('<h1>Sign in to continue</h1>');
    await page.addScriptTag({ content: bundle });

    const failure = await page.evaluate(async () => {
      const api = (window as unknown as {
        EarthStudioAgent: { runCommandInPage(command: string, options: unknown): Promise<unknown> };
      }).EarthStudioAgent;
      try {
        await api.runCommandInPage('fly to Rome', {});
        return 'no error';
      } catch (error) {
        return (error as { format?: () => string }).format?.() ?? String(error);
      }
    });

    assert.match(failure, /DRIVER_LAYOUT_MISMATCH/);
    assert.match(failure, /Open a project/);
    await page.close();
  });
});
