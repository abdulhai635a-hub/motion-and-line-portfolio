/**
 * Earth Studio Driver - Option A from PRD 4.1 (FR4).
 *
 * Earth Studio creates a keyframe whenever a value is typed into an attribute
 * field at a point on the timeline, so the driver reproduces exactly that: it
 * seeks to the computed frame, types each camera value, and reads the value back
 * to confirm the edit landed. Nothing about the project file is invented, and no
 * undocumented format is written - the app's own keyframe engine does the work.
 */
import type { CameraPath, Keyframe } from '../types.ts';
import { AgentError } from '../errors.ts';
import { CAMERA_FIELD_ORDER, DEFAULT_SELECTORS, type CameraFieldName, type EarthStudioSelectors, type FieldSelectors } from './selectors.ts';
import type { PageLike } from './page.ts';

export const EARTH_STUDIO_URL = 'https://earth.google.com/studio/';

export interface DriverOptions {
  selectors?: EarthStudioSelectors;
  /** Per-action timeout in milliseconds. */
  timeoutMs?: number;
  /** Absolute tolerance used when reading a written value back. */
  readbackTolerance?: number;
  /** Log every field write. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  kind: 'seek' | 'field' | 'keyframe';
  frame: number;
  stepIndex: number;
  field?: CameraFieldName;
  value?: number;
}

export interface FieldReport {
  name: CameraFieldName | 'currentFrame' | 'appReady';
  label: string;
  required: boolean;
  /** The candidate selector that matched, or null when none did. */
  matched: string | null;
  candidates: string[];
}

export interface LayoutReport {
  version: string;
  verifiedOn: string;
  ok: boolean;
  fields: FieldReport[];
  /** Required fields with no matching selector. */
  missing: string[];
}

export interface KeyframeResult {
  frame: number;
  stepIndex: number;
  label: string;
  written: Partial<Record<CameraFieldName, number>>;
  skipped: CameraFieldName[];
  ok: boolean;
  error?: string;
}

export interface DriveReport {
  total: number;
  applied: number;
  results: KeyframeResult[];
  failures: KeyframeResult[];
}

export class EarthStudioDriver {
  private readonly page: PageLike;
  private readonly selectors: EarthStudioSelectors;
  private readonly timeoutMs: number;
  private readonly tolerance: number;
  private readonly onProgress?: (event: ProgressEvent) => void;
  private readonly resolvedSelectors = new Map<string, string | null>();

  constructor(page: PageLike, options: DriverOptions = {}) {
    this.page = page;
    this.selectors = options.selectors ?? DEFAULT_SELECTORS;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.tolerance = options.readbackTolerance ?? 1e-4;
    this.onProgress = options.onProgress;
  }

  /**
   * Waits for the editor to appear, navigating there first unless the page is
   * already showing the project (which is the case when attaching to a browser
   * the user opened themselves).
   */
  async open(url: string = EARTH_STUDIO_URL, options: { navigate?: boolean } = {}): Promise<void> {
    if (options.navigate !== false) {
      await this.page.goto(url, { waitUntil: 'load', timeout: this.timeoutMs });
    }
    const ready = await this.findSelector('appReady', this.selectors.appReady);
    if (ready === null) {
      throw new AgentError('DRIVER_NOT_READY', 'The Earth Studio editor did not load.', {
        detail: `None of these matched: ${this.selectors.appReady.candidates.join(', ')}`,
        hint: 'Sign in to Earth Studio once with --user-data-dir so the session is remembered, then re-run.',
      });
    }
  }

  /**
   * Checks every selector against the live page before touching anything
   * (PRD 11: "version-check on each run").
   */
  async verifyLayout(): Promise<LayoutReport> {
    const fields: FieldReport[] = [];
    const entries: Array<[FieldReport['name'], FieldSelectors]> = [
      ['appReady', this.selectors.appReady],
      ['currentFrame', this.selectors.currentFrame],
      ...CAMERA_FIELD_ORDER.map((name) => [name, this.selectors.camera[name]] as [FieldReport['name'], FieldSelectors]),
    ];
    for (const [name, field] of entries) {
      const matched = await this.findSelector(String(name), field);
      fields.push({ name, label: field.label, required: field.required, matched, candidates: field.candidates });
    }
    const missing = fields.filter((field) => field.required && field.matched === null).map((field) => field.label);
    return {
      version: this.selectors.version,
      verifiedOn: this.selectors.verifiedOn,
      ok: missing.length === 0,
      fields,
      missing,
    };
  }

  /**
   * Writes every keyframe of the plan into the open Earth Studio project.
   *
   * FR6: a failure names the step, the frame and the field that failed. By
   * default the run stops there; `continueOnError` records the failure and keeps
   * going so one bad field does not hide the rest.
   */
  async applyPath(path: CameraPath, options: { continueOnError?: boolean } = {}): Promise<DriveReport> {
    const layout = await this.verifyLayout();
    if (!layout.ok) {
      throw new AgentError('DRIVER_LAYOUT_MISMATCH', 'The Earth Studio page does not expose the fields the driver needs.', {
        detail: `Missing: ${layout.missing.join(', ')} (selector set ${layout.version}, verified ${layout.verifiedOn})`,
        hint: 'Update earth-studio-agent/src/driver/selectors.ts, or pass --selectors with a corrected file.',
      });
    }

    const results: KeyframeResult[] = [];
    for (const keyframe of path.keyframes) {
      try {
        results.push(await this.applyKeyframe(keyframe));
      } catch (cause) {
        const result: KeyframeResult = {
          frame: keyframe.frame,
          stepIndex: keyframe.stepIndex,
          label: keyframe.label,
          written: {},
          skipped: [],
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        };
        results.push(result);
        if (options.continueOnError !== true) {
          const failures = results.filter((entry) => !entry.ok);
          throw new AgentError(
            'DRIVER_FIELD_WRITE_FAILED',
            `Stopped at frame ${keyframe.frame} while applying step ${keyframe.stepIndex}.`,
            {
              stepIndex: keyframe.stepIndex,
              detail: result.error,
              hint: `${results.length - failures.length} of ${path.keyframes.length} keyframes were written before this.`,
              cause,
            },
          );
        }
      }
    }

    const failures = results.filter((result) => !result.ok);
    return { total: path.keyframes.length, applied: results.length - failures.length, results, failures };
  }

  /** Seeks to one frame and types the whole camera state there. */
  async applyKeyframe(keyframe: Keyframe): Promise<KeyframeResult> {
    await this.seekToFrame(keyframe.frame, keyframe.stepIndex);

    const written: Partial<Record<CameraFieldName, number>> = {};
    const skipped: CameraFieldName[] = [];

    for (const name of CAMERA_FIELD_ORDER) {
      const field = this.selectors.camera[name];
      const selector = await this.findSelector(name, field);
      if (selector === null) {
        if (field.required) {
          throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `No selector matched the ${field.label} field.`, {
            stepIndex: keyframe.stepIndex,
            detail: `Tried: ${field.candidates.join(', ')}`,
          });
        }
        skipped.push(name);
        continue;
      }
      const value = cameraValue(keyframe, name);
      await this.writeNumber(selector, value, field.label, keyframe.stepIndex);
      written[name] = value;
      this.onProgress?.({ kind: 'field', frame: keyframe.frame, stepIndex: keyframe.stepIndex, field: name, value });
    }

    this.onProgress?.({ kind: 'keyframe', frame: keyframe.frame, stepIndex: keyframe.stepIndex });
    return { frame: keyframe.frame, stepIndex: keyframe.stepIndex, label: keyframe.label, written, skipped, ok: true };
  }

  private async seekToFrame(frame: number, stepIndex: number): Promise<void> {
    const selector = await this.findSelector('currentFrame', this.selectors.currentFrame);
    if (selector === null) {
      throw new AgentError('DRIVER_FRAME_SEEK_FAILED', 'No selector matched the current-frame field.', {
        stepIndex,
        detail: `Tried: ${this.selectors.currentFrame.candidates.join(', ')}`,
      });
    }
    try {
      await this.writeNumber(selector, frame, 'current frame', stepIndex);
    } catch (cause) {
      throw new AgentError('DRIVER_FRAME_SEEK_FAILED', `Could not move the playhead to frame ${frame}.`, {
        stepIndex,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    }
    this.onProgress?.({ kind: 'seek', frame, stepIndex });
  }

  /**
   * Types a number into a field and confirms it stuck. Enter commits the edit,
   * which is what makes Earth Studio create the keyframe.
   */
  private async writeNumber(selector: string, value: number, label: string, stepIndex: number): Promise<void> {
    const text = formatNumber(value);
    try {
      await this.page.fill(selector, text, { timeout: this.timeoutMs });
      await this.page.press(selector, 'Enter', { timeout: this.timeoutMs });
    } catch (cause) {
      throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `Could not type into the ${label} field.`, {
        stepIndex,
        detail: cause instanceof Error ? cause.message : String(cause),
        hint: `Selector used: ${selector}`,
        cause,
      });
    }

    const readback = await this.page.inputValue(selector, { timeout: this.timeoutMs });
    const parsed = Number.parseFloat(readback.replace(/[^0-9eE+.-]/g, ''));
    if (!Number.isFinite(parsed) || Math.abs(parsed - value) > this.toleranceFor(value)) {
      throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${label} field did not accept ${text}.`, {
        stepIndex,
        detail: `Field reads "${readback}" after the edit.`,
        hint: `Selector used: ${selector}`,
      });
    }
  }

  /** Absolute tolerance, widened for large values so 1e7 metres still compares. */
  private toleranceFor(value: number): number {
    return Math.max(this.tolerance, Math.abs(value) * 1e-6);
  }

  /** First candidate selector present on the page; cached per field. */
  private async findSelector(key: string, field: FieldSelectors): Promise<string | null> {
    const cached = this.resolvedSelectors.get(key);
    if (cached !== undefined) return cached;
    let found: string | null = null;
    for (const candidate of field.candidates) {
      const handle = await this.page.$(candidate);
      if (handle !== null && handle !== undefined) {
        found = candidate;
        break;
      }
    }
    this.resolvedSelectors.set(key, found);
    return found;
  }
}

function cameraValue(keyframe: Keyframe, name: CameraFieldName): number {
  return keyframe.camera[name];
}

/**
 * Plain decimal text: Earth Studio's numeric fields reject exponent notation.
 * toFixed switches to exponents above 1e21, so large integers go through
 * toLocaleString's "fullwide" numbering system instead.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) {
    return value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  }
  return value.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}
