import fs from 'fs';
import { nemethMathsToLatexV2 } from './nemeth-rules.mjs';
import { uebMathsToLatexV2 } from './ueb-rules.mjs';
import { speakAst } from './math-speech.mjs';

import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

function toBraille(ascii) {
  return brfToUnicodeBraille(ascii.toUpperCase());
}

function processFile(filename, isNemeth) {
  const content = fs.readFileSync(filename, 'utf8');
  const lines = content.split('\n').filter(l => l.trim() !== '');
  
  const results = [];
  
  for (const line of lines) {
    let cleanLine = line.trim();
    if (isNemeth) {
      if (cleanLine.startsWith('_% ')) cleanLine = cleanLine.substring(3);
      if (cleanLine.endsWith(' _:')) cleanLine = cleanLine.substring(0, cleanLine.length - 3);
    }
    
    cleanLine = cleanLine.trim();
    const unicodeBrl = toBraille(cleanLine);
    
    let res;
    if (isNemeth) {
      res = nemethMathsToLatexV2(unicodeBrl);
    } else {
      res = uebMathsToLatexV2(unicodeBrl);
    }
    
    const speech = speakAst(res.ast);
    results.push({
      ascii: cleanLine,
      unicode: unicodeBrl,
      latex: res.latex,
      speech: speech,
      warnings: res.warnings
    });
  }
  
  return results;
}

const nemethResults = processFile('./examples/nemeth-maths.brf', true);
const uebResults = processFile('./examples/ueb-maths.brf', false);

console.log('--- NEMETH EXAMPLES ---');
nemethResults.forEach((r, i) => {
  console.log(`\nExample ${i+1}: ${r.ascii}`);
  console.log(`  LaTeX : ${r.latex}`);
  console.log(`  Speech: ${r.speech}`);
  if (r.warnings.length) console.log(`  Warns : ${r.warnings.join(', ')}`);
});

console.log('\n--- UEB EXAMPLES ---');
uebResults.forEach((r, i) => {
  console.log(`\nExample ${i+1}: ${r.ascii}`);
  console.log(`  LaTeX : ${r.latex}`);
  console.log(`  Speech: ${r.speech}`);
  if (r.warnings.length) console.log(`  Warns : ${r.warnings.join(', ')}`);
});
