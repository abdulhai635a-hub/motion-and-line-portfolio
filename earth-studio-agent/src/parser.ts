/**
 * Command Parser (PRD 6, FR1).
 *
 * Turns a free-form instruction such as
 *
 *   Start from space, zoom into Japan.
 *   Hold for 3 seconds.
 *   Then fly to Mount Fuji and zoom in close.
 *
 * into an ordered list of ParsedStep. The grammar is deliberately forgiving
 * (PRD 7): every field is optional except that a step must end up with either a
 * place of its own or a predecessor to inherit one from.
 *
 * Pipeline per clause, in this order (the order matters):
 *   1. explicit altitude   ("zoom to 500 meters")
 *   2. duration            ("hold for 3 seconds")
 *   3. "at/to <level>"     ("at street level")
 *   4. place phrase        ("into Japan")
 *   5. action verb and any bare descriptor left over ("zoom in close")
 */
import type { ActionKind, ParsedStep, ZoomDescriptor } from './types.ts';
import { AgentError } from './errors.ts';
import { multiWordPlaceNames } from './geocode/gazetteer.ts';

/**
 * Place names whose own punctuation would otherwise be read as a clause break.
 * The gazetteer supplies the ones it knows ("Washington, D.C."); these cover
 * countries with "and" in the name that the table does not carry.
 */
const EXTRA_PROTECTED_PLACES = [
  'antigua and barbuda',
  'saint kitts and nevis',
  'saint vincent and the grenadines',
  'sao tome and principe',
  'turks and caicos islands',
  'wallis and futuna',
];

/** Longest first, so "Paris, Texas" is matched before "Paris". */
const PROTECTED_PLACES: string[] = [...multiWordPlaceNames(), ...EXTRA_PROTECTED_PLACES].sort(
  (a, b) => b.length - a.length,
);

const WORD_NUMBERS: Record<string, number> = {
  half: 0.5,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  couple: 2, few: 3,
};

const SECONDS_PER_UNIT: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  min: 60, mins: 60, minute: 60, minutes: 60,
  hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};

const METRES_PER_UNIT: Record<string, number> = {
  m: 1, meter: 1, meters: 1, metre: 1, metres: 1,
  km: 1000, kilometer: 1000, kilometers: 1000, kilometre: 1000, kilometres: 1000,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  mi: 1609.344, mile: 1609.344, miles: 1609.344,
};

/** Longest phrase first, so "country level" wins over "country". */
const DESCRIPTOR_PATTERNS: Array<[RegExp, ZoomDescriptor]> = [
  [/\b(?:outer\s+space|space|global|globe|orbit|orbital|planet|whole\s+earth)\b/, 'space'],
  [/\b(?:country|national|nation)(?:[\s-]*level)?\b/, 'country'],
  [/\b(?:region|regional|state|province|county)(?:[\s-]*level)?\b/, 'region'],
  [/\b(?:city|town|metro|urban)(?:[\s-]*level)?\b/, 'city'],
  [/\b(?:street|road|ground|rooftop)(?:[\s-]*level)?\b/, 'street'],
  [/\b(?:close[\s-]?up|closeup|really\s+close|very\s+close|super\s+close|tight|landmark|building)(?:[\s-]*level)?\b/, 'close'],
  [/\bclose\b/, 'close'],
];

/** Only these keywords may follow "at"/"to" and be read as a zoom level. */
const DESCRIPTOR_AFTER_PREPOSITION =
  /\b(?:at|to)\s+(?:the\s+)?((?:outer\s+space|space|global|globe|orbit|orbital|country|national|region|regional|state|province|county|city|town|metro|urban|street|road|ground|rooftop|close[\s-]?up|closeup|close|landmark|building)(?:[\s-]*level)?)\b/;

const ACTION_PATTERNS: Array<[RegExp, ActionKind]> = [
  [/\b(?:hold|wait|stay|pause|linger|freeze|remain|sit)\b/, 'hold'],
  [/\b(?:zoom\s*out|pull\s*(?:out|back|away)|back\s*out|zoom\s*back|widen)\b/, 'zoom_out'],
  [/\b(?:zoom\s*(?:in|into|to)?|dive|push\s*in|descend|close\s*in)\b/, 'zoom_in'],
  [/\b(?:pan|rotate|swing|turn)\b/, 'pan_to'],
  [/\b(?:fly|go|move|travel|jump|cut|head|navigate|transition|sweep|glide)\b/, 'fly_to'],
  [/\b(?:start|begin|open|starting|beginning)\b/, 'start'],
];

/**
 * Prepositions that can introduce a place phrase. "in" and "for" are excluded
 * deliberately: "zoom in close" and "hold for 3 seconds" name no place.
 */
const PLACE_PREPOSITION = /\b(?:to|into|onto|over|at|from|towards?|above|on|near|around)\s+/;

/** A word that ends the place phrase when it follows one ("Japan from above"). */
const PLACE_TAIL_BOUNDARY = /\s+\b(?:from|for|at|in|over|with|until|while|then|during|so)\b/;

/** Removed before the "whatever is left must be a place" fallback. */
const FILLER_WORDS = new Set([
  'then', 'and', 'the', 'a', 'an', 'now', 'next', 'after', 'that', 'this',
  'please', 'lets', 'let', 'us', 'we', 'i', 'camera', 'view', 'shot', 'it',
  'there', 'here', 'slowly', 'quickly', 'smoothly', 'gently', 'straight',
  'down', 'up', 'in', 'out', 'of', 'level', 'for', 'to', 'into', 'at', 'on',
  'over', 'from', 'above', 'back', 'again',
]);

/** "tilt 45", "tilt to 30 degrees". */
const TILT_NUMBER = /\btilt(?:ed)?\s+(?:to\s+)?(-?[0-9]+(?:\.[0-9]+)?)\s*(?:deg|degs|degree|degrees)?\b/;
/** Phrases that name an angle without a number. */
const TILT_PHRASES: Array<[RegExp, number]> = [
  [/\b(?:top[\s-]?down|straight[\s-]down|overhead|nadir|bird'?s?[\s-]?eye)\b/, 0],
  [/\b(?:angled|oblique|cinematic|dramatic|tilted)\b/, 45],
  [/\b(?:horizon|horizontal|eye[\s-]?level)\b/, 80],
];

/** "field of view 30", "fov 24", "wide angle". */
const FOV_NUMBER = /\b(?:field[\s-]of[\s-]view|fov|lens)\s+(?:of\s+)?([0-9]+(?:\.[0-9]+)?)\s*(?:deg|degree|degrees)?\b/;
const FOV_PHRASES: Array<[RegExp, number]> = [
  [/\bwide[\s-]?angle\b/, 90],
  [/\b(?:telephoto|narrow[\s-]?angle)\b/, 20],
];

/** "slowly" and "quickly" scale whatever duration is chosen. */
const SPEED_PHRASES: Array<[RegExp, number]> = [
  [/\b(?:very\s+slowly|really\s+slowly)\b/, 2.2],
  [/\b(?:slowly|slow|gently|gradually|leisurely)\b/, 1.6],
  [/\b(?:very\s+quickly|really\s+fast)\b/, 0.4],
  [/\b(?:quickly|quick|fast|rapidly|snap|snappy|briskly)\b/, 0.6],
];

/** Sentinel that stands in for a dot that must not split a sentence. */
const DOT_GUARD = '~d0t~';

export interface ParseResult {
  steps: ParsedStep[];
  /** Clauses understood as nothing at all, so the CLI can warn instead of skipping silently. */
  ignored: string[];
}

export function parseCommand(command: string): ParseResult {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new AgentError('EMPTY_COMMAND', 'The command is empty.', {
      hint: 'Describe the camera move, e.g. "zoom into Japan, hold 3 seconds, then fly to Mount Fuji".',
    });
  }

  // "1,500 meters" must not be split on its own thousands separator.
  const withoutThousands = command.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const { text, restore } = protectAndPlaces(withoutThousands);
  const steps: ParsedStep[] = [];
  const ignored: string[] = [];
  /** Modifiers read before any step existed, waiting for the first one. */
  const pending: ClauseFields[] = [];

  for (const sentence of splitSentences(text)) {
    let mergeTarget: ParsedStep | null = null;
    for (const rawClause of splitClauses(sentence)) {
      const clause = restore(rawClause).trim();
      if (clause === '') continue;
      const result = parseClause(clause);
      if (result === null) {
        ignored.push(clause);
        continue;
      }
      if (result.kind === 'modifier') {
        // An angle or a pace on its own belongs to the step beside it - the one
        // in this sentence, else the last one written. Said before any step at
        // all ("slowly. fly to Rome."), it waits for the first one.
        const target = mergeTarget ?? steps.at(-1) ?? null;
        if (target === null) pending.push(result.fields);
        else mergeInto(target, result.fields);
        continue;
      }
      const parsed = result.step;
      // A clause naming no place describes the previous clause of the same
      // sentence ("fly to Mount Fuji and zoom in close"). A hold always stands
      // alone, because it is a separate span of time.
      if (
        mergeTarget !== null &&
        parsed.placeQuery === null &&
        parsed.action !== 'hold' &&
        mergeTarget.action !== 'hold'
      ) {
        mergeInto(mergeTarget, parsed);
        continue;
      }
      const step: ParsedStep = { ...parsed, index: steps.length + 1 };
      for (const waiting of pending) backfill(step, waiting);
      pending.length = 0;
      steps.push(step);
      mergeTarget = step;
    }
  }

  if (steps.length === 0) {
    throw new AgentError('NO_STEPS_PARSED', 'No camera steps could be read from the command.', {
      detail: ignored.length > 0 ? `Unrecognised text: ${ignored.join(' | ')}` : undefined,
      hint: 'Name at least one place and one action, e.g. "fly to Rome and zoom in close".',
    });
  }
  return { steps, ignored };
}

/** Folds a modifier clause into the step it describes. */
function mergeInto(target: ParsedStep, extra: ClauseFields): void {
  if (extra.zoom !== null) target.zoom = extra.zoom;
  if (extra.altitudeMeters !== null) target.altitudeMeters = extra.altitudeMeters;
  if (extra.durationSeconds !== null) target.durationSeconds = extra.durationSeconds;
  if (extra.tiltDegrees !== null) target.tiltDegrees = extra.tiltDegrees;
  if (extra.fieldOfViewDegrees !== null) target.fieldOfViewDegrees = extra.fieldOfViewDegrees;
  if (extra.speedScale !== null) target.speedScale = extra.speedScale;
  if (target.action === 'start') {
    // "start from space and zoom in" is still a start.
  } else if (extra.action === 'zoom_in' || extra.action === 'zoom_out') {
    // On a move, the trailing zoom names the target level; the move stays the
    // action. Anywhere else the explicit zoom verb wins.
    if (target.action !== 'fly_to' && target.action !== 'pan_to') {
      target.action = extra.action;
    }
  }
  target.source = `${target.source} + ${extra.source}`;
}

/** Like mergeInto, but the step's own words win over a modifier that preceded it. */
function backfill(target: ParsedStep, extra: ClauseFields): void {
  if (target.tiltDegrees === null) target.tiltDegrees = extra.tiltDegrees;
  if (target.fieldOfViewDegrees === null) target.fieldOfViewDegrees = extra.fieldOfViewDegrees;
  if (target.speedScale === null) target.speedScale = extra.speedScale;
  target.source = `${extra.source} + ${target.source}`;
}

/** Masks multi-word place names so clause splitting keeps them whole. */
function protectAndPlaces(command: string): { text: string; restore: (value: string) => string } {
  const found: string[] = [];
  let text = command;
  for (const place of PROTECTED_PLACES) {
    const pattern = new RegExp(escapeForRegExp(place).replace(/(?:\\\s)+/g, '\\s+'), 'gi');
    text = text.replace(pattern, (match) => {
      found.push(match);
      return `~p${found.length - 1}~`;
    });
  }
  const restore = (value: string): string =>
    value.replace(/~p(\d+)~/g, (_, index: string) => found[Number(index)] ?? '');
  return { text, restore };
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s/g, '\\s');
}

const ABBREVIATIONS = /\b(mt|st|ste|ft|dr|mr|mrs|ms|jr|sr|ave|blvd|rd|no|vs)\.(?=\s|$)/gi;

export function splitSentences(text: string): string[] {
  // Protect decimals ("3.5 seconds"), abbreviations ("Mt. Fuji") and initials
  // ("U.S.A.") from the sentence splitter.
  const guarded = text
    .replace(ABBREVIATIONS, (_, word: string) => `${word}${DOT_GUARD}`)
    .replace(/\b([A-Za-z])\.(?=[A-Za-z])/g, (_, letter: string) => `${letter}${DOT_GUARD}`)
    .replace(/(?<=\d)\.(?=\d)/g, DOT_GUARD);
  return guarded
    .split(/[.;!?\n\r\t]+/)
    .map((part) => part.split(DOT_GUARD).join('.').trim())
    .filter((part) => part !== '');
}

export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/,|\s+\band\s+then\b\s+|\s+\band\b\s+|\s+\bthen\b\s+|\s+\bafter\s+that\b\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** Everything a clause can say, minus which step it belongs to. */
type ClauseFields = Omit<ParsedStep, 'index' | 'action'> & { action?: ActionKind };

/**
 * What one clause turned out to be: a step of its own, or a change to the step
 * beside it ("tilt 45", "slowly"), which names no move and cannot stand alone.
 */
type ClauseResult = { kind: 'step'; step: Omit<ParsedStep, 'index'> } | { kind: 'modifier'; fields: ClauseFields };

/** Parses a single clause, or returns null when it carries no camera meaning. */
function parseClause(clause: string): ClauseResult | null {
  const source = clause;
  let working = ` ${clause.toLowerCase().replace(/\s+/g, ' ')} `;

  // Tilt and lens come first: their numbers would otherwise be read as an
  // altitude or a duration.
  const tilt = extractTilt(working);
  working = tilt.rest;

  const fieldOfView = extractFieldOfView(working);
  working = fieldOfView.rest;

  const speed = extractSpeed(working);
  working = speed.rest;

  const altitude = extractAltitude(working);
  working = altitude.rest;

  const duration = extractDuration(working);
  working = duration.rest;

  let zoom: ZoomDescriptor | null = null;

  const prepositional = working.match(DESCRIPTOR_AFTER_PREPOSITION);
  if (prepositional) {
    zoom = readDescriptorExact(prepositional[1] ?? '');
    working = working.replace(DESCRIPTOR_AFTER_PREPOSITION, ' ');
  }

  // The action verb is read before the place phrase is taken out: the fallback
  // place extractor works token by token and would otherwise split a two-word
  // verb such as "pull back" across a place and a leftover.
  const verbAction = readVerb(working);

  const place = extractPlace(working);
  working = place.rest;
  let placeQuery = place.value;

  // A "place" that is really a zoom level ("start from space").
  if (placeQuery !== null) {
    const asDescriptor = readDescriptorExact(placeQuery);
    if (asDescriptor !== null) {
      zoom = zoom ?? asDescriptor;
      placeQuery = null;
    }
  }

  if (zoom === null) zoom = readDescriptor(working);

  const action = verbAction ?? readAction(working, placeQuery !== null, zoom);
  const fields: ClauseFields = {
    placeQuery,
    zoom,
    altitudeMeters: altitude.value,
    durationSeconds: duration.value,
    tiltDegrees: tilt.value,
    fieldOfViewDegrees: fieldOfView.value,
    speedScale: speed.value,
    source,
  };
  if (action !== null) return { kind: 'step', step: { ...fields, action } };

  // No move, but an angle, a lens or a pace: "fly to Rome, tilt 45" splits on
  // the comma, and the second half is a change to the first, not rubbish.
  const setsCamera = tilt.value !== null || fieldOfView.value !== null || speed.value !== null;
  if (setsCamera && placeQuery === null) return { kind: 'modifier', fields };
  return null;
}

function extractTilt(text: string): { value: number | null; rest: string } {
  const numbered = text.match(TILT_NUMBER);
  if (numbered) {
    const value = Number.parseFloat(numbered[1] ?? '');
    if (Number.isFinite(value)) return { value, rest: text.replace(numbered[0], ' ') };
  }
  for (const [pattern, degrees] of TILT_PHRASES) {
    const match = text.match(pattern);
    if (match) return { value: degrees, rest: text.replace(match[0], ' ') };
  }
  return { value: null, rest: text };
}

function extractFieldOfView(text: string): { value: number | null; rest: string } {
  const numbered = text.match(FOV_NUMBER);
  if (numbered) {
    const value = Number.parseFloat(numbered[1] ?? '');
    if (Number.isFinite(value) && value > 0) return { value, rest: text.replace(numbered[0], ' ') };
  }
  for (const [pattern, degrees] of FOV_PHRASES) {
    const match = text.match(pattern);
    if (match) return { value: degrees, rest: text.replace(match[0], ' ') };
  }
  return { value: null, rest: text };
}

function extractSpeed(text: string): { value: number | null; rest: string } {
  for (const [pattern, scale] of SPEED_PHRASES) {
    const match = text.match(pattern);
    if (match) return { value: scale, rest: text.replace(match[0], ' ') };
  }
  return { value: null, rest: text };
}

const ALTITUDE_UNITS = Object.keys(METRES_PER_UNIT).sort((a, b) => b.length - a.length).join('|');
const ALTITUDE_STRICT = new RegExp(
  `\\b(?:to|at|of|altitude|height|elevation)\\s+(?:an?\\s+)?([0-9][0-9,.]*)\\s*(${ALTITUDE_UNITS})\\b`,
);
const ALTITUDE_LOOSE = new RegExp(`\\b([0-9][0-9,.]*)\\s*(${ALTITUDE_UNITS})\\b`);
const ALTITUDE_CUE = /\b(?:zoom|altitude|height|elevation|climb|descend|rise)\b/;

function extractAltitude(text: string): { value: number | null; rest: string } {
  const match = text.match(ALTITUDE_STRICT) ?? (ALTITUDE_CUE.test(text) ? text.match(ALTITUDE_LOOSE) : null);
  if (!match) return { value: null, rest: text };
  const amount = Number.parseFloat((match[1] ?? '').replace(/,/g, ''));
  const factor = METRES_PER_UNIT[match[2] ?? ''];
  if (!Number.isFinite(amount) || factor === undefined) return { value: null, rest: text };
  return { value: round(amount * factor, 3), rest: text.replace(match[0], ' ') };
}

const DURATION_UNITS = Object.keys(SECONDS_PER_UNIT).sort((a, b) => b.length - a.length).join('|');
const WORD_NUMBER_KEYS = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|');
const DURATION_RE = new RegExp(
  // The optional article covers "half a second" and "a couple of seconds".
  `\\b(?:for|over|during|in|lasting|of)?\\s*(?:(${WORD_NUMBER_KEYS})(?:\\s+of)?(?:\\s+an?)?|([0-9][0-9,.]*))\\s*(${DURATION_UNITS})\\b`,
);

function extractDuration(text: string): { value: number | null; rest: string } {
  const match = text.match(DURATION_RE);
  if (!match) return { value: null, rest: text };
  const amount =
    match[1] !== undefined
      ? WORD_NUMBERS[match[1]]
      : Number.parseFloat((match[2] ?? '').replace(/,/g, ''));
  const factor = SECONDS_PER_UNIT[match[3] ?? ''];
  if (amount === undefined || !Number.isFinite(amount) || factor === undefined) {
    return { value: null, rest: text };
  }
  return { value: round(amount * factor, 3), rest: text.replace(match[0], ' ') };
}

function extractPlace(text: string): { value: string | null; rest: string } {
  const match = PLACE_PREPOSITION.exec(text);
  if (match?.index !== undefined) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const boundary = after.match(PLACE_TAIL_BOUNDARY);
    const phraseRaw = boundary?.index === undefined ? after : after.slice(0, boundary.index);
    const tail = boundary?.index === undefined ? '' : after.slice(boundary.index);
    const phrase = cleanPlace(phraseRaw);
    if (phrase !== null) return { value: phrase, rest: `${before} ${tail} ` };
  }
  return fallbackPlace(text);
}

/** No preposition: whatever is not filler, a verb or a level must be the place. */
function fallbackPlace(text: string): { value: string | null; rest: string } {
  const kept: string[] = [];
  const consumed: string[] = [];
  for (const token of text.split(/\s+/)) {
    const bare = token.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (bare === '') continue;
    if (
      FILLER_WORDS.has(bare) ||
      /^[\d.,]+$/.test(bare) ||
      isActionWord(bare) ||
      readDescriptorExact(bare) !== null
    ) {
      kept.push(token);
    } else {
      consumed.push(token);
    }
  }
  const phrase = cleanPlace(consumed.join(' '));
  if (phrase === null) return { value: null, rest: text };
  return { value: phrase, rest: ` ${kept.join(' ')} ` };
}

function isActionWord(word: string): boolean {
  return ACTION_PATTERNS.some(([pattern]) => pattern.test(` ${word} `));
}

function cleanPlace(raw: string): string | null {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s',.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/[\s,.-]+$/g, '')
    .trim();
  if (cleaned === '' || !/\p{L}/u.test(cleaned)) return null;
  return cleaned;
}

function readDescriptor(text: string): ZoomDescriptor | null {
  for (const [pattern, descriptor] of DESCRIPTOR_PATTERNS) {
    if (pattern.test(text)) return descriptor;
  }
  return null;
}

/** Like readDescriptor, but the whole string must be the descriptor phrase. */
function readDescriptorExact(text: string): ZoomDescriptor | null {
  const normalised = text.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [pattern, descriptor] of DESCRIPTOR_PATTERNS) {
    if (new RegExp(`^(?:the\\s+)?${pattern.source}$`).test(normalised)) return descriptor;
  }
  return null;
}

/** The first action verb present in the clause, if any. */
function readVerb(text: string): ActionKind | null {
  for (const [pattern, action] of ACTION_PATTERNS) {
    if (pattern.test(text)) return action;
  }
  return null;
}

/** Falls back to an implied action when the clause names no verb. */
function readAction(text: string, hasPlace: boolean, zoom: ZoomDescriptor | null): ActionKind | null {
  const verb = readVerb(text);
  if (verb !== null) return verb;
  if (hasPlace) return 'fly_to';
  if (zoom !== null) return 'zoom_in';
  return null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
