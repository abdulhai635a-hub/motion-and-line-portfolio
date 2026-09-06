/**
 * Attaching to a browser the user started themselves (`--cdp`).
 *
 * Google refuses to sign in inside an automation-launched browser ("This
 * browser or app may not be secure"), so the practical route is: the person
 * signs in normally in their own Chrome, started with --remote-debugging-port,
 * and the agent attaches to that window. This test starts a browser exactly
 * that way and drives it through the real launcher.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChromium } from '../src/driver/page.ts';
import { EarthStudioDriver } from '../src/driver/earth-studio-driver.ts';
import { planCameraPath } from '../src/agent.ts';
import { AgentError } from '../src/errors.ts';
import { findChromium } from './helpers/chromium.ts';

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/mock-earth-studio.html')).href;

let child: ChildProcess | undefined;
let endpoint: string | undefined;
let profile: string | undefined;
let reason = 'not started';

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function waitForEndpoint(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  return false;
}

before(async () => {
  let executable = findChromium();
  if (executable === undefined) {
    try {
      const { chromium } = await import('playwright');
      executable = chromium.executablePath();
    } catch (error) {
      reason = `Playwright is unavailable: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
  }
  const port = await freePort();
  profile = await mkdtemp(join(tmpdir(), 'es-cdp-'));
  child = spawn(
    executable,
    ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, FIXTURE],
    { stdio: 'ignore' },
  );
  child.on('error', () => { child = undefined; });
  const candidate = `http://127.0.0.1:${port}`;
  if (await waitForEndpoint(candidate, 20_000)) endpoint = candidate;
  else reason = 'the browser never opened its debugging port';
});

after(async () => {
  // Wait for the browser to actually exit: deleting its profile while it is
  // still flushing files races and fails with ENOTEMPTY.
  if (child !== undefined && child.exitCode === null) {
    const exited = new Promise<void>((done) => child?.once('exit', () => done()));
    child.kill();
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5_000))]);
  }
  if (profile !== undefined) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

const skip = (): string | false => (endpoint === undefined ? `No attachable browser: ${reason}` : false);

describe('attaching over CDP', () => {
  test('attaches to the running browser and finds the open page', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const session = await launchChromium({ cdpEndpoint: endpoint });
    const report = await new EarthStudioDriver(session.page).verifyLayout();
    assert.equal(report.ok, true);
    await session.close();
  });

  test('writes the whole plan into the attached page', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const session = await launchChromium({ cdpEndpoint: endpoint });
    const { path } = await planCameraPath('zoom into Japan, hold 3 seconds, then fly to Mount Fuji and zoom in close');
    const driver = new EarthStudioDriver(session.page);
    // navigate:false is what the CLI does here: the page already holds the project.
    await driver.open(FIXTURE, { navigate: false });
    const report = await driver.applyPath(path);
    assert.equal(report.failures.length, 0);
    assert.equal(report.applied, path.keyframes.length);
    await session.close();
  });

  test('disconnecting leaves the browser running, because it belongs to the user', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const session = await launchChromium({ cdpEndpoint: endpoint });
    await session.close();
    const response = await fetch(`${endpoint}/json/version`);
    assert.equal(response.ok, true, 'the browser should still be running after we disconnect');
  });

  test('a dead endpoint is explained, with the command that fixes it', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const port = await freePort();
    await assert.rejects(() => launchChromium({ cdpEndpoint: `http://127.0.0.1:${port}` }), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'DRIVER_LAUNCH_FAILED');
      assert.match(error.message, /attach/i);
      assert.match(error.hint ?? '', /--remote-debugging-port/);
      return true;
    });
  });
});
