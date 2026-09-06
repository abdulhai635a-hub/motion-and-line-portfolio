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
  const widget = `${rowSelector(target.attributeType)} ${target.widget}`;
  return page.evaluate<RowState>(
    new Function(`
      const widget = document.querySelector(${quote(widget)});
      if (widget === null) return { found: false, displayed: '', unitTitle: '', editBox: null };
      const box = widget.querySelector('[contenteditable="true"], [contenteditable=""]');
      return {
        found: true,
        displayed: (widget.querySelector('.presentedValue') || {}).textContent || '',
        unitTitle: (widget.querySelector('.unit') || {}).getAttribute
          ? widget.querySelector('.unit').getAttribute('title') || ''
          : '',
        editBox: box === null ? null : (box.textContent || ''),
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
    try {
      await page.click(`${row} [data-action="click:addKeyframe"]`, { timeout: timeoutMs });
      keyframed = true;
    } catch (cause) {
      throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `Could not add a keyframe for ${target.label}.`, {
        detail: cause instanceof Error ? cause.message : String(cause),
        hint: 'The value was set, but it is not a keyframe without this button.',
        cause,
      });
    }
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

/** Plain decimal text; the field is a contenteditable, not a number input. */
export function formatForField(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  return value.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}
