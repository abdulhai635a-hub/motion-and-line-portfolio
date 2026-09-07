/**
 * Choosing the settings nobody wants to type.
 *
 * A person writing "fly to Mount Fuji and zoom in close" should not also have
 * to decide how many seconds the move takes or what angle the camera holds.
 * These work both out from the shot itself, and the command can still override
 * either ("hold 3 seconds", "tilt 45 degrees", "slowly").
 */
import type { CameraState } from './types.ts';

export interface AutoDurationSettings {
  /** Seconds a move takes before distance and altitude are considered. */
  base: number;
  /** Seconds added per decade of ground distance in kilometres. */
  perDistance: number;
  /** Seconds added per decade of altitude change. */
  perAltitude: number;
  min: number;
  max: number;
}

export const DEFAULT_AUTO_DURATION: AutoDurationSettings = {
  base: 2.5,
  perDistance: 1.2,
  perAltitude: 0.9,
  min: 2,
  max: 10,
};

/** Great-circle distance in kilometres. */
export function groundDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * How long a move should take.
 *
 * A hop across a city and a dive from orbit are not the same shot, and giving
 * them the same four seconds makes one crawl and the other lurch. Both the
 * ground distance and the change in altitude count, each on a log scale so that
 * crossing an ocean is longer than crossing a country without being ten times
 * longer.
 */
export function smartDuration(
  from: { latitude: number; longitude: number; altitude: number },
  to: { latitude: number; longitude: number; altitude: number },
  settings: AutoDurationSettings = DEFAULT_AUTO_DURATION,
): number {
  const distanceKm = groundDistanceKm(from, to);
  const high = Math.max(from.altitude, to.altitude);
  const low = Math.max(1, Math.min(from.altitude, to.altitude));
  const altitudeRatio = high / low;

  const seconds =
    settings.base +
    settings.perDistance * Math.log10(1 + distanceKm) +
    settings.perAltitude * Math.log10(Math.max(1, altitudeRatio));

  return round(clamp(seconds, settings.min, settings.max), 2);
}

/** Altitude in metres paired with the tilt that suits it, highest first. */
const TILT_BY_ALTITUDE: Array<[metres: number, degrees: number]> = [
  [10_000_000, 0],
  [800_000, 8],
  [150_000, 25],
  [15_000, 40],
  [1_500, 60],
  [150, 75],
];

/**
 * The angle to hold at a given height.
 *
 * Earth Studio's tilt is 0 looking straight down - confirmed against a live
 * project, whose camera at tilt 0 pointed at the ground. Straight down suits an
 * establishing shot from orbit and makes a close pass look like a map, so the
 * angle opens out as the camera comes down.
 */
export function smartTilt(altitudeMetres: number): number {
  const altitude = Math.max(1, altitudeMetres);
  const first = TILT_BY_ALTITUDE[0];
  const last = TILT_BY_ALTITUDE.at(-1);
  if (first === undefined || last === undefined) return 0;
  if (altitude >= first[0]) return first[1];
  if (altitude <= last[0]) return last[1];

  for (let index = 0; index < TILT_BY_ALTITUDE.length - 1; index += 1) {
    const upper = TILT_BY_ALTITUDE[index];
    const lower = TILT_BY_ALTITUDE[index + 1];
    if (upper === undefined || lower === undefined) continue;
    if (altitude <= upper[0] && altitude >= lower[0]) {
      // Interpolate on a log scale: altitude bands are decades, not steps.
      const span = Math.log10(upper[0]) - Math.log10(lower[0]);
      const position = (Math.log10(upper[0]) - Math.log10(altitude)) / span;
      return round(upper[1] + position * (lower[1] - upper[1]), 1);
    }
  }
  return 0;
}

/** The camera a step ends on, given the one before it. */
export function cameraFor(
  previous: CameraState | null,
  place: { latitude: number; longitude: number },
  altitude: number,
): { latitude: number; longitude: number; altitude: number } {
  void previous;
  return { latitude: place.latitude, longitude: place.longitude, altitude };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
