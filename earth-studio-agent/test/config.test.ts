import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ALTITUDE_TABLE, DEFAULT_CONFIG, makeConfig } from '../src/config.ts';
import { AgentError } from '../src/errors.ts';

describe('config', () => {
  test('the altitude table matches PRD 8', () => {
    assert.deepEqual(DEFAULT_ALTITUDE_TABLE, {
      space: 10_000_000,
      country: 800_000,
      region: 150_000,
      city: 15_000,
      close: 1_500,
      street: 150,
    });
  });

  test('defaults answer PRD open question 2 with 30fps at 1080p', () => {
    assert.equal(DEFAULT_CONFIG.frameRate, 30);
    assert.equal(DEFAULT_CONFIG.width, 1920);
    assert.equal(DEFAULT_CONFIG.height, 1080);
  });

  test('overrides merge without dropping the rest of the table', () => {
    const config = makeConfig({ frameRate: 24, altitudeTable: { close: 900 } });
    assert.equal(config.frameRate, 24);
    assert.equal(config.altitudeTable.close, 900);
    assert.equal(config.altitudeTable.city, 15_000);
  });

  test('undefined overrides do not clobber defaults', () => {
    const config = makeConfig({ frameRate: undefined, width: undefined });
    assert.equal(config.frameRate, 30);
    assert.equal(config.width, 1920);
  });

  test('rejects nonsense values', () => {
    const bad: Array<[string, () => unknown]> = [
      ['zero fps', () => makeConfig({ frameRate: 0 })],
      ['negative fps', () => makeConfig({ frameRate: -1 })],
      ['absurd fps', () => makeConfig({ frameRate: 1000 })],
      ['zero hold', () => makeConfig({ defaultHoldSeconds: 0 })],
      ['negative altitude', () => makeConfig({ altitudeTable: { city: -5 } })],
      ['fractional width', () => makeConfig({ width: 100.5 })],
      ['ratio above one', () => makeConfig({ ambiguityRatio: 2 })],
    ];
    for (const [label, run] of bad) {
      assert.throws(run, (error: unknown) => {
        assert.ok(error instanceof AgentError, label);
        assert.equal(error.code, 'INVALID_CONFIG', label);
        return true;
      }, label);
    }
  });
});
