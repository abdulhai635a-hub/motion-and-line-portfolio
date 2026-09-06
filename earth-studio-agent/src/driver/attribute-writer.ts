/**
 * Writes one camera attribute the way Earth Studio actually accepts it.
 *
 * Observed on the live editor: each attribute is a row
 * `li.attribute[data-attribute-type]`, and its value is not an input but a
 * focusable `span.scrub-input.valueInput` showing `span.presentedValue`.
 * Clicking it adds an `editing` class and inserts
 * `div[contenteditable="true"].input` holding the full-precision value with the
 * text selected; Enter commits, Escape cancels. Every row also carries
 * `button[data-action="click:addKeyframe"]`.
 *
 * So the gesture is: click, select all, type, Enter, read back - then click the
 * keyframe button so the value becomes a keyframe rather than a static change.
 */
import type { PageLike } from './page.ts';
import { AgentError } from '../errors.ts';
import { metresPerDisplayUnit, metresPerEditUnit, parseDisplayedNumber, readbackTolerance } from './units.ts';

export interface AttributeTarget {
  /** Shown in errors, e.g. "camera altitude". */
  label: string;
  /** The row's data-attribute-type, e.g. "altitude". */
  attributeType: string;
  /** Which widget in the row carries the value, e.g. ".scrub-input.valueInput". */
  widget: string;
  /** Whether the planned number is metres (altitude) or plain degrees. */
  plannedUnit: 'metres' | 'degrees';
}

export interface WriteResult {
  attributeType: string;
  /** What the agent meant, in its own units. */
  planned: number;
  /** What was typed into the edit box, after any unit conversion. */
  typed: number;
  /** The unit label's tooltip, e.g. "Kilometers". */
  displayUnit: string;
  /** Metres per edit-box unit, as worked out from the page. */
  metresPerEditUnit: number;
  /** The value read back afterwards, in the agent's units. */
  readback: number;
  keyframed: boolean;
}

interface RowState {
  found: boolean;
  displayed: string;
  unitTitle: string;
  editBox: string | null;
  /**
   * Whether the row already has a keyframe at the current frame. Earth Studio
   * binds this itself: the keyframe button carries
   * data-bind-attr="class=hasKeyframeAtCurrentFrame:has-keyframe".
   */
  hasKeyframe: boolean;
  /** Whether the keyframe button is in the DOM at all. */
  hasKeyframeButton: boolean;
}

const rowSelector = (type: string): string => `[data-attribute-type="${type}"]`;

/** CSS strings reach the page inside a built function, so quotes must be safe. */
function quote(value: string): string {
  return JSON.stringify(value);
}

async function readRow(page: PageLike, target: AttributeTarget): Promise<RowState> {
  if (typeof page.evaluate !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be read.');
  }
  const row = rowSelector(target.attributeType);
  const widget = `${row} ${target.widget}`;
  return page.evaluate<RowState>(
    new Function(`
      const widget = document.querySelector(${quote(widget)});
      const row = document.querySelector(${quote(row)});
      const button = row === null ? null : row.querySelector('[data-action="click:addKeyframe"]');
      if (widget === null) {
        return { found: false, displayed: '', unitTitle: '', editBox: null, hasKeyframe: false, hasKeyframeButton: button !== null };
      }
      const box = widget.querySelector('[contenteditable="true"], [contenteditable=""]');
      return {
        found: true,
        displayed: (widget.querySelector('.presentedValue') || {}).textContent || '',
        unitTitle: (widget.querySelector('.unit') || {}).getAttribute
          ? widget.querySelector('.unit').getAttribute('title') || ''
          : '',
        editBox: box === null ? null : (box.textContent || ''),
        hasKeyframe: button !== null && button.classList.contains('has-keyframe'),
        hasKeyframeButton: button !== null,
      };
    `) as () => RowState,
  );
}

export interface WriteOptions {
  /** Click the row's keyframe button after committing. Default true. */
  addKeyframe?: boolean;
  timeoutMs?: number;
  /**
   * How long to wait for the displayed value to catch up after Enter. Earth
   * Studio updates the readout asynchronously, so reading it once, immediately,
   * sees the old value and rejects a write that in fact succeeded.
   */
  settleTimeoutMs?: number;
}

export async function writeAttribute(
  page: PageLike,
  target: AttributeTarget,
  planned: number,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const { addKeyframe = true, timeoutMs = 10_000, settleTimeoutMs = 4_000 } = options;
  if (typeof page.click !== 'function' || page.keyboard === undefined) {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be driven.', {
      detail: 'The page object provides no click() or keyboard.',
    });
  }

  const row = rowSelector(target.attributeType);
  const widget = `${row} ${target.widget}`;

  const before = await readRow(page, target);
  if (!before.found) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `No ${target.label} row is on the page.`, {
      detail: `Looked for ${widget}`,
      hint: 'Run "earth-studio-agent probe" to list the attribute rows this project actually shows.',
    });
  }

  // Open the edit box.
  try {
    await page.click(widget, { timeout: timeoutMs });
    await page.waitForSelector(`${widget} [contenteditable]`, { timeout: timeoutMs });
  } catch (cause) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${target.label} field did not open for editing.`, {
      detail: cause instanceof Error ? cause.message : String(cause),
      hint: `Selector used: ${widget}`,
      cause,
    });
  }

  const opened = await readRow(page, target);
  const displayed = parseDisplayedNumber(before.displayed);
  const editBoxValue = parseDisplayedNumber(opened.editBox ?? '');
  const perDisplay = metresPerDisplayUnit(opened.unitTitle);
  const perEdit =
    target.plannedUnit === 'metres' ? metresPerEditUnit(opened.unitTitle, displayed, editBoxValue) : 1;

  const typed = target.plannedUnit === 'metres' ? planned / perEdit : planned;

  await page.keyboard.press('Control+a');
  await page.keyboard.type(formatForField(typed));
  await page.keyboard.press('Enter');

  const tolerance = readbackTolerance(planned, target.plannedUnit === 'metres' ? perDisplay : 1);
  const toPlanned = (displayedText: string): number => {
    const value = parseDisplayedNumber(displayedText);
    return target.plannedUnit === 'metres' ? value * perDisplay : value;
  };

  // Poll rather than read once: the readout catches up a moment after Enter.
  const deadline = Date.now() + settleTimeoutMs;
  let after = await readRow(page, target);
  let readback = toPlanned(after.displayed);
  while (
    Date.now() < deadline &&
    (!Number.isFinite(readback) || Math.abs(readback - planned) > tolerance || after.editBox !== null)
  ) {
    await new Promise((done) => setTimeout(done, 100));
    after = await readRow(page, target);
    readback = toPlanned(after.displayed);
  }

  if (!Number.isFinite(readback) || Math.abs(readback - planned) > tolerance) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${target.label} field did not take ${planned}.`, {
      detail:
        `Typed ${formatForField(typed)} into a field reading in ${opened.unitTitle || 'unknown units'}; ` +
        `after ${settleTimeoutMs}ms it still shows "${after.displayed}", which is ${readback} ` +
        `against the ${planned} that was wanted.`,
      hint: `Selector used: ${widget}`,
    });
  }

  let keyframed = false;
  if (addKeyframe) {
    keyframed = await ensureKeyframe(page, target, row, after, timeoutMs);
  }

  return {
    attributeType: target.attributeType,
    planned,
    typed,
    displayUnit: opened.unitTitle,
    metresPerEditUnit: perEdit,
    readback,
    keyframed,
  };
}

/**
 * Makes sure the value is a keyframe, not a static change.
 *
 * Earth Studio keyframes an animated attribute by itself when its value
 * changes, and marks that on the row's button with a `has-keyframe` class. So
 * the button is only clicked when the app says there is no keyframe yet -
 * clicking one that already exists would remove it.
 */
async function ensureKeyframe(
  page: PageLike,
  target: AttributeTarget,
  row: string,
  after: RowState,
  timeoutMs: number,
): Promise<boolean> {
  if (after.hasKeyframe) return true;
  if (!after.hasKeyframeButton) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${target.label} row has no keyframe button.`, {
      detail: `Looked for ${row} [data-action="click:addKeyframe"]`,
      hint: 'The value was set, but it is not a keyframe. Run "earth-studio-agent probe" to see the row.',
    });
  }

  const button = `${row} [data-action="click:addKeyframe"]`;
  const attempts: string[] = [];

  // Three ways in, weakest assumptions last. A real mouse click is the most
  // faithful; a forced one ignores anything sitting over the button; and
  // dispatching the click from inside the page works even when the button has
  // no box at all, which is what a narrow Earth Studio window produces - the
  // live run failed with "Element is not visible" even under force.
  const ways: Array<[string, () => Promise<unknown>]> = [
    ['hover and click', async () => {
      if (typeof page.hover === 'function') await page.hover(row, { timeout: timeoutMs });
      await page.click!(button, { timeout: timeoutMs });
    }],
    ['forced click', async () => page.click!(button, { timeout: timeoutMs, force: true })],
    ['click from inside the page', async () => {
      if (typeof page.evaluate !== 'function') throw new Error('the page cannot run script');
      const clicked = await page.evaluate<boolean>(
        new Function(`
          const node = document.querySelector(${quote(button)});
          if (node === null) return false;
          node.click();
          return true;
        `) as () => boolean,
      );
      if (!clicked) throw new Error('the button is not in the page');
    }],
  ];

  let landed = false;
  for (const [name, attempt] of ways) {
    try {
      await attempt();
    } catch (cause) {
      attempts.push(`${name}: ${describe(cause)}`);
      continue;
    }
    if (await keyframeAppeared(page, target)) {
      landed = true;
      break;
    }
    attempts.push(`${name}: no keyframe appeared`);
  }

  if (!landed) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `Could not add a keyframe for ${target.label}.`, {
      detail: attempts.join('; '),
      hint: 'The value was set, but it is not a keyframe. Run "earth-studio-agent probe --buttons" to see the control.',
    });
  }
  return true;
}

/** Waits briefly for the app to mark the row as keyframed at this frame. */
async function keyframeAppeared(page: PageLike, target: AttributeTarget): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if ((await readRow(page, target)).hasKeyframe) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}

/** Plain decimal text; the field is a contenteditable, not a number input. */
export function formatForField(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  return value.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}
