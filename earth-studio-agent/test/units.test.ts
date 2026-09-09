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
  });

  test('an altitude shown in kilometres but edited in metres', () => {
    // The live case: "63170 km" on screen, 63170482.1 in the edit box, so one
    // edit unit is one metre.
    assert.equal(metresPerEditUnit('Kilometers', 63170, 63170482.1), 1);
  });

  test('the unit label must be the one shown at rest, not while editing', () => {
    // Earth Studio relabels the altitude "Meters" while its edit box is open.
    // Pairing that label with the resting display value describes a quantity
    // that does not exist, and the answer is nonsense - which is why the driver
    // reads the label before it clicks.
    assert.notEqual(metresPerEditUnit('Meters', 63170, 63170482.1), 1);
  });

  test('an altitude shown and edited in kilometres', () => {
    // One edit unit is a kilometre, so a planned 1500 m is typed as 1.5.
    assert.equal(metresPerEditUnit('Kilometers', 63170, 63170.4821), 1000);
  });

  test('a planned metre value converts the way the live run needed', () => {
    // The live failure: 10,000,000 m into an altitude reading "63170 km" whose
    // edit box holds metres. It must be typed as 10,000,000; the first attempt
    // typed 10,000,000,000 and Earth Studio clamped the camera to its ceiling.
    const perEdit = metresPerEditUnit('Kilometers', 63170, 63170482.1);
    assert.equal(perEdit, 1);
    assert.equal(10_000_000 / perEdit, 10_000_000);

    // And into a field whose edit box is kilometres it becomes 10,000.
    const perEditKm = metresPerEditUnit('Kilometers', 63170, 63170.4821);
    assert.equal(10_000_000 / perEditKm, 10_000);
  });

  test('falls back to the display unit when there is nothing to compare', () => {
    assert.equal(metresPerEditUnit('Kilometers', 0, 0), 1000);
    assert.equal(metresPerEditUnit('Kilometers', Number.NaN, 5), 1000);
    assert.equal(metresPerEditUnit('Meters', 1500, 0), 1);
  });

  test('a wild ratio is not treated as a unit change', () => {
    // A hundred-million-fold gap is not a unit swap; it means the two readings
    // are not the same quantity, so the display unit stands.
    assert.equal(metresPerEditUnit('Degrees', 10, 1e9), 1);
    assert.equal(metresPerEditUnit('Kilometers', 63170, 1e-6), 1000);
  });

  test('the sign of the value does not affect the scale', () => {
    assert.equal(metresPerEditUnit('Degrees', -34.646, -34.6461), 1);
    assert.equal(metresPerEditUnit('Degrees', -34.646, 34.6461), 1);
  });

  test('a unit that is not a power of ten keeps the display scale', () => {
    // Feet: 0.3048 m each, and the edit box agrees with the display.
    assert.equal(metresPerEditUnit('Feet', 5000, 5000.1), 0.3048);
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
  test('allows half of whatever the last displayed digit is worth', () => {
    // "1.5" km can only be read to the nearest 100 m.
    assert.equal(readbackTolerance(1500, 1000, '1.5'), 50);
    // "1500" m is exact to the metre.
    assert.equal(readbackTolerance(1500, 1, '1500'), 0.5);
    // Degrees at three decimals need only the rounding itself.
    assert.ok(readbackTolerance(29.323, 1, '29.323') < 0.01);
  });

  test('accepts a whole-kilometre display, which a live write failed on', () => {
    // Earth Studio showed "152" km for the 151,743 m it had just been given.
    // That is 257 m out and perfectly correct, and rejecting it cost a run its
    // fourth keyframe.
    const tolerance = readbackTolerance(151_743, 1000, '152');
    assert.ok(Math.abs(152_000 - 151_743) <= tolerance, `tolerance was ${tolerance}`);
  });

  test('does not accept a display that is a whole unit out', () => {
    // Half a step, not a whole one: "153" km is a different altitude.
    assert.ok(Math.abs(153_000 - 151_743) > readbackTolerance(151_743, 1000, '152'));
  });

  test('assumes three decimals when the display is not known', () => {
    assert.equal(readbackTolerance(1500, 1000), 0.5);
  });

  test('grows with the value, so large altitudes still compare', () => {
    assert.ok(readbackTolerance(10_000_000, 1000, '10000') >= 100);
  });
});
