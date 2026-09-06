/**
 * Orchestration: text in, camera path out (PRD 5, steps 1-4).
 *
 * Step 5 of the user flow - actually driving Earth Studio - lives in
 * src/driver/, because everything up to here is pure and testable without a
 * browser.
 */
import type { CameraPath, GeoPlace } from './types.ts';
import { makeConfig, type DeepPartial, type SessionConfig } from './config.ts';
import { parseCommand } from './parser.ts';
import { Geocoder, createNominatimProvider, offlineProvider, type GeocodeProvider } from './geocode/index.ts';
import { buildTimeline, resolveSteps } from './timeline.ts';

export interface PlanOptions {
  config?: DeepPartial<SessionConfig>;
  /** Supply a ready-made geocoder (tests, or a custom provider chain). */
  geocoder?: Geocoder;
  /** Add the OpenStreetMap provider after the built-in table. */
  online?: boolean;
  /** Prepend an establishing pose when the command does not start with one. */
  implicitStart?: boolean;
  onAmbiguous?: (place: GeoPlace, stepIndex: number) => Promise<GeoPlace>;
}

export interface PlanResult {
  path: CameraPath;
  config: SessionConfig;
  /** Clauses the parser could not interpret; surfaced rather than dropped (FR6). */
  ignored: string[];
}

export async function planCameraPath(command: string, options: PlanOptions = {}): Promise<PlanResult> {
  const config = makeConfig(options.config ?? {});
  const geocoder = options.geocoder ?? defaultGeocoder(config, options.online === true);

  const { steps, ignored } = parseCommand(command);
  const resolved = await resolveSteps(steps, geocoder, config, {
    implicitStart: options.implicitStart,
    onAmbiguous: options.onAmbiguous,
  });

  const warnings = [...resolved.warnings];
  for (const clause of ignored) {
    warnings.push({ code: 'CLAUSE_IGNORED', message: `Could not interpret "${clause}"; it was left out of the timeline.` });
  }

  const path = buildTimeline(resolved.steps, config, command, warnings);
  return { path, config, ignored };
}

export function defaultGeocoder(config: SessionConfig, online: boolean): Geocoder {
  const providers: GeocodeProvider[] = [offlineProvider];
  if (online) providers.push(createNominatimProvider());
  return new Geocoder({ providers, ambiguityRatio: config.ambiguityRatio });
}

export { parseCommand } from './parser.ts';
export { Geocoder } from './geocode/index.ts';
export { buildTimeline, resolveSteps } from './timeline.ts';
export { makeConfig, DEFAULT_CONFIG, DEFAULT_ALTITUDE_TABLE } from './config.ts';
export { AgentError, isAgentError } from './errors.ts';
export { EarthStudioDriver, EARTH_STUDIO_URL } from './driver/earth-studio-driver.ts';
export { launchChromium } from './driver/page.ts';
export { DEFAULT_SELECTORS, mergeSelectors } from './driver/selectors.ts';
export { renderPathLog, renderCsv, renderDriveReport, renderLayoutReport } from './log.ts';
export { buildEspProject } from './esp.ts';
export type { CameraPath, Keyframe, ResolvedStep, ParsedStep, GeoPlace } from './types.ts';
