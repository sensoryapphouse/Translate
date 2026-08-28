import {nemethMathsToLatexV2} from './nemeth-rules.mjs';

const padNemethSwitches = (str) => str.split('⠸⠩').join('  ').split('⠸⠱').join('  ');

const nemethHybrid = (s) => {
  let r1 = { latex: ' a ', spans: [] };
  let r2 = nemethMathsToLatexV2(s);

  if (r2 && (!r2.badCells || r2.badCells.length === 0)) {
    const r2LatexClean = r2.latex.replace(/\\phantom\{\}/g, '');
    if (r2LatexClean === r1.latex || r1.latex === null) {
      return r2;
    } else {
      r1.uncertain = true;
      r1.v2_latex = r2.latex;
    }
  }
  return r1;
};

const res = nemethHybrid('⠸⠩ ⠼⠁ ⠸⠱');
console.log('Hybrid result spans:', res.spans);

const mergedSpans = [];
let mGroup = null;
for (const sp of res.spans) {
  if (!mGroup) mGroup = { c0: sp.c0, c1: sp.c1, t0: sp.t0, t1: sp.t1 };
  else {
    if (mGroup.c1 === sp.c0 && mGroup.t1 === sp.t0) {
      mGroup.c1 = sp.c1;
      mGroup.t1 = sp.t1;
    } else {
      mergedSpans.push(mGroup);
      mGroup = { c0: sp.c0, c1: sp.c1, t0: sp.t0, t1: sp.t1 };
    }
  }
}
if (mGroup) mergedSpans.push(mGroup);

const isBalanced = (str) => {
  let b = 0, p = 0;
  for (const c of str) {
    if (c === '{') b++; else if (c === '}') b--;
    if (c === '(') p++; else if (c === ')') p--;
    if (b < 0 || p < 0) return false;
  }
  return b === 0 && p === 0;
};

const wordGroups = [];
let currentGroup = null;
for (const sp of mergedSpans) {
  if (!currentGroup) {
    currentGroup = { c0: sp.c0, c1: sp.c1, t0: sp.t0, t1: sp.t1 };
  } else {
    currentGroup.c1 = sp.c1;
    currentGroup.t1 = sp.t1;
  }
  const frag = res.latex.slice(currentGroup.t0, currentGroup.t1);
  if (isBalanced(frag)) {
    wordGroups.push(currentGroup);
    currentGroup = null;
  }
}
if (currentGroup) wordGroups.push(currentGroup);

console.log('wordGroups:', wordGroups);

