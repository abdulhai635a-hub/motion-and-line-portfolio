/**
 * Experimental Earth Studio project writer - Option B from PRD 4.2.
 *
 * READ THIS BEFORE RELYING ON IT.
 *
 * Earth Studio's .esp project format is undocumented. Its 3D Camera Export is
 * export-only, and there is no published "import these keyframes" contract. The
 * structure below is therefore inferred, not verified: the PRD rates Option B as
 * low reliability and recommends the browser driver (Option A) instead, and this
 * agent follows that recommendation. This writer exists so the option can be
 * trialled cheaply - open the file in Earth Studio and see - without blocking
 * the supported path. If Earth Studio rejects the file, that is the expected
 * failure mode, not a bug in the rest of the agent.
 *
 * Everything the file contains is derived from the same CameraPath that drives
 * Option A, so nothing is lost by ignoring this module entirely.
 */
import type { CameraPath } from './types.ts';

export interface EspKeyframe {
  time: number;
  value: number;
  /** Linear in v1; PRD 11 keeps easing out of scope until the basics are proven. */
  transitionIn: { type: 'linear' };
  transitionOut: { type: 'linear' };
}

export interface EspAttribute {
  type: 'number';
  value: number;
  keyframes: EspKeyframe[];
}

export interface EspProject {
  __generatedBy: string;
  __warning: string;
  projectType: 'earthstudio';
  name: string;
  width: number;
  height: number;
  frameRate: number;
  numFrames: number;
  currentFrame: number;
  scenes: Array<{
    name: string;
    startFrame: number;
    duration: number;
    attributes: {
      cameraPositionAbsolute: {
        type: 'group';
        attributes: {
          latitude: EspAttribute;
          longitude: EspAttribute;
          altitude: EspAttribute;
        };
      };
      cameraRotation: {
        type: 'group';
        attributes: {
          pan: EspAttribute;
          tilt: EspAttribute;
          roll: EspAttribute;
        };
      };
      fieldOfView: EspAttribute;
    };
    trackPoints: [];
  }>;
}

/** Builds the project object. Callers should write it as JSON with a .esp name. */
export function buildEspProject(path: CameraPath, name = 'Generated camera path'): EspProject {
  const lastFrame = Math.max(1, path.totalFrames - 1);
  // Earth Studio stores keyframe times normalised across the scene, so frames
  // are mapped onto 0..1 here. This is one of the inferred parts of the format.
  const attribute = (pick: (keyframe: CameraPath['keyframes'][number]) => number): EspAttribute => ({
    type: 'number',
    value: pick(path.keyframes[0] ?? emptyKeyframe()),
    keyframes: path.keyframes.map((keyframe) => ({
      time: Number((keyframe.frame / lastFrame).toFixed(6)),
      value: pick(keyframe),
      transitionIn: { type: 'linear' as const },
      transitionOut: { type: 'linear' as const },
    })),
  });

  return {
    __generatedBy: 'earth-studio-agent 1.0.0',
    __warning:
      'Experimental. The .esp format is undocumented (PRD 4.2); if Earth Studio ' +
      'will not open this file, use the browser driver (Option A) instead.',
    projectType: 'earthstudio',
    name,
    width: path.width,
    height: path.height,
    frameRate: path.frameRate,
    numFrames: path.totalFrames,
    currentFrame: 0,
    scenes: [
      {
        name,
        startFrame: 0,
        duration: path.totalFrames,
        attributes: {
          cameraPositionAbsolute: {
            type: 'group',
            attributes: {
              latitude: attribute((keyframe) => keyframe.camera.latitude),
              longitude: attribute((keyframe) => keyframe.camera.longitude),
              altitude: attribute((keyframe) => keyframe.camera.altitude),
            },
          },
          cameraRotation: {
            type: 'group',
            attributes: {
              pan: attribute((keyframe) => keyframe.camera.pan),
              tilt: attribute((keyframe) => keyframe.camera.tilt),
              roll: attribute((keyframe) => keyframe.camera.roll),
            },
          },
          fieldOfView: attribute((keyframe) => keyframe.camera.fieldOfView),
        },
        trackPoints: [],
      },
    ],
  };
}

function emptyKeyframe(): CameraPath['keyframes'][number] {
  return {
    frame: 0,
    time: 0,
    stepIndex: 1,
    label: 'empty',
    camera: { latitude: 0, longitude: 0, altitude: 1, pan: 0, tilt: 0, roll: 0, fieldOfView: 60 },
  };
}
