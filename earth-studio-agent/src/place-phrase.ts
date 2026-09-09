/**
 * Finding the place in a sentence written for a person.
 *
 * A shot list does not say "fly to Shute Creek". It says
 *
 *   What will be shown: WIDE - Shute Creek gas plant's complete industrial
 *   footprint, slow lateral pan
 *
 * and the old reading of that - everything that is not a verb or a filler word
 * must be the place - handed the geocoder the whole sentence:
 *
 *   Looked for: "show wide shute creek gas plant's complete industrial
 *   footprint not aerial orbit"
 *
 * A person does not read it that way. They see the capitals. Proper nouns are
 * what names a place in any language once it has been translated, they survive
 * translation intact, and they are short - so those are what is looked for
 * here, longest and most repeated first, with the generic word a plan hangs off
 * them ("gas plant", "facility") tried and then dropped.
 */

/** Words that are capitalised in a brief without naming anywhere. */
const NOT_A_PLACE = new Set([
  // Labels a brief hangs on its lines.
  'what', 'type', 'link', 'place', 'project', 'note', 'notes', 'shot', 'scene',
  'easing', 'source', 'format', 'duration', 'keyframe', 'frame', 'camera',
  // Shot sizes and moves.
  'wide', 'mid', 'close', 'closeup', 'cu', 'ecu', 'ext', 'int', 'pov', 'ls', 'ms',
  'pan', 'tilt', 'zoom', 'push', 'pull', 'orbit', 'reveal', 'descent', 'ascent',
  'aerial', 'lateral', 'sideward', 'slow', 'slowly', 'fast', 'quick', 'quickly',
  'very', 'gently', 'gradually', 'rapidly', 'briskly', 'smoothly', 'steady', 'controlled',
  // The tool itself, and the things a brief links to.
  'google', 'earth', 'studio', 'map', 'maps', 'youtube', 'link', 'url',
  // Sentence openers, which capitalise whatever follows a full stop.
  'the', 'a', 'an', 'this', 'that', 'then', 'from', 'to', 'at', 'in', 'on', 'it',
  'we', 'i', 'first', 'next', 'last', 'finally', 'start', 'end', 'begin', 'hold',
  'fly', 'move', 'go', 'travel', 'show', 'shown', 'shows', 'use', 'used', 'take',
  'takes', 'will', 'be', 'is', 'are', 'no', 'not', 'and', 'or', 'but', 'with',
]);

/** Generic words a plan hangs off a name, dropped when the full name fails. */
const GENERIC_TAIL = new Set([
  'plant', 'facility', 'facilities', 'site', 'station', 'terminal', 'complex',
  'works', 'factory', 'refinery', 'mine', 'field', 'area', 'region', 'district',
  'zone', 'park', 'centre', 'center', 'building', 'tower', 'bridge', 'dam',
  'airport', 'port', 'harbour', 'harbor', 'river', 'lake', 'valley', 'mountain',
]);

/** Small words that may sit inside a name without breaking it. */
const JOINERS = new Set(['of', 'the', 'de', 'del', 'la', 'le', 'van', 'von', 'da', 'do', 'dos', 'and', 'upon']);

// A capital letter starts a name. A digit does not: "tilt 45" names an angle.
const CAPITALISED = /^\p{Lu}/u;

/**
 * True when every word in a phrase is one that names nowhere - a label, a shot
 * size, a camera move, the tool's own name. "Type: Map" and "slow sideward
 * reveal" are lines from a brief, not destinations.
 */
export function namesNowhere(phrase: string): boolean {
  const parts = words(phrase)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase())
    .filter((word) => word !== '');
  if (parts.length === 0) return true;
  // A generic word does not count here: someone who writes "fly to the mine"
  // means the mine, and it is not this function's business to disbelieve them.
  return parts.every((word) => NOT_A_PLACE.has(word) || JOINERS.has(word));
}

/**
 * The names a piece of text mentions, best first.
 *
 * "Best" is longest, then most often repeated: a brief names its subject over
 * and over, and the phrase it repeats is the one the shot is about.
 */
export function placeCandidates(text: string): string[] {
  const counts = new Map<string, number>();
  for (const phrase of capitalisedPhrases(text)) {
    for (const candidate of shorten(phrase)) {
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => words(b[0]).length - words(a[0]).length || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([candidate]) => candidate);
}

/** Runs of capitalised words, with the labels and shot jargon taken out. */
function capitalisedPhrases(text: string): string[] {
  const phrases: string[] = [];
  // Sentence and clause punctuation ends a name; a hyphen or apostrophe does not.
  for (const chunk of text.split(/[.;:,!?\n\r\t()[\]{}—–|/]+/u)) {
    let run: string[] = [];
    const flush = (): void => {
      const phrase = trim(run);
      if (phrase !== null) phrases.push(phrase);
      run = [];
    };
    for (const word of words(chunk)) {
      const bare = word.replace(/[^\p{L}\p{N}'’-]/gu, '');
      if (bare === '') continue;
      if (CAPITALISED.test(bare)) {
        run.push(bare);
        continue;
      }
      // A small joining word keeps a name together only when it is inside one.
      if (run.length > 0 && JOINERS.has(bare.toLowerCase())) {
        run.push(bare);
        continue;
      }
      // "Shute Creek gas plant" - the generic word belongs to the name too, and
      // shorten() will try the name without it.
      if (run.length > 0 && GENERIC_TAIL.has(bare.toLowerCase())) {
        run.push(bare);
        continue;
      }
      flush();
    }
    flush();
  }
  return phrases;
}

/** Drops leading and trailing words that name nothing, or returns null. */
function trim(run: string[]): string | null {
  let kept = [...run];
  while (kept.length > 0 && NOT_A_PLACE.has((kept[0] ?? '').toLowerCase())) kept = kept.slice(1);
  while (kept.length > 0 && isTrailingNoise(kept.at(-1) ?? '')) kept = kept.slice(0, -1);
  if (kept.length === 0) return null;
  // A single word that is not capitalised is a joiner left on its own.
  if (kept.every((word) => !CAPITALISED.test(word))) return null;
  return kept.join(' ');
}

function isTrailingNoise(word: string): boolean {
  const lower = word.toLowerCase();
  return NOT_A_PLACE.has(lower) || JOINERS.has(lower);
}

/**
 * A name and the shorter names inside it: "Shute Creek gas plant" is worth
 * asking about, and so is "Shute Creek" when the first one finds nothing.
 */
function shorten(phrase: string): string[] {
  const parts = words(phrase);
  const shorter: string[] = [phrase];
  let kept = [...parts];
  while (kept.length > 1 && GENERIC_TAIL.has((kept.at(-1) ?? '').toLowerCase())) {
    kept = kept.slice(0, -1);
    const candidate = kept.join(' ');
    if (!shorter.includes(candidate)) shorter.push(candidate);
  }
  return shorter;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '');
}
