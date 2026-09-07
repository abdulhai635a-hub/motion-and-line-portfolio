/**
 * Shot plans written as a keyframe table.
 *
 * A plan can arrive already solved - every value, at every time, spelled out:
 *
 *   Keyframe 1 - 0.0s : lat -10.0000 · lon -55.0000 · altitude 800,000 m ·
 *                       pan 0° · tilt 0° · roll 0°
 *   Keyframe 2 - 4.0s : lat -6.0586 · lon -50.1769 · altitude 15,000 m ·
 *                       pan 300° · tilt 65° · roll 0°
 *
 * There is nothing to work out here and nothing to improve on: the rows are the
 * answer, and the agent's job is to type them in exactly.
 *
 * A row is recognised by carrying both a labelled latitude and a labelled
 * longitude, never by the word "keyframe". These plans are written in every
 * language and reach the agent through a translator, so "কীফ্রেম" may arrive as
 * "keyframe", "key frame" or something else again - but "lat" and "lon" stay as
 * they are, and so do the numbers.
 */

export interface KeyframeRow {
  /** Absolute time from the start of the shot, in seconds. */
  atSeconds: number | null;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  panDegrees: number | null;
  tiltDegrees: number | null;
  rollDegrees: number | null;
  fieldOfViewDegrees: number | null;
}

export interface ProjectSettings {
  frameRate?: number;
  width?: number;
  height?: number;
}

const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?`;

/** `lat -6.0586`, `latitude: -6.0586`, `lat = -6.0586`. */
const labelled = (labels: string): RegExp => new RegExp(String.raw`\b(?:${labels})\b\s*[:=]?\s*(${NUMBER})`, 'i');

const LATITUDE = labelled('lat|latitude');
const LONGITUDE = labelled('lon|lng|long|longitude');
const PAN = labelled('pan|heading|azimuth|yaw|bearing');
const TILT = labelled('tilt|pitch');
const ROLL = labelled('roll');
const FOV = labelled('fov|field of view|focal');
/** An altitude with a unit, so an unfamiliar word for "height" still reads. */
const ALTITUDE_LABELLED = new RegExp(
  String.raw`\b(?:alt|altitude|height|elevation|elev)\b\s*[:=]?\s*(${NUMBER})\s*(m|metres|meters|km|kilometres|kilometers|ft|feet)?`,
  'i',
);
const ALTITUDE_BY_UNIT = new RegExp(String.raw`(${NUMBER})\s*(m|metres|meters|km|kilometres|kilometers|ft|feet)\b`, 'i');
/** `0.0s`, `4.0 s`, `at 4s`, `t=4`. */
const TIME = new RegExp(String.raw`(?:\bt\s*=\s*|\bat\s+)?(${NUMBER})\s*s(?:ec|econds?)?\b`, 'i');

const METRES_PER_UNIT: Record<string, number> = {
  m: 1, metre: 1, metres: 1, meter: 1, meters: 1,
  km: 1000, kilometre: 1000, kilometres: 1000, kilometer: 1000, kilometers: 1000,
  ft: 0.3048, feet: 0.3048,
};

/** Reads one row of a keyframe table, or returns null when the line is not one. */
export function parseKeyframeRow(line: string): KeyframeRow | null {
  const text = line.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const latitude = read(text, LATITUDE);
  const longitude = read(text, LONGITUDE);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  // The time is read from the head of the row, before the coordinates, so a
  // "15,000 m" or a "300°" further along cannot be mistaken for one.
  const head = text.slice(0, Math.min(indexOf(text, LATITUDE), indexOf(text, LONGITUDE)));
  const time = read(head, TIME);

  return {
    atSeconds: time !== null && time >= 0 ? time : null,
    latitude,
    longitude,
    altitudeMeters: readAltitude(text),
    panDegrees: read(text, PAN),
    tiltDegrees: read(text, TILT),
    rollDegrees: read(text, ROLL),
    fieldOfViewDegrees: read(text, FOV),
  };
}

/** `4 seconds · 30 fps · 1920x1080` - what the plan says about the project. */
export function parseProjectSettings(line: string): ProjectSettings | null {
  const settings: ProjectSettings = {};
  const fps = /(\d+(?:\.\d+)?)\s*(?:fps|frames?\s*per\s*second)\b/i.exec(line);
  if (fps !== null) {
    const value = Number(fps[1]);
    if (Number.isFinite(value) && value > 0 && value <= 240) settings.frameRate = value;
  }
  const size = /\b(\d{3,5})\s*[x×*]\s*(\d{3,5})\b/i.exec(line);
  if (size !== null) {
    const width = Number(size[1]);
    const height = Number(size[2]);
    if (Number.isInteger(width) && Number.isInteger(height)) {
      settings.width = width;
      settings.height = height;
    }
  }
  return settings.frameRate === undefined && settings.width === undefined ? null : settings;
}

function read(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function indexOf(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  return match === null ? text.length : match.index;
}

function readAltitude(text: string): number | null {
  const labelledMatch = ALTITUDE_LABELLED.exec(text);
  if (labelledMatch !== null) {
    const value = Number(labelledMatch[1]);
    const unit = (labelledMatch[2] ?? 'm').toLowerCase();
    if (Number.isFinite(value)) return value * (METRES_PER_UNIT[unit] ?? 1);
  }
  // The word for height may have been translated into something unexpected, but
  // the unit beside the number was not.
  const byUnit = ALTITUDE_BY_UNIT.exec(text);
  if (byUnit !== null) {
    const value = Number(byUnit[1]);
    const unit = (byUnit[2] ?? 'm').toLowerCase();
    if (Number.isFinite(value)) return value * (METRES_PER_UNIT[unit] ?? 1);
  }
  return null;
}
