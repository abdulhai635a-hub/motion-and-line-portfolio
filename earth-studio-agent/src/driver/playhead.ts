/**
 * Moving Earth Studio's playhead.
 *
 * The timecode readout, `li.control.timecode`, cannot be typed into: its only
 * action is `click:toggleTimeFormat`, which switches between a frame count and
 * a timecode. Probing the live editor showed the playhead is driven from the
 * keyboard instead:
 *
 *   Home              frame 0
 *   End               the last frame
 *   ArrowRight/Left   one frame
 *   Shift+Arrow       five frames
 *
 * Two things caught the probe out and are handled here. Keystrokes reach the
 * app only when focus is not on a control - clicking the readout leaves focus
 * on it, and every key then looks dead. And the readout updates
 * asynchronously, so it has to be read after the app settles, not immediately.
 */
import type { PageLike } from './page.ts';
import { AgentError } from '../errors.ts';

export const READOUT = 'li.control.timecode';
/** Frames moved by one Shift+Arrow press. */
export const COARSE_STEP = 5;

/**
 * The transport buttons beside the readout. Clicking these cannot be defeated
 * by focus sitting somewhere unhelpful, so they are the fallback when the
 * keyboard turns out to do nothing.
 */
export const JUMP_START = '[data-action="click:jumpWorkspaceStart"]';
export const STEP_FORWARD = '[data-action="click:forward"]';
export const STEP_BACKWARD = '[data-action="click:backward"]';

export interface SeekOptions {
  readout?: string;
  /** Milliseconds to let the readout catch up after a burst of keys. */
  settleMs?: number;
  /** Refuse to press more keys than this for one seek. */
  maxPresses?: number;
}

export interface SeekResult {
  from: number;
  to: number;
  presses: number;
  /** True when the first attempt missed and an absolute seek was needed. */
  corrected: boolean;
}

/** Reads the playhead position, switching the readout to frames if needed. */
export async function readFrame(page: PageLike, readout = READOUT, settleMs = 250): Promise<number> {
  if (typeof page.evaluate !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be read.');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const text = await page.evaluate<string, string>((selector) => {
      const node = document.querySelector(selector);
      return node === null ? '' : (node.textContent ?? '').trim();
    }, readout);
    if (/^-?\d+$/.test(text)) return Number(text);
    if (text === '') {
      throw new AgentError('DRIVER_FRAME_SEEK_FAILED', 'The timecode readout is not on the page.', {
        detail: `Looked for ${readout}`,
        hint: 'Run "earth-studio-agent probe --playhead" to check the timeline controls.',
      });
    }
    // A timecode like 00:00:04; one click cycles the display back to frames.
    if (typeof page.click !== 'function') break;
    await page.click(readout, { timeout: 5_000 });
    await pause(settleMs);
  }
  throw new AgentError('DRIVER_FRAME_SEEK_FAILED', 'The timecode readout never showed a frame number.', {
    hint: 'Click the timecode in Earth Studio until it shows frames, then re-run.',
  });
}

/** Takes focus off any control, so keystrokes reach the application. */
export async function releaseFocus(page: PageLike): Promise<void> {
  if (typeof page.evaluate !== 'function') return;
  await page.evaluate<void, undefined>(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    document.body?.focus?.();
  });
}

/**
 * Moves the playhead to `frame` and confirms it arrived.
 *
 * Stepping is relative, because that is all the keyboard offers, so the result
 * is always read back; if it is wrong the seek is retried from Home, which
 * cannot accumulate error.
 */
export async function seekToFrame(page: PageLike, frame: number, options: SeekOptions = {}): Promise<SeekResult> {
  const { readout = READOUT, settleMs = 250, maxPresses = 4_000 } = options;
  if (!Number.isInteger(frame) || frame < 0) {
    throw new AgentError('DRIVER_FRAME_SEEK_FAILED', `Frame ${frame} is not a frame number.`);
  }
  if (page.keyboard === undefined) {
    throw new AgentError('DRIVER_NOT_READY', 'This page has no keyboard to drive.');
  }

  await releaseFocus(page);
  const from = await readFrame(page, readout, settleMs);
  if (from === frame) return { from, to: frame, presses: 0, corrected: false };

  let presses = await step(page, frame - from, maxPresses);
  await pause(settleMs);
  let landed = await readFrame(page, readout, settleMs);
  if (landed === frame) return { from, to: landed, presses, corrected: false };

  // Relative stepping drifted, or the keyboard did nothing at all. Go back to a
  // known frame and try again; the jump button is used rather than Home because
  // a click cannot be swallowed by whatever holds focus.
  presses += await jumpToStart(page, settleMs);
  presses += await step(page, frame, maxPresses);
  await pause(settleMs);
  landed = await readFrame(page, readout, settleMs);
  if (landed === frame) return { from, to: landed, presses, corrected: true };

  // The keyboard is not reaching the application. The transport buttons are.
  if (landed === 0 && typeof page.click === 'function') {
    presses += await clickForward(page, frame, maxPresses);
    await pause(settleMs);
    landed = await readFrame(page, readout, settleMs);
    if (landed === frame) return { from, to: landed, presses, corrected: true };
  }

  throw new AgentError('DRIVER_FRAME_SEEK_FAILED', `The playhead would not move to frame ${frame}.`, {
    detail: `It sits at frame ${landed} after ${presses} attempts.`,
    hint: 'Run "earth-studio-agent probe --playhead" to see what the timeline controls are doing.',
  });
}

/** Presses arrow keys to move `delta` frames, coarse steps first. */
async function step(page: PageLike, delta: number, maxPresses: number): Promise<number> {
  if (page.keyboard === undefined || delta === 0) return 0;
  const forward = delta > 0;
  const distance = Math.abs(delta);
  const coarse = Math.floor(distance / COARSE_STEP);
  const fine = distance % COARSE_STEP;
  const total = coarse + fine;
  if (total > maxPresses) {
    throw new AgentError('DRIVER_FRAME_SEEK_FAILED', `Moving ${distance} frames would take ${total} key presses.`, {
      hint: 'Raise maxPresses, or shorten the path.',
    });
  }
  const coarseKey = forward ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
  const fineKey = forward ? 'ArrowRight' : 'ArrowLeft';
  for (let press = 0; press < coarse; press += 1) await page.keyboard.press(coarseKey);
  for (let press = 0; press < fine; press += 1) await page.keyboard.press(fineKey);
  return total;
}

/** Clicks the jump-to-start control, falling back to the Home key. */
async function jumpToStart(page: PageLike, settleMs: number): Promise<number> {
  if (typeof page.click === 'function') {
    try {
      await page.click(JUMP_START, { timeout: 5_000 });
      await pause(settleMs);
      await releaseFocus(page);
      return 1;
    } catch {
      // The control is not there; the key below is the fallback.
    }
  }
  if (page.keyboard !== undefined) {
    await page.keyboard.press('Home');
    await pause(settleMs);
    return 1;
  }
  return 0;
}

/** Steps forward one frame at a time using the transport button. */
async function clickForward(page: PageLike, frames: number, maxPresses: number): Promise<number> {
  if (typeof page.click !== 'function') return 0;
  if (frames > maxPresses) {
    throw new AgentError('DRIVER_FRAME_SEEK_FAILED', `Stepping ${frames} frames by button would take ${frames} clicks.`, {
      hint: 'Raise maxPresses, or shorten the path.',
    });
  }
  for (let click = 0; click < frames; click += 1) {
    try {
      await page.click(STEP_FORWARD, { timeout: 5_000 });
    } catch {
      // The transport button is missing or unclickable; the caller reports the
      // frame actually reached rather than a Playwright stack trace.
      return click;
    }
  }
  return frames;
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
