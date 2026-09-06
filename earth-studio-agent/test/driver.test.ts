/**
 * The selector model, checked without a browser.
 *
 * These are the facts read off a live Earth Studio session with `probe`; if a
 * future edit to selectors.ts loses one, these fail rather than the driver
 * quietly writing into the wrong row.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_FIELD_ORDER,
  DEFAULT_SELECTORS,
  mergeSelectors,
  rowSelector,
  widgetSelector,
} from '../src/driver/selectors.ts';

describe('camera attribute selectors', () => {
  test('every camera field maps to an attribute row', () => {
    for (const field of CAMERA_FIELD_ORDER) {
      const attribute = DEFAULT_SELECTORS.camera[field];
      assert.notEqual(attribute.attributeType, '', field);
      assert.notEqual(attribute.label, '', field);
      assert.equal(attribute.widget, '.scrub-input.valueInput', field);
    }
  });

  test('the rotations use the axis names Earth Studio uses', () => {
    // Observed live: Pan is rotationX, Tilt rotationY, Roll rotationZ.
    assert.equal(DEFAULT_SELECTORS.camera.pan.attributeType, 'rotationX');
    assert.equal(DEFAULT_SELECTORS.camera.tilt.attributeType, 'rotationY');
    assert.equal(DEFAULT_SELECTORS.camera.roll.attributeType, 'rotationZ');
    assert.equal(DEFAULT_SELECTORS.camera.fieldOfView.attributeType, 'fov');
  });

  test('only altitude is planned in metres', () => {
    assert.equal(DEFAULT_SELECTORS.camera.altitude.plannedUnit, 'metres');
    for (const field of CAMERA_FIELD_ORDER.filter((name) => name !== 'altitude')) {
      assert.equal(DEFAULT_SELECTORS.camera[field].plannedUnit, 'degrees', field);
    }
  });

  test('position is required, orientation is optional', () => {
    for (const field of ['latitude', 'longitude', 'altitude'] as const) {
      assert.equal(DEFAULT_SELECTORS.camera[field].required, true, field);
    }
    for (const field of ['pan', 'tilt', 'roll', 'fieldOfView'] as const) {
      assert.equal(DEFAULT_SELECTORS.camera[field].required, false, field);
    }
  });

  test('builds the selectors the driver uses', () => {
    const altitude = DEFAULT_SELECTORS.camera.altitude;
    assert.equal(rowSelector(altitude), '[data-attribute-type="altitude"]');
    assert.equal(widgetSelector(altitude), '[data-attribute-type="altitude"] .scrub-input.valueInput');
  });

  test('readiness is judged by the attribute panel, not by the body', () => {
    // An earlier version accepted "body", which matched any page at all - a
    // signed-out one included.
    assert.ok(!DEFAULT_SELECTORS.appReady.candidates.includes('body'));
    assert.match(DEFAULT_SELECTORS.appReady.candidates[0] ?? '', /data-attribute-type/);
  });

  test('the selector set says when it was last checked against the live app', () => {
    assert.match(DEFAULT_SELECTORS.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('playhead selectors', () => {
  test('the readout is required and the transport buttons are not', () => {
    assert.equal(DEFAULT_SELECTORS.playhead.readout.required, true);
    assert.equal(DEFAULT_SELECTORS.playhead.forward.required, false);
  });

  test('the transport buttons use the actions the page declares', () => {
    assert.deepEqual(DEFAULT_SELECTORS.playhead.jumpStart.candidates, ['[data-action="click:jumpWorkspaceStart"]']);
    assert.deepEqual(DEFAULT_SELECTORS.playhead.forward.candidates, ['[data-action="click:forward"]']);
    assert.deepEqual(DEFAULT_SELECTORS.playhead.backward.candidates, ['[data-action="click:backward"]']);
  });
});

describe('mergeSelectors', () => {
  test('an override file replaces only what it names', () => {
    const merged = mergeSelectors({
      version: '3.0.0',
      camera: { latitude: { attributeType: 'lat2' } },
      playhead: { readout: { candidates: ['#clock'] } },
    });
    assert.equal(merged.version, '3.0.0');
    assert.equal(merged.camera.latitude.attributeType, 'lat2');
    assert.equal(merged.camera.latitude.label, DEFAULT_SELECTORS.camera.latitude.label);
    assert.deepEqual(merged.camera.longitude, DEFAULT_SELECTORS.camera.longitude);
    assert.deepEqual(merged.playhead.readout.candidates, ['#clock']);
    assert.equal(merged.playhead.forward.candidates[0], DEFAULT_SELECTORS.playhead.forward.candidates[0]);
  });

  test('garbage in the override file falls back to the defaults', () => {
    assert.deepEqual(mergeSelectors(null), DEFAULT_SELECTORS);
    assert.deepEqual(mergeSelectors('nope'), DEFAULT_SELECTORS);
  });
});
