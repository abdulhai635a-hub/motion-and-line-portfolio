import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  metresPerDisplayUnit,
  metresPerEditUnit,
  parseDisplayedNumber,
  readbackTolerance,
} from '../src/driver/units.ts';

describe('metresPerDisplayUnit', () => {
  test('reads the unit tooltip Earth Studio shows', () => {
    assert.equal(metresPerDisplayUnit('Kilometers'), 1000);
    assert.equal(metresPerDisplayUnit('Meters'), 1);
    assert.equal(metresPerDisplayUnit('Degrees'), 1);
    assert.equal(metresPerDisplayUnit('Feet'), 0.3048);
    assert.equal(metresPerDisplayUnit(''), 1);
  });
});

describe('metresPerEditUnit', () => {
  test('an edit box that agrees with the display shares its unit', () => {
    // Observed for latitude: display 29.323, edit box 29.3228910257184.
    assert.equal(metresPerEditUnit('Degrees', 29.323, 29.3228910257184), 1);
    // And for altitude if the edit box is also in kilometres.
    assert.equal(metresPerEditUnit('Kilometers', 63170, 63170.4821), 1000);
  });

  test('an edit box a thousand times larger is using the finer unit', () => {
    // Display "63170 km", edit box "63170482.1" - the box is in metres.
    assert.equal(metresPerEditUnit('Kilometers', 63170, 63170482.1), 1);
  });

  test('an edit box a thousand times smaller is using the coarser unit', () => {
    assert.equal(metresPerEditUnit('Meters', 1500, 1.5), 1000);
  });

  test('falls back to the display unit when there is nothing to compare', () => {
    assert.equal(metresPerEditUnit('Kilometers', 0, 0), 1000);
    assert.equal(metresPerEditUnit('Kilometers', Number.NaN, 5), 1000);
  });

  test('a wild ratio is not treated as a unit change', () => {
    assert.equal(metresPerEditUnit('Degrees', 10, 1e9), 1);
  });

  test('the sign of the value does not affect the scale', () => {
    assert.equal(metresPerEditUnit('Degrees', -34.646, -34.6461), 1);
  });
});

describe('parseDisplayedNumber', () => {
  test('handles the shapes the page prints', () => {
    assert.equal(parseDisplayedNumber('-15.018'), -15.018);
    assert.equal(parseDisplayedNumber('63,170'), 63170);
    assert.equal(parseDisplayedNumber('52043 km'), 52043);
    assert.ok(Number.isNaN(parseDisplayedNumber('Visible')));
  });
});

describe('readbackTolerance', () => {
  test('accepts what the three-decimal display can actually show', () => {
    // 1500 m shown in kilometres is "1.5", so a metre of slack is needed.
    assert.ok(readbackTolerance(1500, 1000) >= 1);
    // Degrees need only the rounding itself.
    assert.ok(readbackTolerance(29.323, 1) < 0.01);
  });

  test('grows with the value, so large altitudes still compare', () => {
    assert.ok(readbackTolerance(10_000_000, 1000) >= 100);
  });
});
