/**
 * Side panel: takes the command, hands it to the content script, shows what
 * happened.
 *
 * All the work happens in the page; this only collects settings, streams
 * progress, and renders the result - including the reason for any failure,
 * which the agent already words for a person rather than a log.
 */
interface ProgressMessage {
  type: 'progress';
  progress: { stage: string; message: string; fraction?: number };
}

interface RunResponse {
  ok: boolean;
  error?: string;
  applied?: number;
  total?: number;
  frames?: number[];
  durationSeconds?: number;
  english?: string;
  via?: string;
  detected?: string;
  warnings?: Array<{ code: string; message: string; stepIndex?: number }>;
  steps?: Array<{ action: string; place: string; altitude: number; duration: number }>;
  skipped?: string[];
}

interface ChromeTab { id?: number; url?: string }
declare const chrome: {
  tabs: {
    query(options: { active: boolean; currentWindow: boolean }): Promise<ChromeTab[]>;
    sendMessage(tabId: number, message: unknown): Promise<RunResponse>;
  };
  runtime: { onMessage: { addListener(handler: (message: ProgressMessage) => void): void } };
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const command = $<HTMLTextAreaElement>('command');
const status = $<HTMLDivElement>('status');
const detailsBox = $<HTMLDivElement>('details');
const bar = $<HTMLDivElement>('bar');
const barFill = $<HTMLSpanElement>('barFill');
const runButton = $<HTMLButtonElement>('run');
const planButton = $<HTMLButtonElement>('plan');

function numberOf(id: string, fallback: number): number {
  const value = Number.parseFloat($<HTMLInputElement>(id).value);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * A setting the user left blank. Blank is the normal state: the agent works the
 * move length, the tilt and the lens out from the command itself, and naming
 * one of them here is what turns that off. So an empty box must reach the agent
 * as "not set", never as a number this panel invented.
 */
function overrideOf(id: string): number | undefined {
  const raw = $<HTMLInputElement>(id).value.trim();
  if (raw === '') return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function say(text: string, kind: '' | 'ok' | 'error' = ''): void {
  status.textContent = text;
  status.className = kind;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'progress') return;
  say(message.progress.message);
  if (message.progress.fraction === undefined) return;
  bar.hidden = false;
  barFill.style.width = `${Math.round(message.progress.fraction * 100)}%`;
});

async function activeStudioTab(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab.');
  if (!(tab.url ?? '').startsWith('https://earth.google.com/studio')) {
    throw new Error('Open your Earth Studio project in this tab first.');
  }
  return tab.id;
}

function renderResult(response: RunResponse, dryRun: boolean): void {
  const rows = (response.steps ?? [])
    .map(
      (step, index) =>
        `<tr><td class="num">${index + 1}</td><td>${escapeHtml(step.action)}</td>` +
        `<td>${escapeHtml(step.place)}</td>` +
        `<td class="num">${Math.round(step.altitude).toLocaleString()} m</td>` +
        `<td class="num">${step.duration}s</td></tr>`,
    )
    .join('');

  const parts: string[] = [];
  if (response.via !== undefined && response.via !== 'already-english') {
    parts.push(
      `<p class="hint">Read as English${response.detected ? ` from ${escapeHtml(response.detected)}` : ''}: ` +
        `<code>${escapeHtml(response.english ?? '')}</code></p>`,
    );
  }
  if (rows !== '') {
    parts.push(
      `<table><thead><tr><th></th><th>action</th><th>place</th><th>altitude</th><th>time</th></tr></thead>` +
        `<tbody>${rows}</tbody></table>`,
    );
  }
  if ((response.frames ?? []).length > 0) {
    parts.push(`<p class="hint">Frames: ${response.frames?.join(', ')} &middot; ${response.durationSeconds}s total</p>`);
  }
  if ((response.skipped ?? []).length > 0) {
    parts.push(
      `<p class="hint">Not on this project's timeline, so skipped: ${(response.skipped ?? []).join(', ')}.</p>`,
    );
  }
  for (const warning of response.warnings ?? []) {
    parts.push(`<p class="warn">${escapeHtml(warning.message)}</p>`);
  }
  detailsBox.innerHTML = parts.join('');

  say(
    dryRun
      ? `Planned ${response.total} keyframes. Nothing was written.`
      : `Wrote ${response.applied} of ${response.total} keyframes. Review them in Earth Studio, then render there.`,
    response.applied === response.total ? 'ok' : '',
  );
}

async function send(dryRun: boolean): Promise<void> {
  runButton.disabled = true;
  planButton.disabled = true;
  detailsBox.innerHTML = '';
  bar.hidden = true;
  barFill.style.width = '0';
  say('Starting');

  try {
    const tabId = await activeStudioTab();
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'run',
      command: command.value,
      options: {
        dryRun,
        online: $<HTMLInputElement>('online').checked,
        config: {
          frameRate: numberOf('fps', 30),
          defaultTransitionSeconds: overrideOf('transition'),
          defaultHoldSeconds: overrideOf('hold'),
          defaultTilt: overrideOf('tilt'),
          defaultFieldOfView: overrideOf('fov'),
        },
      },
    });

    if (!response.ok) {
      say(response.error ?? 'Something went wrong.', 'error');
      return;
    }
    renderResult(response, dryRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(
      message.includes('Receiving end does not exist')
        ? 'The page has not loaded the extension yet. Reload the Earth Studio tab and try again.'
        : message,
      'error',
    );
  } finally {
    runButton.disabled = false;
    planButton.disabled = false;
  }
}

runButton.addEventListener('click', () => void send(false));
planButton.addEventListener('click', () => void send(true));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[character] ?? character;
  });
}
