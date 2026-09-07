"use strict";
(() => {
  // src/extension/cdp-input.ts
  var MODIFIER_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, command: 4, shift: 8 };
  var KEY_CODES = {
    Enter: { code: "Enter", vk: 13, text: "\r" },
    Tab: { code: "Tab", vk: 9, text: "	" },
    Escape: { code: "Escape", vk: 27 },
    Backspace: { code: "Backspace", vk: 8 },
    Delete: { code: "Delete", vk: 46 },
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    Home: { code: "Home", vk: 36 },
    End: { code: "End", vk: 35 },
    PageUp: { code: "PageUp", vk: 33 },
    PageDown: { code: "PageDown", vk: 34 },
    " ": { code: "Space", vk: 32, text: " " }
  };
  function clickCommands(x, y) {
    const at = { x: Math.round(x), y: Math.round(y) };
    return [
      { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", ...at, button: "none", buttons: 0, clickCount: 0 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 } }
    ];
  }
  function keyCommands(key) {
    const parts = key.split("+");
    const name = parts.pop() ?? key;
    let modifiers = 0;
    for (const part of parts) modifiers |= MODIFIER_BITS[part.toLowerCase()] ?? 0;
    const named = KEY_CODES[name];
    const printable = named === void 0 && Array.from(name).length === 1;
    const text = named?.text ?? (printable ? name : void 0);
    const code = named?.code ?? (printable ? `Key${name.toUpperCase()}` : name);
    const vk = named?.vk ?? (printable ? name.toUpperCase().charCodeAt(0) : 0);
    const withText = text !== void 0 && (modifiers & 2) === 0 && (modifiers & 1) === 0;
    const shared = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    return [
      {
        method: "Input.dispatchKeyEvent",
        params: withText ? { type: "keyDown", ...shared, text } : { type: "rawKeyDown", ...shared }
      },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...shared } }
    ];
  }
  function textCommands(text) {
    return [{ method: "Input.insertText", params: { text } }];
  }

  // src/extension/background.ts
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  });
  var attached = /* @__PURE__ */ new Set();
  var RELEASE_AFTER_MS = 6e4;
  var releaseTimer;
  chrome.debugger?.onDetach.addListener((source) => attached.delete(source.tabId));
  async function attach(tabId) {
    if (chrome.debugger === void 0) throw new Error("This Chrome has no debugger API.");
    if (attached.has(tabId)) return;
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already attached/i.test(message)) throw error;
    }
    attached.add(tabId);
  }
  async function release(tabId) {
    if (chrome.debugger === void 0 || !attached.has(tabId)) return;
    attached.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {
    });
  }
  function scheduleRelease(tabId) {
    if (releaseTimer !== void 0) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => void release(tabId), RELEASE_AFTER_MS);
  }
  async function run(tabId, commands) {
    await attach(tabId);
    for (const command of commands) {
      await chrome.debugger?.sendCommand({ tabId }, command.method, command.params);
    }
    scheduleRelease(tabId);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "input") return void 0;
    const tabId = sender.tab?.id;
    if (tabId === void 0) {
      sendResponse({ ok: false, error: "No tab to send input to." });
      return true;
    }
    const work = async () => {
      switch (message.action) {
        case "probe":
          await attach(tabId);
          scheduleRelease(tabId);
          return;
        case "click":
          return run(tabId, clickCommands(message.x ?? 0, message.y ?? 0));
        case "key":
          return run(tabId, keyCommands(message.key ?? ""));
        case "text":
          return run(tabId, textCommands(message.text ?? ""));
        case "release":
          return release(tabId);
        default:
          throw new Error(`Unknown input action "${message.action ?? ""}".`);
      }
    };
    work().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();
