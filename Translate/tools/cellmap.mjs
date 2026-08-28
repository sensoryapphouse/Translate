// BLAST-RADIUS lookup — every meaning the standards give a cell (or cell
// sequence), collected BEFORE a fix is written, so one meaning is never
// repaired by silently breaking another. Born of the vertical-bar saga
// (open |x|, close |f|_a, unpaired dy/dx|_{x=1} — three fixes where one
// enumeration would have done) and the ⠨⠼-italic mistake (§130's # was in
// the inventory all along).
//
// Sources searched:
//   • tools/rules/inventory.json — the 456 audited rule statements
//   • nemeth-symbol-table.js     — the generated Nemeth symbol repertoire
//   • connector/ueb-symbols.mjs  — the UEB symbol repertoire
//
// Run: node connector/tools/cellmap.mjs ⠳ [⠸⠴ …]
//      (each argument is matched against indicators, statements and tables)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'inventory.json'), 'utf8'));
const { NEMETH_SYMBOLS } = require(path.resolve(__dirname, '../../nemeth-symbol-table.js'));
const { UEB_SYMBOLS } = await import(path.resolve(__dirname, '../ueb-symbols.mjs'));

const queries = process.argv.slice(2).filter((a) => /[⠀-⣿]/.test(a));
if (!queries.length) {
  console.error('usage: node connector/tools/cellmap.mjs <cells> [<cells> …]');
  process.exit(1);
}

for (const q of queries) {
  console.log(`\n═══ ${q} ═══`);
  let hits = 0;

  console.log('— rule statements —');
  for (const area of inv.areas) {
    for (const r of area.rules || []) {
      const inInd = (r.indicators || []).some((ind) => ind.includes(q) || q.includes(ind) && ind.length > 1);
      const inText = (r.statement || '').includes(q) || (r.pattern || '').includes(q);
      if (inInd || inText) {
        hits++;
        console.log(`  [${r.ref}] ${String(r.statement || '').slice(0, 150)}`);
      }
    }
  }

  console.log('— Nemeth symbol table —');
  for (const [cells, tex] of NEMETH_SYMBOLS) {
    if (cells.includes(q)) { hits++; console.log(`  ${cells} → ${JSON.stringify(tex)}`); }
  }

  console.log('— UEB symbol table —');
  for (const [cells, tex] of UEB_SYMBOLS) {
    if (cells.includes(q)) { hits++; console.log(`  ${cells} → ${JSON.stringify(tex)}`); }
  }

  if (!hits) console.log('  (no mention anywhere — a genuinely novel sequence)');
}
