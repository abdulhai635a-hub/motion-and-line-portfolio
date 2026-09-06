/**
 * Geocoder (FR2).
 *
 * Resolves a place name to coordinates, picks the most likely candidate when a
 * name collides, and always reports the alternatives it rejected so the choice
 * can be reviewed (PRD 11, "Georgia the country vs the US state").
 */
import type { GeoPlace, PlaceCandidate } from '../types.ts';
import type { SessionConfig } from '../config.ts';
import { AgentError } from '../errors.ts';
import { offlineProvider, type GeocodeProvider } from './providers.ts';

export { offlineProvider, createNominatimProvider, mapNominatimKind } from './providers.ts';
export type { GeocodeProvider } from './providers.ts';
export { knownNames, normaliseName } from './gazetteer.ts';

export interface GeocoderOptions {
  providers?: GeocodeProvider[];
  /** Runner-up/winner score ratio above which a choice is flagged. */
  ambiguityRatio?: number;
  /** Pre-seeded results, e.g. loaded from a cache file. */
  cache?: Map<string, GeoPlace>;
}

export class Geocoder {
  private readonly providers: GeocodeProvider[];
  private readonly ambiguityRatio: number;
  readonly cache: Map<string, GeoPlace>;

  constructor(options: GeocoderOptions = {}) {
    this.providers = options.providers ?? [offlineProvider];
    this.ambiguityRatio = options.ambiguityRatio ?? 0.6;
    this.cache = options.cache ?? new Map();
    if (this.providers.length === 0) {
      throw new AgentError('INVALID_CONFIG', 'The geocoder needs at least one provider.');
    }
  }

  /** Resolves one place name. Throws AgentError('PLACE_NOT_FOUND') if nothing matches. */
  async resolve(query: string, stepIndex?: number): Promise<GeoPlace> {
    const key = query.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const failures: string[] = [];
    for (const provider of this.providers) {
      let candidates: PlaceCandidate[];
      try {
        candidates = await provider.lookup(query);
      } catch (cause) {
        // A provider being down must not hide a later provider that can answer.
        failures.push(cause instanceof Error ? `${provider.name}: ${cause.message}` : String(cause));
        continue;
      }
      if (candidates.length === 0) continue;
      const place = this.rank(query, provider.name, candidates);
      this.cache.set(key, place);
      return place;
    }

    const hasOnline = this.providers.some((provider) => provider.name !== 'gazetteer');
    throw new AgentError('PLACE_NOT_FOUND', `Could not resolve the place "${query}".`, {
      stepIndex,
      detail: failures.length > 0 ? failures.join('; ') : `Tried: ${this.providers.map((p) => p.name).join(', ')}.`,
      hint: hasOnline
        ? 'Check the spelling, or use a name the online geocoder knows.'
        : 'Check the spelling, or add --online to look the place up on OpenStreetMap.',
    });
  }

  /** Sorts candidates, picks the winner, and works out whether it is ambiguous. */
  private rank(query: string, provider: string, candidates: PlaceCandidate[]): GeoPlace {
    const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const winner = sorted[0];
    if (winner === undefined) {
      throw new AgentError('PLACE_NOT_FOUND', `Could not resolve the place "${query}".`);
    }
    const runnerUp = sorted[1];
    // A rival is a real alternative when it scores close to the winner, or when
    // it is a different kind of thing entirely (a country vs a US state).
    const ambiguous =
      runnerUp !== undefined &&
      (runnerUp.score >= winner.score * this.ambiguityRatio || runnerUp.kind !== winner.kind);
    const confidence =
      runnerUp === undefined ? 1 : winner.score / (winner.score + runnerUp.score);

    return {
      query,
      name: winner.name,
      latitude: winner.latitude,
      longitude: winner.longitude,
      kind: winner.kind,
      context: winner.context,
      provider,
      confidence: Number(confidence.toFixed(3)),
      ambiguous,
      alternatives: sorted.slice(1, 5),
    };
  }
}

/** Serialises the cache for `--cache-file`. */
export function serialiseCache(cache: Map<string, GeoPlace>): string {
  return JSON.stringify(Object.fromEntries(cache), null, 2);
}

export function parseCache(json: string): Map<string, GeoPlace> {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
  return new Map(Object.entries(parsed as Record<string, GeoPlace>));
}

export type { SessionConfig };
