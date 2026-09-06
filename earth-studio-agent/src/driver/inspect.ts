/**
 * Reports what the live Earth Studio page actually contains.
 *
 * The default selectors in selectors.ts are candidates, not verified fact
 * (PRD 4 and 11: Google publishes no DOM contract). When `verify-layout` says a
 * field is missing, this command dumps the page's real editable fields - their
 * attributes, their labels, and a usable selector for each - so the selector
 * file can be corrected from evidence instead of guesswork.
 */
import type { PageLike } from './page.ts';
import { AgentError } from '../errors.ts';

export interface FieldRow {
  tag: string;
  /** A CSS selector that reaches this element. */
  selector: string;
  /** Visible label text, when one could be found. */
  label: string;
  value: string;
  attributes: Record<string, string>;
  /** Enclosing elements, nearest first, with the attributes worth matching on. */
  ancestors: Array<{ tag: string; id: string; className: string; data: Record<string, string> }>;
}

export interface Inspection {
  url: string;
  title: string;
  fieldCount: number;
  iframeCount: number;
  /** Present when the page has no editable fields at all, to explain why. */
  note?: string;
  fields: FieldRow[];
  /** Only filled in by `--deep`, which digs past the obvious form controls. */
  deep?: DeepInspection;
}

/**
 * The wider sweep. Earth Studio's numeric attributes are not plain inputs - the
 * shallow pass finds only the "add to timeline" checkboxes - so this reports
 * every id on the page, every custom element, and the raw HTML of the rows that
 * hold the camera attributes, which is what new selectors get written from.
 */
export interface DeepInspection {
  ids: string[];
  customElements: string[];
  /** Window size: a small window makes Earth Studio hide whole panels. */
  viewport: { width: number; height: number };
  /** Class names that look like they belong to an attribute or value widget. */
  classHints: string[];
  /** Elements carrying a numeric-looking value, however they are built. */
  numericLike: Array<{
    tag: string;
    selector: string;
    label: string;
    text: string;
    attributes: Record<string, string>;
    /** Enclosing elements with their classes, which is what a selector hangs off. */
    parents: string;
  }>;
  /** Raw HTML of a few attribute rows, truncated. */
  samples: Array<{ around: string; html: string }>;
  /** Raw HTML requested with --html, when that was used. */
  requested?: Array<{ selector: string; matched: number; html: string[] }>;
}

export async function inspectPage(
  page: PageLike,
  limit = 60,
  deep = false,
  htmlSelectors: string[] = [],
): Promise<Inspection> {
  if (typeof page.evaluate !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be inspected.', {
      detail: 'The page object has no evaluate() method.',
    });
  }

  const raw = await page.evaluate<Inspection>(() => {
    const escape = (value: string): string =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/["\\]/g, '\\$&');

    const attributesOf = (element: Element): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        // Long inline styles and class lists drown out what matters.
        if (attribute.name === 'style') continue;
        result[attribute.name] = attribute.value.slice(0, 160);
      }
      return result;
    };

    const dataOf = (element: Element): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('data-') || attribute.name === 'aria-label') {
          result[attribute.name] = attribute.value.slice(0, 120);
        }
      }
      return result;
    };

    /** Prefer a stable hook (id, data-*, aria-label) over a positional path. */
    const selectorFor = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      if (element.id !== '') return `#${escape(element.id)}`;
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('data-') || attribute.name === 'aria-label' || attribute.name === 'name') {
          return `${tag}[${attribute.name}="${attribute.value}"]`;
        }
      }
      let ancestor: Element | null = element.parentElement;
      for (let depth = 0; depth < 4 && ancestor !== null; depth += 1) {
        if (ancestor.id !== '') return `#${escape(ancestor.id)} ${tag}`;
        for (const attribute of Array.from(ancestor.attributes)) {
          if (attribute.name.startsWith('data-') || attribute.name === 'aria-label') {
            return `${ancestor.tagName.toLowerCase()}[${attribute.name}="${attribute.value}"] ${tag}`;
          }
        }
        ancestor = ancestor.parentElement;
      }
      const parent = element.parentElement;
      if (parent === null) return tag;
      const index = Array.from(parent.children).indexOf(element) + 1;
      const parentClass = parent.className.toString().trim().split(/\s+/)[0] ?? '';
      const parentPart = parentClass === '' ? parent.tagName.toLowerCase() : `.${escape(parentClass)}`;
      return `${parentPart} > ${tag}:nth-child(${index})`;
    };

    const labelFor = (element: Element): string => {
      const id = element.id;
      if (id !== '') {
        const explicit = document.querySelector(`label[for="${escape(id)}"]`);
        if (explicit?.textContent) return explicit.textContent.trim().slice(0, 80);
      }
      const wrapping = element.closest('label');
      if (wrapping?.textContent) return wrapping.textContent.trim().slice(0, 80);
      const aria = element.getAttribute('aria-label');
      if (aria !== null && aria !== '') return aria.slice(0, 80);
      let node: Element | null = element;
      for (let depth = 0; depth < 3 && node !== null; depth += 1) {
        const previous = node.previousElementSibling;
        if (previous?.textContent) {
          const text = previous.textContent.trim();
          if (text !== '') return text.slice(0, 80);
        }
        node = node.parentElement;
      }
      return '';
    };

    const nodes = Array.from(
      document.querySelectorAll(
        'input, textarea, [contenteditable=""], [contenteditable="true"], [role="spinbutton"], [role="textbox"]',
      ),
    );

    const fields = nodes.map((element) => {
      const ancestors: Array<{ tag: string; id: string; className: string; data: Record<string, string> }> = [];
      let ancestor: Element | null = element.parentElement;
      for (let depth = 0; depth < 4 && ancestor !== null; depth += 1) {
        ancestors.push({
          tag: ancestor.tagName.toLowerCase(),
          id: ancestor.id,
          className: ancestor.className.toString().slice(0, 100),
          data: dataOf(ancestor),
        });
        ancestor = ancestor.parentElement;
      }
      return {
        tag: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        label: labelFor(element),
        value: ('value' in element ? String((element as HTMLInputElement).value) : (element.textContent ?? '')).slice(0, 40),
        attributes: attributesOf(element),
        ancestors,
      };
    });

    const iframeCount = document.querySelectorAll('iframe').length;
    let note: string | undefined;
    if (fields.length === 0) {
      note =
        iframeCount > 0
          ? `No editable fields in the main document, but it holds ${iframeCount} iframe(s) - the editor is probably inside one.`
          : 'No editable fields in this document at all. Either the editor has not finished loading, or this is not the editor page.';
    }

    return { url: location.href, title: document.title, fieldCount: fields.length, iframeCount, note, fields };
  });

  const inspection: Inspection = { ...raw, fields: raw.fields.slice(0, limit) };
  if (deep || htmlSelectors.length > 0) inspection.deep = await deepInspect(page, htmlSelectors);
  return inspection;
}

/** The wider sweep, run only for `--deep`. */
async function deepInspect(page: PageLike, htmlSelectors: string[] = []): Promise<DeepInspection> {
  if (typeof page.evaluate !== 'function') {
    throw new AgentError('DRIVER_NOT_READY', 'This page cannot be inspected.');
  }
  // The selectors are passed as an argument. Building the function from a
  // string would work in Playwright but is forbidden by a Chrome extension's
  // content security policy, and this code runs in both.
  return page.evaluate<DeepInspection, string[]>((requested) => {
    const attributesOf = (element: Element): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name === 'style' || attribute.name === 'class') continue;
        result[attribute.name] = attribute.value.slice(0, 120);
      }
      return result;
    };

    const ids = Array.from(document.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter((id) => id !== '');

    const customElements = Array.from(
      new Set(
        Array.from(document.querySelectorAll('*'))
          .map((element) => element.tagName.toLowerCase())
          .filter((tag) => tag.includes('-')),
      ),
    );

    // Anything whose own text is a bare number is a candidate value field,
    // whatever element it is built from.
    const numericLike: DeepInspection['numericLike'] = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.children.length > 0) continue;
      const text = (element.textContent ?? '').trim();
      if (text === '' || text.length > 24) continue;
      if (!/^-?[\d,]+(\.\d+)?$/.test(text)) continue;
      const tag = element.tagName.toLowerCase();
      const id = element.id;
      // A bare tag name is useless for writing a selector, so fall back to the
      // element's own classes and then to its nearest classed ancestor.
      const own = element.className.toString().trim().split(/\s+/).filter((name) => name !== '');
      let selector = id !== '' ? `#${id}` : own.length > 0 ? `${tag}.${own.join('.')}` : tag;
      let label = '';
      const chain: string[] = [];
      let ancestor: Element | null = element.parentElement;
      for (let depth = 0; depth < 4 && ancestor !== null; depth += 1) {
        const classes = ancestor.className.toString().trim().split(/\s+/).filter((name) => name !== '');
        chain.push(`${ancestor.tagName.toLowerCase()}${classes.length > 0 ? `.${classes.join('.')}` : ''}`);
        if (label === '') {
          const text = ancestor.getAttribute('title') ?? ancestor.getAttribute('aria-label') ?? '';
          if (text !== '') label = text.slice(0, 60);
        }
        if (selector === tag && classes.length > 0) selector = `${ancestor.tagName.toLowerCase()}.${classes[0]} ${tag}`;
        ancestor = ancestor.parentElement;
      }
      numericLike.push({ tag, selector, label, text, attributes: attributesOf(element), parents: chain.join(' < ') });
      if (numericLike.length >= 40) break;
    }

    // Raw HTML of a row that holds a camera attribute, which shows exactly how
    // the value field is built.
    const samples: DeepInspection['samples'] = [];
    for (const id of ['rotationZ', 'rotationX', 'rotationY', 'altitude', 'latitude', 'longitude', 'currentFrame']) {
      const anchor = document.getElementById(id);
      if (anchor === null) continue;
      const row = anchor.closest('li') ?? anchor.parentElement?.parentElement ?? anchor.parentElement;
      if (row === null || row === undefined) continue;
      samples.push({ around: `#${id}`, html: row.outerHTML.slice(0, 2000) });
      if (samples.length >= 2) break;
    }

    // Class names that look like an attribute or value widget, which is where
    // the numeric fields live when they are not plain inputs.
    const classHints = Array.from(
      new Set(
        Array.from(document.querySelectorAll('[class]'))
          .flatMap((element) => element.className.toString().split(/\s+/))
          .filter((name) => /attribut|value|field|input|numer|scrub|param|coord|camera|position|altitude|latitude/i.test(name)),
      ),
    ).sort();

    const requestedHtml = requested.map((selector) => {
      let matches: Element[] = [];
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        // An invalid selector reports zero matches rather than throwing.
      }
      return {
        selector,
        matched: matches.length,
        html: matches.slice(0, 3).map((element) => element.outerHTML.slice(0, 3000)),
      };
    });

    return {
      ids,
      customElements,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      classHints,
      numericLike,
      samples,
      requested: requestedHtml.length === 0 ? undefined : requestedHtml,
    };
  }, htmlSelectors);
}

export function renderInspection(inspection: Inspection): string {
  const lines: string[] = [
    `Page   ${inspection.url}`,
    `Title  ${inspection.title}`,
    `Found  ${inspection.fieldCount} editable field(s), ${inspection.iframeCount} iframe(s)`,
  ];
  if (inspection.note !== undefined) lines.push('', `Note   ${inspection.note}`);
  lines.push('');

  inspection.fields.forEach((field, index) => {
    lines.push(`[${index + 1}] ${field.tag}  ${field.label === '' ? '(no label)' : `"${field.label}"`}`);
    lines.push(`    selector : ${field.selector}`);
    lines.push(`    value    : ${JSON.stringify(field.value)}`);
    const attributes = Object.entries(field.attributes)
      .map(([name, value]) => `${name}="${value}"`)
      .join(' ');
    if (attributes !== '') lines.push(`    attrs    : ${attributes}`);
    const ancestors = field.ancestors
      .map((ancestor) => {
        const data = Object.entries(ancestor.data).map(([name, value]) => `${name}="${value}"`).join(' ');
        const id = ancestor.id === '' ? '' : `#${ancestor.id}`;
        return `${ancestor.tag}${id}${data === '' ? '' : ` ${data}`}`;
      })
      .join('  <  ');
    if (ancestors !== '') lines.push(`    parents  : ${ancestors}`);
    lines.push('');
  });

  const deep = inspection.deep;
  if (deep !== undefined) {
    lines.push('-'.repeat(72));
    lines.push(`Window ${deep.viewport.width} x ${deep.viewport.height}`);
    if (deep.viewport.width < 1100 || deep.viewport.height < 700) {
      lines.push('  ! Earth Studio hides panels in a small window. Maximise it and inspect again.');
    }
    lines.push('');
    lines.push(`Class names worth targeting (${deep.classHints.length})`);
    lines.push(`  ${deep.classHints.length === 0 ? '(none)' : deep.classHints.join(', ')}`);
    lines.push('');
    lines.push(`Element ids (${deep.ids.length})`);
    lines.push(`  ${deep.ids.join(', ')}`);
    lines.push('');
    lines.push(`Custom elements (${deep.customElements.length})`);
    lines.push(`  ${deep.customElements.length === 0 ? '(none)' : deep.customElements.join(', ')}`);
    lines.push('');
    lines.push(`Elements holding a number (${deep.numericLike.length})`);
    for (const entry of deep.numericLike) {
      const attributes = Object.entries(entry.attributes).map(([name, value]) => `${name}="${value}"`).join(' ');
      lines.push(`  ${JSON.stringify(entry.text).padEnd(12)} ${entry.selector}${entry.label === '' ? '' : `   (${entry.label})`}`);
      if (attributes !== '') lines.push(`               ${attributes}`);
      if (entry.parents !== '') lines.push(`               in: ${entry.parents}`);
    }
    lines.push('');
    for (const sample of deep.samples) {
      lines.push(`Raw HTML of the row around ${sample.around}`);
      lines.push(sample.html);
      lines.push('');
    }
    for (const request of deep.requested ?? []) {
      lines.push(`Raw HTML for --html ${request.selector}  (${request.matched} match(es))`);
      if (request.html.length === 0) lines.push('  (nothing matched)');
      for (const html of request.html) lines.push(html);
      lines.push('');
    }
  }

  return lines.join('\n');
}
