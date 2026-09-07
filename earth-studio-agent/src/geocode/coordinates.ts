/**
 * Coordinates written the way people write them.
 *
 * A shot plan usually names the exact spot rather than a place the gazetteer
 * knows - "Carajas mine (6°00'44"S, 50°10'37"W)" - and a lookup for those words
 * fails while the numbers beside them are exact. So a pair of coordinates is
 * read directly and never goes near a geocoder.
 *
 * Both notations are accepted, in either order (some plans write longitude
 * first), with or without hemispheres:
 *
 *   6°00'44"S, 50°10'37"W      degrees, minutes, seconds
 *   6° 0.73' S 50° 10.6' W     degrees and decimal minutes
 *   -6.0122, -50.1769          decimal degrees
 *   6.0122 S, 50.1769 W        decimal degrees with a hemisphere
 */
import type { GeoPlace } from '../types.ts';

/** Degrees[/minutes[/seconds]] with a hemisphere letter: 6°00'44"S. */
const SEXAGESIMAL = String.raw`(\d{1,3})\s*[°º]\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*["″”]?\s*)?([NSEWnsew])(?![A-Za-z])`;
/** A plain decimal degree, hemisphere optional: -6.0122, or 6.0122 S. */
const DECIMAL = String.raw`([+-]?\d{1,3}\.\d+)\s*[°º]?\s*(?:([NSEWnsew])(?![A-Za-z]))?`;
const COMPONENT = `(?:${SEXAGESIMAL}|${DECIMAL})`;
/** Two components, separated by a comma, a slash or just space. */
const PAIR = `${COMPONENT}\\s*(?:,|;|/|\\s)\\s*${COMPONENT}`;

/** Matches every coordinate pair in a text. Global, so callers must reset it. */
export const COORDINATE_PATTERN = new RegExp(PAIR, 'g');

export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface Component {
  value: number;
  hemisphere: string | null;
}

/**
 * Reads a coordinate pair, or returns null when the text is not one. The whole
 * text must be the pair: a stray number in a sentence is not a location.
 */
export function parseCoordinates(text: string): Coordinates | null {
  const trimmed = text.trim().replace(/^[([]|[)\]]$/g, '').trim();
  const whole = new RegExp(`^${PAIR}$`, 'i');
  const match = whole.exec(trimmed);
  return match === null ? null : fromMatch(match);
}

/**
 * Words that turn a pair of numbers into something else entirely: "hold 3.5,
 * 2.5 seconds" is two durations, not a spot on the planet.
 */
const UNIT_AFTER = /^\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|m|meter|meters|metre|metres|km|kilometer|kilometers|kilometre|kilometres|ft|foot|feet|mi|mile|miles|deg|degree|degrees|fps|%)\b/i;

/** Every coordinate pair inside a longer text, with where each one sits. */
export function findCoordinates(text: string): Array<{ text: string; index: number }> {
  const found: Array<{ text: string; index: number }> = [];
  COORDINATE_PATTERN.lastIndex = 0;
  for (let match = COORDINATE_PATTERN.exec(text); match !== null; match = COORDINATE_PATTERN.exec(text)) {
    if (fromMatch(match) === null) continue;
    // Bare decimals are only coordinates if nothing says otherwise. Degree
    // marks or a hemisphere letter settle it; without either, a unit word after
    // the pair means these were measurements.
    const marked = /[°ºNSEWnsew]/.test(match[0]);
    if (!marked && UNIT_AFTER.test(text.slice(match.index + match[0].length))) continue;
    found.push({ text: match[0].trim(), index: match.index });
  }
  return found;
}

/** The place a coordinate pair names, in the shape the geocoder returns. */
export function coordinatePlace(query: string, at: Coordinates): GeoPlace {
  return {
    query,
    name: formatCoordinates(at),
    latitude: at.latitude,
    longitude: at.longitude,
    // A coordinate is a point, not an area, so it gets the close-in altitude a
    // landmark gets rather than a city's.
    kind: 'landmark',
    context: 'coordinates',
    provider: 'coordinates',
    confidence: 1,
    ambiguous: false,
    alternatives: [],
  };
}

export function formatCoordinates(at: Coordinates): string {
  return `${at.latitude.toFixed(6)}, ${at.longitude.toFixed(6)}`;
}

/** Turns the ten capture groups of one PAIR match into a checked lat/lon. */
function fromMatch(match: RegExpExecArray): Coordinates | null {
  // Each COMPONENT contributes six groups: four sexagesimal, then two decimal.
  const first = readComponent(match.slice(1, 7));
  const second = readComponent(match.slice(7, 13));
  if (first === null || second === null) return null;

  // Hemispheres say which is which; without them the usual order is latitude
  // first, unless only one of the two can be a latitude at all.
  let latitude = first;
  let longitude = second;
  const northSouth = /^[nsNS]$/;
  if (first.hemisphere !== null && second.hemisphere !== null) {
    if (northSouth.test(first.hemisphere) === northSouth.test(second.hemisphere)) return null;
    if (!northSouth.test(first.hemisphere)) [latitude, longitude] = [second, first];
  } else if (Math.abs(first.value) > 90 && Math.abs(second.value) <= 90) {
    [latitude, longitude] = [second, first];
  }

  const lat = signed(latitude, /^[sS]$/);
  const lon = signed(longitude, /^[wW]$/);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // 0,0 in the Gulf of Guinea is what an empty template looks like, not a shot.
  if (lat === 0 && lon === 0) return null;
  return { latitude: round(lat), longitude: round(lon) };
}

/** One component: either the four sexagesimal groups or the two decimal ones. */
function readComponent(groups: Array<string | undefined>): Component | null {
  const [degrees, minutes, seconds, hemisphere, decimal, decimalHemisphere] = groups;
  if (degrees !== undefined) {
    const value =
      Number(degrees) + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600;
    return Number.isFinite(value) ? { value, hemisphere: hemisphere ?? null } : null;
  }
  if (decimal !== undefined) {
    const value = Number(decimal);
    return Number.isFinite(value) ? { value, hemisphere: decimalHemisphere ?? null } : null;
  }
  return null;
}

function signed(component: Component, negative: RegExp): number {
  const magnitude = component.hemisphere === null ? component.value : Math.abs(component.value);
  return component.hemisphere !== null && negative.test(component.hemisphere) ? -magnitude : magnitude;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
