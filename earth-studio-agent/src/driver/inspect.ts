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
}

export async function inspectPage(page: PageLike, limit = 60): Promise<Inspection> {
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

  return { ...raw, fields: raw.fields.slice(0, limit) };
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

  return lines.join('\n');
}
