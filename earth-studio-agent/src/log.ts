/**
 * Human-readable run log (FR5).
 *
 * "Produce a human-readable log of what was set at each frame, so the user can
 * verify against the Earth Studio timeline."
 */
import type { CameraPath, ResolvedStep, Warning } from './types.ts';
import type { DriveReport, LayoutReport } from './driver/earth-studio-driver.ts';

export function renderPathLog(path: CameraPath): string {
  const lines: string[] = [];

  lines.push('Earth Studio camera path');
  lines.push('='.repeat(72));
  lines.push('');
  lines.push('Command');
  for (const line of path.command.split(/\r?\n/)) lines.push(`  > ${line}`);
  lines.push('');
  lines.push(
    `Project   ${path.width}x${path.height} at ${path.frameRate}fps, ` +
      `${path.totalFrames} frames, ${path.durationSeconds.toFixed(3)}s`,
  );
  lines.push(`Generated ${path.generatedAt}`);
  lines.push('');

  lines.push('Steps');
  lines.push(`  ${'#'.padStart(2)}  ${'action'.padEnd(8)}  ${'place'.padEnd(24)}  ${'altitude'.padStart(14)}  ${'seconds'.padStart(8)}  why`);
  for (const step of path.steps) {
    lines.push(
      `  ${String(step.index).padStart(2)}  ${step.action.padEnd(8)}  ${placeLabel(step).padEnd(24)}  ` +
        `${formatMetres(step.altitude).padStart(14)}  ${step.duration.toFixed(2).padStart(8)}  ` +
        `altitude=${step.altitudeSource}, duration=${step.durationSource}`,
    );
  }
  lines.push('');

  lines.push('Keyframes (each row is one keyframe to create on the timeline)');
  lines.push(
    `  ${'frame'.padStart(6)}  ${'time'.padStart(9)}  ${'step'.padStart(4)}  ${'latitude'.padStart(12)}  ` +
      `${'longitude'.padStart(12)}  ${'altitude m'.padStart(14)}  ${'pan'.padStart(6)}  ${'tilt'.padStart(6)}  ` +
      `${'roll'.padStart(6)}  ${'fov'.padStart(6)}  label`,
  );
  for (const keyframe of path.keyframes) {
    const { camera } = keyframe;
    lines.push(
      `  ${String(keyframe.frame).padStart(6)}  ${`${keyframe.time.toFixed(3)}s`.padStart(9)}  ` +
        `${String(keyframe.stepIndex).padStart(4)}  ${camera.latitude.toFixed(6).padStart(12)}  ` +
        `${camera.longitude.toFixed(6).padStart(12)}  ${camera.altitude.toFixed(2).padStart(14)}  ` +
        `${camera.pan.toFixed(1).padStart(6)}  ${camera.tilt.toFixed(1).padStart(6)}  ` +
        `${camera.roll.toFixed(1).padStart(6)}  ${fieldOfViewCell(path, camera.fieldOfView)}  ${keyframe.label}`,
    );
  }
  if (!path.writeFieldOfView) {
    lines.push("  fov is left as the project has it - name one (\"field of view 30\") to set it.");
  }

  const warnings = path.warnings;
  if (warnings.length > 0) {
    lines.push('');
    lines.push('Warnings');
    for (const warning of warnings) lines.push(`  ! ${formatWarning(warning)}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** The lens is only ours to report when the command asked for one. */
function fieldOfViewCell(path: CameraPath, value: number): string {
  return (path.writeFieldOfView ? value.toFixed(1) : '-').padStart(6);
}

export function formatWarning(warning: Warning): string {
  const where = warning.stepIndex === undefined ? '' : `step ${warning.stepIndex}: `;
  return `[${warning.code}] ${where}${warning.message}`;
}

export function renderLayoutReport(report: LayoutReport): string {
  const lines: string[] = [
    `Selector set ${report.version} (verified ${report.verifiedOn})`,
    report.ok ? 'All required fields were found.' : `Missing required fields: ${report.missing.join(', ')}`,
    '',
  ];
  for (const field of report.fields) {
    const status = field.matched === null ? (field.required ? 'MISSING ' : 'absent  ') : 'ok      ';
    const detail = field.matched ?? field.note ?? `tried ${field.candidates.length} candidates`;
    lines.push(`  ${status}${field.label.padEnd(22)} ${detail}`);
  }
  return lines.join('\n');
}

export function renderDriveReport(report: DriveReport): string {
  const lines: string[] = [`Wrote ${report.applied} of ${report.total} keyframes into Earth Studio.`];
  for (const result of report.results) {
    const fields = Object.entries(result.written)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ');
    lines.push(
      `  ${result.ok ? 'ok  ' : 'FAIL'} frame ${String(result.frame).padStart(6)}  step ${result.stepIndex}  ` +
        `${result.label}${fields === '' ? '' : `  [${fields}]`}`,
    );
    if (result.error !== undefined) lines.push(`       ${result.error}`);
    if (result.skipped.length > 0) lines.push(`       skipped optional fields: ${result.skipped.join(', ')}`);
  }
  if (report.failures.length > 0) {
    lines.push('');
    lines.push(`${report.failures.length} keyframe(s) failed - see the FAIL rows above.`);
  }
  return lines.join('\n');
}

/** frame,latitude,longitude,altitude,pan,tilt,roll,fov - one row per keyframe. */
export function renderCsv(path: CameraPath): string {
  const rows = ['frame,time,step,latitude,longitude,altitude,pan,tilt,roll,fieldOfView,label'];
  for (const keyframe of path.keyframes) {
    const { camera } = keyframe;
    rows.push(
      [
        keyframe.frame,
        keyframe.time,
        keyframe.stepIndex,
        camera.latitude,
        camera.longitude,
        camera.altitude,
        camera.pan,
        camera.tilt,
        camera.roll,
        camera.fieldOfView,
        JSON.stringify(keyframe.label),
      ].join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}

function placeLabel(step: ResolvedStep): string {
  return step.place === null ? '(none)' : step.place.name;
}

function formatMetres(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} m`;
}
