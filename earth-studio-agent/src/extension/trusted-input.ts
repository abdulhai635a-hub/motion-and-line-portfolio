/**
 * Real input, asked for from the page side.
 *
 * The content script cannot attach a debugger; the service worker can. This is
 * the thin end of that conversation - and the interface DomPage drives, so a
 * test can hand it a fake and check what was asked for.
 */
export interface TrustedInput {
  /** Whether real input can be used at all. Attaches on the first yes. */
  available(): Promise<boolean>;
  /** A left click at a point in the page's coordinates. */
  click(x: number, y: number): Promise<void>;
  /** One keystroke, written as the driver writes them: "Shift+ArrowRight". */
  key(key: string): Promise<void>;
  /** Inserts text at the caret, replacing any selection. */
  type(text: string): Promise<void>;
  /** Lets go, so Chrome's debugging banner does not outlive the run. */
  release(): Promise<void>;
}

interface Messenger {
  sendMessage(
    message: unknown,
    callback: (response: { ok?: boolean; error?: string; heights?: Array<number | null> } | undefined) => void,
  ): void;
  lastError?: { message: string };
}

/**
 * Talks to this extension's service worker. `available` is answered once and
 * remembered: asking Chrome to attach a debugger is not free, and a refusal
 * will not change its mind mid-run.
 */
export function extensionInput(runtime: Messenger): TrustedInput {
  let usable: boolean | undefined;

  const ask = (message: Record<string, unknown>): Promise<void> =>
    new Promise((resolve, reject) => {
      runtime.sendMessage({ type: 'input', ...message }, (response) => {
        const failed = runtime.lastError;
        if (failed !== undefined) return reject(new Error(failed.message));
        if (response?.ok !== true) return reject(new Error(response?.error ?? 'The extension gave no answer.'));
        resolve();
      });
    });

  return {
    async available(): Promise<boolean> {
      if (usable !== undefined) return usable;
      try {
        await ask({ action: 'probe' });
        usable = true;
      } catch {
        usable = false;
      }
      return usable;
    },
    click: (x: number, y: number) => ask({ action: 'click', x, y }),
    key: (key: string) => ask({ action: 'key', key }),
    type: (text: string) => ask({ action: 'text', text }),
    release: () => ask({ action: 'release' }).catch(() => undefined),
  };
}

/**
 * How high the ground is, asked of the service worker.
 *
 * The lookup could be made from the page, but a content script's fetch is a
 * cross-origin request from earth.google.com and lives or dies by what the
 * other end allows. The worker has the host permission and no such question.
 */
export function extensionElevation(runtime: Messenger) {
  return async (points: Array<{ latitude: number; longitude: number }>): Promise<Array<number | null>> =>
    new Promise((resolve) => {
      runtime.sendMessage({ type: 'elevation', points }, (response) => {
        // Not knowing the ground is a warning the plan already carries, never a
        // reason to refuse to write it.
        if (runtime.lastError !== undefined || response?.ok !== true) return resolve(points.map(() => null));
        resolve(response.heights ?? points.map(() => null));
      });
    });
}
