import { uebMathsToLatexV2 } from './ueb-rules.mjs';

const input = '⠭⠐⠖⠼⠁'; // x+1
const res = uebMathsToLatexV2(input);
console.log('LaTeX:', res.latex);
console.log('Spans:', res.spans);
