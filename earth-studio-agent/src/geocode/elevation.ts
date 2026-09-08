/**
 * How high the ground is.
 *
 * Earth Studio's altitude field is measured from sea level, while a camera
 * move is described from the ground: "1,500 m over the mine" means 1,500 m of
 * air beneath the camera, wherever that ground happens to be. Over the sea the
 * two are the same, and everywhere else they are not - a live run wrote 1,500 m
 * over Shute Creek in Wyoming, where the ground is at about 2,050 m, and put
 * the camera half a kilometre underground. The frame came out black.
 *
 * So the ground is looked up and added. Open-Meteo's elevation service answers
 * without a key, in batches, and the fetch is injectable so the arithmetic can
 * be tested without a live service.
 */
import { AgentError } from '../errors.ts';

export interface Point {
  latitude: number;
  longitude: number;
}

/** Ground height in metres above sea level, or null where it is not known. */
export type ElevationProvider = (points: Point[]) => Promise<Array<number | null>>;

export interface ElevationOptions {
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Points per request. Open-Meteo takes 100. */
  batchSize?: number;
}

export function createElevationProvider(options: ElevationOptions = {}): ElevationProvider {
  const {
    endpoint = 'https://api.open-meteo.com/v1/elevation',
    timeoutMs = 10_000,
    fetchImpl = globalThis.fetch,
    batchSize = 100,
  } = options;

  return async (points: Point[]): Promise<Array<number | null>> => {
    if (points.length === 0) return [];
    if (typeof fetchImpl !== 'function') {
      throw new AgentError('GEOCODER_UNAVAILABLE', 'No fetch implementation is available for the elevation lookup.');
    }

    const heights: Array<number | null> = [];
    for (let start = 0; start < points.length; start += batchSize) {
      const batch = points.slice(start, start + batchSize);
      const latitudes = batch.map((point) => point.latitude.toFixed(6)).join(',');
      const longitudes = batch.map((point) => point.longitude.toFixed(6)).join(',');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${endpoint}?latitude=${latitudes}&longitude=${longitudes}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const body = (await response.json()) as { elevation?: unknown };
        const values = Array.isArray(body.elevation) ? body.elevation : [];
        for (let i = 0; i < batch.length; i += 1) {
          const value = values[i];
          heights.push(typeof value === 'number' && Number.isFinite(value) ? value : null);
        }
      } catch (cause) {
        // Not knowing the ground is a warning, never a failure: the plan is
        // still worth writing, and the caller says what the risk is.
        for (let i = 0; i < batch.length; i += 1) heights.push(null);
      } finally {
        clearTimeout(timer);
      }
    }
    return heights;
  };
}

/** Remembers what it has looked up, keyed to about a hundred metres. */
export function cachedElevation(provider: ElevationProvider, cache = new Map<string, number | null>()): ElevationProvider {
  return async (points: Point[]): Promise<Array<number | null>> => {
    const keys = points.map((point) => `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`);
    // One request per distinct place, however many steps stand on it.
    const wanted = new Map<string, Point>();
    for (const [index, key] of keys.entries()) {
      const point = points[index];
      if (point !== undefined && !cache.has(key)) wanted.set(key, point);
    }
    if (wanted.size > 0) {
      const asked = [...wanted.keys()];
      const found = await provider([...wanted.values()]);
      asked.forEach((key, index) => cache.set(key, found[index] ?? null));
    }
    return keys.map((key) => cache.get(key) ?? null);
  };
}
