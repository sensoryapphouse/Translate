// COMPARING TWO SCORES WITHOUT ROUNDING EITHER OF THEM.
//
// TR-17 of the 15 Oct 2026 audit. check.mjs compared Math.round(n / of * 100),
// so a score had to move a whole percentage point before the gate noticed.
// Nemeth faithful stood at 623/735 = 84.76%, which rounds to 85; 622/735 =
// 84.63% also rounds to 85, so losing a case that had been correct passed the
// gate in silence. A gate that cannot see one lost case is not a ratchet.
//
// The counts are integers, so the comparison needs no floating point at all:
// a/b < c/d is a*d < c*b for positive b and d. Exact, and nothing to round.
//
// Rounding stays, but only where it belongs - in the table a person reads.

/** -1 if `cur` is a worse rate than `old`, 0 if identical, 1 if better. */
export function compareRates(cur, old) {
  if (!cur || !old) throw new Error('compareRates needs two {n, of} scores');
  for (const s of [cur, old]) {
    if (!Number.isInteger(s.n) || !Number.isInteger(s.of)) {
      throw new Error(`a score must be whole counts, got ${JSON.stringify(s)}`);
    }
    // A DENOMINATOR OF ZERO IS NOT A PERFECT SCORE. It is a metric that
    // measured nothing, and the caller has to say what that means rather than
    // being handed a quiet 0 or a NaN that compares false against everything.
    if (s.of <= 0) throw new Error(`a score over ${s.of} cases cannot be a rate: ${JSON.stringify(s)}`);
    if (s.n < 0 || s.n > s.of) throw new Error(`${s.n} of ${s.of} is not a count`);
  }
  const left = cur.n * old.of;
  const right = old.n * cur.of;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The integer percentage, for the table only — never for a comparison. */
export const pctRound = (s) => Math.round(s.n / s.of * 100);

/** Enough precision to SHOW a difference the integer percentage hides. */
export const pctExact = (s) => {
  const v = s.n / s.of * 100;
  const r = Math.round(v);
  // Two decimals only when the rounded figure would tell the reader nothing,
  // which is exactly the case this module exists for.
  return Math.abs(v - r) < 0.005 ? String(r) : v.toFixed(2);
};

/** "623/735 (84.76%)" — the chain, not the rate. A bare percentage cannot
 *  distinguish a smaller corpus from a worse result. */
export const scoreText = (s) => `${s.n}/${s.of} (${pctExact(s)}%)`;

/** How many cases this score could lose before a ROUNDED comparison noticed:
 *  the blind spot the old gate had, reported so it can be quoted. */
export function roundingBlindSpot(s) {
  const p = pctRound(s);
  let lost = 0;
  while (s.n - lost - 1 >= 0 && Math.round((s.n - lost - 1) / s.of * 100) === p) lost += 1;
  return lost;
}
