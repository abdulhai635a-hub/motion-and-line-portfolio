/**
 * Writing a camera attribute through Earth Studio's real editing gesture,
 * against a fixture copied from the live editor's markup and behaviour.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { writeAttribute, formatForField, type AttributeTarget } from '../src/driver/attribute-writer.ts';
import { AgentError } from '../src/errors.ts';
import { findChromium } from './helpers/chromium.ts';
import type { PageLike } from '../src/driver/page.ts';

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/earth-studio-attributes.html')).href;

const LATITUDE: AttributeTarget = {
  label: 'camera latitude',
  attributeType: 'latitude',
  widget: '.scrub-input.valueInput',
  plannedUnit: 'degrees',
};
const ALTITUDE: AttributeTarget = {
  label: 'camera altitude',
  attributeType: 'altitude',
  widget: '.scrub-input.valueInput',
  plannedUnit: 'metres',
};
const LONGITUDE: AttributeTarget = {
  label: 'camera longitude',
  attributeType: 'longitude',
  widget: '.scrub-input.valueInput',
  plannedUnit: 'degrees',
};

let browser: Browser | undefined;
let launchError: string | undefined;

before(async () => {
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: findChromium() });
  } catch (error) {
    launchError = (error instanceof Error ? error.message : String(error)).split('\n')[0];
  }
});

after(async () => {
  await browser?.close();
});

const skip = (): string | false => (browser === undefined ? `Chromium unavailable: ${launchError}` : false);

async function open(): Promise<Page> {
  assert.ok(browser);
  const page = await browser.newPage();
  await page.goto(FIXTURE);
  return page;
}

const shown = (page: Page, type: string): Promise<string | null> =>
  page.locator(`[data-attribute-type="${type}"] .scrub-input.valueInput .presentedValue`).textContent();

describe('writeAttribute', () => {
  test('sets a degrees attribute and reads it back', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const result = await writeAttribute(page as unknown as PageLike, LATITUDE, 35.3606);

    assert.equal(result.typed, 35.3606);
    assert.equal(result.displayUnit, 'Degrees');
    assert.ok(Math.abs(result.readback - 35.3606) < 0.001);
    assert.equal(await shown(page, 'latitude'), '35.361');
    await page.close();
  });

  test('converts metres to the unit the field is showing', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // The field displays kilometres, so a planned 1500 m must be typed as 1.5.
    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 1500);

    assert.equal(result.displayUnit, 'Kilometers');
    assert.equal(result.metresPerEditUnit, 1000);
    assert.equal(result.typed, 1.5);
    assert.equal(await shown(page, 'altitude'), '1.5');
    assert.ok(Math.abs(result.readback - 1500) < 2, `read back ${result.readback}`);
    await page.close();
  });

  test('a large altitude survives the conversion too', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 10_000_000);
    assert.equal(result.typed, 10_000);
    assert.equal(await shown(page, 'altitude'), '10000');
    assert.ok(Math.abs(result.readback - 10_000_000) < 100);
    await page.close();
  });

  test('picks the degrees widget, not the whole-rotations one beside it', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await writeAttribute(page as unknown as PageLike, LONGITUDE, 138.7274);

    assert.equal(await shown(page, 'longitude'), '138.727');
    // The rotations widget must be left exactly as it was.
    const rotations = await page
      .locator('[data-attribute-type="longitude"] .scrub-input.rotationInput .presentedValue')
      .textContent();
    assert.equal(rotations, '0');
    await page.close();
  });

  test('adds a keyframe after committing the value', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const result = await writeAttribute(page as unknown as PageLike, LATITUDE, 12.25);
    assert.equal(result.keyframed, true);

    const added = await page.evaluate(
      () => (window as unknown as { __keyframesAdded: Array<{ type: string; value: string }> }).__keyframesAdded,
    );
    assert.deepEqual(added.map((entry) => entry.type), ['latitude']);
    assert.equal(added[0]?.value, '12.25');
    await page.close();
  });

  test('can set a value without keyframing it', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const result = await writeAttribute(page as unknown as PageLike, LATITUDE, 1.5, { addKeyframe: false });
    assert.equal(result.keyframed, false);
    const added = await page.evaluate(() => (window as unknown as { __keyframesAdded: unknown[] }).__keyframesAdded);
    assert.equal(added.length, 0);
    await page.close();
  });

  test('several attributes in a row each land on their own field', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await writeAttribute(page as unknown as PageLike, LATITUDE, 35.3606);
    await writeAttribute(page as unknown as PageLike, LONGITUDE, 138.7274);
    await writeAttribute(page as unknown as PageLike, ALTITUDE, 1500);

    assert.equal(await shown(page, 'latitude'), '35.361');
    assert.equal(await shown(page, 'longitude'), '138.727');
    assert.equal(await shown(page, 'altitude'), '1.5');
    await page.close();
  });

  test('a missing attribute row names itself and points at probe', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await assert.rejects(
      () => writeAttribute(page as unknown as PageLike, { ...LATITUDE, attributeType: 'nosuch' }, 1),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FIELD_WRITE_FAILED');
        assert.match(error.hint ?? '', /probe/);
        return true;
      },
    );
    await page.close();
  });

  test('a negative value is typed correctly', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await writeAttribute(page as unknown as PageLike, LATITUDE, -13.1631);
    assert.equal(await shown(page, 'latitude'), '-13.163');
    await page.close();
  });
});

describe('formatForField', () => {
  test('never produces exponent notation', () => {
    assert.equal(formatForField(10_000_000), '10000000');
    assert.equal(formatForField(1e-7), '0.0000001');
    assert.ok(!formatForField(1e21).includes('e'));
  });

  test('keeps precision without trailing zeros', () => {
    assert.equal(formatForField(35.3606), '35.3606');
    assert.equal(formatForField(1.5), '1.5');
    assert.equal(formatForField(-13.1631), '-13.1631');
  });
});
