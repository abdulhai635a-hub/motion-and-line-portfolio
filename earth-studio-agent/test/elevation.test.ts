/**
 * Altitude above the ground, not above the sea.
 *
 * Earth Studio's altitude field is measured from sea level. A shot is described
 * from the ground - "1,500 m over the site" means 1,500 m of air below the
 * camera. Over the sea the two agree; over Wyoming they are half a kilometre
 * apart, and a live run put the camera underground and rendered a black frame.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planCameraPath } from '../src/agent.ts';
import { createElevationProvider, cachedElevation, type Point } from '../src/geocode/elevation.ts';
import { Geocoder } from '../src/geocode/index.ts';
import type { GeocodeProvider } from '../src/geocode/index.ts';

/** Shute Creek, Wyoming: the ground is about 2,050 m above sea level. */
const SHUTE_CREEK: GeocodeProvider = {
  name: 'fixed',
  async lookup() {
    return [{ name: 'Shute Creek', latitude: 41.8806, longitude: -110.0903, kind: 'landmark', score: 1 }];
  },
};

const ground = (metres: number) => async (points: Point[]): Promise<Array<number | null>> => points.map(() => metres);

describe('altitudes are written above the ground', () => {
  test('a close pass over high ground clears it', async () => {
    const { path } = await planCameraPath('fly to the site and zoom in close', {
      geocoder: new Geocoder({ providers: [SHUTE_CREEK] }),
      elevation: ground(2_050),
    });
    // The plan asks for 1,500 m of air; the field gets 1,500 + 2,050.
    assert.equal(path.steps.at(-1)?.altitude, 1_500);
    assert.equal(path.keyframes.at(-1)?.camera.altitude, 3_550);
    assert.equal(path.warnings.length, 0, JSON.stringify(path.warnings));
  });

  test('at sea level the two are the same', async () => {
    const { path } = await planCameraPath('fly to the site and zoom in close', {
      geocoder: new Geocoder({ providers: [SHUTE_CREEK] }),
      elevation: ground(0),
    });
    assert.equal(path.keyframes.at(-1)?.camera.altitude, 1_500);
  });

  test('an altitude the command states is written exactly as written', async () => {
    // A keyframe table gives the field value, not a height above the ground.
    const { path } = await planCameraPath(
      'Keyframe 1 - 0.0s : lat 41.8806 · lon -110.0903 · altitude 4,000 m\n' +
        'Keyframe 2 - 4.0s : lat 41.8806 · lon -110.0903 · altitude 6,000 m',
      { elevation: ground(2_050) },
    );
    assert.deepEqual(path.keyframes.map((keyframe) => keyframe.camera.altitude), [4_000, 6_000]);
  });

  test('but says so when a stated altitude is underground', async () => {
    const { path } = await planCameraPath(
      'Keyframe 1 - 0.0s : lat 41.8806 · lon -110.0903 · altitude 1,500 m\n' +
        'Keyframe 2 - 4.0s : lat 41.8806 · lon -110.0903 · altitude 6,000 m',
      { elevation: ground(2_050) },
    );
    const warning = path.warnings.find((entry) => entry.code === 'ALTITUDE_UNDERGROUND');
    assert.ok(warning, JSON.stringify(path.warnings));
    assert.match(warning.message, /2050 m above sea level/);
    assert.match(warning.message, /black/);
  });

  test('without a ground height, a low pass is flagged rather than silently buried', async () => {
    const { path } = await planCameraPath('fly to the site and zoom in close', {
      geocoder: new Geocoder({ providers: [SHUTE_CREEK] }),
    });
    assert.ok(path.warnings.some((warning) => warning.code === 'GROUND_UNKNOWN'));
  });

  test('a shot that stays in orbit is not flagged', async () => {
    const { path } = await planCameraPath('start from space, fly to Japan at country level');
    assert.equal(path.warnings.some((warning) => warning.code === 'GROUND_UNKNOWN'), false);
  });
});

describe('the elevation service', () => {
  const respond = (body: unknown, ok = true): typeof fetch =>
    (async () => ({ ok, status: 200, statusText: 'OK', json: async () => body })) as unknown as typeof fetch;

  test('asks for every point in one request and reads the heights back', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(String(url));
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ elevation: [2050, 30] }) };
    }) as unknown as typeof fetch;

    const provider = createElevationProvider({ fetchImpl });
    const heights = await provider([
      { latitude: 41.8806, longitude: -110.0903 },
      { latitude: 29.9792, longitude: 31.1342 },
    ]);
    assert.deepEqual(heights, [2050, 30]);
    assert.equal(asked.length, 1);
    assert.match(asked[0] ?? '', /latitude=41\.880600,29\.979200/);
    assert.match(asked[0] ?? '', /longitude=-110\.090300,31\.134200/);
  });

  test('a service that is down is not a failure, just an unknown', async () => {
    const provider = createElevationProvider({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    assert.deepEqual(await provider([{ latitude: 1, longitude: 2 }]), [null]);
  });

  test('a refusal is an unknown too, not a thrown error', async () => {
    const provider = createElevationProvider({ fetchImpl: respond({}, false) });
    assert.deepEqual(await provider([{ latitude: 1, longitude: 2 }]), [null]);
  });

  test('a short answer leaves the rest unknown rather than shifting them', async () => {
    const provider = createElevationProvider({ fetchImpl: respond({ elevation: [100] }) });
    assert.deepEqual(await provider([{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }]), [100, null]);
  });

  test('the same place is asked about once, however many steps stand on it', async () => {
    let calls = 0;
    const counted = async (points: Point[]): Promise<Array<number | null>> => {
      calls += 1;
      return points.map(() => 500);
    };
    const provider = cachedElevation(counted);
    const here = { latitude: 41.8806, longitude: -110.0903 };
    assert.deepEqual(await provider([here, here, here]), [500, 500, 500]);
    assert.deepEqual(await provider([here]), [500]);
    assert.equal(calls, 1);
  });
});
