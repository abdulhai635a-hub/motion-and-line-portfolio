/**
 * The whole agent, running inside the Earth Studio page.
 *
 * Same pipeline as the CLI - translate, parse, geocode, build a timeline, drive
 * the editor - with the browser standing in for Playwright. Everything except
 * the driving is pure, and the driving is the code the Playwright tests already
 * cover, reached through DomPage.
 */
import type { CameraPath, GeoPlace, Warning } from '../types.ts';
import type { DeepPartial, SessionConfig } from '../config.ts';
import { makeConfig } from '../config.ts';
import { parseCommand } from '../parser.ts';
import { buildTimeline, resolveSteps } from '../timeline.ts';
import { Geocoder, createNominatimProvider, offlineProvider } from '../geocode/index.ts';
import { EarthStudioDriver, type DriveReport, type LayoutReport } from '../driver/earth-studio-driver.ts';
import { AgentError } from '../errors.ts';
import { DomPage } from './dom-page.ts';
import { toEnglish, type TranslateOptions, type TranslationResult } from './language.ts';

export interface RunOptions {
  config?: DeepPartial<SessionConfig>;
  /** Look unknown places up on OpenStreetMap. Needs host permission. */
  online?: boolean;
  language?: TranslateOptions;
  /** Report progress to the panel as the run goes. */
  onProgress?: (event: ProgressReport) => void;
  /** Plan only: work out the keyframes but write nothing. */
  dryRun?: boolean;
}

export interface ProgressReport {
  stage: 'translating' | 'planning' | 'checking' | 'writing' | 'done';
  message: string;
  /** 0..1 where known. */
  fraction?: number;
}

export interface RunResult {
  translation: TranslationResult;
  path: CameraPath;
  layout: LayoutReport;
  report?: DriveReport;
  warnings: Warning[];
}

/** Plans a command and writes it into the Earth Studio page this is running in. */
export async function runCommandInPage(command: string, options: RunOptions = {}): Promise<RunResult> {
  const notify = options.onProgress ?? (() => {});

  notify({ stage: 'translating', message: 'Reading the command' });
  const translation = await toEnglish(command, options.language ?? {});

  notify({ stage: 'planning', message: 'Working out the camera path' });
  const config = makeConfig(options.config ?? {});
  const providers = [offlineProvider];
  if (options.online === true) providers.push(createNominatimProvider());
  const geocoder = new Geocoder({ providers, ambiguityRatio: config.ambiguityRatio });

  const { steps, ignored } = parseCommand(translation.english);
  const resolved = await resolveSteps(steps, geocoder, config);
  const warnings: Warning[] = [...resolved.warnings];
  for (const clause of ignored) {
    warnings.push({ code: 'CLAUSE_IGNORED', message: `Could not interpret "${clause}"; it was left out.` });
  }
  const path = buildTimeline(resolved.steps, config, translation.english, warnings);

  const page = new DomPage();
  const driver = new EarthStudioDriver(page, {
    onProgress: (event) => {
      if (event.kind !== 'keyframe') return;
      const done = path.keyframes.findIndex((keyframe) => keyframe.frame === event.frame) + 1;
      notify({
        stage: 'writing',
        message: `Wrote keyframe ${done} of ${path.keyframes.length} at frame ${event.frame}`,
        fraction: done / path.keyframes.length,
      });
    },
  });

  notify({ stage: 'checking', message: 'Checking the Earth Studio controls' });
  const layout = await driver.verifyLayout();
  if (!layout.ok) {
    throw new AgentError('DRIVER_LAYOUT_MISMATCH', 'The Earth Studio page is missing controls the agent needs.', {
      detail: `Missing: ${layout.missing.join(', ')}`,
      hint: 'Open a project so the camera attributes are on screen, then try again.',
    });
  }

  if (options.dryRun === true) {
    notify({ stage: 'done', message: `Planned ${path.keyframes.length} keyframes; nothing was written` });
    return { translation, path, layout, warnings: path.warnings };
  }

  notify({ stage: 'writing', message: `Writing ${path.keyframes.length} keyframes`, fraction: 0 });
  const report = await driver.applyPath(path);
  notify({ stage: 'done', message: `Wrote ${report.applied} of ${report.total} keyframes`, fraction: 1 });

  return { translation, path, layout, report, warnings: path.warnings };
}

export type { GeoPlace };
export { AgentError };
