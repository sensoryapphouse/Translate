// THE TWO CELLS THAT SAY "MATHS STARTS HERE", IN ONE PLACE.
//
// BANA's Nemeth code switch indicators: dots 456-146 opens, dots 456-156 closes.
// They were typed separately in translate.mjs and mode-detect.mjs, so a change
// to one would have been invisible to the other (2026-09-02, the audit). This
// module has no other job and imports nothing, so anything may take it -
// including a Node tool that must not pull the browser app in with it.
const D = (str) => str.split(/\s+/).filter(Boolean)
  .map((d) => String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0))).join('');

export const NEM_OPEN = D('456 146');
export const NEM_CLOSE = D('456 156');
