/**
 * Error model. FR6 requires the agent to say exactly which step failed and why,
 * instead of skipping it silently, so every failure carries a machine-readable
 * code and (where known) the 1-based step index it belongs to.
 */

export type ErrorCode =
  | 'EMPTY_COMMAND'
  | 'COMMAND_FILE_UNREADABLE'
  | 'SELECTOR_FILE_UNREADABLE'
  | 'DRIVER_LAUNCH_FAILED'
  | 'NO_STEPS_PARSED'
  | 'NO_PLACE_FOR_STEP'
  | 'PLACE_NOT_FOUND'
  | 'GEOCODER_UNAVAILABLE'
  | 'AMBIGUOUS_PLACE'
  | 'INVALID_DURATION'
  | 'INVALID_ALTITUDE'
  | 'INVALID_CONFIG'
  | 'DRIVER_NOT_INSTALLED'
  | 'DRIVER_LAYOUT_MISMATCH'
  | 'DRIVER_FIELD_WRITE_FAILED'
  | 'DRIVER_FRAME_SEEK_FAILED'
  | 'DRIVER_NOT_READY';

export class AgentError extends Error {
  readonly code: ErrorCode;
  /** 1-based step index, when the failure belongs to a specific step. */
  readonly stepIndex?: number;
  /** Extra context shown under the message in CLI output. */
  readonly detail?: string;
  /** What the user can do about it. */
  readonly hint?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: { stepIndex?: number; detail?: string; hint?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AgentError';
    this.code = code;
    this.stepIndex = options.stepIndex;
    this.detail = options.detail;
    this.hint = options.hint;
  }

  /** Multi-line rendering used by the CLI and the run log. */
  format(): string {
    const where = this.stepIndex === undefined ? '' : ` (step ${this.stepIndex})`;
    const lines = [`[${this.code}]${where} ${this.message}`];
    if (this.detail) lines.push(`  detail: ${this.detail}`);
    if (this.hint) lines.push(`  hint:   ${this.hint}`);
    return lines.join('\n');
  }
}

/** True when `value` is an AgentError, without relying on instanceof across realms. */
export function isAgentError(value: unknown): value is AgentError {
  return value instanceof AgentError;
}
