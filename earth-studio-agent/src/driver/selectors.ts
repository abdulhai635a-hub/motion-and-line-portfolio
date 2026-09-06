/**
 * Every reference to the Earth Studio UI lives in this file.
 *
 * PRD 11 asks for exactly this: "Isolate all selectors/field references in one
 * config module; version-check on each run." When Google changes the interface,
 * this is the only file that needs editing - or the only file that needs
 * replacing at run time via `--selectors my-selectors.json`.
 *
 * These are not guesses. They were read off a live, signed-in session with
 * `earth-studio-agent probe`, which reported the attribute rows, their units
 * and the transport controls; `verifiedOn` below says when. The shape found
 * there is:
 *
 *   li.attribute[data-attribute-type="latitude"]
 *     span.title                        "Latitude"
 *     span.actions
 *       span.value
 *         span.scrub-input.valueInput   <- click to edit
 *           span.presentedValueContainer > span.presentedValue   "29.323"
 *           span.unit[title="Degrees"]                           "deg"
 *       button[data-action="click:addKeyframe"]
 *
 * Longitude and the rotations also carry a `span.scrub-input.rotationInput` for
 * whole turns, which is why the widget is named explicitly rather than taken by
 * position.
 */
import type { CameraState } from '../types.ts';

export type CameraFieldName = keyof CameraState;

export interface FieldSelectors {
  /** Candidate CSS selectors, best first. */
  candidates: string[];
  /** Shown in errors and in the layout report. */
  label: string;
  /** False for fields the agent can run without. */
  required: boolean;
}

/** One camera attribute row, as Earth Studio builds it. */
export interface AttributeSelector {
  label: string;
  /** The row's data-attribute-type, e.g. "rotationX" for Pan. */
  attributeType: string;
  /** Which widget in the row carries the value. */
  widget: string;
  /** Whether the agent's number is metres (altitude) or plain degrees. */
  plannedUnit: 'metres' | 'degrees';
  required: boolean;
}

export interface PlayheadSelectors {
  /** The frame/timecode readout; clicking it toggles between the two formats. */
  readout: FieldSelectors;
  jumpStart: FieldSelectors;
  forward: FieldSelectors;
  backward: FieldSelectors;
}

export interface EarthStudioSelectors {
  /** Bumped whenever these selectors are re-verified against the live product. */
  version: string;
  /** Date the selectors were last checked against a live session, ISO yyyy-mm-dd. */
  verifiedOn: string;
  appReady: FieldSelectors;
  playhead: PlayheadSelectors;
  camera: Record<CameraFieldName, AttributeSelector>;
}

export const CAMERA_FIELD_ORDER: CameraFieldName[] = [
  'latitude',
  'longitude',
  'altitude',
  'pan',
  'tilt',
  'roll',
  'fieldOfView',
];

const VALUE_WIDGET = '.scrub-input.valueInput';

export const DEFAULT_SELECTORS: EarthStudioSelectors = {
  version: '2.0.0',
  verifiedOn: '2026-09-06',
  appReady: {
    label: 'attribute panel',
    required: true,
    // The attribute list is the thing the driver actually needs; a body match
    // would say nothing, which is how an earlier version passed on a page that
    // had not loaded the editor at all.
    candidates: ['[data-attribute-type="latitude"]', '.attribute-list', '.timeline-attributes'],
  },
  playhead: {
    readout: {
      label: 'timecode readout',
      required: true,
      candidates: ['li.control.timecode', '.playback-controls .timecode', '[data-value="model.timecode"]'],
    },
    jumpStart: {
      label: 'jump to start',
      required: false,
      candidates: ['[data-action="click:jumpWorkspaceStart"]'],
    },
    forward: {
      label: 'next frame',
      required: false,
      candidates: ['[data-action="click:forward"]'],
    },
    backward: {
      label: 'previous frame',
      required: false,
      candidates: ['[data-action="click:backward"]'],
    },
  },
  camera: {
    latitude: { label: 'camera latitude', attributeType: 'latitude', widget: VALUE_WIDGET, plannedUnit: 'degrees', required: true },
    longitude: { label: 'camera longitude', attributeType: 'longitude', widget: VALUE_WIDGET, plannedUnit: 'degrees', required: true },
    altitude: { label: 'camera altitude', attributeType: 'altitude', widget: VALUE_WIDGET, plannedUnit: 'metres', required: true },
    // Earth Studio names the rotations by axis: X is Pan, Y is Tilt, Z is Roll.
    pan: { label: 'camera pan', attributeType: 'rotationX', widget: VALUE_WIDGET, plannedUnit: 'degrees', required: false },
    tilt: { label: 'camera tilt', attributeType: 'rotationY', widget: VALUE_WIDGET, plannedUnit: 'degrees', required: false },
    roll: { label: 'camera roll', attributeType: 'rotationZ', widget: VALUE_WIDGET, plannedUnit: 'degrees', required: false },
    fieldOfView: { label: 'camera field of view', attributeType: 'fov', widget: VALUE_WIDGET, plannedUnit: 'degrees', required: false },
  },
};

/** The row a camera field lives in. */
export function rowSelector(attribute: AttributeSelector): string {
  return `[data-attribute-type="${attribute.attributeType}"]`;
}

/** The clickable value widget of a camera field. */
export function widgetSelector(attribute: AttributeSelector): string {
  return `${rowSelector(attribute)} ${attribute.widget}`;
}

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

  const playhead = { ...DEFAULT_SELECTORS.playhead };
  const overridePlayhead = (source.playhead ?? {}) as Partial<PlayheadSelectors>;
  for (const key of ['readout', 'jumpStart', 'forward', 'backward'] as const) {
    const value = overridePlayhead[key];
    if (value !== undefined) playhead[key] = { ...DEFAULT_SELECTORS.playhead[key], ...value };
  }

  return {
    version: source.version ?? DEFAULT_SELECTORS.version,
    verifiedOn: source.verifiedOn ?? DEFAULT_SELECTORS.verifiedOn,
    appReady: { ...DEFAULT_SELECTORS.appReady, ...(source.appReady ?? {}) },
    playhead,
    camera,
  };
}
