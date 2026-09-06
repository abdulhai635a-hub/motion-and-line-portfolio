#!/usr/bin/env node
/**
 * Command-line interface.
 *
 *   earth-studio-agent plan  "zoom into Japan, hold 3s, then fly to Mount Fuji"
 *   earth-studio-agent drive "..." --user-data-dir ./.es-profile
 *   earth-studio-agent verify-layout --user-data-dir ./.es-profile
 *   earth-studio-agent places
 *
 * `plan` never opens a browser: it writes the keyframe plan, the log and
 * optional extra formats. `drive` plans and then types the values into a live
 * Earth Studio session (PRD 4.1, Option A).
 */
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { planCameraPath } from './agent.ts';
import { AgentError, isAgentError } from './errors.ts';
import { renderCsv, renderDriveReport, renderLayoutReport, renderPathLog, formatWarning } from './log.ts';
import { buildEspProject } from './esp.ts';
import { EarthStudioDriver, EARTH_STUDIO_URL } from './driver/earth-studio-driver.ts';
import { launchChromium } from './driver/page.ts';
import { mergeSelectors } from './driver/selectors.ts';
import { inspectPage, renderInspection } from './driver/inspect.ts';
import {
  Geocoder,
  createNominatimProvider,
  knownNames,
  offlineProvider,
  parseCache,
  serialiseCache,
} from './geocode/index.ts';
import { makeConfig } from './config.ts';
import type { GeoPlace } from './types.ts';
import type { DeepPartial, SessionConfig } from './config.ts';

const USAGE = `earth-studio-agent - turn a text instruction into Earth Studio camera keyframes

Usage
  earth-studio-agent plan  "<command>"   [options]   write the keyframe plan and log
  earth-studio-agent drive "<command>"   [options]   plan, then type it into Earth Studio
  earth-studio-agent login               [options]   sign in to Google once and remember the session
  earth-studio-agent verify-layout       [options]   check the UI selectors against the live app
  earth-studio-agent inspect             [options]   dump the page's real fields, to fix the selectors
  earth-studio-agent places                          list the built-in place names

Input
  --file <path>            read the command from a file instead of the argument

Project (PRD 8 defaults)
  --fps <n>                frame rate, default 30
  --width <n>              default 1920
  --height <n>             default 1080
  --transition <seconds>   default move duration, default 4
  --hold <seconds>         default hold duration, default 2
  --tilt <degrees>         camera tilt written at every keyframe, default 0
  --fov <degrees>          field of view, default 60
  --start-altitude <m>     altitude of the opening pose, default 10000000
  --no-implicit-start      do not prepend an establishing pose

Places
  --online                 also query OpenStreetMap for unknown places
  --confirm-ambiguous      ask which place was meant instead of assuming
  --cache-file <path>      reuse geocoding results between runs

Output
  --out <prefix>           output path prefix, default ./earth-studio-path
  --csv                    also write <prefix>.csv
  --esp                    also write <prefix>.esp (experimental, see PRD 4.2)
  --quiet                  only print the summary

Browser (drive / verify-layout)
  --cdp <url>              attach to a Chrome you started yourself, e.g.
                           http://localhost:9222 - use this when Google refuses
                           to sign in to an automated browser (see the README)
  --user-data-dir <path>   Chromium profile, so the Google sign-in is remembered
  --headless               run without a visible window (sign-in usually needs a window)
  --channel <name>         use an installed browser, e.g. "chrome"
  --executable-path <path> use a specific Chromium binary
  --url <url>              default ${EARTH_STUDIO_URL}
  --selectors <path>       JSON file overriding src/driver/selectors.ts
  --continue-on-error      keep going after a failed keyframe and report all failures
  --dry-run                plan and check the layout, but write nothing
  --deep                   inspect only: also report every id, every custom
                           element, and the raw HTML of the attribute rows

  -h, --help               show this help
`;

const KNOWN_COMMANDS = new Set(['plan', 'drive', 'login', 'verify-layout', 'inspect', 'places', 'help']);

interface Cli {
  command: string;
  positional: string[];
  values: Record<string, string | boolean | undefined>;
}

export async function main(argv: string[]): Promise<number> {
  let cli: Cli;
  try {
    cli = readArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (cli.values.help === true || cli.command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    switch (cli.command) {
      case 'plan':
        return await runPlan(cli);
      case 'drive':
        return await runDrive(cli);
      case 'login':
        return await runLogin(cli);
      case 'verify-layout':
        return await runVerifyLayout(cli);
      case 'inspect':
        return await runInspect(cli);
      case 'places':
        process.stdout.write(`${knownNames().join('\n')}\n`);
        return 0;
      default:
        process.stderr.write(`Unknown command "${cli.command}".\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (isAgentError(error)) {
      process.stderr.write(`${error.format()}\n`);
      return 1;
    }
    process.stderr.write(`Unexpected failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return 1;
  }
}

function readArgs(argv: string[]): Cli {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      file: { type: 'string' },
      fps: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      transition: { type: 'string' },
      hold: { type: 'string' },
      tilt: { type: 'string' },
      fov: { type: 'string' },
      'start-altitude': { type: 'string' },
      'no-implicit-start': { type: 'boolean' },
      online: { type: 'boolean' },
      'confirm-ambiguous': { type: 'boolean' },
      'cache-file': { type: 'string' },
      out: { type: 'string' },
      csv: { type: 'boolean' },
      esp: { type: 'boolean' },
      quiet: { type: 'boolean' },
      'user-data-dir': { type: 'string' },
      headless: { type: 'boolean' },
      'executable-path': { type: 'string' },
      cdp: { type: 'string' },
      channel: { type: 'string' },
      url: { type: 'string' },
      selectors: { type: 'string' },
      'continue-on-error': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      deep: { type: 'boolean' },
    },
  });
  // The first positional is a subcommand only when it is exactly one of the
  // known names; anything else is the instruction itself, so
  // `earth-studio-agent "fly to Rome"` works as documented.
  const [first, ...rest] = positionals;
  if (first !== undefined && KNOWN_COMMANDS.has(first)) {
    return { command: first, positional: rest, values };
  }
  // A mistyped subcommand would otherwise be planned as if it were a place, so
  // point it out - as a note, not an error, since a one-word instruction is legal.
  const nearMiss = first === undefined ? undefined : closestCommand(first);
  if (nearMiss !== undefined) {
    process.stderr.write(`Note: "${first}" is being read as part of the instruction. Did you mean the "${nearMiss}" command?\n`);
  }
  return { command: 'plan', positional: positionals, values };
}

/** The known command within two edits of `word`, if there is one. */
function closestCommand(word: string): string | undefined {
  if (/\s/.test(word)) return undefined;
  for (const candidate of KNOWN_COMMANDS) {
    if (editDistance(word.toLowerCase(), candidate) <= 2) return candidate;
  }
  return undefined;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

async function readCommandText(cli: Cli): Promise<string> {
  const file = cli.values.file;
  if (typeof file === 'string') {
    try {
      return await readFile(resolve(file), 'utf8');
    } catch (cause) {
      throw new AgentError('COMMAND_FILE_UNREADABLE', `Could not read the command file "${file}".`, {
        detail: cause instanceof Error ? cause.message : String(cause),
        hint: 'Check the path, or pass the instruction directly in quotes.',
        cause,
      });
    }
  }
  const text = cli.positional.join(' ').trim();
  if (text === '') {
    throw new AgentError('EMPTY_COMMAND', 'No command was given.', {
      hint: 'Pass the instruction in quotes, or use --file to read it from a file.',
    });
  }
  return text;
}

function numberOption(cli: Cli, name: string): number | undefined {
  const raw = cli.values[name];
  if (typeof raw !== 'string') return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new AgentError('INVALID_CONFIG', `--${name} needs a number, got "${raw}".`);
  }
  return value;
}

function integerOption(cli: Cli, name: string): number | undefined {
  const value = numberOption(cli, name);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new AgentError('INVALID_CONFIG', `--${name} needs a whole number, got "${value}".`);
  }
  return value;
}

function configFromArgs(cli: Cli): DeepPartial<SessionConfig> {
  return {
    frameRate: numberOption(cli, 'fps'),
    width: integerOption(cli, 'width'),
    height: integerOption(cli, 'height'),
    defaultTransitionSeconds: numberOption(cli, 'transition'),
    defaultHoldSeconds: numberOption(cli, 'hold'),
    defaultTilt: numberOption(cli, 'tilt'),
    defaultFieldOfView: numberOption(cli, 'fov'),
    startAltitude: numberOption(cli, 'start-altitude'),
  };
}

/** Interactive disambiguation for --confirm-ambiguous (PRD 12, question 3). */
async function askWhichPlace(place: GeoPlace, stepIndex: number): Promise<GeoPlace> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `! step ${stepIndex}: "${place.query}" is ambiguous but stdin is not a terminal; ` +
        `keeping ${place.name}.\n`,
    );
    return place;
  }
  const choices = [place, ...place.alternatives.map((alt) => ({ ...place, ...alt, alternatives: [] }))];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`\nStep ${stepIndex}: "${place.query}" could mean:\n`);
    choices.forEach((choice, index) => {
      process.stdout.write(
        `  ${index + 1}) ${choice.name}${choice.context === undefined ? '' : ` - ${choice.context}`}` +
          ` (${choice.latitude.toFixed(4)}, ${choice.longitude.toFixed(4)})\n`,
      );
    });
    const answer = (await rl.question(`Which one? [1-${choices.length}, default 1] `)).trim();
    const index = answer === '' ? 0 : Number.parseInt(answer, 10) - 1;
    const chosen = choices[index] ?? choices[0];
    if (chosen === undefined) return place;
    return { ...chosen, ambiguous: false, alternatives: place.alternatives };
  } finally {
    rl.close();
  }
}

async function plan(cli: Cli): Promise<Awaited<ReturnType<typeof planCameraPath>>> {
  const command = await readCommandText(cli);
  const overrides = configFromArgs(cli);
  const config = makeConfig(overrides);
  const online = cli.values.online === true;
  const cacheFile = typeof cli.values['cache-file'] === 'string' ? cli.values['cache-file'] : undefined;

  let cache: Map<string, GeoPlace> | undefined;
  if (cacheFile !== undefined) {
    try {
      cache = parseCache(await readFile(resolve(cacheFile), 'utf8'));
    } catch {
      cache = new Map(); // A missing or unreadable cache is not an error; it is just cold.
    }
  }

  const providers = [offlineProvider];
  if (online) providers.push(createNominatimProvider());
  const geocoder = new Geocoder({ providers, ambiguityRatio: config.ambiguityRatio, cache });

  const result = await planCameraPath(command, {
    config: overrides,
    geocoder,
    implicitStart: cli.values['no-implicit-start'] === true ? false : undefined,
    onAmbiguous: cli.values['confirm-ambiguous'] === true ? askWhichPlace : undefined,
  });

  if (cacheFile !== undefined) {
    await mkdir(dirname(resolve(cacheFile)), { recursive: true });
    await writeFile(resolve(cacheFile), serialiseCache(geocoder.cache), 'utf8');
  }
  return result;
}

async function runPlan(cli: Cli): Promise<number> {
  const { path } = await plan(cli);
  const prefix = typeof cli.values.out === 'string' ? cli.values.out : 'earth-studio-path';
  const written = await writeOutputs(path, prefix, cli);

  if (cli.values.quiet !== true) process.stdout.write(`${renderPathLog(path)}\n`);
  for (const warning of path.warnings) process.stderr.write(`! ${formatWarning(warning)}\n`);
  process.stdout.write(
    `Planned ${path.keyframes.length} keyframes over ${path.durationSeconds.toFixed(2)}s ` +
      `(${path.totalFrames} frames at ${path.frameRate}fps).\n`,
  );
  for (const file of written) process.stdout.write(`  wrote ${file}\n`);
  process.stdout.write('\nNext: run the same command with "drive" to type these into Earth Studio,\n');
  process.stdout.write('then review the keyframes on the timeline and render from Earth Studio itself.\n');
  return 0;
}

async function writeOutputs(
  path: Awaited<ReturnType<typeof planCameraPath>>['path'],
  prefix: string,
  cli: Cli,
): Promise<string[]> {
  const base = resolve(prefix);
  await mkdir(dirname(base), { recursive: true });
  const written: string[] = [];

  const jsonFile = `${base}.json`;
  await writeFile(jsonFile, `${JSON.stringify(path, null, 2)}\n`, 'utf8');
  written.push(jsonFile);

  const logFile = `${base}.log.txt`;
  await writeFile(logFile, renderPathLog(path), 'utf8');
  written.push(logFile);

  if (cli.values.csv === true) {
    const csvFile = `${base}.csv`;
    await writeFile(csvFile, renderCsv(path), 'utf8');
    written.push(csvFile);
  }

  if (cli.values.esp === true) {
    const espFile = `${base}.esp`;
    await writeFile(espFile, `${JSON.stringify(buildEspProject(path), null, 2)}\n`, 'utf8');
    written.push(espFile);
    process.stderr.write(
      '! The .esp writer is experimental: the format is undocumented (PRD 4.2). ' +
        'If Earth Studio will not open it, use "drive" instead.\n',
    );
  }

  return written;
}

async function loadSelectors(cli: Cli) {
  const file = cli.values.selectors;
  if (typeof file !== 'string') return undefined;
  try {
    return mergeSelectors(JSON.parse(await readFile(resolve(file), 'utf8')));
  } catch (cause) {
    throw new AgentError('SELECTOR_FILE_UNREADABLE', `Could not read the selector file "${file}".`, {
      detail: cause instanceof Error ? cause.message : String(cause),
      hint: 'It must be JSON shaped like src/driver/selectors.ts.',
      cause,
    });
  }
}

async function openDriver(cli: Cli) {
  // Read the selector override first: it is cheap, and a broken file should be
  // reported before a browser window is opened.
  const selectors = await loadSelectors(cli);
  const cdpEndpoint = typeof cli.values.cdp === 'string' ? cli.values.cdp : undefined;
  const session = await launchChromium({
    headless: cli.values.headless === true,
    userDataDir: typeof cli.values['user-data-dir'] === 'string' ? resolve(cli.values['user-data-dir']) : undefined,
    executablePath: typeof cli.values['executable-path'] === 'string' ? cli.values['executable-path'] : undefined,
    channel: typeof cli.values.channel === 'string' ? cli.values.channel : undefined,
    cdpEndpoint,
  });
  const driver = new EarthStudioDriver(session.page, { selectors });
  const url = typeof cli.values.url === 'string' ? cli.values.url : EARTH_STUDIO_URL;
  // An attached browser already has the project open; navigating would lose it.
  await driver.open(url, { navigate: cdpEndpoint === undefined });
  return { session, driver };
}

/**
 * Opens Earth Studio in a persistent Chromium profile and waits, so the Google
 * sign-in happens once and every later `verify-layout` and `drive` reuses it.
 */
async function runLogin(cli: Cli): Promise<number> {
  if (typeof cli.values.cdp === 'string') {
    process.stdout.write(
      'With --cdp you sign in yourself, in your own Chrome, so there is nothing for login to do.\n' +
        'Sign in there, open your Earth Studio project, then run verify-layout with the same --cdp.\n',
    );
    return 0;
  }
  const profile = cli.values['user-data-dir'];
  if (typeof profile !== 'string' || profile === '') {
    throw new AgentError('INVALID_CONFIG', 'login needs --user-data-dir, or there is nowhere to remember the session.', {
      hint: 'Try: earth-studio-agent login --user-data-dir ./.es-profile',
    });
  }

  const session = await launchChromium({
    headless: false,
    userDataDir: resolve(profile),
    executablePath: typeof cli.values['executable-path'] === 'string' ? cli.values['executable-path'] : undefined,
  });
  const url = typeof cli.values.url === 'string' ? cli.values.url : EARTH_STUDIO_URL;
  try {
    await session.page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    process.stdout.write(
      `A Chromium window is open at ${url}.\n\n` +
        '  1. Sign in to your Google account.\n' +
        '  2. Open or create the Earth Studio project you want the keyframes in.\n' +
        '  3. Come back here.\n\n',
    );
    process.stdout.write(
      'If Google says "This browser or app may not be secure", it is refusing to sign in\n' +
        'to an automated browser. Use the --cdp route instead; the README explains it.\n\n',
    );
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await rl.question('Press Enter once you are signed in and the project is open... ');
      } finally {
        rl.close();
      }
    } else {
      process.stderr.write('stdin is not a terminal, so there is nothing to wait for; closing in 60 seconds.\n');
      await new Promise((done) => setTimeout(done, 60_000));
    }
    process.stdout.write(`\nSession saved to ${resolve(profile)}.\n`);
    process.stdout.write(`Next: earth-studio-agent verify-layout --user-data-dir ${profile}\n`);
    return 0;
  } finally {
    await session.close();
  }
}

async function runVerifyLayout(cli: Cli): Promise<number> {
  const { session, driver } = await openDriver(cli);
  try {
    const report = await driver.verifyLayout();
    process.stdout.write(`${renderLayoutReport(report)}\n`);
    return report.ok ? 0 : 1;
  } finally {
    await session.close();
  }
}

/**
 * Dumps the live page's editable fields so the selector file can be corrected
 * from what is actually there. This is the answer to a verify-layout that
 * reports missing fields.
 */
async function runInspect(cli: Cli): Promise<number> {
  const { session } = await openDriver(cli);
  try {
    const inspection = await inspectPage(session.page, 60, cli.values.deep === true);
    const text = renderInspection(inspection);
    process.stdout.write(`${text}\n`);
    const prefix = typeof cli.values.out === 'string' ? cli.values.out : 'earth-studio-fields';
    const base = resolve(prefix);
    await mkdir(dirname(base), { recursive: true });
    await writeFile(`${base}.txt`, text, 'utf8');
    await writeFile(`${base}.json`, `${JSON.stringify(inspection, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote ${base}.txt and ${base}.json\n`);
    if (inspection.fieldCount === 0) {
      process.stdout.write(`\nNothing editable was found on the page this attached to:\n`);
      process.stdout.write(`  ${inspection.title === '' ? '(no title)' : inspection.title}\n  ${inspection.url}\n`);
      if (session.listTabs !== undefined) {
        const tabs = await session.listTabs();
        process.stdout.write(`\nTabs this browser has open (${tabs.length}):\n`);
        for (const tab of tabs) {
          process.stdout.write(`  ${tab.attached ? '->' : '  '} ${tab.title === '' ? '(no title)' : tab.title}\n`);
          process.stdout.write(`     ${tab.url}\n`);
        }
      }
      process.stdout.write('\nOpen your Earth Studio project in this browser, then run this again.\n');
      return 1;
    }
    process.stdout.write(`\nInspected: ${inspection.title} - ${inspection.url}\n`);
    return 0;
  } finally {
    await session.close();
  }
}

async function runDrive(cli: Cli): Promise<number> {
  const { path } = await plan(cli);
  const prefix = typeof cli.values.out === 'string' ? cli.values.out : 'earth-studio-path';
  await writeOutputs(path, prefix, cli);
  for (const warning of path.warnings) process.stderr.write(`! ${formatWarning(warning)}\n`);

  const { session, driver } = await openDriver(cli);
  try {
    const layout = await driver.verifyLayout();
    process.stdout.write(`${renderLayoutReport(layout)}\n\n`);
    if (cli.values['dry-run'] === true) {
      process.stdout.write('Dry run: nothing was typed into Earth Studio.\n');
      return layout.ok ? 0 : 1;
    }
    const report = await driver.applyPath(path, { continueOnError: cli.values['continue-on-error'] === true });
    process.stdout.write(`${renderDriveReport(report)}\n`);
    process.stdout.write('\nReview the keyframes in Earth Studio, adjust anything you want, then render there.\n');
    return report.failures.length === 0 ? 0 : 1;
  } finally {
    await session.close();
  }
}

// Only run when this file is the entry point, not when it is imported.
// pathToFileURL is required rather than string concatenation: it percent-encodes
// spaces and produces the file:///C:/... form Windows uses, both of which a
// hand-built `file://` + path would get wrong, leaving the CLI silently inert.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && pathToFileURL(entryPoint).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
