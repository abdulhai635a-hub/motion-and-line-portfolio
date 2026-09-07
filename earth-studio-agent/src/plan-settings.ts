/**
 * What a plan says about the project it belongs to, and what it says beside it.
 *
 * Kept apart from the agent module on purpose: this is imported by the browser
 * extension, and the agent module reaches the Playwright driver, which cannot
 * be bundled for a page.
 */
import { makeConfig, type DeepPartial, type SessionConfig } from './config.ts';
import type { ProjectSettings } from './keyframe-row.ts';
import type { Warning } from './types.ts';

/** Folds a plan's own project settings into the caller's, saying what changed. */
export function applyProjectSettings(
  base: DeepPartial<SessionConfig>,
  project: ProjectSettings | undefined,
): { config: DeepPartial<SessionConfig>; warnings: Warning[] } {
  if (project === undefined) return { config: base, warnings: [] };
  const warnings: Warning[] = [];
  const config: DeepPartial<SessionConfig> = { ...base };
  const effective = makeConfig(base);
  if (project.frameRate !== undefined && project.frameRate !== effective.frameRate) {
    warnings.push({
      code: 'PROJECT_FROM_COMMAND',
      message: `The plan asks for ${project.frameRate} fps, so that is what the frames are counted in.`,
    });
    config.frameRate = project.frameRate;
  }
  if (project.width !== undefined && project.height !== undefined) {
    if (project.width !== effective.width || project.height !== effective.height) {
      warnings.push({
        code: 'PROJECT_FROM_COMMAND',
        message: `The plan asks for ${project.width}x${project.height}; set that in Earth Studio's project settings.`,
      });
    }
    config.width = project.width;
    config.height = project.height;
  }
  return { config, warnings };
}

/** One line about the prose beside a keyframe table, rather than one per clause. */
export function noteWarnings(notes: string[]): Warning[] {
  if (notes.length === 0) return [];
  const shown = notes.slice(0, 3).map((note) => `"${note.trim()}"`);
  const rest = notes.length - shown.length;
  return [
    {
      code: 'TABLE_IS_THE_SHOT',
      message:
        `The keyframe table is the whole shot, so everything beside it was read as a note: ` +
        `${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}.`,
    },
  ];
}
