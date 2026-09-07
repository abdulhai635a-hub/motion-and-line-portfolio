"use strict";
(() => {
  // src/extension/panel.ts
  var $ = (id) => document.getElementById(id);
  var command = $("command");
  var status = $("status");
  var detailsBox = $("details");
  var bar = $("bar");
  var barFill = $("barFill");
  var runButton = $("run");
  var planButton = $("plan");
  function numberOf(id, fallback) {
    const value = Number.parseFloat($(id).value);
    return Number.isFinite(value) ? value : fallback;
  }
  function overrideOf(id) {
    const raw = $(id).value.trim();
    if (raw === "") return void 0;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : void 0;
  }
  function say(text, kind = "") {
    status.textContent = text;
    status.className = kind;
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "progress") return;
    say(message.progress.message);
    if (message.progress.fraction === void 0) return;
    bar.hidden = false;
    barFill.style.width = `${Math.round(message.progress.fraction * 100)}%`;
  });
  async function activeStudioTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === void 0) throw new Error("No active tab.");
    if (!(tab.url ?? "").startsWith("https://earth.google.com/studio")) {
      throw new Error("Open your Earth Studio project in this tab first.");
    }
    return tab.id;
  }
  function renderResult(response, dryRun) {
    const rows = (response.steps ?? []).map(
      (step, index) => `<tr><td class="num">${index + 1}</td><td>${escapeHtml(step.action)}</td><td>${escapeHtml(step.place)}</td><td class="num">${Math.round(step.altitude).toLocaleString()} m</td><td class="num">${step.duration}s</td></tr>`
    ).join("");
    const parts = [];
    if (response.via !== void 0 && response.via !== "already-english") {
      parts.push(
        `<p class="hint">Read as English${response.detected ? ` from ${escapeHtml(response.detected)}` : ""}: <code>${escapeHtml(response.english ?? "")}</code></p>`
      );
    }
    if (rows !== "") {
      parts.push(
        `<table><thead><tr><th></th><th>action</th><th>place</th><th>altitude</th><th>time</th></tr></thead><tbody>${rows}</tbody></table>`
      );
    }
    if ((response.frames ?? []).length > 0) {
      parts.push(`<p class="hint">Frames: ${response.frames?.join(", ")} &middot; ${response.durationSeconds}s total</p>`);
    }
    if ((response.skipped ?? []).length > 0) {
      parts.push(
        `<p class="hint">Not on this project's timeline, so skipped: ${(response.skipped ?? []).join(", ")}.</p>`
      );
    }
    for (const warning of response.warnings ?? []) {
      parts.push(`<p class="warn">${escapeHtml(warning.message)}</p>`);
    }
    detailsBox.innerHTML = parts.join("");
    say(
      dryRun ? `Planned ${response.total} keyframes. Nothing was written.` : `Wrote ${response.applied} of ${response.total} keyframes. Review them in Earth Studio, then render there.`,
      response.applied === response.total ? "ok" : ""
    );
  }
  async function send(dryRun) {
    runButton.disabled = true;
    planButton.disabled = true;
    detailsBox.innerHTML = "";
    bar.hidden = true;
    barFill.style.width = "0";
    say("Starting");
    try {
      const tabId = await activeStudioTab();
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "run",
        command: command.value,
        options: {
          dryRun,
          online: $("online").checked,
          config: {
            frameRate: numberOf("fps", 30),
            defaultTransitionSeconds: overrideOf("transition"),
            defaultHoldSeconds: overrideOf("hold"),
            defaultTilt: overrideOf("tilt"),
            defaultFieldOfView: overrideOf("fov")
          }
        }
      });
      if (!response.ok) {
        say(response.error ?? "Something went wrong.", "error");
        return;
      }
      renderResult(response, dryRun);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      say(
        message.includes("Receiving end does not exist") ? "The page has not loaded the extension yet. Reload the Earth Studio tab and try again." : message,
        "error"
      );
    } finally {
      runButton.disabled = false;
      planButton.disabled = false;
    }
  }
  runButton.addEventListener("click", () => void send(false));
  planButton.addEventListener("click", () => void send(true));
  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[character] ?? character;
    });
  }
})();
