/**
 * Content script: the bridge between the side panel and the page.
 *
 * It runs inside earth.google.com/studio, so it can drive the editor directly -
 * the agent needs no browser automation at all here. Its only job is to receive
 * a command from the panel, run it, and stream progress back.
 */
import { runCommandInPage, type ProgressReport, type RunOptions } from './run-in-page.ts';
import { extensionInput } from './trusted-input.ts';
import { isAgentError } from '../errors.ts';

interface RuntimeMessage {
  type: string;
  command?: string;
  options?: RunOptions;
}

interface ChromeRuntime {
  onMessage: {
    addListener(
      handler: (message: RuntimeMessage, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void,
    ): void;
  };
  sendMessage(message: unknown, callback?: (response: { ok?: boolean; error?: string } | undefined) => void): void;
  lastError?: { message: string };
}

declare const chrome: { runtime: ChromeRuntime };

/** Translation cannot cross the messaging boundary, so it is done here. */
function withTranslator(options: RunOptions): RunOptions {
  return options;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ ok: true, url: location.href, title: document.title });
    return true;
  }

  if (message.type !== 'run') return undefined;

  const options = withTranslator(message.options ?? {});
  runCommandInPage(message.command ?? '', {
    ...options,
    // Real browser input, sent by the service worker. Earth Studio's fields
    // ignore anything a script dispatches itself.
    input: extensionInput(chrome.runtime),
    onProgress: (progress: ProgressReport) => chrome.runtime.sendMessage({ type: 'progress', progress }),
  })
    .then((result) => {
      sendResponse({
        ok: true,
        applied: result.report?.applied ?? 0,
        total: result.report?.total ?? result.path.keyframes.length,
        frames: result.path.keyframes.map((keyframe) => keyframe.frame),
        durationSeconds: result.path.durationSeconds,
        english: result.translation.english,
        via: result.translation.via,
        detected: result.translation.detected,
        warnings: result.warnings,
        steps: result.path.steps.map((step) => ({
          action: step.action,
          place: step.place?.name ?? '',
          altitude: step.altitude,
          duration: step.duration,
        })),
        skipped: result.report?.results[0]?.skipped ?? [],
      });
    })
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: isAgentError(error) ? error.format() : error instanceof Error ? error.message : String(error),
      });
    });

  // Keeps the message channel open for the asynchronous reply.
  return true;
});
