/**
 * Geocoding providers (PRD 6, "Geocoder").
 *
 * `offlineProvider` answers from the built-in gazetteer, which makes the agent
 * deterministic and usable with no network. `createNominatimProvider` reaches
 * OpenStreetMap for anything the table does not know; its fetch is injectable so
 * the mapping logic can be tested without a live service.
 */
import type { PlaceCandidate, PlaceKind } from '../types.ts';
import { lookupExact, lookupFuzzy, type GazetteerEntry } from './gazetteer.ts';
import { AgentError } from '../errors.ts';

export interface GeocodeProvider {
  readonly name: string;
  lookup(query: string): Promise<PlaceCandidate[]>;
}

function toCandidate(entry: GazetteerEntry, penalty = 1): PlaceCandidate {
  return {
    name: entry.name,
    latitude: entry.latitude,
    longitude: entry.longitude,
    kind: entry.kind,
    score: entry.weight * penalty,
    context: entry.context,
  };
}

export const offlineProvider: GeocodeProvider = {
  name: 'gazetteer',
  async lookup(query: string): Promise<PlaceCandidate[]> {
    const exact = lookupExact(query);
    if (exact.length > 0) return exact.map((entry) => toCandidate(entry));
    // Fuzzy hits are worth less: they matched only a substring.
    return lookupFuzzy(query).map((entry) => toCandidate(entry, 0.5));
  },
};

/** Shape of the Nominatim jsonv2 rows this provider reads. */
interface NominatimRow {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  importance?: number;
  category?: string;
  type?: string;
  addresstype?: string;
  class?: string;
}

export interface NominatimOptions {
  /** Nominatim requires a descriptive User-Agent identifying the application. */
  userAgent?: string;
  endpoint?: string;
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const NOMINATIM_KIND: Record<string, PlaceKind> = {
  country: 'country',
  state: 'region',
  region: 'region',
  province: 'region',
  county: 'region',
  city: 'city',
  town: 'city',
  village: 'city',
  municipality: 'city',
  hamlet: 'city',
  suburb: 'city',
  neighbourhood: 'city',
  administrative: 'region',
};

export function mapNominatimKind(row: NominatimRow): PlaceKind {
  const key = (row.addresstype ?? row.type ?? '').toLowerCase();
  const mapped = NOMINATIM_KIND[key];
  if (mapped) return mapped;
  const category = (row.category ?? row.class ?? '').toLowerCase();
  if (category === 'place') return 'city';
  if (category === 'boundary') return 'region';
  if (['tourism', 'historic', 'natural', 'building', 'man_made', 'leisure', 'amenity', 'waterway'].includes(category)) {
    return 'landmark';
  }
  return 'unknown';
}

export function createNominatimProvider(options: NominatimOptions = {}): GeocodeProvider {
  const {
    userAgent = 'earth-studio-agent/1.0 (camera path generator)',
    endpoint = 'https://nominatim.openstreetmap.org/search',
    limit = 5,
    timeoutMs = 10_000,
    fetchImpl = globalThis.fetch,
  } = options;

  return {
    name: 'nominatim',
    async lookup(query: string): Promise<PlaceCandidate[]> {
      if (typeof fetchImpl !== 'function') {
        throw new AgentError('GEOCODER_UNAVAILABLE', 'No fetch implementation is available for the online geocoder.');
      }
      const url = `${endpoint}?q=${encodeURIComponent(query)}&format=jsonv2&limit=${limit}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let rows: NominatimRow[];
      try {
        const response = await fetchImpl(url, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new AgentError(
            'GEOCODER_UNAVAILABLE',
            `Online geocoder returned HTTP ${response.status} for "${query}".`,
            { hint: 'Re-run with --offline to use only the built-in place table.' },
          );
        }
        rows = (await response.json()) as NominatimRow[];
      } catch (cause) {
        if (cause instanceof AgentError) throw cause;
        throw new AgentError('GEOCODER_UNAVAILABLE', `Online geocoder request failed for "${query}".`, {
          detail: cause instanceof Error ? cause.message : String(cause),
          hint: 'Re-run with --offline to use only the built-in place table.',
          cause,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((row) => {
        const latitude = Number.parseFloat(row.lat ?? '');
        const longitude = Number.parseFloat(row.lon ?? '');
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        return [{
          name: row.name && row.name !== '' ? row.name : (row.display_name ?? query),
          latitude,
          longitude,
          kind: mapNominatimKind(row),
          // importance is 0..1; scale it so it can be compared with itself.
          score: Math.max(1, Math.round((row.importance ?? 0.1) * 1_000_000)),
          context: row.display_name,
        }];
      });
    },
  };
}
