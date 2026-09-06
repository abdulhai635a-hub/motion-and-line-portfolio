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
    // The field reads kilometres but its edit box holds metres, so a planned
    // 1500 m is typed as 1500. Trusting the label alone would have typed 1.5,
    // putting the camera a metre and a half above the ground.
    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 1500);

    assert.equal(result.displayUnit, 'Kilometers');
    assert.equal(result.metresPerEditUnit, 1);
    assert.equal(result.typed, 1500);
    assert.ok(Math.abs(result.readback - 1500) < 2, `read back ${result.readback}`);
    await page.close();
  });

  test('accepts a write that makes the field switch units', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // The live failure at the last keyframe: the field read kilometres, 1500 m
    // was written correctly, and Earth Studio then relabelled it "1500 m".
    // Converting that with the old label made a correct write look like a
    // thousandfold overshoot.
    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 1500);

    assert.equal(result.typed, 1500);
    assert.ok(Math.abs(result.readback - 1500) < 2, `read back ${result.readback}`);
    assert.equal(await shown(page, 'altitude'), '1500');
    assert.equal(
      await page.locator('[data-attribute-type="altitude"] .scrub-input.valueInput .unit').getAttribute('title'),
      'Meters',
    );
    await page.close();
  });

  test('writes a small altitude and then a large one, across the unit switch', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await writeAttribute(page as unknown as PageLike, ALTITUDE, 1500);
    assert.equal(await shown(page, 'altitude'), '1500');

    // Back up to 800 km: the field is reading metres now, and must end up in
    // kilometres again.
    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 800_000);
    assert.equal(result.typed, 800_000);
    assert.ok(Math.abs(result.readback - 800_000) < 10, `read back ${result.readback}`);
    assert.equal(await shown(page, 'altitude'), '800');
    await page.close();
  });

  test('a large altitude survives the conversion too', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // The live failure: this was typed as 10,000,000,000 and Earth Studio
    // clamped the camera to its ceiling.
    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 10_000_000);
    assert.equal(result.typed, 10_000_000);
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

  test('hovers to reveal a keyframe button that is hidden until then', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // The live editor only shows the button on hover.
    assert.equal(await page.locator('[data-attribute-type="latitude"] .add-keyframe').isVisible(), false);

    const result = await writeAttribute(page as unknown as PageLike, LATITUDE, 12.25);
    assert.equal(result.keyframed, true);
    await page.close();
  });

  test('does not click a keyframe button that already reports a keyframe', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await writeAttribute(page as unknown as PageLike, LATITUDE, 12.25);

    // Earth Studio keyframes an animated attribute by itself, so clicking the
    // button again would remove the keyframe rather than add one.
    const before = (await page.evaluate(
      () => (window as unknown as { __keyframesAdded: unknown[] }).__keyframesAdded.length,
    )) as number;
    const second = await writeAttribute(page as unknown as PageLike, LATITUDE, 13.5);
    const afterCount = (await page.evaluate(
      () => (window as unknown as { __keyframesAdded: unknown[] }).__keyframesAdded.length,
    )) as number;

    assert.equal(second.keyframed, true);
    assert.equal(afterCount, before, 'the button should not be clicked a second time');
    await page.close();
  });

  test('keyframes even when the button has no box at all', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // What the live editor did in a narrow window: the button is in the DOM but
    // renders to nothing, so even a forced click fails with "not visible".
    await page.addStyleTag({ content: '.add-keyframe { display: none !important; }' });
    assert.equal(await page.locator('[data-attribute-type="latitude"] .add-keyframe').isVisible(), false);

    const result = await writeAttribute(page as unknown as PageLike, LATITUDE, 12.25);
    assert.equal(result.keyframed, true);

    const added = await page.evaluate(
      () => (window as unknown as { __keyframesAdded: Array<{ type: string }> }).__keyframesAdded,
    );
    assert.deepEqual(added.map((entry) => entry.type), ['latitude']);
    await page.close();
  });

  test('reports every way it tried when none of them keyframes', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // The button is there but inert: no click of any kind will keyframe.
    await page.evaluate(() => {
      const button = document.querySelector('[data-attribute-type="latitude"] .add-keyframe');
      if (button !== null) button.replaceWith(button.cloneNode(true));
    });
    await page.addStyleTag({ content: '.add-keyframe { display: none !important; }' });

    await assert.rejects(
      () => writeAttribute(page as unknown as PageLike, LATITUDE, 12.25),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.match(error.message, /Could not add a keyframe/);
        assert.match(error.detail ?? '', /hover and click/);
        assert.match(error.detail ?? '', /click from inside the page/);
        assert.match(error.hint ?? '', /probe --buttons/);
        return true;
      },
    );
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
    // 1500 m is below the size at which the field switches to kilometres.
    assert.equal(await shown(page, 'altitude'), '1500');
    await page.close();
  });

  test('waits for a readout that updates slowly', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // The live editor updates the value a moment after Enter. Reading it once,
    // immediately, saw the old value and rejected a write that had worked - the
    // failure this test exists to prevent.
    await page.evaluate(() => {
      (window as unknown as { __commitDelay: number }).__commitDelay = 1_200;
    });

    const result = await writeAttribute(page as unknown as PageLike, LATITUDE, 36.2048);
    assert.ok(Math.abs(result.readback - 36.2048) < 0.001);
    assert.equal(await shown(page, 'latitude'), '36.205');
    await page.close();
  });

  test('gives up if the readout never catches up, saying how long it waited', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await page.evaluate(() => {
      (window as unknown as { __commitDelay: number }).__commitDelay = 60_000;
    });

    await assert.rejects(
      () => writeAttribute(page as unknown as PageLike, LATITUDE, 36.2048, { settleTimeoutMs: 600 }),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'DRIVER_FIELD_WRITE_FAILED');
        assert.match(error.detail ?? '', /after 600ms/);
        return true;
      },
    );
    await page.close();
  });

  test('commits even when focus does not stay on the edit box', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    // A live run lost a keyframe exactly here: the value was typed with the
    // global keyboard, focus was not on the box, and nothing was committed -
    // the box stayed open and the field kept its old value.
    await page.evaluate(() => {
      (window as unknown as { __stealFocus: boolean }).__stealFocus = true;
    });

    const result = await writeAttribute(page as unknown as PageLike, ALTITUDE, 1500);
    assert.equal(result.typed, 1500);
    assert.equal(await shown(page, 'altitude'), '1500');

    // And the edit box must be closed afterwards, not left open over the value.
    assert.equal(await page.locator('[data-attribute-type="altitude"] [contenteditable]').count(), 0);
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
