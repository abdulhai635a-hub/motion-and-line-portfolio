/**
 * Finding the place in a sentence written for a person.
 *
 * Every one of these is a line from a real shot plan that the agent read as a
 * destination and handed to a geocoder whole.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { namesNowhere, placeCandidates } from '../src/place-phrase.ts';
import { parseCommand } from '../src/parser.ts';

describe('placeCandidates', () => {
  test('finds the name inside a sentence about a shot', () => {
    assert.deepEqual(
      placeCandidates("What will be shown: WIDE — Shute Creek gas plant's complete industrial footprint, slow lateral pan"),
      ['Shute Creek'],
    );
  });

  test('offers the name with and without the word hung off it', () => {
    assert.deepEqual(placeCandidates('a steady aerial orbit centred on Shute Creek facility'), [
      'Shute Creek facility',
      'Shute Creek',
    ]);
  });

  test('ignores the labels and the tool a brief names', () => {
    assert.deepEqual(placeCandidates('Type: Map'), []);
    assert.deepEqual(placeCandidates('Link: Google Earth Studio'), []);
    assert.deepEqual(placeCandidates('Project: 4 seconds - 30 fps'), []);
  });

  test('keeps a name that a joining word runs through', () => {
    assert.ok(placeCandidates('over the Isle of Skye at dawn').includes('Isle of Skye'));
  });

  test('a number is not a name', () => {
    assert.deepEqual(placeCandidates('tilt 45'), []);
  });
});

describe('namesNowhere', () => {
  test('knows a line of jargon from a place', () => {
    for (const phrase of ['slow sideward reveal', 'type map', 'link google earth studio', 'lateral']) {
      assert.equal(namesNowhere(phrase), true, phrase);
    }
    for (const phrase of ['shute creek', 'rome', 'the mine', 'carajas']) {
      assert.equal(namesNowhere(phrase), false, phrase);
    }
  });
});

describe('a shot plan written as prose', () => {
  const BRIEF = [
    "What will be shown: WIDE — Shute Creek gas plant's complete industrial footprint, slow lateral pan",
    'Type: Map',
    'Link: Google Earth Studio',
    'What to take: a steady aerial orbit centred on Shute Creek facility; slow sideward reveal',
  ].join('\n');

  test('reads the place, the pace, and nothing else', () => {
    const { steps, ignored } = parseCommand(BRIEF);
    assert.deepEqual(
      steps.map((step) => step.placeQuery),
      ['shute creek', 'shute creek facility'],
    );
    // "slow" is an instruction; the labels are not.
    assert.equal(steps[0]?.speedScale, 1.6);
    assert.deepEqual(ignored, ['Type: Map', 'Link: Google Earth Studio']);
  });

  test('an aerial orbit is a move around a subject, not a height above the planet', () => {
    const { steps } = parseCommand('a steady aerial orbit centred on Shute Creek facility');
    assert.equal(steps[0]?.zoom, null, 'the camera should not be sent to space');
  });

  test('a plain instruction still reads the way it always did', () => {
    const { steps } = parseCommand('Start from space, zoom into Japan. Hold 3 seconds. Then fly to Mount Fuji.');
    assert.deepEqual(
      steps.map((step) => `${step.action}:${step.placeQuery ?? ''}`),
      ['start:', 'zoom_in:japan', 'hold:', 'fly_to:mount fuji'],
    );
  });
});
