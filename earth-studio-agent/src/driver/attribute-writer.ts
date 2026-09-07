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

async function readRow(
  page: PageLike,
  target: AttributeTarget,
  row = rowSelector(target.attributeType),
): Promise<RowState> {
  if (typeof page.evaluate !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be read.');
  }
  const widget = `${row} ${target.widget}`;
  return page.evaluate<RowState, { row: string; widget: string }>(
    ({ row: rowSelectorText, widget: widgetSelectorText }) => {
      const widgetNode = document.querySelector(widgetSelectorText);
      const rowNode = document.querySelector(rowSelectorText);
      const button = rowNode === null ? null : rowNode.querySelector('[data-action="click:addKeyframe"]');
      if (widgetNode === null) {
        return {
          found: false,
          displayed: '',
          unitTitle: '',
          editBox: null,
          hasKeyframe: false,
          hasKeyframeButton: button !== null,
        };
      }
      const box = widgetNode.querySelector('[contenteditable="true"], [contenteditable=""]');
      return {
        found: true,
        displayed: widgetNode.querySelector('.presentedValue')?.textContent ?? '',
        unitTitle: widgetNode.querySelector('.unit')?.getAttribute('title') ?? '',
        editBox: box === null ? null : (box.textContent ?? ''),
        hasKeyframe: button !== null && button.classList.contains('has-keyframe'),
        hasKeyframeButton: button !== null,
      };
    },
    { row, widget },
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

  // A project can carry more than one element per attribute type - a template,
  // an off-screen copy, a row in a panel that is not the timeline - and the
  // first one in the document is not always the one on screen. So the row is
  // chosen by what it looks like, then marked, and everything below addresses
  // the mark rather than the type.
  const row = await pickRow(page, target);
  const widget = `${row} ${target.widget}`;

  const before = await readRow(page, target, row);
  if (!before.found) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `No ${target.label} row is on the page.`, {
      detail: `Looked for ${widget}`,
      hint: 'Run "earth-studio-agent probe" to list the attribute rows this project actually shows.',
    });
  }

  await openEditor(page, widget, target, rowSelector(target.attributeType), timeoutMs);

  const opened = await readRow(page, target, row);
  const displayed = parseDisplayedNumber(before.displayed);
  const editBoxValue = parseDisplayedNumber(opened.editBox ?? '');
  // The unit label read BEFORE the click. Earth Studio relabels the altitude
  // "Meters" while its edit box is open even though the number on screen is
  // still kilometres; pairing the two describes a quantity that does not exist,
  // and a live run that did so typed a thousand times the intended altitude.
  const perDisplay = metresPerDisplayUnit(before.unitTitle);
  const perEdit =
    target.plannedUnit === 'metres' ? metresPerEditUnit(before.unitTitle, displayed, editBoxValue) : 1;

  const typed = target.plannedUnit === 'metres' ? planned / perEdit : planned;

  // Type into the edit box by addressing it, not by trusting where focus is.
  // Ctrl+A followed by keystrokes goes wherever focus happens to be, and a live
  // run lost a whole keyframe that way: the box stayed open, nothing was
  // committed, and the field still read its old value.
  const editSelector = `${widget} [contenteditable]`;
  const text = formatForField(typed);
  try {
    await page.fill(editSelector, text, { timeout: timeoutMs });
  } catch {
    // Older shapes of the widget may not accept fill; fall back to the keyboard.
    await page.keyboard.press('Control+a');
    await page.keyboard.type(text);
  }
  try {
    await page.press(editSelector, 'Enter', { timeout: timeoutMs });
  } catch {
    await page.keyboard.press('Enter');
  }

  // The edit box must close, or nothing was committed. One more Enter, then
  // give up cleanly rather than leaving the project mid-edit.
  if (await stillEditing(page, target, row)) {
    await page.keyboard.press('Enter');
    if (await stillEditing(page, target, row)) {
      await page.keyboard.press('Escape');
      throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${target.label} field would not commit ${planned}.`, {
        detail: `Typed ${text}, but the edit box stayed open, so the value was never applied.`,
        hint: `Selector used: ${editSelector}`,
      });
    }
  }

  // The read-back must use the unit as it reads AFTER the commit, not before:
  // Earth Studio switches the altitude between kilometres and metres by
  // magnitude, so writing 1500 m into a field that read kilometres leaves it
  // reading "1500 m". Converting that with the old label made a correct write
  // look like a thousandfold overshoot.
  const toPlanned = (row: RowState): number => {
    const value = parseDisplayedNumber(row.displayed);
    return target.plannedUnit === 'metres' ? value * metresPerDisplayUnit(row.unitTitle) : value;
  };
  const toleranceFor = (row: RowState): number =>
    readbackTolerance(planned, target.plannedUnit === 'metres' ? metresPerDisplayUnit(row.unitTitle) : 1);

  // Poll rather than read once: the readout catches up a moment after Enter.
  const deadline = Date.now() + settleTimeoutMs;
  let after = await readRow(page, target, row);
  let readback = toPlanned(after);
  let tolerance = toleranceFor(after);
  while (
    Date.now() < deadline &&
    (!Number.isFinite(readback) || Math.abs(readback - planned) > tolerance || after.editBox !== null)
  ) {
    await new Promise((done) => setTimeout(done, 100));
    after = await readRow(page, target, row);
    readback = toPlanned(after);
    tolerance = toleranceFor(after);
  }

  if (!Number.isFinite(readback) || Math.abs(readback - planned) > tolerance) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${target.label} field did not take ${planned}.`, {
      detail:
        `Typed ${formatForField(typed)} into a field reading in ${before.unitTitle || 'unknown units'} ` +
        `(one edit-box unit = ${perEdit} m); after ${settleTimeoutMs}ms it shows ` +
        `"${after.displayed}" ${after.unitTitle || 'in unknown units'}, which is ${readback} ` +
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
    displayUnit: before.unitTitle,
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
      const clicked = await page.evaluate<boolean, string>((selector) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (node === null) return false;
        node.click();
        return true;
      }, button);
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
    if (await keyframeAppeared(page, target, row)) {
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

/** True when the edit box is still open a moment after Enter. */
async function stillEditing(page: PageLike, target: AttributeTarget, row: string): Promise<boolean> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if ((await readRow(page, target, row)).editBox === null) return false;
    await new Promise((done) => setTimeout(done, 100));
  }
  return true;
}

/** Waits briefly for the app to mark the row as keyframed at this frame. */
async function keyframeAppeared(page: PageLike, target: AttributeTarget, row: string): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if ((await readRow(page, target, row)).hasKeyframe) return true;
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

/** The gestures tried, in order, to get a value field into edit mode. */
const GESTURES = ['click', 'pointer', 'mouse', 'native', 'dblclick'] as const;
type Gesture = (typeof GESTURES)[number];

/**
 * Opens a value field for editing.
 *
 * One click is all it takes with a real mouse, and that is what the first
 * attempt is. Inside a Chrome extension the click is synthesised, and a
 * synthetic one can miss: a control that captures the pointer throws on a
 * pointerId that belongs to no real pointer, and its handler dies before the
 * part that opens the box. So the click escalates - pointer events, then mouse
 * events alone, then the element's own click(), then a double click - and each
 * attempt is checked rather than assumed.
 */
async function openEditor(
  page: PageLike,
  widget: string,
  target: AttributeTarget,
  originalRow: string,
  timeoutMs: number,
): Promise<void> {
  const label = target.label;
  const edit = `${widget} [contenteditable]`;
  const tried: Gesture[] = [];
  let lastError: unknown;
  // The first attempt gets the full timeout, since it is also the one waiting
  // for a slow page; the fallbacks only need to be given a moment each.
  let budget = timeoutMs;
  for (const gesture of GESTURES) {
    if (await isOpen(page, edit)) return;
    tried.push(gesture);
    try {
      if (gesture === 'click') await page.click?.(widget, { timeout: timeoutMs });
      else await gestureAt(page, widget, gesture);
    } catch (cause) {
      lastError = cause;
    }
    if (await waitOpen(page, edit, budget)) return;
    budget = 1_200;
  }

  throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `The ${label} field did not open for editing.`, {
    detail:
      `Tried ${tried.join(', ')} on ${widget}` +
      (lastError instanceof Error ? `; last error: ${lastError.message.split('\n')[0]}` : ''),
    // Every candidate, not just the one that was tried. Without a terminal -
    // which is the whole point of the extension - this message is the only way
    // to see whether the field simply ignored the click or whether the wrong
    // element was clicked all along.
    hint: `Candidates for ${originalRow} ${target.widget}: ${await describeMatches(page, `${originalRow} ${target.widget}`)}`,
    cause: lastError,
  });
}

/**
 * The attribute row to drive, marked so that every later selector means this
 * one element. Where several match, the visible one wins - and where several
 * are visible, the one whose value field is largest, which is the row a person
 * would have clicked.
 */
async function pickRow(page: PageLike, target: AttributeTarget): Promise<string> {
  const plain = rowSelector(target.attributeType);
  if (typeof page.evaluate !== 'function') return plain;
  const marked = await page.evaluate<boolean, { row: string; widget: string; mark: string }>(
    (input) => {
      const rows = Array.from(document.querySelectorAll(input.row));
      for (const node of Array.from(document.querySelectorAll(`[data-agent-row="${input.mark}"]`))) {
        node.removeAttribute('data-agent-row');
      }
      if (rows.length === 0) return false;
      const score = (node: Element): number => {
        const field = node.querySelector(input.widget);
        if (field === null) return -1;
        const box = field.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return 0;
        const style = getComputedStyle(field as HTMLElement);
        if (style.visibility === 'hidden' || style.display === 'none') return 0;
        return box.width * box.height;
      };
      let best = rows[0] as Element;
      let bestScore = score(best);
      for (const node of rows.slice(1)) {
        const value = score(node);
        if (value > bestScore) {
          best = node;
          bestScore = value;
        }
      }
      best.setAttribute('data-agent-row', input.mark);
      return true;
    },
    { row: plain, widget: target.widget, mark: target.attributeType },
  );
  return marked ? `[data-agent-row="${target.attributeType}"]` : plain;
}

/** Every element a selector matches, for a failure someone has to read. */
async function describeMatches(page: PageLike, selector: string): Promise<string> {
  if (typeof page.evaluate !== 'function') return selector;
  try {
    return await page.evaluate<string, string>((query) => {
      const nodes = Array.from(document.querySelectorAll(query));
      if (nodes.length === 0) return 'none on the page at all';
      return nodes
        .map((node, index) => {
          const box = node.getBoundingClientRect();
          const centreX = box.left + box.width / 2;
          const centreY = box.top + box.height / 2;
          const under = document.elementFromPoint(centreX, centreY);
          const covered = under === null ? 'off-screen' : node.contains(under) ? 'clickable' : `covered by <${under.tagName.toLowerCase()} class="${under.className}">`;
          return (
            `#${index + 1} <${node.tagName.toLowerCase()} class="${node.className}"> ` +
            `${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.left)},${Math.round(box.top)} ` +
            `text "${(node.textContent ?? '').trim().slice(0, 24)}" ${covered}`
          );
        })
        .join(' | ');
    }, selector);
  } catch {
    return selector;
  }
}

/** True once the edit box exists and has been laid out. */
async function isOpen(page: PageLike, edit: string): Promise<boolean> {
  if (typeof page.evaluate !== 'function') return false;
  return page.evaluate<boolean, string>((selector) => {
    const node = document.querySelector(selector);
    if (node === null) return false;
    const box = node.getBoundingClientRect();
    return box.width > 0 || box.height > 0;
  }, edit);
}

async function waitOpen(page: PageLike, edit: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await isOpen(page, edit)) return true;
    await new Promise((done) => setTimeout(done, 80));
  } while (Date.now() < deadline);
  return false;
}

/** Dispatches one gesture inside the page, so it works with or without Playwright. */
async function gestureAt(page: PageLike, selector: string, kind: Gesture): Promise<void> {
  if (typeof page.evaluate !== 'function') return;
  await page.evaluate<void, { selector: string; kind: string }>((input) => {
    const element = document.querySelector(input.selector) as HTMLElement | null;
    if (element === null) return;
    // A real click lands on whatever is under the pointer, after the browser has
    // brought it into view. Both matter: a handler that checks event.target
    // ignores a press delivered to the wrapper instead of the number inside it,
    // and a row scrolled out of the panel has no on-screen point at all.
    element.scrollIntoView?.({ block: 'center', inline: 'center' });
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const under = document.elementFromPoint(x, y);
    const target = under !== null && element.contains(under) ? (under as HTMLElement) : element;
    const fire = (type: string, extra: Record<string, unknown>): void => {
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        detail: 1,
        ...extra,
      };
      const pointer = type.startsWith('pointer') && typeof PointerEvent === 'function';
      target.dispatchEvent(
        pointer
          ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 })
          : new MouseEvent(type, init),
      );
    };

    if (input.kind === 'native') {
      target.click();
      return;
    }
    if (input.kind === 'dblclick') {
      for (const detail of [1, 2]) {
        fire('mousedown', { buttons: 1, detail });
        fire('mouseup', { buttons: 0, detail });
        fire('click', { detail });
      }
      fire('dblclick', { detail: 2 });
      return;
    }

    // A control can arm on hover and only then read the press, so the pointer
    // arrives before it is put down.
    const usePointer = input.kind === 'pointer';
    if (usePointer) {
      fire('pointerover', { buttons: 0 });
      fire('pointerenter', { buttons: 0 });
    }
    fire('mouseover', { buttons: 0 });
    fire('mouseenter', { buttons: 0 });
    if (usePointer) fire('pointermove', { buttons: 0 });
    fire('mousemove', { buttons: 0 });
    if (usePointer) fire('pointerdown', { buttons: 1, pressure: 0.5 });
    fire('mousedown', { buttons: 1 });
    (target.closest('[tabindex]') as HTMLElement | null)?.focus?.();
    if (usePointer) fire('pointerup', { buttons: 0 });
    fire('mouseup', { buttons: 0 });
    fire('click', {});
  }, { selector, kind });
}
