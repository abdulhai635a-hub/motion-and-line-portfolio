/**
 * Opens the side panel, and sends the input events a script cannot make.
 *
 * Earth Studio's value fields ignore events dispatched from JavaScript, so the
 * content script asks for real ones here: chrome.debugger delivers input
 * through the browser itself, which is what made the same driver work over the
 * debugging protocol from a terminal. Chrome shows its "started debugging"
 * banner while this is attached, and the attachment is released as soon as the
 * run is over.
 */
import { clickCommands, keyCommands, textCommands, type CdpCommand } from './cdp-input.ts';
import { cachedElevation, createElevationProvider, type Point } from '../geocode/elevation.ts';

interface DebuggerTarget { tabId: number }
declare const chrome: {
  sidePanel: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  runtime: {
    onInstalled: { addListener(handler: () => void): void };
    lastError?: { message: string };
    onMessage: {
      addListener(
        handler: (
          message: {
            type?: string;
            action?: string;
            x?: number;
            y?: number;
            key?: string;
            text?: string;
            points?: Point[];
          },
          sender: { tab?: { id?: number } },
          sendResponse: (response: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  debugger?: {
    attach(target: DebuggerTarget, version: string): Promise<void>;
    detach(target: DebuggerTarget): Promise<void>;
    sendCommand(target: DebuggerTarget, method: string, params?: Record<string, unknown>): Promise<unknown>;
    onDetach: { addListener(handler: (source: DebuggerTarget) => void): void };
  };
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Older Chrome versions open the panel from the manifest entry instead.
});

/** Tabs this worker believes it is attached to. */
const attached = new Set<number>();
/** Released after a lull, so the debugging banner does not outlive the run. */
const RELEASE_AFTER_MS = 60_000;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

chrome.debugger?.onDetach.addListener((source) => attached.delete(source.tabId));

async function attach(tabId: number): Promise<void> {
  if (chrome.debugger === undefined) throw new Error('This Chrome has no debugger API.');
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (error) {
    // A service worker can be restarted while the attachment survives, and
    // DevTools may hold the tab; only the second is a real refusal.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) throw error;
  }
  attached.add(tabId);
}

async function release(tabId: number): Promise<void> {
  if (chrome.debugger === undefined || !attached.has(tabId)) return;
  attached.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {
    // The tab may already be gone; there is nothing left to release.
  });
}

function scheduleRelease(tabId: number): void {
  if (releaseTimer !== undefined) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => void release(tabId), RELEASE_AFTER_MS);
}

async function run(tabId: number, commands: CdpCommand[]): Promise<void> {
  await attach(tabId);
  for (const command of commands) {
    await chrome.debugger?.sendCommand({ tabId }, command.method, command.params);
  }
  scheduleRelease(tabId);
}

/**
 * How high the ground is. Asked for here rather than from the page: the worker
 * has the host permission, so there is no cross-origin question to lose on.
 */
const elevation = cachedElevation(createElevationProvider());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'elevation') {
    elevation(message.points ?? [])
      .then((heights) => sendResponse({ ok: true, heights }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type !== 'input') return undefined;
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    sendResponse({ ok: false, error: 'No tab to send input to.' });
    return true;
  }

  const work = async (): Promise<void> => {
    switch (message.action) {
      case 'probe':
        await attach(tabId);
        scheduleRelease(tabId);
        return;
      case 'click':
        return run(tabId, clickCommands(message.x ?? 0, message.y ?? 0));
      case 'key':
        return run(tabId, keyCommands(message.key ?? ''));
      case 'text':
        return run(tabId, textCommands(message.text ?? ''));
      case 'release':
        return release(tabId);
      default:
        throw new Error(`Unknown input action "${message.action ?? ''}".`);
    }
  };

  work()
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
