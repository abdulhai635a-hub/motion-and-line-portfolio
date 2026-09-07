/**
 * The input events Chrome itself will deliver, described as data.
 *
 * Earth Studio's value fields ignore events made in JavaScript. Every gesture
 * the extension could synthesise - pointer, mouse, the element's own click(),
 * a double click - left the field shut, while the same driver over the
 * debugging protocol opened it first time. The difference is that those events
 * come from the browser rather than from a script.
 *
 * A Chrome extension can send the same kind through chrome.debugger, and this
 * module is the part of that worth testing: turning a click or a keystroke into
 * the exact Input.* commands, with no Chrome API in sight.
 */

export interface CdpCommand {
  method: string;
  params: Record<string, unknown>;
}

/** Modifier bits the protocol expects. */
const MODIFIER_BITS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, command: 4, shift: 8 };

/** Keys that are not a character, with the virtual key code Windows gives them. */
const KEY_CODES: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9, text: '\t' },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
};

/** One left-button click at a point in the page's own coordinates. */
export function clickCommands(x: number, y: number): CdpCommand[] {
  const at = { x: Math.round(x), y: Math.round(y) };
  return [
    { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', ...at, button: 'none', buttons: 0, clickCount: 0 } },
    { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 } },
    { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 } },
  ];
}

/** A keystroke, written the way the rest of the driver writes one: "Shift+ArrowRight". */
export function keyCommands(key: string): CdpCommand[] {
  const parts = key.split('+');
  const name = parts.pop() ?? key;
  let modifiers = 0;
  for (const part of parts) modifiers |= MODIFIER_BITS[part.toLowerCase()] ?? 0;

  const named = KEY_CODES[name];
  const printable = named === undefined && Array.from(name).length === 1;
  const text = named?.text ?? (printable ? name : undefined);
  const code = named?.code ?? (printable ? `Key${name.toUpperCase()}` : name);
  const vk = named?.vk ?? (printable ? name.toUpperCase().charCodeAt(0) : 0);

  // A key that produces a character is sent as keyDown with its text; one that
  // does not is a rawKeyDown, which is what the protocol expects for arrows and
  // the like. Holding Ctrl suppresses the character either way.
  const withText = text !== undefined && (modifiers & 2) === 0 && (modifiers & 1) === 0;
  const shared = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  return [
    {
      method: 'Input.dispatchKeyEvent',
      params: withText ? { type: 'keyDown', ...shared, text } : { type: 'rawKeyDown', ...shared },
    },
    { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...shared } },
  ];
}

/** Typing a whole string, the way a paste or an IME commits one. */
export function textCommands(text: string): CdpCommand[] {
  return [{ method: 'Input.insertText', params: { text } }];
}
