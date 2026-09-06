/**
 * The slice of Playwright's Page that the driver actually uses.
 *
 * Depending on this interface rather than on Playwright directly keeps the
 * driver testable: the test suite drives a real Chromium page against a mock
 * Earth Studio document, and Playwright's Page satisfies this shape as-is.
 */
export interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  /**
   * Present on a real Playwright page; used by the driver, `inspect` and
   * `probe`. The argument matters: Playwright serialises the function, so it
   * cannot close over anything, and building one from a string instead is
   * forbidden by a Chrome extension's content security policy.
   */
  evaluate?<R, A = undefined>(pageFunction: (arg: A) => R, arg?: A): Promise<R>;
  click?(selector: string, options?: { timeout?: number; clickCount?: number; force?: boolean }): Promise<void>;
  hover?(selector: string, options?: { timeout?: number }): Promise<void>;
  keyboard?: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  url?(): string;
  title?(): Promise<string>;
  waitForSelector(selector: string, options?: { timeout?: number; state?: string }): Promise<unknown>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  inputValue(selector: string, options?: { timeout?: number }): Promise<string>;
  press(selector: string, key: string, options?: { timeout?: number }): Promise<void>;
  $(selector: string): Promise<unknown>;
}

export interface BrowserSession {
  page: PageLike;
  /** Every tab the session can see, so a wrong-tab attach is obvious. */
  listTabs?(): Promise<Array<{ url: string; title: string; attached: boolean }>>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  headless?: boolean;
  /** Persistent profile directory, so the Google sign-in survives between runs. */
  userDataDir?: string;
  /** Overrides the bundled Chromium, e.g. a system install. */
  executablePath?: string;
  /** Playwright browser channel, e.g. "chrome" for the installed Google Chrome. */
  channel?: string;
  /**
   * Attach to a Chrome the user started themselves, instead of launching one:
   * "http://localhost:9222". Google refuses sign-in in an automation-launched
   * browser, so this is the reliable route - sign in normally in your own
   * Chrome, then let the agent drive that window.
   */
  cdpEndpoint?: string;
  slowMoMs?: number;
}

/**
 * Playwright announces itself through --enable-automation and a
 * navigator.webdriver flag. Dropping them does not defeat Google's sign-in
 * check, but it keeps the launched browser behaving like an ordinary one for
 * everything after sign-in.
 */
const QUIET_AUTOMATION = {
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
};

/**
 * Launches Chromium through Playwright, which is an optional dependency: the
 * parse/geocode/timeline half of the agent runs without it.
 */
export async function launchChromium(options: LaunchOptions = {}): Promise<BrowserSession> {
  const { headless = false, userDataDir, executablePath, channel, cdpEndpoint, slowMoMs } = options;
  let playwright: typeof import('playwright');
  try {
    playwright = await import('playwright');
  } catch (cause) {
    const { AgentError } = await import('../errors.ts');
    throw new AgentError('DRIVER_NOT_INSTALLED', 'Playwright is not installed, so the browser driver cannot start.', {
      detail: cause instanceof Error ? cause.message : String(cause),
      hint: 'Run "npm install playwright && npx playwright install chromium" inside earth-studio-agent/.',
      cause,
    });
  }

  const launchArgs = { headless, executablePath, channel, slowMo: slowMoMs, ...QUIET_AUTOMATION };
  const { AgentError } = await import('../errors.ts');

  try {
    if (cdpEndpoint !== undefined) {
      const browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const pages = context.pages();
      // Prefer the tab already showing Earth Studio, so an open project is used
      // rather than a blank tab somewhere else in the window.
      const page =
        pages.find((candidate) => candidate.url().includes('earth.google.com')) ??
        pages[0] ??
        (await context.newPage());
      await page.bringToFront();
      const listTabs = async () =>
        Promise.all(
          browser
            .contexts()
            .flatMap((each) => each.pages())
            .map(async (candidate) => ({
              url: candidate.url(),
              title: await candidate.title().catch(() => ''),
              attached: candidate === page,
            })),
        );
      // close() on a CDP connection disconnects; it does not shut the user's browser.
      return { page: page as unknown as PageLike, listTabs, close: () => browser.close() };
    }

    if (userDataDir !== undefined) {
      const context = await playwright.chromium.launchPersistentContext(userDataDir, launchArgs);
      const page = context.pages()[0] ?? (await context.newPage());
      return { page: page as unknown as PageLike, close: () => context.close() };
    }
    const browser = await playwright.chromium.launch(launchArgs);
    const page = await browser.newPage();
    return { page: page as unknown as PageLike, close: () => browser.close() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // Each of these needs a different fix, so say which one it is.
    const hint = cdpEndpoint !== undefined
      ? `Nothing is listening at ${cdpEndpoint}. Start Chrome with --remote-debugging-port first (see the README).`
      : /XServer|DISPLAY|headed browser/i.test(message)
        ? 'This machine has no display. Add --headless, or run under "xvfb-run".'
        : 'Run "npx playwright install chromium", or point --executable-path at a Chromium binary.';
    throw new AgentError('DRIVER_LAUNCH_FAILED', cdpEndpoint === undefined ? 'Chromium could not be started.' : 'Could not attach to the running Chrome.', {
      detail: message.split('\n')[0],
      hint,
      cause,
    });
  }
}
