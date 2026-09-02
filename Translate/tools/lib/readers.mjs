// WHICH READERS AN INSTRUMENT SCORES.
//
// The Translate audit (2026-09-02) found bench, curriculum and roundtrip all
// scoring the older readers (V1) while the app showed a hybrid decision built
// on the newer pair - a gate that was green for code the app does not run.
// Every instrument now asks here, and the default is the decision the app
// ships. MATHS_IMPL selects:
//   hybrid  the app's decision (maths-hybrid.mjs)          - the default, the gate
//   v1      the older pair alone (ueb-maths-to-latex.mjs, nemeth-to-latex.js)
//   v2      the newer pair alone, raw (ueb-rules.mjs, nemeth-rules.mjs)
// The three read the same input shape and answer { latex, warnings, ... }.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const MATHS_IMPLS = ['hybrid', 'v1', 'v2'];

export async function pickReaders(impl = process.env.MATHS_IMPL || 'hybrid') {
  if (!MATHS_IMPLS.includes(impl)) throw new Error(`MATHS_IMPL must be one of ${MATHS_IMPLS.join(', ')}, not "${impl}"`);
  const v1Nemeth = require(path.resolve(HERE, '../../../nemeth-to-latex.js'));
  const { uebMathsToLatex } = await import('../../ueb-maths-to-latex.mjs');
  if (impl === 'v1') return { impl, ueb: uebMathsToLatex, nemeth: v1Nemeth.convert };
  const { uebMathsToLatexV2 } = await import('../../ueb-rules.mjs');
  const { nemethMathsToLatexV2 } = await import('../../nemeth-rules.mjs');
  if (impl === 'v2') return { impl, ueb: uebMathsToLatexV2, nemeth: nemethMathsToLatexV2 };
  globalThis.NemethToLatex = v1Nemeth;           // the classic script's global, as the app has it
  const { uebHybrid, nemethHybrid } = await import('../../maths-hybrid.mjs');
  return { impl, ueb: uebHybrid, nemeth: nemethHybrid };
}
