/**
 * Works out how Earth Studio's attribute rows are edited.
 *
 * The live editor turned out not to use inputs at all: each row is
 *
 *   <li class="attribute" data-attribute-type="latitude">
 *     <span class="title">Latitude</span>
 *     <span class="actions"><span class="value">
 *       <span class="scrub-input valueInput" tabindex="0">
 *         <span class="presentedValueContainer"><span class="presentedValue">-15.018</span></span>
 *         <span class="unit degrees" title="Degrees">deg</span>
 *   ...
 *     <button data-action="click:addKeyframe" title-tooltip="Add keyframe">
 *
 * `list` reports every row, its type, its value and its displayed unit - the
 * unit matters because altitude is shown in kilometres while the agent plans in
 * metres. `interact` clicks one row and reports what the DOM does, which is how
 * the driver learns whether editing opens an input, turns the span
 * contenteditable, or something else again.
 */
import type { PageLike } from './page.ts';
import { AgentError } from '../errors.ts';

export interface AttributeRow {
  /** The value of data-attribute-type, e.g. "latitude". */
  type: string;
  /** The row's visible title, e.g. "Latitude". */
  title: string;
  /** Every scrub widget in the row, in document order. */
  widgets: Array<{
    classes: string;
    value: string;
    /** Unit text as displayed, e.g. "km". */
    unit: string;
    /** The unit's tooltip, e.g. "Kilometers" - the authoritative one. */
    unitTitle: string;
  }>;
  hasKeyframeButton: boolean;
}

export interface AttributeSurvey {
  url: string;
  rows: AttributeRow[];
  /** Selectors the survey suggests, ready to paste into selectors.ts. */
  suggestions: Record<string, string>;
}

const SURVEY = (): AttributeSurvey => {
  const rows = Array.from(document.querySelectorAll('[data-attribute-type]')).map((row) => {
    const type = row.getAttribute('data-attribute-type') ?? '';
    const title = (row.querySelector('.title')?.textContent ?? '').trim();
    const widgets = Array.from(row.querySelectorAll('.scrub-input')).map((widget) => ({
      classes: widget.className.toString(),
      value: (widget.querySelector('.presentedValue')?.textContent ?? '').trim(),
      unit: (widget.querySelector('.unit')?.textContent ?? '').trim(),
      unitTitle: widget.querySelector('.unit')?.getAttribute('title') ?? '',
    }));
    return {
      type,
      title,
      widgets,
      hasKeyframeButton: row.querySelector('[data-action="click:addKeyframe"]') !== null,
    };
  });

  const suggestions: Record<string, string> = {};
  for (const row of rows) {
    if (row.type === '') continue;
    suggestions[row.type] = `[data-attribute-type="${row.type}"] .scrub-input.valueInput`;
  }
  return { url: location.href, rows, suggestions };
};

export async function surveyAttributes(page: PageLike): Promise<AttributeSurvey> {
  if (typeof page.evaluate !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be probed.');
  }
  return page.evaluate<AttributeSurvey>(SURVEY);
}

export interface InteractionStep {
  what: string;
  /** The row's HTML after this step, truncated. */
  html: string;
  /** tag.class of document.activeElement after this step. */
  focused: string;
  /** Any input or contenteditable that now exists inside the row. */
  editable: string[];
}

export interface InteractionReport {
  type: string;
  steps: InteractionStep[];
}

/**
 * Clicks one attribute's value widget and records what the DOM does, so the
 * driver can be written against the real editing gesture rather than a guess.
 * Typing is opt-in and always ends with Escape, which cancels the edit.
 */
export async function probeAttribute(
  page: PageLike,
  type: string,
  typeValue?: string,
): Promise<InteractionReport> {
  return probeSelector(page, `[data-attribute-type="${type}"]`, `[data-attribute-type="${type}"] .scrub-input.valueInput`, type, typeValue);
}

/**
 * Clicks any element and records the same before/after picture. The playhead
 * control is not an attribute row, so it needs this rather than probeAttribute.
 */
export async function probeSelector(
  page: PageLike,
  rowSelector: string,
  widgetSelector: string,
  label: string,
  typeValue?: string,
): Promise<InteractionReport> {
  if (typeof page.evaluate !== 'function' || typeof page.click !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be probed.');
  }
  const type = label;
  const steps: InteractionStep[] = [];

  const snapshot = async (what: string): Promise<void> => {
    const state = await page.evaluate!<Omit<InteractionStep, 'what'>>(
      new Function(`
        const row = document.querySelector('${rowSelector.replace(/'/g, "\\\\'")}');
        const active = document.activeElement;
        const describe = (element) => {
          if (element === null) return '(none)';
          const classes = element.className ? String(element.className).trim().split(/\\\\s+/).join('.') : '';
          return element.tagName.toLowerCase() + (classes === '' ? '' : '.' + classes);
        };
        const editable = row === null ? [] : Array.from(
          row.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable=""]'),
        ).map(describe);
        return {
          html: row === null ? '(row not found)' : row.outerHTML.slice(0, 1200),
          focused: describe(active),
          editable,
        };
      `) as () => Omit<InteractionStep, 'what'>,
    );
    steps.push({ what, ...state });
  };

  await snapshot('before any interaction');

  try {
    await page.click(widgetSelector, { timeout: 5_000 });
  } catch (cause) {
    throw new AgentError('DRIVER_FIELD_WRITE_FAILED', `Could not click the ${type} widget.`, {
      detail: cause instanceof Error ? cause.message : String(cause),
      hint: `Selector used: ${widgetSelector}`,
      cause,
    });
  }
  await snapshot('after a single click');

  if (typeValue !== undefined && page.keyboard !== undefined) {
    await page.keyboard.type(typeValue);
    await snapshot(`after typing "${typeValue}"`);
    await page.keyboard.press('Escape');
    await snapshot('after Escape (edit cancelled)');
  }

  return { type, steps };
}

export function renderSurvey(survey: AttributeSurvey): string {
  const lines = [`Attribute rows on ${survey.url}`, ''];
  if (survey.rows.length === 0) {
    lines.push('  (none found - is the camera attributes panel open?)');
    return lines.join('\n');
  }
  lines.push(`  ${'data-attribute-type'.padEnd(22)} ${'title'.padEnd(18)} ${'value'.padEnd(12)} unit`);
  for (const row of survey.rows) {
    const primary = row.widgets.find((widget) => widget.classes.includes('valueInput')) ?? row.widgets[0];
    const unit = primary === undefined ? '' : `${primary.unit} (${primary.unitTitle})`;
    lines.push(
      `  ${row.type.padEnd(22)} ${row.title.padEnd(18)} ${(primary?.value ?? '').padEnd(12)} ${unit}` +
        `${row.widgets.length > 1 ? `   [${row.widgets.length} widgets]` : ''}` +
        `${row.hasKeyframeButton ? '' : '   (no keyframe button)'}`,
    );
  }
  lines.push('');
  lines.push('Suggested selectors');
  for (const [type, selector] of Object.entries(survey.suggestions)) {
    lines.push(`  ${type.padEnd(22)} ${selector}`);
  }
  return lines.join('\n');
}

export function renderInteraction(report: InteractionReport): string {
  const lines = [`Interaction with "${report.type}"`, ''];
  for (const step of report.steps) {
    lines.push(`--- ${step.what}`);
    lines.push(`    focused : ${step.focused}`);
    lines.push(`    editable: ${step.editable.length === 0 ? '(none)' : step.editable.join(', ')}`);
    lines.push(`    html    : ${step.html}`);
    lines.push('');
  }
  return lines.join('\n');
}
