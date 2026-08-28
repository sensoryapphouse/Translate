// Browser ESM wrapper around the liblouis WASM engine.
// Tables are fetched and written into the in-memory FS at /tables. The glue
// (liblouis-wasm.js) is loaded as a classic <script>, exposing globalThis.createLiblouis.

// The include-closure for the UEB tables (engine/ueb-table-closure.txt).
const TABLE_FILES = [
  'braille-patterns.cti', 'en-ueb-chardefs.uti', 'en-ueb-g1.ctb', 'en-ueb-g2.ctb',
  'en-ueb-math.ctb', 'en-us-brf.dis', 'latinLetterDef6Dots.uti',
  'latinUppercaseComp6.uti', 'spaces.uti', 'text_nabcc.dis', 'unicode.dis',
];

export const TABLES = {
  uebG2: '/tables/en-us-brf.dis,/tables/en-ueb-g2.ctb',   // contracted (Grade 2)
  uebG1: '/tables/en-us-brf.dis,/tables/en-ueb-g1.ctb',   // uncontracted (Grade 1)
};

let M = null;
let baseUrl = '';                    // remembered from init, for ensureTables
const present = new Set();           // table files written into the wasm FS

export async function init({ tablesBaseUrl, wasmFactory } = {}) {
  if (M) return version();
  const factory = wasmFactory || globalThis.createLiblouis;
  if (!factory) throw new Error('liblouis-wasm.js not loaded (globalThis.createLiblouis missing)');
  M = await factory();
  baseUrl = tablesBaseUrl || '';
  try { M.FS.mkdir('/tables'); } catch { /* exists */ }
  await Promise.all(TABLE_FILES.map(async (name) => {
    const res = await fetch(`${tablesBaseUrl}/${name}`);
    if (!res.ok) throw new Error(`table fetch failed: ${name} (${res.status})`);
    M.FS.writeFile(`/tables/${name}`, new Uint8Array(await res.arrayBuffer()));
    present.add(name);
  }));
  const cs = M.ccall('lou_charSize', 'number', [], []);
  if (cs !== 2) throw new Error(`liblouis charSize ${cs}, expected 2`);
  return version();
}

// THE ENGINE ONLY KNOWS THE TABLES IT WAS GIVEN (user report, 2026-08-19).
// init() writes the eleven UEB files above and nothing else, so selecting any
// other braille code asked liblouis to compile a table that was not in its
// filesystem: lou_backTranslateString failed, the app's bt() swallowed the
// throw and returned '', and the print pane went blank with no message. The
// 476 tables ship and serve — they were simply never handed to the engine.
//
// ensureTables() fetches a table and, RECURSIVELY, everything it `include`s:
// a liblouis table is a graph, not a file (afr-za-g1.ctb includes en-ueb-g1.ctb,
// which includes en-ueb-chardefs.uti, en-ueb-math.ctb and braille-patterns.cti),
// and one missing leaf fails the whole compile exactly as a missing root does.
// Files already present are skipped, so a second selection of the same code
// costs nothing and an offline reselect works from the service worker's cache.
// Throws — callers must decide what to do about a code that cannot be loaded,
// and the one thing they must not do is silently show an empty document.
const INCLUDE_RE = /^\s*include\s+(\S+)/gim;

export async function ensureTables(tableList) {
  if (!M) throw new Error('call init() first');
  const queue = String(tableList).split(',')
    .map((p) => p.trim().replace(/^\/tables\//, ''))
    .filter(Boolean);
  const seen = new Set();
  const fetched = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (present.has(name)) continue;
    const res = await fetch(`${baseUrl}/${name}`);
    if (!res.ok) throw new Error(`table fetch failed: ${name} (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    M.FS.writeFile(`/tables/${name}`, bytes);
    present.add(name);
    fetched.push(name);
    // Includes are named relative to the tables directory, so the name in the
    // directive is the name to fetch. Decoded as UTF-8 only to read them; the
    // bytes written above are untouched.
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    for (const m of text.matchAll(INCLUDE_RE)) queue.push(m[1]);
  }
  return fetched;                    // what this call had to go and get
}

export function version() { return M.ccall('lou_version', 'string', [], []); }

// liblouis typeform (emphasis) bit values for the `formtype` buffer. Legacy
// liblouis convention (still the values the UEB emphasis classes map to):
// italic=1, underline=2, bold=4. Verify with a live emphasis test before relying on it.
export const TYPEFORM = { plain: 0, italic: 1, underline: 2, bold: 4 };

// Translate `text` -> BRF. `typeform`, if given, is an array (one entry per input
// character) of TYPEFORM bit flags; liblouis emits the UEB emphasis indicators.
// Passing no typeform keeps the exact previous behaviour (6th arg 0).
export function translate(text, tableList = TABLES.uebG2, typeform = null) {
  if (!M) throw new Error('call init() first');
  if (!text) return '';
  const inLen = text.length;
  // Grow the output buffer and retry if liblouis fills it exactly — a full buffer
  // means the braille may have been silently TRUNCATED (data loss). Braille rarely
  // exceeds ~3x the input, so the initial 6x+1024 almost never retries. All
  // buffers are freed in `finally` so a throw from ccall/getValue can't leak them.
  for (let mul = 6; ; mul *= 4) {
    const outCap = inLen * mul + 1024;
    const inPtr = M._malloc(Math.max(inLen, 1) * 2);
    const outPtr = M._malloc(outCap * 2);
    const inLenPtr = M._malloc(4);
    const outLenPtr = M._malloc(4);
    let typePtr = 0;
    try {
      for (let i = 0; i < inLen; i++) M.setValue(inPtr + i * 2, text.charCodeAt(i), 'i16');
      M.setValue(inLenPtr, inLen, 'i32');
      M.setValue(outLenPtr, outCap, 'i32');
      if (typeform) {                                            // formtype = unsigned short
        typePtr = M._malloc(Math.max(inLen, outCap) * 2);
        for (let i = 0; i < inLen; i++) {
          const val = typeof typeform === 'number' ? typeform : (typeform[i] || 0);
          M.setValue(typePtr + i * 2, val, 'i16');
        }
      }
      const rc = M.ccall('lou_translateString', 'number',
        ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [tableList, inPtr, inLenPtr, outPtr, outLenPtr, typePtr, 0, 0]);
      if (!rc) throw new Error('lou_translateString failed');
      const outLen = M.getValue(outLenPtr, 'i32');
      if (outLen >= outCap && mul < 400) continue;
      if (outLen >= outCap) throw new Error('liblouis: braille output exceeded the maximum buffer (possible truncation)');               // buffer full -> retry bigger
      let out = '';
      for (let i = 0; i < outLen; i++) out += String.fromCharCode(M.getValue(outPtr + i * 2, 'i16') & 0xffff);
      return out;
    } finally {
      M._free(inPtr); M._free(outPtr); M._free(inLenPtr); M._free(outLenPtr);
      if (typePtr) M._free(typePtr);
    }
  }
}

// Translate AND return the cell→source-char map (inputPos[j] = input-char index
// that produced output cell j). Braille is identical to translate()'s. Used for
// word/cell-level print↔braille linking in the editor.
export function translatePos(text, tableList = TABLES.uebG2, typeform = null) {
  if (!M) throw new Error('call init() first');
  if (!text) return { braille: '', inputPos: [] };
  const inLen = text.length;
  for (let mul = 6; ; mul *= 4) {
    const outCap = inLen * mul + 1024;
    const inPtr = M._malloc(Math.max(inLen, 1) * 2);
    const outPtr = M._malloc(outCap * 2);
    const inLenPtr = M._malloc(4);
    const outLenPtr = M._malloc(4);
    const outPosPtr = M._malloc(Math.max(inLen, 1) * 4);
    const inPosPtr = M._malloc(outCap * 4);
    let typePtr = 0;
    try {
      for (let i = 0; i < inLen; i++) M.setValue(inPtr + i * 2, text.charCodeAt(i), 'i16');
      M.setValue(inLenPtr, inLen, 'i32');
      M.setValue(outLenPtr, outCap, 'i32');
      if (typeform) {
        typePtr = M._malloc(Math.max(inLen, outCap) * 2);
        for (let i = 0; i < inLen; i++) {
          const val = typeof typeform === 'number' ? typeform : (typeform[i] || 0);
          M.setValue(typePtr + i * 2, val, 'i16');
        }
      };
      const rc = M.ccall('lou_translate', 'number',
        ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [tableList, inPtr, inLenPtr, outPtr, outLenPtr, typePtr, 0, outPosPtr, inPosPtr, 0, 0]);
      if (!rc) throw new Error('lou_translate failed');
      const outLen = M.getValue(outLenPtr, 'i32');
      if (outLen >= outCap && mul < 400) continue;
      if (outLen >= outCap) throw new Error('liblouis: braille output exceeded the maximum buffer (possible truncation)');
      let braille = '';
      const inputPos = new Array(outLen);
      for (let j = 0; j < outLen; j++) { braille += String.fromCharCode(M.getValue(outPtr + j * 2, 'i16') & 0xffff); inputPos[j] = M.getValue(inPosPtr + j * 4, 'i32'); }
      return { braille, inputPos };
    } finally {
      M._free(inPtr); M._free(outPtr); M._free(inLenPtr); M._free(outLenPtr); M._free(outPosPtr); M._free(inPosPtr);
      if (typePtr) M._free(typePtr);
    }
  }
}

// Back-translate BRF ASCII (or Unicode braille) -> text, using the same table list
// as translate(). Used for the round-trip proofread (translate then back-translate
// should return the source). Same buffer-growth + free-in-finally discipline.
export function backTranslate(braille, tableList = TABLES.uebG2) {
  if (!M) throw new Error('call init() first');
  const inLen = braille.length;
  for (let mul = 6; ; mul *= 4) {
    const outCap = inLen * mul + 1024;
    const inPtr = M._malloc(Math.max(inLen, 1) * 2);
    const outPtr = M._malloc(outCap * 2);
    const inLenPtr = M._malloc(4);
    const outLenPtr = M._malloc(4);
    try {
      for (let i = 0; i < inLen; i++) M.setValue(inPtr + i * 2, braille.charCodeAt(i), 'i16');
      M.setValue(inLenPtr, inLen, 'i32');
      M.setValue(outLenPtr, outCap, 'i32');
      const rc = M.ccall('lou_backTranslateString', 'number',
        ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [tableList, inPtr, inLenPtr, outPtr, outLenPtr, 0, 0, 0]);
      if (!rc) throw new Error('lou_backTranslateString failed');
      const outLen = M.getValue(outLenPtr, 'i32');
      if (outLen >= outCap && mul < 400) continue;
      if (outLen >= outCap) throw new Error('liblouis: braille output exceeded the maximum buffer (possible truncation)');
      let out = '';
      for (let i = 0; i < outLen; i++) out += String.fromCharCode(M.getValue(outPtr + i * 2, 'i16') & 0xffff);
      return out;
    } finally {
      M._free(inPtr); M._free(outPtr); M._free(inLenPtr); M._free(outLenPtr);
    }
  }
}
