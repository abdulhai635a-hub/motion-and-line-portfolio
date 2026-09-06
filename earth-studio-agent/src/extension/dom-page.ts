/**
 * A PageLike that works on the document it is running in.
 *
 * The driver, the attribute writer and the playhead were all written against
 * PageLike so they could be tested through Playwright. Inside a Chrome content
 * script there is no Playwright and no remote debugging - the code is already
 * in the page - so this implements the same surface with plain DOM calls, and
 * every line of tested driving logic runs unchanged.
 *
 * The differences that matter:
 *
 *   - Playwright waits for an element to be actionable; here waiting is
 *     explicit, polling until the selector appears or the timeout runs out.
 *   - Playwright's click is a real mouse press. A content script cannot make
 *     one, so this dispatches a full pointer/mouse sequence and then calls
 *     element.click(). Driving the live editor over CDP already showed that
 *     element.click() reaches Earth Studio's handlers, including for the
 *     keyframe button that renders to nothing.
 */
import type { PageLike } from '../driver/page.ts';

export interface DomPageOptions {
  /** Document to work on. Defaults to the ambient one. */
  document?: Document;
  /** Default timeout for waits, in milliseconds. */
  timeoutMs?: number;
}

export class DomPage implements PageLike {
  private readonly doc: Document;
  private readonly defaultTimeout: number;

  constructor(options: DomPageOptions = {}) {
    this.doc = options.document ?? globalThis.document;
    this.defaultTimeout = options.timeoutMs ?? 10_000;
  }

  /** There is nothing to navigate: the script is already on the page. */
  async goto(): Promise<null> {
    return null;
  }

  async $(selector: string): Promise<Element | null> {
    return this.doc.querySelector(selector);
  }

  async waitForSelector(selector: string, options: { timeout?: number } = {}): Promise<Element> {
    const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
    if (element === null) throw new Error(`Timed out waiting for ${selector}`);
    return element;
  }

  async click(selector: string, options: { timeout?: number } = {}): Promise<void> {
    const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
    if (element === null) throw new Error(`Timed out waiting for ${selector}`);
    dispatchClick(element);
  }

  async hover(selector: string, options: { timeout?: number } = {}): Promise<void> {
    const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
    if (element === null) throw new Error(`Timed out waiting for ${selector}`);
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
      element.dispatchEvent(pointerEvent(type, element));
    }
  }

  async fill(selector: string, value: string, options: { timeout?: number } = {}): Promise<void> {
    const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
    if (element === null) throw new Error(`Timed out waiting for ${selector}`);

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      setNativeValue(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // A contenteditable, which is what Earth Studio opens over a value.
    const editable = element as HTMLElement;
    editable.focus();
    selectAll(editable);
    editable.textContent = value;
    placeCaretAtEnd(editable);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }

  async inputValue(selector: string, options: { timeout?: number } = {}): Promise<string> {
    const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
    if (element === null) throw new Error(`Timed out waiting for ${selector}`);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return element.textContent ?? '';
  }

  async press(selector: string, key: string, options: { timeout?: number } = {}): Promise<void> {
    const element = await this.wait(selector, options.timeout ?? this.defaultTimeout);
    if (element === null) throw new Error(`Timed out waiting for ${selector}`);
    (element as HTMLElement).focus?.();
    sendKey(element, key);
  }

  /**
   * Runs a function in this page. The driver builds these with `new Function`,
   * which a content script may execute in its own world; the DOM it touches is
   * the shared one, which is all the driver needs.
   */
  async evaluate<R>(pageFunction: () => R): Promise<R> {
    return pageFunction();
  }

  readonly keyboard = {
    press: async (key: string): Promise<void> => {
      sendKey(this.doc.activeElement ?? this.doc.body, key);
    },
    type: async (text: string): Promise<void> => {
      const target = this.doc.activeElement;
      if (target === null) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        setNativeValue(target, text);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const editable = target as HTMLElement;
      if (editable.isContentEditable) {
        editable.textContent = text;
        placeCaretAtEnd(editable);
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    },
  };

  private async wait(selector: string, timeoutMs: number): Promise<Element | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const element = this.doc.querySelector(selector);
      if (element !== null) return element;
      if (Date.now() >= deadline) return null;
      await new Promise((done) => setTimeout(done, 50));
    }
  }
}

/** A pointer/mouse sequence followed by the element's own click(). */
function dispatchClick(element: Element): void {
  for (const type of ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    element.dispatchEvent(pointerEvent(type, element));
  }
  (element as HTMLElement).click?.();
}

function pointerEvent(type: string, element: Element): Event {
  const rect = element.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  };
  return type.startsWith('pointer') && typeof PointerEvent === 'function'
    ? new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true })
    : new MouseEvent(type, init);
}

/** Key strokes as a keydown/keypress/keyup trio, with modifiers parsed. */
function sendKey(target: EventTarget, key: string): void {
  const parts = key.split('+');
  const name = parts.pop() ?? key;
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  const init: KeyboardEventInit = {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: modifiers.has('control') || modifiers.has('ctrl'),
    shiftKey: modifiers.has('shift'),
    altKey: modifiers.has('alt'),
    metaKey: modifiers.has('meta'),
  };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/**
 * React and similar frameworks patch the value setter to track changes, so a
 * plain assignment can be ignored. Going through the prototype setter makes the
 * change visible to them.
 */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) descriptor.set.call(element, value);
  else element.value = value;
}

function selectAll(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (selection === null) return;
  selection.removeAllRanges();
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.addRange(range);
}

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (selection === null) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
