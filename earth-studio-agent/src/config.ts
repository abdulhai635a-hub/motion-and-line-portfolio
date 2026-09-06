/**
 * Session configuration: frame rate, defaults, and the editable altitude table.
 * Reference: PRD 6 ("Session Config") and PRD 8 (default zoom/altitude table).
 */
import { AgentError } from './errors.ts';
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
  defaultTilt: 0,
  defaultPan: 0,
  defaultRoll: 0,
  defaultFieldOfView: 60,
  altitudeTable: { ...DEFAULT_ALTITUDE_TABLE },
  descriptorByPlaceKind: { ...DEFAULT_DESCRIPTOR_BY_PLACE_KIND },
  ambiguityRatio: 0.6,
};

/** Deep-merges a partial override onto the defaults and validates the result. */
export function makeConfig(overrides: DeepPartial<SessionConfig> = {}): SessionConfig {
  const config: SessionConfig = {
    ...DEFAULT_CONFIG,
    ...stripUndefined(overrides),
    altitudeTable: { ...DEFAULT_CONFIG.altitudeTable, ...stripUndefined(overrides.altitudeTable ?? {}) },
    descriptorByPlaceKind: {
      ...DEFAULT_CONFIG.descriptorByPlaceKind,
      ...stripUndefined(overrides.descriptorByPlaceKind ?? {}),
    },
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
