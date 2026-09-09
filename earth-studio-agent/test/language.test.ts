/**
 * Accepting commands in any language.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, looksEnglish, scriptLanguage, toEnglish } from '../src/extension/language.ts';
import { AgentError } from '../src/errors.ts';

describe('looksEnglish', () => {
  test('recognises a command the parser can already read', () => {
    assert.equal(looksEnglish('fly to Rome and hold 2 seconds'), true);
    assert.equal(looksEnglish('Start from space, zoom into Japan.'), true);
  });

  test('rejects text in another script', () => {
    assert.equal(looksEnglish('মহাকাশ থেকে জাপানে জুম করো'), false);
    assert.equal(looksEnglish('東京にズームインして'), false);
    assert.equal(looksEnglish('Vuela a Roma y espera 2 segundos'), false);
  });

  test('accepts English around a place name in another script', () => {
    // The parser reads the English; the geocoder can look the name up.
    assert.equal(looksEnglish('fly to 東京 and zoom in close'), true);
  });

  test('rejects text with no words the parser knows', () => {
    assert.equal(looksEnglish('lorem ipsum dolor'), false);
    assert.equal(looksEnglish(''), false);
    assert.equal(looksEnglish('12345'), false);
  });
});

describe('toEnglish', () => {
  test('leaves an English command untouched', async () => {
    const result = await toEnglish('fly to Rome and hold 2 seconds');
    assert.equal(result.translated, false);
    assert.equal(result.via, 'already-english');
    assert.equal(result.english, 'fly to Rome and hold 2 seconds');
  });

  test('translates through the supplied translator', async () => {
    const result = await toEnglish('মহাকাশ থেকে জাপানে জুম করো', {
      detectLanguage: async () => 'bn',
      translate: async (text, source) => {
        assert.equal(source, 'bn');
        assert.equal(text, 'মহাকাশ থেকে জাপানে জুম করো');
        return 'Start from space, zoom into Japan';
      },
    });
    assert.equal(result.translated, true);
    assert.equal(result.via, 'supplied');
    assert.equal(result.detected, 'bn');
    assert.equal(result.english, 'Start from space, zoom into Japan');
  });

  test('assumeEnglish skips both steps', async () => {
    const result = await toEnglish('জাপান', { assumeEnglish: true });
    assert.equal(result.via, 'assumed');
    assert.equal(result.english, 'জাপান');
  });

  test('an empty command is refused before anything else', async () => {
    await assert.rejects(() => toEnglish('   '), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'EMPTY_COMMAND');
      return true;
    });
  });

  test('an empty translation is refused rather than passed on', async () => {
    await assert.rejects(
      () => toEnglish('মহাকাশ থেকে জাপানে জুম করো', {
        detectLanguage: async () => 'bn',
        translate: async () => '   ',
      }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.match(error.detail ?? '', /bn/);
        return true;
      },
    );
  });

  test('says what is missing when nothing can translate', async () => {
    // No built-in translator in Node, and none supplied.
    await assert.rejects(
      () => toEnglish('মহাকাশ থেকে জাপানে জুম করো', { detectLanguage: async () => 'bn' }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.match(error.message, /not in English/);
        assert.match(error.hint ?? '', /English|translation service/);
        return true;
      },
    );
  });

  test('says so when the language cannot be identified either', async () => {
    await assert.rejects(
      () => toEnglish('zzz qqq xxx', { detectLanguage: async () => 'und' }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.match(error.detail ?? '', /could not be identified|no built-in translator/);
        return true;
      },
    );
  });
});

describe('detectLanguage', () => {
  test('falls back to "und" where no detector exists', async () => {
    assert.equal(await detectLanguage('fly to Rome'), 'und');
  });

  test('uses the supplied detector when there is one', async () => {
    assert.equal(await detectLanguage('hola', { detectLanguage: async () => 'es' }), 'es');
  });
});

describe('a command written in two languages at once', () => {
  const MIXED = [
    'কী দেখাবে: MID — Shute Creek Facility-এর অবস্থান Wyoming প্রান্তরের মধ্যে, ধীরে নিচে নামা push-in',
    'ধরন: ম্যাপ',
    'লিংক: Google Earth Studio',
    'কোনটা নেবে: Wyoming থেকে সরাসরি Shute Creek Facility-র দিকে ধীর controlled descent',
  ].join('\n');

  test('is read from its script, not from a detector', () => {
    // Most of the characters are Latin - the place names and the jargon - so a
    // detector calls this English and the half carrying the instructions goes
    // unread.
    assert.equal(scriptLanguage(MIXED), 'bn');
  });

  test('is translated even when the detector insists it is English', async () => {
    const asked: string[] = [];
    const result = await toEnglish(MIXED, {
      detectLanguage: async () => 'en',
      translate: async (text, source) => {
        asked.push(source);
        return 'slow push-in toward Shute Creek Facility, Wyoming';
      },
    });
    assert.equal(result.translated, true);
    assert.equal(result.detected, 'bn');
    assert.deepEqual(asked, ['bn']);
  });

  test('plain English is still left alone', async () => {
    const result = await toEnglish('fly to Rome and hold 2 seconds', {
      translate: async () => {
        throw new Error('English should not be translated');
      },
    });
    assert.equal(result.via, 'already-english');
  });

  test('knows the scripts a shot plan is likely to arrive in', () => {
    assert.equal(scriptLanguage('東京タワーへ飛ぶ'), 'ja');
    assert.equal(scriptLanguage('лететь в Москву'), 'ru');
    assert.equal(scriptLanguage('الطيران إلى القاهرة'), 'ar');
    assert.equal(scriptLanguage('fly to Rome'), undefined);
  });
});
