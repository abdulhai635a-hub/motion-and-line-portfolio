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

  // src/errors.ts
  var AgentError = class extends Error {
    code;
    /** 1-based step index, when the failure belongs to a specific step. */
    stepIndex;
    /** Extra context shown under the message in CLI output. */
    detail;
    /** What the user can do about it. */
    hint;
    constructor(code, message, options = {}) {
      super(message, { cause: options.cause });
      this.name = "AgentError";
      this.code = code;
      this.stepIndex = options.stepIndex;
      this.detail = options.detail;
      this.hint = options.hint;
    }
    /** Multi-line rendering used by the CLI and the run log. */
    format() {
      const where = this.stepIndex === void 0 ? "" : ` (step ${this.stepIndex})`;
      const lines = [`[${this.code}]${where} ${this.message}`];
      if (this.detail) lines.push(`  detail: ${this.detail}`);
      if (this.hint) lines.push(`  hint:   ${this.hint}`);
      return lines.join("\n");
    }
  };

  // src/geocode/elevation.ts
  function createElevationProvider(options = {}) {
    const {
      endpoint = "https://api.open-meteo.com/v1/elevation",
      timeoutMs = 1e4,
      fetchImpl = globalThis.fetch,
      batchSize = 100
    } = options;
    return async (points) => {
      if (points.length === 0) return [];
      if (typeof fetchImpl !== "function") {
        throw new AgentError("GEOCODER_UNAVAILABLE", "No fetch implementation is available for the elevation lookup.");
      }
      const heights = [];
      for (let start = 0; start < points.length; start += batchSize) {
        const batch = points.slice(start, start + batchSize);
        const latitudes = batch.map((point) => point.latitude.toFixed(6)).join(",");
        const longitudes = batch.map((point) => point.longitude.toFixed(6)).join(",");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${endpoint}?latitude=${latitudes}&longitude=${longitudes}`, {
            signal: controller.signal,
            headers: { accept: "application/json" }
          });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          const body = await response.json();
          const values = Array.isArray(body.elevation) ? body.elevation : [];
          for (let i = 0; i < batch.length; i += 1) {
            const value = values[i];
            heights.push(typeof value === "number" && Number.isFinite(value) ? value : null);
          }
        } catch (cause) {
          for (let i = 0; i < batch.length; i += 1) heights.push(null);
        } finally {
          clearTimeout(timer);
        }
      }
      return heights;
    };
  }
  function cachedElevation(provider, cache = /* @__PURE__ */ new Map()) {
    return async (points) => {
      const keys = points.map((point) => `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`);
      const wanted = /* @__PURE__ */ new Map();
      for (const [index, key] of keys.entries()) {
        const point = points[index];
        if (point !== void 0 && !cache.has(key)) wanted.set(key, point);
      }
      if (wanted.size > 0) {
        const asked = [...wanted.keys()];
        const found = await provider([...wanted.values()]);
        asked.forEach((key, index) => cache.set(key, found[index] ?? null));
      }
      return keys.map((key) => cache.get(key) ?? null);
    };
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
  var elevation = cachedElevation(createElevationProvider());
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "elevation") {
      elevation(message.points ?? []).then((heights) => sendResponse({ ok: true, heights })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
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
