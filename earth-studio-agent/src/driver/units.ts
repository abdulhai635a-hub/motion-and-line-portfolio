/**
 * Unit handling for Earth Studio's value fields.
 *
 * The agent plans altitude in metres, but the editor displays it in kilometres
 * once it is large ("63170 km"), and the edit box that opens on click may use
 * either scale. Typing a planned 1500 into a field that means kilometres would
 * put the camera 1500 km up instead of 1500 m - a thousandfold error that would
 * look like the agent simply not working.
 *
 * Rather than assume, the driver reads two numbers it can see - the rounded
 * value on screen and the full-precision value in the edit box - and works out
 * the scale from their ratio. That stays correct if Earth Studio switches
 * between metres and kilometres by magnitude, and if it changes which unit the
 * edit box uses.
 */

/** Metres represented by one unit of the displayed value. */
export function metresPerDisplayUnit(unitTitle: string): number {
  const normalised = unitTitle.trim().toLowerCase();
  if (normalised.startsWith('kilomet')) return 1000;
  if (normalised.startsWith('mile')) return 1609.344;
  if (normalised.startsWith('feet') || normalised.startsWith('foot')) return 0.3048;
  return 1;
}

/**
 * Metres represented by one unit of the edit box.
 *
 * The two numbers on screen describe the same quantity: the rounded value with
 * its unit, and the full-precision value in the edit box. So if one display
 * unit is `perDisplay` metres,
 *
 *     displayed x perDisplay  =  editBox x (metres per edit unit)
 *
 * and the answer falls out. The result is snapped to a power of ten, because
 * the only real cases are the same unit or a metre/kilometre swap, and the two
 * readings differ slightly through rounding.
 *
 * Deriving it rather than assuming matters: Earth Studio labels the altitude
 * "Kilometers" at rest but "Meters" while the edit box is open, and a live run
 * that trusted the label typed a thousand times the intended altitude.
 */
export function metresPerEditUnit(unitTitle: string, displayed: number, editBox: number): number {
  const perDisplay = metresPerDisplayUnit(unitTitle);
  if (!Number.isFinite(displayed) || !Number.isFinite(editBox) || displayed === 0 || editBox === 0) {
    // Nothing to compare against; the edit box almost certainly matches the display.
    return perDisplay;
  }
  const raw = Math.abs((displayed * perDisplay) / editBox);
  if (!Number.isFinite(raw) || raw <= 0) return perDisplay;

  const snapped = 10 ** Math.round(Math.log10(raw));
  // Only trust the snap when the two readings really are the same quantity;
  // otherwise the display unit is the safer assumption.
  // The two readings describe the same quantity and differ only by display
  // rounding, so a real swap lands within a whisker of a power of ten. Half a
  // decade of slack would accept ratios that mean something else entirely.
  if (raw / snapped > 1.2 || snapped / raw > 1.2) return perDisplay;
  // A real unit swap is a metre/kilometre one at most. A wilder factor means
  // the two numbers are not the same quantity - a stale readout, say - and
  // acting on it would be worse than assuming the display unit.
  const swing = snapped / perDisplay;
  if (swing < 1e-3 || swing > 1e3) return perDisplay;
  return snapped;
}

/** Parses a number as the page prints it, e.g. "63,170.48" or "-15.018". */
export function parseDisplayedNumber(text: string): number {
  const cleaned = text.replace(/[^0-9eE+.-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * How close a read-back has to be to count as correct.
 *
 * The display rounds to three decimals, so a value can never be confirmed more
 * precisely than that, whatever was typed.
 */
export function readbackTolerance(planned: number, metresPerDisplay: number): number {
  const displayRounding = 0.0005 * metresPerDisplay * 2;
  return Math.max(displayRounding, Math.abs(planned) * 1e-5);
}
