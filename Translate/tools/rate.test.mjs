// THE GATE'S OWN ARITHMETIC — does the ratchet actually hold?
//
// TR-17 of the 15 Oct 2026 audit. check.mjs compared Math.round(n / of * 100),
// so a score had to lose a whole percentage point before the gate objected.
// The audit's own example: Nemeth faithful at 623/735 rounds to 85%, and so
// does 622/735, so a case that had been correct could go missing and the
// battery would still come back green.
//
// WHY THESE CASES. The acceptance asked for three - a one-case decrease at the
// same denominator, a genuine improvement, and corpus growth - and each case
// here is also run under the OLD rounded rule, because a test that only shows
// the new rule working would not show what was wrong with the old one. The
// REAL figures from this repo are used rather than invented ones: 623/735 is
// the audit's case, 452/481 is the independent set, 59/60 the school set.
//
// Run: node Translate/tools/rate.test.mjs
import { compareRates, pctRound, pctExact, scoreText, roundingBlindSpot } from './rate.mjs';

let pass = 0; const fails = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass += 1; console.log(`ok    ${name}`); }
  else { fails.push(name); console.log(`FAIL  ${name}${got === '' ? '' : ': ' + got}`); }
};
// The rule this file replaces, kept verbatim so the comparison is real and not
// a paraphrase of what I remember it doing.
const OLD_RULE = (cur, old) => Math.round(cur.n / cur.of * 100) - Math.round(old.n / old.of * 100);

console.log('one case lost, same denominator — the audit\'s own case');
{
  const was = { n: 623, of: 735 }, now = { n: 622, of: 735 };
  ok('the exact gate calls it a regression', compareRates(now, was) === -1, compareRates(now, was));
  ok('...and the old rounded gate did NOT', OLD_RULE(now, was) === 0, OLD_RULE(now, was));
  ok('both still display as 85%', pctRound(was) === 85 && pctRound(now) === 85,
     `${pctRound(was)} / ${pctRound(now)}`);
  ok('the message shows the counts, so the drop is visible at all',
     scoreText(was) === '623/735 (84.76%)' && scoreText(now) === '622/735 (84.63%)',
     `${scoreText(was)} -> ${scoreText(now)}`);
}

console.log('\none case lost on the independent set, where the band is widest');
{
  const was = { n: 452, of: 481 }, now = { n: 451, of: 481 };
  ok('a regression', compareRates(now, was) === -1);
  ok('...invisible to the old rule', OLD_RULE(now, was) === 0);
  // The old gate recorded this metric as 94 out of 100. That is the fault
  // underneath TR-17 on this tool: the counts were never written down.
  const asRecorded = { n: 94, of: 100 };
  ok('and invisible even after losing two, as the baseline used to store it',
     OLD_RULE({ n: 450, of: 481 }, asRecorded) === 0, OLD_RULE({ n: 450, of: 481 }, asRecorded));
}

console.log('\na genuine improvement must not be mistaken for a regression');
{
  ok('one more correct case', compareRates({ n: 624, of: 735 }, { n: 623, of: 735 }) === 1);
  ok('an unchanged score is neither', compareRates({ n: 623, of: 735 }, { n: 623, of: 735 }) === 0);
  ok('a big improvement', compareRates({ n: 700, of: 735 }, { n: 623, of: 735 }) === 1);
}

console.log('\ncorpus growth — the reason the gate compares rates and not counts');
{
  // 14 cases added, 11 of them correct: more right answers, worse rate. The
  // new cases have to land BELOW the standing rate of 84.76% for that to be
  // true - at 12 of 14 the rate rises to 84.78% and it is an improvement, which
  // is what this case got wrong the first time I wrote it.
  const was = { n: 623, of: 735 }, now = { n: 634, of: 749 };
  ok('more correct cases but a WORSE rate is a regression',
     compareRates(now, was) === -1, `${scoreText(was)} -> ${scoreText(now)}`);
  // Same rate exactly, at a bigger denominator: 623/735 doubled.
  ok('the identical rate at double the corpus is not a regression',
     compareRates({ n: 1246, of: 1470 }, was) === 0);
  // Growth that keeps improving.
  ok('growth with a better rate is an improvement',
     compareRates({ n: 640, of: 749 }, was) === 1, scoreText({ n: 640, of: 749 }));
  // A corpus that SHRANK while the rate held.
  ok('a smaller corpus at the same rate is not a regression',
     compareRates({ n: 249, of: 294 }, { n: 415, of: 490 }) === 0);
}

console.log('\nthe blind spot, measured per metric');
{
  ok('623/735 could lose 1 case unnoticed', roundingBlindSpot({ n: 623, of: 735 }) === 1,
     roundingBlindSpot({ n: 623, of: 735 }));
  ok('452/481 could lose 2', roundingBlindSpot({ n: 452, of: 481 }) === 2,
     roundingBlindSpot({ n: 452, of: 481 }));
  // The school set is small enough that one case moves it 1.67 points, so the
  // old rule happened to be exact there. Luck, not design - and it would stop
  // being true the moment the set passed 100 cases.
  ok('59/60 could lose none — the school set was exact by luck',
     roundingBlindSpot({ n: 59, of: 60 }) === 0, roundingBlindSpot({ n: 59, of: 60 }));
  ok('a percentage stored out of 100 could lose none, which is why it looked safe',
     roundingBlindSpot({ n: 94, of: 100 }) === 0);
}

console.log('\nscores that are not scores are refused, not scored');
{
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  // A DENOMINATOR OF ZERO IS NOT A PERFECT SCORE. A metric that measured
  // nothing must not compare equal to one that measured everything.
  ok('zero cases is an error, not 100%',
     throws(() => compareRates({ n: 0, of: 0 }, { n: 623, of: 735 })));
  ok('a count above the denominator is an error',
     throws(() => compareRates({ n: 10, of: 5 }, { n: 1, of: 5 })));
  ok('a negative count is an error', throws(() => compareRates({ n: -1, of: 5 }, { n: 1, of: 5 })));
  ok('a fractional count is an error — a scraped percentage is not a count',
     throws(() => compareRates({ n: 84.76, of: 100 }, { n: 85, of: 100 })));
  ok('a missing side is an error', throws(() => compareRates({ n: 1, of: 2 }, undefined)));
}

console.log('\ndisplay still reads the way it always did');
{
  ok('the table keeps whole percentages', pctRound({ n: 623, of: 735 }) === 85);
  ok('an exact figure is not padded with noise', pctExact({ n: 60, of: 60 }) === '100');
  ok('...but a hidden difference is spelled out', pctExact({ n: 622, of: 735 }) === '84.63');
}

console.log(`\n${pass}/${pass + fails.length} checks passed`);
process.exit(fails.length ? 1 : 0);
