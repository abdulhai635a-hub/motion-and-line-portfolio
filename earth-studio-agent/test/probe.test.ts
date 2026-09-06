/**
 * The attribute survey and the interaction probe, against a fixture copied from
 * the markup the live Earth Studio actually returned.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import { probeAttribute, renderInteraction, renderSurvey, surveyAttributes } from '../src/driver/probe.ts';
import { findChromium } from './helpers/chromium.ts';
import type { PageLike } from '../src/driver/page.ts';

const FIXTURE = pathToFileURL(resolve(import.meta.dirname, 'fixtures/earth-studio-attributes.html')).href;

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

describe('attribute survey', () => {
  test('finds every attribute row with its type, value and unit', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const survey = await surveyAttributes(page as unknown as PageLike);

    assert.deepEqual(survey.rows.map((row) => row.type), ['longitude', 'latitude', 'altitude']);
    assert.equal(survey.rows[1]?.title, 'Latitude');
    assert.equal(survey.rows[1]?.widgets[0]?.value, '-15.018');
    await page.close();
  });

  test('reports the displayed unit, which is not always the planned one', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const survey = await surveyAttributes(page as unknown as PageLike);

    // Altitude reads in kilometres while the agent plans in metres: writing a
    // planned 1500 into this field without converting would mean 1500 km.
    const altitude = survey.rows.find((row) => row.type === 'altitude');
    assert.equal(altitude?.widgets[0]?.unit, 'km');
    assert.equal(altitude?.widgets[0]?.unitTitle, 'Kilometers');

    const latitude = survey.rows.find((row) => row.type === 'latitude');
    assert.equal(latitude?.widgets[0]?.unitTitle, 'Degrees');
    await page.close();
  });

  test('keeps both of longitude’s widgets apart', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const survey = await surveyAttributes(page as unknown as PageLike);

    // Longitude shows whole rotations next to degrees; only the degrees widget
    // carries the value the agent means to set.
    const longitude = survey.rows.find((row) => row.type === 'longitude');
    assert.equal(longitude?.widgets.length, 2);
    assert.ok(longitude?.widgets[0]?.classes.includes('rotationInput'));
    assert.ok(longitude?.widgets[1]?.classes.includes('valueInput'));
    assert.equal(longitude?.widgets[1]?.value, '-34.646');
    await page.close();
  });

  test('suggests a selector per attribute, and each one resolves', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const survey = await surveyAttributes(page as unknown as PageLike);

    for (const [type, selector] of Object.entries(survey.suggestions)) {
      assert.equal(await page.locator(selector).count(), 1, `${type}: ${selector}`);
    }
    assert.match(renderSurvey(survey), /\[data-attribute-type="altitude"\] \.scrub-input\.valueInput/);
    await page.close();
  });

  test('notices the keyframe button each row carries', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const survey = await surveyAttributes(page as unknown as PageLike);
    assert.ok(survey.rows.every((row) => row.hasKeyframeButton));
    await page.close();
  });
});

describe('interaction probe', () => {
  test('records what the page does when a value widget is clicked', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const report = await probeAttribute(page as unknown as PageLike, 'latitude');

    assert.equal(report.steps.length, 2);
    assert.equal(report.steps[0]?.editable.length, 0, 'nothing should be editable before the click');

    // The live editor opens a contenteditable div, not an input, and focuses it.
    assert.deepEqual(report.steps[1]?.editable, ['div.input']);
    assert.equal(report.steps[1]?.focused, 'div.input');
    assert.match(report.steps[1]?.html ?? '', /contenteditable="true"/);
    assert.match(renderInteraction(report), /after a single click/);
    await page.close();
  });

  test('typing is recorded and then cancelled, leaving the value untouched', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    const report = await probeAttribute(page as unknown as PageLike, 'latitude', '12.5');

    assert.deepEqual(
      report.steps.map((step) => step.what),
      ['before any interaction', 'after a single click', 'after typing "12.5"', 'after Escape (edit cancelled)'],
    );
    // Escape must put the row back as it was: a probe that edits the user's
    // project would be worse than no probe.
    const value = await page.locator('[data-attribute-type="latitude"] .presentedValue').textContent();
    assert.equal(value, '-15.018');
    await page.close();
  });

  test('an unknown attribute fails with the selector it tried', async (t) => {
    const why = skip();
    if (why !== false) return t.skip(why);
    const page = await open();
    await assert.rejects(
      () => probeAttribute(page as unknown as PageLike, 'nosuchattribute'),
      (error: unknown) => {
        assert.match(String((error as { hint?: string }).hint), /nosuchattribute/);
        return true;
      },
    );
    await page.close();
  });
});
