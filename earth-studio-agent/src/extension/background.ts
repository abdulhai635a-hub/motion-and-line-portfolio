/**
 * Opens the side panel when the toolbar button is clicked.
 *
 * Everything else happens in the panel and the content script; this exists only
 * because a side panel cannot open itself.
 */
declare const chrome: {
  sidePanel: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  runtime: { onInstalled: { addListener(handler: () => void): void } };
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Older Chrome versions open the panel from the manifest entry instead.
});
