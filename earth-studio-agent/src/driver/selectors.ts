/**
 * Every reference to the Earth Studio UI lives in this file.
 *
 * PRD 11 asks for exactly this: "Isolate all selectors/field references in one
 * config module; version-check on each run." When Google changes the interface,
 * this is the only file that needs editing - or the only file that needs to be
 * replaced at run time via `--selectors my-selectors.json`.
 *
 * Each field lists candidate selectors in priority order. The driver uses the
 * first one present on the page and reports which candidate it matched, so a
 * layout change shows up as a named mismatch rather than a silent no-op.
 */

export interface FieldSelectors {
  /** Candidate CSS selectors, best first. */
  candidates: string[];
  /** Shown in errors and in the layout report. */
  label: string;
  /** False for fields the agent can run without (roll, field of view). */
  required: boolean;
}

export interface EarthStudioSelectors {
  /** Bumped whenever these selectors are re-verified against the live product. */
  version: string;
  /** Date the selectors were last checked, ISO yyyy-mm-dd. */
  verifiedOn: string;
  /** Present once the editor has finished loading. */
  appReady: FieldSelectors;
  /** The timeline's current-frame box. */
  currentFrame: FieldSelectors;
  camera: {
    latitude: FieldSelectors;
    longitude: FieldSelectors;
    altitude: FieldSelectors;
    pan: FieldSelectors;
    tilt: FieldSelectors;
    roll: FieldSelectors;
    fieldOfView: FieldSelectors;
  };
}

export type CameraFieldName = keyof EarthStudioSelectors['camera'];

export const CAMERA_FIELD_ORDER: CameraFieldName[] = [
  'latitude',
  'longitude',
  'altitude',
  'pan',
  'tilt',
  'roll',
  'fieldOfView',
];

/**
 * Defaults.
 *
 * Google Earth Studio ships no public API and no stable published DOM contract,
 * so these are candidate selectors, not guaranteed ones. Run
 * `earth-studio-agent verify-layout` against a signed-in session before the
 * first real run: it prints which candidate matched each field and which fields
 * need a new selector.
 */
export const DEFAULT_SELECTORS: EarthStudioSelectors = {
  version: '1.0.0',
  verifiedOn: 'unverified',
  appReady: {
    label: 'editor root',
    required: true,
    candidates: ['[data-earth-studio-app]', 'earth-studio-app', '#app-container', 'body'],
  },
  currentFrame: {
    label: 'current frame',
    required: true,
    candidates: [
      '[data-attribute="currentFrame"] input',
      'input[data-attribute="currentFrame"]',
      '#timeline-current-frame input',
      'input[aria-label="Current frame"]',
    ],
  },
  camera: {
    latitude: {
      label: 'camera latitude',
      required: true,
      candidates: [
        '[data-attribute="latitude"] input',
        'input[data-attribute="latitude"]',
        '#camera-position-latitude input',
        'input[aria-label="Latitude"]',
      ],
    },
    longitude: {
      label: 'camera longitude',
      required: true,
      candidates: [
        '[data-attribute="longitude"] input',
        'input[data-attribute="longitude"]',
        '#camera-position-longitude input',
        'input[aria-label="Longitude"]',
      ],
    },
    altitude: {
      label: 'camera altitude',
      required: true,
      candidates: [
        '[data-attribute="altitude"] input',
        'input[data-attribute="altitude"]',
        '#camera-position-altitude input',
        'input[aria-label="Altitude"]',
      ],
    },
    pan: {
      label: 'camera pan',
      required: false,
      candidates: ['[data-attribute="pan"] input', 'input[data-attribute="pan"]', 'input[aria-label="Pan"]'],
    },
    tilt: {
      label: 'camera tilt',
      required: false,
      candidates: ['[data-attribute="tilt"] input', 'input[data-attribute="tilt"]', 'input[aria-label="Tilt"]'],
    },
    roll: {
      label: 'camera roll',
      required: false,
      candidates: ['[data-attribute="roll"] input', 'input[data-attribute="roll"]', 'input[aria-label="Roll"]'],
    },
    fieldOfView: {
      label: 'camera field of view',
      required: false,
      candidates: [
        '[data-attribute="fieldOfView"] input',
        'input[data-attribute="fieldOfView"]',
        'input[aria-label="Field of View"]',
      ],
    },
  },
};

/** Validates and merges a user-supplied selector file over the defaults. */
export function mergeSelectors(overrides: unknown): EarthStudioSelectors {
  if (overrides === null || typeof overrides !== 'object') return DEFAULT_SELECTORS;
  const source = overrides as Partial<EarthStudioSelectors>;
  const camera = { ...DEFAULT_SELECTORS.camera };
  const overrideCamera = (source.camera ?? {}) as Partial<EarthStudioSelectors['camera']>;
  for (const field of CAMERA_FIELD_ORDER) {
    const value = overrideCamera[field];
    if (value !== undefined) camera[field] = { ...DEFAULT_SELECTORS.camera[field], ...value };
  }
  return {
    version: source.version ?? DEFAULT_SELECTORS.version,
    verifiedOn: source.verifiedOn ?? DEFAULT_SELECTORS.verifiedOn,
    appReady: { ...DEFAULT_SELECTORS.appReady, ...(source.appReady ?? {}) },
    currentFrame: { ...DEFAULT_SELECTORS.currentFrame, ...(source.currentFrame ?? {}) },
    camera,
  };
}
