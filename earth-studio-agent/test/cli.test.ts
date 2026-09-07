/**
 * The CLI is tested by running it as a real subprocess, so argument parsing,
 * file writing, exit codes and stderr all get exercised the way a user meets them.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../src/cli.ts');

let workspace: string;

before(async () => {
  // The space is deliberate: paths with spaces are ordinary on Windows
  // ("C:\\Users\\first last") and have broken this CLI before.
  workspace = await mkdtemp(join(tmpdir(), 'es agent cli '));
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { maxBuffer: 20_000_000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('cli', () => {
  test('--help explains the commands and exits cleanly', async () => {
    const result = await cli('--help');
    assert.equal(result.code, 0);
    assert.match(result.stdout, /earth-studio-agent plan/);
    assert.match(result.stdout, /earth-studio-agent drive/);
    assert.match(result.stdout, /verify-layout/);
  });

  test('plan writes the keyframe JSON and the log', async () => {
    const prefix = join(workspace, 'basic');
    const result = await cli('plan', 'zoom into Japan, hold 3 seconds, then fly to Mount Fuji and zoom in close', '--out', prefix);
    assert.equal(result.code, 0, result.stderr);

    const plan = JSON.parse(await readFile(`${prefix}.json`, 'utf8')) as {
      keyframes: Array<{ frame: number; camera: { altitude: number } }>;
      frameRate: number;
    };
    assert.equal(plan.frameRate, 30);
    // Move durations are worked out from each move, so the frames are not fixed
    // in advance; the commanded hold of 3 seconds is exactly 90 frames.
    const frames = plan.keyframes.map((keyframe) => keyframe.frame);
    assert.equal(frames.length, 4);
    assert.equal((frames[2] ?? 0) - (frames[1] ?? 0), 90);
    assert.deepEqual(frames, [...frames].sort((a, b) => a - b));

    const log = await readFile(`${prefix}.log.txt`, 'utf8');
    assert.match(log, /Mount Fuji/);
    assert.match(result.stdout, /Planned 4 keyframes/);
  });

  test('plan is the default command', async () => {
    const prefix = join(workspace, 'default-cmd');
    const result = await cli('fly to Rome', '--out', prefix, '--quiet');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Planned 2 keyframes/);
  });

  test('--csv and --esp write the extra formats', async () => {
    const prefix = join(workspace, 'formats');
    const result = await cli('plan', 'fly to Rome', '--out', prefix, '--csv', '--esp', '--quiet');
    assert.equal(result.code, 0, result.stderr);
    assert.match(await readFile(`${prefix}.csv`, 'utf8'), /^frame,time,step,/);
    const esp = JSON.parse(await readFile(`${prefix}.esp`, 'utf8')) as { __warning: string };
    assert.match(esp.__warning, /[Ee]xperimental/);
    assert.match(result.stderr, /experimental/i);
  });

  test('project options change the timeline', async () => {
    const prefix = join(workspace, 'options');
    await cli('plan', 'fly to Rome. hold 2 seconds', '--fps', '60', '--transition', '1', '--out', prefix, '--quiet');
    const plan = JSON.parse(await readFile(`${prefix}.json`, 'utf8')) as {
      frameRate: number;
      keyframes: Array<{ frame: number }>;
    };
    assert.equal(plan.frameRate, 60);
    assert.deepEqual(plan.keyframes.map((keyframe) => keyframe.frame), [0, 60, 180]);
  });

  test('--tilt and --fov reach every keyframe', async () => {
    const prefix = join(workspace, 'camera');
    await cli('plan', 'fly to Rome', '--tilt', '35', '--fov', '50', '--out', prefix, '--quiet');
    const plan = JSON.parse(await readFile(`${prefix}.json`, 'utf8')) as {
      keyframes: Array<{ camera: { tilt: number; fieldOfView: number } }>;
    };
    for (const keyframe of plan.keyframes) {
      assert.equal(keyframe.camera.tilt, 35);
      assert.equal(keyframe.camera.fieldOfView, 50);
    }
  });

  test('--no-implicit-start drops the establishing pose', async () => {
    const prefix = join(workspace, 'no-start');
    await cli('plan', 'fly to Rome', '--no-implicit-start', '--out', prefix, '--quiet');
    const plan = JSON.parse(await readFile(`${prefix}.json`, 'utf8')) as { keyframes: unknown[] };
    assert.equal(plan.keyframes.length, 1);
  });

  test('--file reads the command from disk', async () => {
    const script = join(workspace, 'script.txt');
    await writeFile(script, 'Start from space, zoom into Japan.\nHold for 3 seconds.\n', 'utf8');
    const prefix = join(workspace, 'from-file');
    const result = await cli('plan', '--file', script, '--out', prefix, '--quiet');
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(await readFile(`${prefix}.json`, 'utf8')) as { command: string };
    assert.match(plan.command, /zoom into Japan/);
  });

  test('an ambiguous place is reported on stderr but still planned', async () => {
    const prefix = join(workspace, 'ambiguous');
    const result = await cli('plan', 'fly to Georgia', '--out', prefix, '--quiet');
    assert.equal(result.code, 0);
    assert.match(result.stderr, /AMBIGUOUS_PLACE/);
    assert.match(result.stderr, /Georgia/);
  });

  test('an unresolvable place exits non-zero and names the step (FR6)', async () => {
    const result = await cli('plan', 'fly to Qqqqzzz Nowhere', '--out', join(workspace, 'bad'));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PLACE_NOT_FOUND/);
    assert.match(result.stderr, /step 2/);
    assert.match(result.stderr, /hint:/);
  });

  test('an empty command is a clean error, not a crash', async () => {
    const result = await cli('plan', '');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /EMPTY_COMMAND/);
    assert.doesNotMatch(result.stderr, /at Object\./);
  });

  test('a bad option value is explained', async () => {
    const result = await cli('plan', 'fly to Rome', '--fps', 'fast');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INVALID_CONFIG/);
    assert.match(result.stderr, /--fps/);
  });

  test('an unknown option exits with a usage error', async () => {
    const result = await cli('plan', 'fly to Rome', '--nope');
    assert.equal(result.code, 2);
    assert.match(result.stderr, /earth-studio-agent plan/);
  });

  test('a word that is not a command is treated as part of the instruction', async () => {
    const result = await cli('teleport to Tokyo', '--out', join(workspace, 'teleport'), '--quiet');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Planned 2 keyframes/);
  });

  test('a mistyped subcommand is pointed out instead of silently planned', async () => {
    const result = await cli('verify-layuot', '--out', join(workspace, 'typo'), '--quiet');
    assert.match(result.stderr, /Did you mean the "verify-layout" command\?/);
  });

  test('runs when its own path contains a space', async () => {
    // A hand-built `file://` + path comparison silently failed to recognise the
    // entry point here, so the CLI exited 0 having done nothing at all.
    const home = join(workspace, 'copy of agent');
    await cp(resolve(import.meta.dirname, '../src'), join(home, 'src'), { recursive: true });
    const { stdout } = await run(process.execPath, [join(home, 'src', 'cli.ts'), 'plan', 'fly to Rome', '--quiet', '--out', join(home, 'out')]);
    assert.match(stdout, /Planned 2 keyframes/);
    assert.match(await readFile(join(home, 'out.json'), 'utf8'), /"formatVersion": 1/);
  });

  test('login refuses to run without somewhere to save the session', async () => {
    const result = await cli('login');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INVALID_CONFIG/);
    assert.match(result.stderr, /--user-data-dir/);
  });

  test('--help lists every command the dispatcher accepts', async () => {
    const { stdout } = await cli('--help');
    for (const command of ['plan', 'drive', 'login', 'verify-layout', 'places']) {
      assert.match(stdout, new RegExp(`earth-studio-agent ${command}`), command);
    }
  });

  test('places lists the built-in table', async () => {
    const result = await cli('places');
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Mount Fuji/);
    assert.ok(result.stdout.split('\n').length > 100);
  });

  test('--cache-file is written and then reused', async () => {
    const cache = join(workspace, 'cache.json');
    const prefix = join(workspace, 'cached');
    await cli('plan', 'fly to Rome', '--cache-file', cache, '--out', prefix, '--quiet');
    const contents = JSON.parse(await readFile(cache, 'utf8')) as Record<string, { name: string }>;
    assert.equal(contents.rome?.name, 'Rome');

    const second = await cli('plan', 'fly to Rome', '--cache-file', cache, '--out', prefix, '--quiet');
    assert.equal(second.code, 0, second.stderr);
  });

  test('--confirm-ambiguous keeps the automatic choice when there is no terminal', async () => {
    const prefix = join(workspace, 'confirm');
    const result = await cli('plan', 'fly to Georgia', '--confirm-ambiguous', '--out', prefix, '--quiet');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /not a terminal/);
  });

  test('a missing --file is explained, not dumped as a stack trace', async () => {
    const result = await cli('plan', '--file', join(workspace, 'does-not-exist.txt'));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /COMMAND_FILE_UNREADABLE/);
    assert.match(result.stderr, /hint:/);
    assert.doesNotMatch(result.stderr, /at async/);
  });

  test('a broken --selectors file is reported before a browser is opened', async () => {
    const broken = join(workspace, 'broken-selectors.json');
    await writeFile(broken, 'not json', 'utf8');
    const result = await cli('drive', 'fly to Rome', '--selectors', broken, '--out', join(workspace, 'sel'), '--quiet');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /SELECTOR_FILE_UNREADABLE/);
    assert.doesNotMatch(result.stderr, /at async/);
  });

  test('drive without a browser fails with an actionable message', async () => {
    const result = await cli('drive', 'fly to Rome', '--out', join(workspace, 'drive'), '--quiet', '--executable-path', '/definitely/not/a/browser');
    assert.equal(result.code, 1);
    // Either Playwright is missing, or it is present and the binary is not.
    assert.match(result.stderr, /DRIVER_NOT_INSTALLED|DRIVER_LAUNCH_FAILED/);
    assert.match(result.stderr, /hint:/);
    assert.doesNotMatch(result.stderr, /at async/);
  });
});
