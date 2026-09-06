import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, splitClauses, splitSentences } from '../src/parser.ts';
import { AgentError } from '../src/errors.ts';

describe('splitSentences', () => {
  test('splits on newlines and terminators', () => {
    assert.deepEqual(splitSentences('a. b; c\nd!'), ['a', 'b', 'c', 'd']);
  });

  test('keeps decimals intact', () => {
    assert.deepEqual(splitSentences('hold for 3.5 seconds'), ['hold for 3.5 seconds']);
  });

  test('keeps abbreviated place names intact', () => {
    assert.deepEqual(splitSentences('fly to Mt. Fuji'), ['fly to Mt. Fuji']);
    assert.deepEqual(splitSentences('fly to St. Louis. Hold.'), ['fly to St. Louis', 'Hold']);
  });
});

describe('splitClauses', () => {
  test('splits on commas, and, then', () => {
    assert.deepEqual(splitClauses('fly to Rome, then zoom in and hold'), ['fly to Rome', 'zoom in', 'hold']);
  });
});

describe('parseCommand', () => {
  test('reproduces the worked example from the PRD', () => {
    const { steps } = parseCommand(
      'Start from space, zoom into Japan.\nHold for 3 seconds.\nThen fly to Mount Fuji and zoom in close.\nHold for 2 seconds.',
    );
    assert.deepEqual(
      steps.map((step) => [step.action, step.placeQuery, step.zoom, step.durationSeconds]),
      [
        ['start', null, 'space', null],
        ['zoom_in', 'japan', null, null],
        ['hold', null, null, 3],
        ['fly_to', 'mount fuji', 'close', null],
        ['hold', null, null, 2],
      ],
    );
  });

  test('a trailing zoom clause refines the move it follows, it does not become a step', () => {
    const { steps } = parseCommand('fly to Mount Fuji and zoom in close');
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.action, 'fly_to');
    assert.equal(steps[0]?.zoom, 'close');
  });

  test('a hold is always its own step even inside one sentence', () => {
    const { steps } = parseCommand('fly to Rome and hold 2 seconds');
    assert.deepEqual(steps.map((s) => s.action), ['fly_to', 'hold']);
    assert.equal(steps[1]?.durationSeconds, 2);
  });

  test('recognises the duration spellings from PRD 7', () => {
    for (const [text, expected] of [
      ['hold for 3 seconds', 3],
      ['hold 5 sec', 5],
      ['hold 2s', 2],
      ['wait 1.5 seconds', 1.5],
      ['hold for three seconds', 3],
      ['hold for half a second', 0.5],
      ['hold for 2 minutes', 120],
    ] as const) {
      assert.equal(parseCommand(text).steps[0]?.durationSeconds, expected, text);
    }
  });

  test('recognises explicit altitudes and converts units', () => {
    for (const [text, expected] of [
      ['zoom to 500 meters', 500],
      ['zoom to 1.5km', 1500],
      ['zoom in to 2000 m', 2000],
      ['zoom to 1000 feet', 304.8],
    ] as const) {
      assert.equal(parseCommand(text).steps[0]?.altitudeMeters, expected, text);
    }
  });

  test('maps the relative zoom descriptors from PRD 8', () => {
    const cases: Array<[string, string]> = [
      ['start from space', 'space'],
      ['zoom out to country level', 'country'],
      ['zoom to state level', 'region'],
      ['zoom to city level', 'city'],
      ['zoom in close', 'close'],
      ['fly to Rome at street level', 'street'],
    ];
    for (const [text, expected] of cases) {
      assert.equal(parseCommand(text).steps[0]?.zoom, expected, text);
    }
  });

  test('a descriptor is not mistaken for a place, and vice versa', () => {
    const spaceStep = parseCommand('start from space').steps[0];
    assert.equal(spaceStep?.placeQuery, null);
    assert.equal(spaceStep?.zoom, 'space');

    // "City" inside a place name must survive.
    const cityStep = parseCommand('fly to New York City').steps[0];
    assert.equal(cityStep?.placeQuery, 'new york city');
  });

  test('cuts the place phrase at a trailing preposition', () => {
    assert.equal(parseCommand('zoom into Japan from above').steps[0]?.placeQuery, 'japan');
    assert.equal(parseCommand('fly over the Grand Canyon at street level').steps[0]?.placeQuery, 'grand canyon');
  });

  test('keeps place names that contain "and"', () => {
    const { steps } = parseCommand('fly to Trinidad and Tobago');
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.placeQuery, 'trinidad and tobago');
  });

  test('keeps place names that contain a comma', () => {
    for (const [text, expected] of [
      ['fly to Washington, D.C.', 'washington, d.c'],
      ['fly to Paris, Texas', 'paris, texas'],
      ['fly to Cambridge, Massachusetts', 'cambridge, massachusetts'],
    ] as const) {
      const { steps } = parseCommand(text);
      assert.equal(steps.length, 1, text);
      assert.equal(steps[0]?.placeQuery, expected, text);
    }
  });

  test('a thousands separator is not a clause break', () => {
    const { steps } = parseCommand('zoom to 1,500 meters over Rome');
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.altitudeMeters, 1500);
    assert.equal(steps[0]?.placeQuery, 'rome');
  });

  test('a tab separates steps', () => {
    const { steps } = parseCommand('fly to Rome\thold 2 seconds');
    assert.deepEqual(steps.map((step) => step.action), ['fly_to', 'hold']);
  });

  test('reads a place with no preposition', () => {
    const { steps } = parseCommand('Mount Fuji, hold 2 seconds');
    assert.equal(steps[0]?.placeQuery, 'mount fuji');
    assert.equal(steps[1]?.action, 'hold');
  });

  test('defaults to fly_to when a place is named with no verb', () => {
    assert.equal(parseCommand('Tokyo').steps[0]?.action, 'fly_to');
  });

  test('distinguishes zoom out from zoom in', () => {
    assert.equal(parseCommand('zoom out').steps[0]?.action, 'zoom_out');
    assert.equal(parseCommand('pull back').steps[0]?.action, 'zoom_out');
    assert.equal(parseCommand('zoom in').steps[0]?.action, 'zoom_in');
  });

  test('does not read metres as minutes', () => {
    const step = parseCommand('zoom to 500 m').steps[0];
    assert.equal(step?.altitudeMeters, 500);
    assert.equal(step?.durationSeconds, null);
  });

  test('rejects an empty command', () => {
    assert.throws(() => parseCommand('   '), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'EMPTY_COMMAND');
      return true;
    });
  });

  test('keeps unrecognised text as a step so the geocoder can name it (FR6)', () => {
    // The grammar is forgiving by design, so nonsense becomes a place lookup
    // that fails loudly at step 2 rather than being dropped without a trace.
    const result = parseCommand('fly to Rome. purple monkey dishwasher');
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[1]?.placeQuery, 'purple monkey dishwasher');
  });

  test('throws when nothing at all can be understood', () => {
    assert.throws(() => parseCommand('!!! ??? ...'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'NO_STEPS_PARSED');
      return true;
    });
  });

  test('numbers every step from one, in order', () => {
    const { steps } = parseCommand('fly to Rome. hold 2s. fly to Paris. hold 1s');
    assert.deepEqual(steps.map((step) => step.index), [1, 2, 3, 4]);
  });
});
