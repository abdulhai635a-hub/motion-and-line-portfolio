import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AUTO_DURATION, groundDistanceKm, smartDuration, smartTilt } from '../src/smart.ts';

const TOKYO = { latitude: 35.6762, longitude: 139.6503 };
const FUJI = { latitude: 35.3606, longitude: 138.7274 };
const ROME = { latitude: 41.9028, longitude: 12.4964 };

describe('groundDistanceKm', () => {
  test('measures real distances', () => {
    assert.ok(Math.abs(groundDistanceKm(TOKYO, FUJI) - 88) < 8, `${groundDistanceKm(TOKYO, FUJI)} km`);
    assert.ok(Math.abs(groundDistanceKm(ROME, TOKYO) - 9860) < 120, `${groundDistanceKm(ROME, TOKYO)} km`);
  });

  test('is zero for the same point', () => {
    assert.equal(groundDistanceKm(ROME, ROME), 0);
  });
});

describe('smartDuration', () => {
  test('a dive in place is brisk', () => {
    const seconds = smartDuration({ ...FUJI, altitude: 10_000_000 }, { ...FUJI, altitude: 800_000 });
    assert.ok(seconds >= 3 && seconds <= 5, `${seconds}s`);
  });

  test('crossing the world takes longer than crossing a country', () => {
    const short = smartDuration({ ...TOKYO, altitude: 15_000 }, { ...FUJI, altitude: 15_000 });
    const long = smartDuration({ ...ROME, altitude: 15_000 }, { ...TOKYO, altitude: 15_000 });
    assert.ok(long > short + 2, `${short}s then ${long}s`);
  });

  test('a big altitude change counts as well as distance', () => {
    const flat = smartDuration({ ...FUJI, altitude: 15_000 }, { ...FUJI, altitude: 15_000 });
    const dive = smartDuration({ ...FUJI, altitude: 800_000 }, { ...FUJI, altitude: 1_500 });
    assert.ok(dive > flat + 2, `${flat}s then ${dive}s`);
  });

  test('stays inside sensible bounds whatever it is given', () => {
    const nothing = smartDuration({ ...ROME, altitude: 1_000 }, { ...ROME, altitude: 1_000 });
    const everything = smartDuration({ latitude: 90, longitude: 0, altitude: 10_000_000 }, { latitude: -90, longitude: 180, altitude: 150 });
    assert.equal(nothing, DEFAULT_AUTO_DURATION.min + 0.5);
    assert.ok(nothing >= DEFAULT_AUTO_DURATION.min);
    assert.ok(everything <= DEFAULT_AUTO_DURATION.max);
  });

  test('an altitude of zero does not break the arithmetic', () => {
    const seconds = smartDuration({ ...ROME, altitude: 0 }, { ...ROME, altitude: 1_500 });
    assert.ok(Number.isFinite(seconds) && seconds > 0);
  });
});

describe('smartTilt', () => {
  test('looks straight down from orbit', () => {
    assert.equal(smartTilt(10_000_000), 0);
    assert.equal(smartTilt(50_000_000), 0);
  });

  test('opens out as the camera comes down', () => {
    const heights = [10_000_000, 800_000, 150_000, 15_000, 1_500, 150];
    const tilts = heights.map(smartTilt);
    for (let index = 1; index < tilts.length; index += 1) {
      assert.ok((tilts[index] ?? 0) > (tilts[index - 1] ?? 0), `tilt fell at ${heights[index]} m`);
    }
  });

  test('a close pass is angled, not a map from above', () => {
    assert.ok(smartTilt(1_500) >= 50, `${smartTilt(1500)} degrees`);
    assert.ok(smartTilt(150) >= 70);
  });

  test('interpolates between the bands rather than stepping', () => {
    const between = smartTilt(5_000);
    assert.ok(between > smartTilt(15_000) && between < smartTilt(1_500), `${between} degrees`);
  });

  test('never returns something unusable', () => {
    for (const altitude of [0, -5, 1, 1e12, Number.NaN]) {
      const tilt = smartTilt(altitude);
      assert.ok(Number.isFinite(tilt), `${altitude} gave ${tilt}`);
      assert.ok(tilt >= 0 && tilt <= 90, `${altitude} gave ${tilt}`);
    }
  });
});
