/**
 * Earth Studio Driver - Option A from PRD 4.1 (FR4).
 *
 * Earth Studio creates a keyframe when a value is entered at a point on the
 * timeline, so the driver reproduces exactly that gesture, as observed on a
 * live session with `earth-studio-agent probe`:
 *
 *   1. move the playhead to the computed frame (keyboard, or the transport
 *      buttons when the keyboard is not reaching the app)
 *   2. click each camera attribute's value widget, which opens a contenteditable
 *      holding the full-precision value
 *   3. type the value - converted into whatever unit the field is showing - and
 *      press Enter
 *   4. read the value back, then click the row's "add keyframe" button
 *
 * Nothing about the project file is invented and no undocumented format is
 * written; the app's own keyframe engine does the work.
 */
import type { CameraPath, Keyframe } from '../types.ts';
import { AgentError } from '../errors.ts';
import {
  CAMERA_FIELD_ORDER,
  DEFAULT_SELECTORS,
  rowSelector,
  widgetSelector,
  type AttributeSelector,
  type CameraFieldName,
  type EarthStudioSelectors,
  type FieldSelectors,
} from './selectors.ts';
import type { PageLike } from './page.ts';
import { writeAttribute, type WriteResult } from './attribute-writer.ts';
import { findLastFrame, readFrame, seekToFrame } from './playhead.ts';

export const EARTH_STUDIO_URL = 'https://earth.google.com/studio/';

export interface DriverOptions {
  selectors?: EarthStudioSelectors;
  /** Per-action timeout in milliseconds. */
  timeoutMs?: number;
  /** Milliseconds to let the page settle after moving the playhead. */
  settleMs?: number;
  /** Turn each written value into a keyframe. Default true. */
  addKeyframes?: boolean;
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
  name: string;
  label: string;
  required: boolean;
  /** The selector that matched, or null when none did. */
  matched: string | null;
  /** Why a present-but-unusable field was not counted. */
  note?: string;
  candidates: string[];
}

export interface LayoutReport {
  version: string;
  verifiedOn: string;
  ok: boolean;
  fields: FieldReport[];
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
  /** What each field actually did, including any unit conversion. */
  details: WriteResult[];
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
  private readonly settleMs: number;
  private readonly addKeyframes: boolean;
  private readonly onProgress?: (event: ProgressEvent) => void;

  constructor(page: PageLike, options: DriverOptions = {}) {
    this.page = page;
    this.selectors = options.selectors ?? DEFAULT_SELECTORS;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.settleMs = options.settleMs ?? 250;
    this.addKeyframes = options.addKeyframes ?? true;
    this.onProgress = options.onProgress;
  }

  /** Navigates to Earth Studio and waits for the attribute panel to appear. */
  async open(url: string = EARTH_STUDIO_URL, options: { navigate?: boolean } = {}): Promise<void> {
    if (options.navigate !== false) {
      await this.page.goto(url, { waitUntil: 'load', timeout: this.timeoutMs });
    }
    if ((await this.matchOne(this.selectors.appReady)) === null) {
      throw new AgentError('DRIVER_NOT_READY', 'The Earth Studio attribute panel is not on this page.', {
        detail: `None of these matched: ${this.selectors.appReady.candidates.join(', ')}`,
        hint: 'Open your Earth Studio project first. "earth-studio-agent probe" lists what the page is showing.',
      });
    }
  }

  /** Checks every selector against the live page (PRD 11: version-check on each run). */
  async verifyLayout(): Promise<LayoutReport> {
    const fields: FieldReport[] = [];

    for (const [name, field] of [
      ['attribute panel', this.selectors.appReady],
      ['timecode readout', this.selectors.playhead.readout],
      ['jump to start', this.selectors.playhead.jumpStart],
      ['next frame', this.selectors.playhead.forward],
      ['previous frame', this.selectors.playhead.backward],
    ] as Array<[string, FieldSelectors]>) {
      const matched = await this.matchOne(field);
      fields.push({ name, label: field.label, required: field.required, matched, candidates: field.candidates });
    }

    for (const name of CAMERA_FIELD_ORDER) {
      const attribute = this.selectors.camera[name];
      const selector = widgetSelector(attribute);
      // Presence is not enough. An attribute a project has not put on its
      // timeline is still in the DOM but renders to nothing, and reporting it
      // as found sends the driver off to click something invisible.
      const usable = await this.isUsable(selector);
      fields.push({
        name,
        label: attribute.label,
        required: attribute.required,
        matched: usable ? selector : null,
        note: !usable && (await this.exists(selector)) ? 'on the page but not shown' : undefined,
        candidates: [selector],
      });
    }

    const missing = fields.filter((field) => field.required && field.matched === null).map((field) => field.label);
    return { version: this.selectors.version, verifiedOn: this.selectors.verifiedOn, ok: missing.length === 0, fields, missing };
  }

  /**
   * Writes every keyframe of the plan into the open Earth Studio project.
   *
   * FR6: a failure names the step, the frame and the field. By default the run
   * stops there; `continueOnError` records it and carries on, so one bad field
   * does not hide the rest.
   */
  async applyPath(path: CameraPath, options: { continueOnError?: boolean } = {}): Promise<DriveReport> {
    const layout = await this.verifyLayout();
    if (!layout.ok) {
      throw new AgentError('DRIVER_LAYOUT_MISMATCH', 'The Earth Studio page does not expose the fields the driver needs.', {
        detail: `Missing: ${layout.missing.join(', ')} (selector set ${layout.version}, verified ${layout.verifiedOn})`,
        hint: 'Run "earth-studio-agent probe" to see the attribute rows this project shows, then update src/driver/selectors.ts.',
      });
    }

    // A path longer than the project cannot be written, and finding that out on
    // the last keyframe leaves the project half-written. It is one keypress to
    // ask first.
    const needed = path.keyframes.at(-1)?.frame ?? 0;
    const lastFrame = await findLastFrame(this.page);
    if (lastFrame !== null && lastFrame > 0 && lastFrame < needed) {
      const seconds = ((needed + 1) / path.frameRate).toFixed(1);
      throw new AgentError('DRIVER_FRAME_SEEK_FAILED', `This path is longer than the project.`, {
        detail: `It needs ${needed + 1} frames (${seconds}s at ${path.frameRate}fps); the timeline ends at frame ${lastFrame}.`,
        hint:
          `Lengthen the project in Earth Studio - its duration is in the project settings - ` +
          `or shorten the path. Nothing has been written.`,
      });
    }

    const results: KeyframeResult[] = [];
    for (const keyframe of path.keyframes) {
      try {
        results.push(await this.applyKeyframe(keyframe, { writeFieldOfView: path.writeFieldOfView }));
      } catch (cause) {
        const result: KeyframeResult = {
          frame: keyframe.frame,
          stepIndex: keyframe.stepIndex,
          label: keyframe.label,
          written: {},
          skipped: [],
          details: [],
          ok: false,
          // format() keeps the inner detail and hint; message alone would throw
          // away the actual reason and leave only the outer summary.
          error: cause instanceof AgentError ? cause.format() : cause instanceof Error ? cause.message : String(cause),
        };
        results.push(result);
        if (options.continueOnError !== true) {
          const done = results.filter((entry) => entry.ok).length;
          throw new AgentError(
            'DRIVER_FIELD_WRITE_FAILED',
            `Stopped at frame ${keyframe.frame} while applying step ${keyframe.stepIndex}.`,
            {
              stepIndex: keyframe.stepIndex,
              detail: result.error,
              hint: `${done} of ${path.keyframes.length} keyframes were written before this.`,
              cause,
            },
          );
        }
      }
    }

    const failures = results.filter((result) => !result.ok);
    return { total: path.keyframes.length, applied: results.length - failures.length, results, failures };
  }

  /** Seeks to one frame and writes the whole camera state there. */
  async applyKeyframe(keyframe: Keyframe, options: { writeFieldOfView?: boolean } = {}): Promise<KeyframeResult> {
    await seekToFrame(this.page, keyframe.frame, {
      readout: this.selectors.playhead.readout.candidates[0],
      settleMs: this.settleMs,
    });
    this.onProgress?.({ kind: 'seek', frame: keyframe.frame, stepIndex: keyframe.stepIndex });

    const written: Partial<Record<CameraFieldName, number>> = {};
    const skipped: CameraFieldName[] = [];
    const details: WriteResult[] = [];

    for (const name of CAMERA_FIELD_ORDER) {
      const attribute = this.selectors.camera[name];
      // The project's own lens is left alone unless the command named one.
      if (name === 'fieldOfView' && options.writeFieldOfView !== true) {
        skipped.push(name);
        continue;
      }
      if (!(await this.isUsable(widgetSelector(attribute)))) {
        if (attribute.required) {
          throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${attribute.label} row cannot be edited.`, {
            stepIndex: keyframe.stepIndex,
            detail: `${widgetSelector(attribute)} is ${(await this.exists(widgetSelector(attribute))) ? 'on the page but not shown' : 'not on the page'}.`,
            hint: 'Open the Camera Position group in Earth Studio so its fields are visible.',
          });
        }
        // An attribute this project has not added to its timeline, such as Roll
        // or Field of View. The camera path does not need it.
        skipped.push(name);
        continue;
      }
      const value = keyframe.camera[name];
      details.push(
        await writeAttribute(this.page, toTarget(attribute), value, {
          addKeyframe: this.addKeyframes,
          timeoutMs: this.timeoutMs,
        }),
      );
      written[name] = value;
      this.onProgress?.({ kind: 'field', frame: keyframe.frame, stepIndex: keyframe.stepIndex, field: name, value });
    }

    this.onProgress?.({ kind: 'keyframe', frame: keyframe.frame, stepIndex: keyframe.stepIndex });
    return { frame: keyframe.frame, stepIndex: keyframe.stepIndex, label: keyframe.label, written, skipped, details, ok: true };
  }

  /** The frame the playhead is on, as the page reports it. */
  async currentFrame(): Promise<number> {
    return readFrame(this.page, this.selectors.playhead.readout.candidates[0], this.settleMs);
  }

  private async matchOne(field: FieldSelectors): Promise<string | null> {
    for (const candidate of field.candidates) {
      if (await this.exists(candidate)) return candidate;
    }
    return null;
  }

  private async exists(selector: string): Promise<boolean> {
    const handle = await this.page.$(selector);
    return handle !== null && handle !== undefined;
  }

  /** Present, rendered and clickable - not merely in the DOM. */
  private async isUsable(selector: string): Promise<boolean> {
    if (typeof this.page.evaluate !== 'function') return this.exists(selector);
    return this.page.evaluate<boolean, string>((target) => {
      const node = document.querySelector(target);
      if (node === null) return false;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(node);
      return style.visibility !== 'hidden' && style.display !== 'none';
    }, selector);
  }
}

function toTarget(attribute: AttributeSelector) {
  return {
    label: attribute.label,
    attributeType: attribute.attributeType,
    widget: attribute.widget,
    plannedUnit: attribute.plannedUnit,
  };
}

export { rowSelector, widgetSelector };
