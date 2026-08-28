import { describeNemeth } from './nemeth-symbols.mjs';

function esc0(s) { return s; }

function explain(brl) {
  const parts = describeNemeth(brl);
  const code = 'Nemeth';
  const html = 
    `<span class="sb-arrow" aria-hidden="true">→</span>` +
    `<span class="sb-note" aria-hidden="true">${code}, ${[...brl].length} cell${[...brl].length === 1 ? '' : 's'}</span>` +
    parts.map((p, i) => `<span class="sb-rule c${i % 7}" aria-hidden="true">${esc0(p.cells)} = ${esc0(p.name)}</span>`).join('');
  return html;
}

console.log('⠸⠩:', explain('⠸⠩'));
console.log('⠸:', explain('⠸'));
