/**
 * Coordinates as people write them in a shot plan. These are the exact spot,
 * so they must never depend on a gazetteer or on the network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findCoordinates, parseCoordinates } from '../src/geocode/coordinates.ts';
import { Geocoder } from '../src/geocode/index.ts';
import { parseCommand } from '../src/parser.ts';
import { planCameraPath } from '../src/agent.ts';

describe('parseCoordinates', () => {
  test('reads degrees, minutes and seconds with hemispheres', () => {
    assert.deepEqual(parseCoordinates('6°00\'44"S, 50°10\'37"W'), {
      latitude: -6.012222,
      longitude: -50.176944,
    });
    assert.deepEqual(parseCoordinates('48°51\'30"N 2°17\'40"E'), { latitude: 48.858333, longitude: 2.294444 });
  });

  test('reads plain decimal degrees, signed or with a hemisphere', () => {
    assert.deepEqual(parseCoordinates('-6.0122, -50.1769'), { latitude: -6.0122, longitude: -50.1769 });
    assert.deepEqual(parseCoordinates('6.0122 S, 50.1769 W'), { latitude: -6.0122, longitude: -50.1769 });
    assert.deepEqual(parseCoordinates('35.6762 139.6503'), { latitude: 35.6762, longitude: 139.6503 });
  });

  test('accepts longitude written first, because plans do', () => {
    assert.deepEqual(parseCoordinates('50°10\'37"W 6°00\'44"S'), { latitude: -6.012222, longitude: -50.176944 });
    assert.deepEqual(parseCoordinates('139.6503, 35.6762'), { latitude: 35.6762, longitude: 139.6503 });
  });

  test('refuses what is not a location', () => {
    for (const text of ['1500, 2000', '0, 0', '95.5, 200.5', 'hold 3 seconds', '6°00\'44"S']) {
      assert.equal(parseCoordinates(text), null, `${text} should not be a coordinate`);
    }
  });
});

describe('findCoordinates', () => {
  test('finds a pair inside a line of prose', () => {
    const found = findCoordinates('Shot 1 - Carajas mine (6°00\'44"S, 50°10\'37"W)');
    assert.equal(found.length, 1);
    assert.equal(found[0]?.text, '6°00\'44"S, 50°10\'37"W');
  });

  test('leaves measurements alone', () => {
    // Two durations are not a place, and reading them as one used to be the
    // risk of accepting bare decimals at all.
    assert.deepEqual(findCoordinates('hold 3.5, 2.5 seconds'), []);
    assert.deepEqual(findCoordinates('zoom to 1.5, 2.5 km'), []);
  });
});

describe('coordinates end to end', () => {
  test('the geocoder answers from the numbers, not from a lookup', async () => {
    const place = await new Geocoder().resolve('6°00\'44"S, 50°10\'37"W');
    assert.equal(place.provider, 'coordinates');
    assert.equal(place.latitude, -6.012222);
    assert.equal(place.ambiguous, false);
  });

  test('a comma inside a coordinate does not split the step', () => {
    const { steps } = parseCommand('fly to 6°00\'44"S, 50°10\'37"W and hold 2 seconds');
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.placeQuery, '6°00\'44"S, 50°10\'37"W');
  });

  test('a plan built from coordinates lands on them exactly', async () => {
    const { path } = await planCameraPath('fly to -6.0122, -50.1769 at street level');
    const last = path.keyframes.at(-1);
    assert.equal(last?.camera.latitude, -6.0122);
    assert.equal(last?.camera.longitude, -50.1769);
    assert.equal(last?.camera.altitude, 150);
  });
});
