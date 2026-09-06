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
 * Metres represented by one unit of the edit box, worked out by comparing the
 * edit box's own text with the rounded value shown beside it.
 *
 * `displayed` and `editBox` are the two numbers as read from the page;
 * `unitTitle` is the unit label's tooltip, e.g. "Kilometers".
 */
export function metresPerEditUnit(unitTitle: string, displayed: number, editBox: number): number {
  const perDisplay = metresPerDisplayUnit(unitTitle);
  if (!Number.isFinite(displayed) || !Number.isFinite(editBox) || displayed === 0) {
    // Nothing to compare against: the edit box almost certainly matches the
    // display, which is what Earth Studio was observed to do for latitude.
    return perDisplay;
  }
  const ratio = Math.abs(editBox / displayed);
  if (ratio >= 0.5 && ratio <= 2) return perDisplay;
  if (ratio >= 500 && ratio <= 2000) return perDisplay / 1000;
  if (ratio >= 1 / 2000 && ratio <= 1 / 500) return perDisplay * 1000;
  return perDisplay;
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
