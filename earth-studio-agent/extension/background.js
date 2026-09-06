"use strict";
(() => {
  // src/extension/background.ts
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  });
})();
