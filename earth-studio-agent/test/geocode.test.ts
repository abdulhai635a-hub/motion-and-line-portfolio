import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksWorthLookingUp,
  Geocoder,
  createNominatimProvider,
  mapNominatimKind,
  offlineProvider,
  parseCache,
  serialiseCache,
  normaliseName,
  knownNames,
} from '../src/geocode/index.ts';
import { GAZETTEER, lookupExact } from '../src/geocode/gazetteer.ts';
import { AgentError } from '../src/errors.ts';
import type { GeocodeProvider } from '../src/geocode/index.ts';

describe('gazetteer', () => {
  test('every entry has plausible coordinates and a positive weight', () => {
    for (const entry of GAZETTEER) {
      assert.ok(entry.latitude >= -90 && entry.latitude <= 90, `${entry.name} latitude`);
      assert.ok(entry.longitude >= -180 && entry.longitude <= 180, `${entry.name} longitude`);
      assert.ok(entry.weight > 0, `${entry.name} weight`);
      assert.notEqual(entry.name.trim(), '');
      assert.notEqual(entry.context.trim(), '');
    }
  });

  test('normalises case, accents and punctuation', () => {
    assert.equal(normaliseName('São Paulo'), 'sao paulo');
    assert.equal(normaliseName('  Washington, D.C. '), 'washington d c');
    assert.equal(normaliseName('Mount  Fuji'), 'mount fuji');
  });

  test('a few well-known coordinates are right', () => {
    const cases: Array<[string, number, number]> = [
      ['Japan', 36.2048, 138.2529],
      ['Mount Fuji', 35.3606, 138.7274],
      ['Eiffel Tower', 48.8584, 2.2945],
      ['Sydney', -33.8688, 151.2093],
    ];
    for (const [name, latitude, longitude] of cases) {
      const entry = lookupExact(name)[0];
      assert.ok(entry, name);
      assert.ok(Math.abs(entry.latitude - latitude) < 0.001, `${name} latitude`);
      assert.ok(Math.abs(entry.longitude - longitude) < 0.001, `${name} longitude`);
    }
  });

  test('a comma-qualified name resolves to the qualified place, not the famous one', async () => {
    const { Geocoder: G } = await import('../src/geocode/index.ts');
    const geocoder = new G();
    assert.equal((await geocoder.resolve('Paris, Texas')).name, 'Paris, Texas');
    assert.equal((await geocoder.resolve('Washington, D.C.')).name, 'Washington, D.C.');
  });

  test('lists its own names', () => {
    assert.ok(knownNames().includes('Mount Fuji'));
    assert.ok(knownNames().length > 100);
  });
});

describe('Geocoder', () => {
  test('resolves a country, a city and a landmark', async () => {
    const geocoder = new Geocoder();
    assert.equal((await geocoder.resolve('Japan')).kind, 'country');
    assert.equal((await geocoder.resolve('Tokyo')).kind, 'city');
    assert.equal((await geocoder.resolve('Mount Fuji')).kind, 'landmark');
  });

  test('matches aliases and is case-insensitive', async () => {
    const geocoder = new Geocoder();
    assert.equal((await geocoder.resolve('mt fuji')).name, 'Mount Fuji');
    assert.equal((await geocoder.resolve('NYC')).name, 'New York City');
    assert.equal((await geocoder.resolve('  japan  ')).name, 'Japan');
  });

  test('flags Georgia the country against Georgia the state (PRD 11)', async () => {
    const place = await new Geocoder().resolve('Georgia');
    assert.equal(place.ambiguous, true);
    assert.equal(place.kind, 'country');
    assert.ok(place.alternatives.some((alt) => alt.kind === 'region'));
    assert.ok(place.confidence < 0.7);
  });

  test('does not flag a name whose rivals are far less likely', async () => {
    const place = await new Geocoder().resolve('Paris');
    assert.equal(place.name, 'Paris');
    assert.equal(place.ambiguous, false);
    assert.ok(place.confidence > 0.9);
  });

  test('flags two cities of similar size', async () => {
    const place = await new Geocoder().resolve('Cambridge');
    assert.equal(place.ambiguous, true);
    assert.equal(place.alternatives[0]?.name, 'Cambridge, Massachusetts');
  });

  test('always reports the alternatives it rejected (FR2)', async () => {
    const place = await new Geocoder().resolve('Washington');
    assert.ok(place.alternatives.length >= 1);
    assert.ok(place.alternatives.every((alt) => alt.name !== undefined));
  });

  test('names the step when a place cannot be resolved (FR6)', async () => {
    await assert.rejects(() => new Geocoder().resolve('Zzyzx Nowhere Land', 4), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'PLACE_NOT_FOUND');
      assert.equal(error.stepIndex, 4);
      return true;
    });
  });

  test('caches a resolved place', async () => {
    let calls = 0;
    const counting: GeocodeProvider = {
      name: 'counting',
      async lookup(query) {
        calls += 1;
        return offlineProvider.lookup(query);
      },
    };
    const geocoder = new Geocoder({ providers: [counting] });
    await geocoder.resolve('Tokyo');
    await geocoder.resolve('tokyo');
    assert.equal(calls, 1);
  });

  test('falls through to the next provider when the first is down', async () => {
    const broken: GeocodeProvider = {
      name: 'broken',
      async lookup() {
        throw new Error('network down');
      },
    };
    const geocoder = new Geocoder({ providers: [broken, offlineProvider] });
    assert.equal((await geocoder.resolve('Tokyo')).name, 'Tokyo');
  });

  test('reports why every provider failed', async () => {
    const broken: GeocodeProvider = {
      name: 'broken',
      async lookup() {
        throw new Error('network down');
      },
    };
    await assert.rejects(() => new Geocoder({ providers: [broken] }).resolve('Tokyo'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.match(error.detail ?? '', /broken: network down/);
      return true;
    });
  });

  test('round-trips its cache', async () => {
    const geocoder = new Geocoder();
    await geocoder.resolve('Rome');
    const restored = parseCache(serialiseCache(geocoder.cache));
    assert.equal(restored.get('rome')?.name, 'Rome');
    assert.equal(parseCache('[]').size, 0);
  });
});

describe('nominatim provider', () => {
  const row = {
    name: 'Wellington',
    display_name: 'Wellington, New Zealand',
    lat: '-41.2866',
    lon: '174.7756',
    importance: 0.7,
    addresstype: 'city',
  };

  test('maps a response row onto a candidate', async () => {
    const provider = createNominatimProvider({
      fetchImpl: (async () => new Response(JSON.stringify([row]), { status: 200 })) as unknown as typeof fetch,
    });
    const [candidate] = await provider.lookup('Wellington');
    assert.equal(candidate?.name, 'Wellington');
    assert.equal(candidate?.kind, 'city');
    assert.ok(Math.abs((candidate?.latitude ?? 0) + 41.2866) < 1e-6);
  });

  test('drops rows without usable coordinates', async () => {
    const provider = createNominatimProvider({
      fetchImpl: (async () => new Response(JSON.stringify([{ name: 'x', lat: 'nope', lon: 'nope' }]), { status: 200 })) as unknown as typeof fetch,
    });
    assert.deepEqual(await provider.lookup('x'), []);
  });

  test('turns an HTTP error into an actionable AgentError', async () => {
    const provider = createNominatimProvider({
      fetchImpl: (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch,
    });
    await assert.rejects(() => provider.lookup('Wellington'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'GEOCODER_UNAVAILABLE');
      assert.match(error.hint ?? '', /--offline/);
      return true;
    });
  });

  test('turns a network failure into an actionable AgentError', async () => {
    const provider = createNominatimProvider({
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await assert.rejects(() => provider.lookup('Wellington'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'GEOCODER_UNAVAILABLE');
      assert.match(error.detail ?? '', /ECONNREFUSED/);
      return true;
    });
  });

  test('sends a descriptive User-Agent, as Nominatim requires', async () => {
    let seenHeaders: Record<string, string> = {};
    const provider = createNominatimProvider({
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seenHeaders = init.headers as Record<string, string>;
        return new Response('[]', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await provider.lookup('Wellington');
    assert.match(seenHeaders['User-Agent'] ?? '', /earth-studio-agent/);
  });

  test('classifies rows the way the altitude table expects', () => {
    assert.equal(mapNominatimKind({ addresstype: 'country' }), 'country');
    assert.equal(mapNominatimKind({ addresstype: 'state' }), 'region');
    assert.equal(mapNominatimKind({ addresstype: 'town' }), 'city');
    assert.equal(mapNominatimKind({ category: 'tourism' }), 'landmark');
    assert.equal(mapNominatimKind({}), 'unknown');
  });
});

describe('what is worth looking up online', () => {
  test('a place name is', () => {
    for (const query of ['shute creek', 'wyoming', 'carajas mine', 'rome', 'mount fuji']) {
      assert.equal(looksWorthLookingUp(query), true, query);
    }
  });

  test('a line lifted out of a brief is not', () => {
    // A fuzzy online search will find a village called No, and a plan about
    // Wyoming does not want a keyframe there.
    for (const query of ['no', 'use', 'type map', 'the and for', 'shot 1']) {
      assert.equal(looksWorthLookingUp(query), false, query);
    }
  });

  test('the built-in table is still asked, since it only matches real names', async () => {
    const online: GeocodeProvider = {
      name: 'nominatim',
      async lookup() {
        throw new Error('the online geocoder should not have been asked');
      },
    };
    const geocoder = new Geocoder({ providers: [offlineProvider, online] });
    await assert.rejects(() => geocoder.resolve('type map'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'PLACE_NOT_FOUND');
      return true;
    });
    // And a real name still reaches it.
    assert.equal((await geocoder.resolve('Rome')).name, 'Rome');
  });
});
