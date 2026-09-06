/**
 * Accepting a command in any language.
 *
 * The parser is English-only, and teaching it every language would mean a
 * keyword table per language that is always missing something. Translating
 * first is both simpler and more complete, and it does the right thing with
 * place names: Bengali "মাউন্ট ফুজি" comes back as "Mount Fuji", which is
 * exactly what the geocoder wants.
 *
 * Chrome ships a built-in translator (Chrome 138+) that runs on the device, so
 * the usual case needs no key, no network and no account. Where it is missing,
 * a translate function can be supplied instead - the extension offers an LLM
 * for that - and English input never touches either path.
 */
import { AgentError } from '../errors.ts';

export interface TranslateOptions {
  /** Overrides the built-in translator, e.g. with an LLM call. */
  translate?: (text: string, sourceLanguage: string) => Promise<string>;
  /** Overrides language detection, mainly for tests. */
  detectLanguage?: (text: string) => Promise<string>;
  /** Skip translation entirely and take the text as written. */
  assumeEnglish?: boolean;
}

export interface TranslationResult {
  /** The command the parser will read. */
  english: string;
  /** The language the input was taken to be, when that was decided. */
  detected?: string;
  translated: boolean;
  /** How the English was arrived at, for the run log. */
  via: 'already-english' | 'chrome-translator' | 'supplied' | 'assumed';
}

/** English words that make a command recognisable without detecting anything. */
const ENGLISH_MARKERS =
  /\b(fly|go|move|travel|zoom|pan|hold|wait|start|begin|from|to|into|over|at|then|and|second|seconds|sec|minute|minutes|close|level|space|city|country|street|region|state)\b/i;

/** True when the text is Latin script and uses words the parser knows. */
export function looksEnglish(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters === '') return false;
  const latin = letters.replace(/[^\p{Script=Latin}]/gu, '');
  // A command with a non-Latin place name in otherwise English text is still
  // English to the parser; the geocoder can look the name up online.
  if (latin.length / letters.length < 0.5) return false;
  return ENGLISH_MARKERS.test(text);
}

interface ChromeTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
}

interface DetectorApi {
  availability(): Promise<string>;
  create(): Promise<{ detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>> }>;
}

function translatorApi(): TranslatorApi | undefined {
  return (globalThis as { Translator?: TranslatorApi }).Translator;
}

function detectorApi(): DetectorApi | undefined {
  return (globalThis as { LanguageDetector?: DetectorApi }).LanguageDetector;
}

/** True when this browser can translate on its own. */
export async function builtInTranslationAvailable(sourceLanguage: string): Promise<boolean> {
  const api = translatorApi();
  if (api === undefined) return false;
  try {
    const state = await api.availability({ sourceLanguage, targetLanguage: 'en' });
    return state !== 'unavailable';
  } catch {
    return false;
  }
}

/** Best guess at the language of `text`, or "und" when nothing can tell. */
export async function detectLanguage(text: string, options: TranslateOptions = {}): Promise<string> {
  if (options.detectLanguage !== undefined) return options.detectLanguage(text);
  const api = detectorApi();
  if (api === undefined) return 'und';
  try {
    if ((await api.availability()) === 'unavailable') return 'und';
    const detector = await api.create();
    const results = await detector.detect(text);
    return results[0]?.detectedLanguage ?? 'und';
  } catch {
    return 'und';
  }
}

/**
 * Turns a command in any language into the English the parser reads.
 *
 * Throws an AgentError naming what is missing rather than silently handing the
 * parser text it cannot read - which would surface much later as "no camera
 * steps could be read", pointing at the wrong thing entirely.
 */
export async function toEnglish(text: string, options: TranslateOptions = {}): Promise<TranslationResult> {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new AgentError('EMPTY_COMMAND', 'The command is empty.');
  }
  if (options.assumeEnglish === true) {
    return { english: trimmed, translated: false, via: 'assumed' };
  }
  if (looksEnglish(trimmed)) {
    return { english: trimmed, translated: false, via: 'already-english' };
  }

  const detected = await detectLanguage(trimmed, options);
  const source = detected === 'und' || detected === 'en' ? 'auto' : detected;

  if (options.translate !== undefined) {
    const english = (await options.translate(trimmed, source)).trim();
    if (english === '') {
      throw new AgentError('EMPTY_COMMAND', 'The translation came back empty.', {
        detail: `Input language: ${detected}`,
      });
    }
    return { english, detected, translated: true, via: 'supplied' };
  }

  const api = translatorApi();
  if (api === undefined || source === 'auto') {
    throw new AgentError('NO_STEPS_PARSED', 'This command is not in English and it could not be translated.', {
      detail:
        api === undefined
          ? 'This browser has no built-in translator.'
          : `The language of the command could not be identified (detected: ${detected}).`,
      hint: 'Write the command in English, or set a translation service in the extension options.',
    });
  }

  try {
    if ((await api.availability({ sourceLanguage: source, targetLanguage: 'en' })) === 'unavailable') {
      throw new Error(`translation from ${source} is not available`);
    }
    const translator = await api.create({ sourceLanguage: source, targetLanguage: 'en' });
    const english = (await translator.translate(trimmed)).trim();
    translator.destroy?.();
    if (english === '') throw new Error('the translation came back empty');
    return { english, detected, translated: true, via: 'chrome-translator' };
  } catch (cause) {
    throw new AgentError('NO_STEPS_PARSED', `The command could not be translated from ${detected}.`, {
      detail: cause instanceof Error ? cause.message : String(cause),
      hint: 'Write the command in English, or set a translation service in the extension options.',
      cause,
    });
  }
}
