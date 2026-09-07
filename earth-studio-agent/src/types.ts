/**
 * Shared domain types for the Earth Studio text-to-camera-path agent.
 * Reference: PRD v1.0 sections 5-9.
 */

/** Camera actions recognised by the command parser (PRD 7). */
export type ActionKind =
  | 'start'
  | 'fly_to'
  | 'pan_to'
  | 'zoom_in'
  | 'zoom_out'
  | 'hold';

/** Relative zoom descriptors mapped to altitudes by the table in PRD 8. */
export type ZoomDescriptor =
  | 'space'
  | 'country'
  | 'region'
  | 'city'
  | 'close'
  | 'street';

/** Coarse classification of a resolved place, used to pick a default altitude. */
export type PlaceKind = 'country' | 'region' | 'city' | 'landmark' | 'unknown';

/** One step of the user's command, before geocoding. */
export interface ParsedStep {
  /** 1-based position in the sequence. */
  index: number;
  action: ActionKind;
  /** Raw place text as typed; null means "same place as the previous step". */
  placeQuery: string | null;
  /** Relative zoom descriptor, if the user gave one. */
  zoom: ZoomDescriptor | null;
  /** Explicit altitude override in metres ("zoom to 500 meters"). */
  altitudeMeters: number | null;
  /** Explicit duration in seconds; null means "work it out from the shot". */
  durationSeconds: number | null;
  /** The level a move starts from ("push in from high orbit"), if it says. */
  fromZoom: ZoomDescriptor | null;
  /** Explicit tilt in degrees ("tilt 45"); null means "work it out". */
  tiltDegrees: number | null;
  /** Explicit field of view; null means "leave the project's lens alone". */
  fieldOfViewDegrees: number | null;
  /** "slowly" and "quickly" stretch or shorten whatever duration is chosen. */
  speedScale: number | null;
  /** The clause this step came from, kept for the human-readable log. */
  source: string;
}

/** A candidate returned by a geocoding provider. */
export interface PlaceCandidate {
  name: string;
  latitude: number;
  longitude: number;
  kind: PlaceKind;
  /** Provider-specific ranking score; higher wins. Population for the offline gazetteer. */
  score: number;
  /** Free-text disambiguation hint, e.g. "country" or "state in the United States". */
  context?: string;
}

/** The place a step was resolved to, plus the alternatives that were rejected. */
export interface GeoPlace {
  /** The text that was looked up. */
  query: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: PlaceKind;
  /** Disambiguation hint from the provider, e.g. "state in the United States". */
  context?: string;
  provider: string;
  /** 0..1. Below `ambiguityThreshold` the choice is flagged for user review (FR2). */
  confidence: number;
  /** True when a rival candidate scored close enough to be a plausible alternative. */
  ambiguous: boolean;
  /** Rejected candidates, best first. */
  alternatives: PlaceCandidate[];
}

/** A step after geocoding, with every default filled in. */
export interface ResolvedStep {
  index: number;
  action: ActionKind;
  /** null only for a `start` step that named no place (it borrows the next step's place). */
  place: GeoPlace | null;
  /** Final altitude in metres. */
  altitude: number;
  /** Final duration in seconds. */
  duration: number;
  /** How the altitude was decided, for the log. */
  altitudeSource: 'explicit' | 'descriptor' | 'place-kind' | 'inherited';
  /** How the duration was decided, for the log. */
  durationSource: 'explicit' | 'automatic' | 'default';
  /** Tilt written at this step's keyframe. */
  tilt: number;
  tiltSource: 'explicit' | 'automatic' | 'default';
  /** Field of view, when the command asked for one. */
  fieldOfView: number | null;
  zoom: ZoomDescriptor | null;
  source: string;
}

/** Full camera attribute set written at a single keyframe. */
export interface CameraState {
  latitude: number;
  longitude: number;
  /** Metres above ground. */
  altitude: number;
  /** Compass heading in degrees, 0 = north. */
  pan: number;
  /** Degrees; see README for the sign convention. 0 = looking straight down. */
  tilt: number;
  roll: number;
  fieldOfView: number;
}

/** One keyframe on the Earth Studio timeline. */
export interface Keyframe {
  /** Absolute frame number, 0-based. */
  frame: number;
  /** Frame time in seconds. */
  time: number;
  /** Which step produced this keyframe (1-based). */
  stepIndex: number;
  /** Human-readable reason this keyframe exists, e.g. "fly_to Mount Fuji (end)". */
  label: string;
  camera: CameraState;
}

/** A non-fatal issue worth showing the user (FR2, FR6). */
export interface Warning {
  code: string;
  message: string;
  stepIndex?: number;
}

/** The complete plan: the agent's canonical output. */
export interface CameraPath {
  formatVersion: 1;
  generatedAt: string;
  command: string;
  frameRate: number;
  width: number;
  height: number;
  totalFrames: number;
  durationSeconds: number;
  /**
   * Whether the field of view should be written. False unless the command asked
   * for one: a project has its own lens and overwriting it changes every shot.
   */
  writeFieldOfView: boolean;
  steps: ResolvedStep[];
  keyframes: Keyframe[];
  warnings: Warning[];
}
