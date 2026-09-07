/**
 * Session configuration: frame rate, defaults, and the editable altitude table.
 * Reference: PRD 6 ("Session Config") and PRD 8 (default zoom/altitude table).
 */
import { AgentError } from './errors.ts';
import { DEFAULT_AUTO_DURATION, type AutoDurationSettings } from './smart.ts';
import type { PlaceKind, ZoomDescriptor } from './types.ts';

/** PRD 8. Metres above ground. Every value is overridable per session. */
export const DEFAULT_ALTITUDE_TABLE: Record<ZoomDescriptor, number> = {
  space: 10_000_000,
  country: 800_000,
  region: 150_000,
  city: 15_000,
  close: 1_500,
  street: 150,
};

/**
 * Which descriptor a place defaults to when the user names no zoom level
 * ("fly to Paris" should not land at country altitude). PRD 6, Geocoder row.
 */
export const DEFAULT_DESCRIPTOR_BY_PLACE_KIND: Record<PlaceKind, ZoomDescriptor> = {
  country: 'country',
  region: 'region',
  city: 'city',
  landmark: 'close',
  unknown: 'city',
};

export interface SessionConfig {
  /** PRD open question 2 - answered with 30fps / 1080p defaults. */
  frameRate: number;
  width: number;
  height: number;
  /** Seconds used by any move step that gives no duration. */
  defaultTransitionSeconds: number;
  /** Seconds used by a "hold" with no stated duration. */
  defaultHoldSeconds: number;
  /** Altitude a sequence starts from when the user does not say. */
  startAltitude: number;
  /**
   * Work the duration of each move out from the shot instead of using
   * defaultTransitionSeconds. A hop across a city and a dive from orbit are not
   * the same length of move.
   */
  automaticTiming: boolean;
  /**
   * Work the tilt out from the altitude instead of using defaultTilt. Straight
   * down suits an establishing shot; a close pass wants an angle.
   */
  automaticTilt: boolean;
  /** Tuning for automaticTiming. */
  autoDuration: AutoDurationSettings;
  /**
   * Write the field of view. Off by default: a project has its own lens - a
   * live one was set to 20 degrees - and overwriting it silently changes the
   * look of every shot. A command that names a field of view turns this on.
   */
  writeFieldOfView: boolean;
  /** Camera attributes the v1 grammar does not expose. */
  defaultTilt: number;
  defaultPan: number;
  defaultRoll: number;
  defaultFieldOfView: number;
  altitudeTable: Record<ZoomDescriptor, number>;
  descriptorByPlaceKind: Record<PlaceKind, ZoomDescriptor>;
  /**
   * A resolved place is flagged ambiguous when the runner-up candidate scores at
   * least this fraction of the winner's score (PRD 11, "Georgia" risk row).
   */
  ambiguityRatio: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  frameRate: 30,
  width: 1920,
  height: 1080,
  defaultTransitionSeconds: 4,
  defaultHoldSeconds: 2,
  startAltitude: DEFAULT_ALTITUDE_TABLE.space,
  automaticTiming: true,
  automaticTilt: true,
  autoDuration: { ...DEFAULT_AUTO_DURATION },
  writeFieldOfView: false,
  defaultTilt: 0,
  defaultPan: 0,
  defaultRoll: 0,
  defaultFieldOfView: 60,
  altitudeTable: { ...DEFAULT_ALTITUDE_TABLE },
  descriptorByPlaceKind: { ...DEFAULT_DESCRIPTOR_BY_PLACE_KIND },
  ambiguityRatio: 0.6,
};

/**
 * Deep-merges a partial override onto the defaults and validates the result.
 *
 * Naming a setting turns off the automatic behaviour it replaces: someone who
 * passes a move duration means that duration, not a suggestion, and someone who
 * names a field of view means it to be written. Say nothing and the agent works
 * all three out from the shot, which is the point.
 */
export function makeConfig(overrides: DeepPartial<SessionConfig> = {}): SessionConfig {
  const automatic = {
    automaticTiming: overrides.defaultTransitionSeconds === undefined,
    automaticTilt: overrides.defaultTilt === undefined,
    writeFieldOfView: overrides.defaultFieldOfView !== undefined,
  };
  const config: SessionConfig = {
    ...DEFAULT_CONFIG,
    ...automatic,
    ...stripUndefined(overrides),
    altitudeTable: { ...DEFAULT_CONFIG.altitudeTable, ...stripUndefined(overrides.altitudeTable ?? {}) },
    descriptorByPlaceKind: {
      ...DEFAULT_CONFIG.descriptorByPlaceKind,
      ...stripUndefined(overrides.descriptorByPlaceKind ?? {}),
    },
    autoDuration: { ...DEFAULT_CONFIG.autoDuration, ...stripUndefined(overrides.autoDuration ?? {}) },
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config: SessionConfig): void {
  if (!Number.isFinite(config.frameRate) || config.frameRate <= 0) {
    throw new AgentError('INVALID_CONFIG', `frameRate must be a positive number, got ${config.frameRate}`);
  }
  if (config.frameRate > 240) {
    throw new AgentError('INVALID_CONFIG', `frameRate ${config.frameRate} is above the supported maximum of 240`);
  }
  for (const key of ['defaultTransitionSeconds', 'defaultHoldSeconds'] as const) {
    const value = config[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new AgentError('INVALID_CONFIG', `${key} must be a positive number, got ${value}`);
    }
  }
  for (const [descriptor, altitude] of Object.entries(config.altitudeTable)) {
    if (!Number.isFinite(altitude) || altitude <= 0) {
      throw new AgentError('INVALID_CONFIG', `altitudeTable.${descriptor} must be a positive number, got ${altitude}`);
    }
  }
  for (const key of ['base', 'min', 'max'] as const) {
    const value = config.autoDuration[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new AgentError('INVALID_CONFIG', `autoDuration.${key} must be a positive number, got ${value}`);
    }
  }
  if (config.autoDuration.min > config.autoDuration.max) {
    throw new AgentError(
      'INVALID_CONFIG',
      `autoDuration.min (${config.autoDuration.min}) is above autoDuration.max (${config.autoDuration.max})`,
    );
  }
  if (!Number.isFinite(config.ambiguityRatio) || config.ambiguityRatio <= 0 || config.ambiguityRatio > 1) {
    throw new AgentError('INVALID_CONFIG', `ambiguityRatio must be within (0, 1], got ${config.ambiguityRatio}`);
  }
  for (const key of ['width', 'height'] as const) {
    const value = config[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new AgentError('INVALID_CONFIG', `${key} must be a positive integer, got ${value}`);
    }
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? Partial<T[K]> : T[K];
};

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
