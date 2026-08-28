// eBRAILLE 1.0 — read and write .ebrl, the format that remembers what BRF forgets.
//
// WHY THIS EXISTS. A Connector or BrlDuet document is MIXED: some lines are
// text, some UEB maths, some Nemeth, some music. That mode lives only in the
// app's `lineModes`; nothing in the braille cells carries it. Save to BRF,
// reload, and every mode is gone. eBraille can carry it, so eBraille is what
// Save writes (PB, 2026-08-09); BRF stays, as Export.
//
// WHAT THE SPEC GIVES US, AND WHAT IT DOES NOT (eBraille 1.0, published
// 2025-08, DAISY Board approved 2025-11 — https://daisy.github.io/ebraille/):
//
//   • The file holds ALREADY-TRANSLATED cells. "the braille is not transformed
//     on the fly but comes formatted according to the rules of the regional
//     braille code where the publication was produced." There is no translation
//     engine in the reading device to switch, so no `<math>` tag can tell one
//     to "render this bit as Nemeth" — a tempting but wrong mental model
//     borrowed from EPUB.
//   • `a11y:brailleSystem` is PUBLICATION-WIDE. Re-checked twice: "there is no
//     attribute, element class, or role defined to specify braille code at
//     document sections or individual elements."
//   • The Codes Registry cannot even NAME our central distinction: `ueb grade1`
//     and `ueb grade2` exist, but UEB maths is not distinguishable from UEB
//     literary text at any granularity.
//   • It DOES register `Nemeth no-grade math` and `Braille-music no-grade
//     music`, and it DOES permit MathML inside content documents.
//
// SO THE FILES ARE CONFORMING **AND** ENRICHED, in three layers:
//   1. CONFORMING — OCF ZIP, all thirteen required metadata items, Unicode
//      braille text, every system present declared publication-wide. Any
//      eBraille reader opens it and shows correct braille.
//   2. SEMANTIC WHERE THE SPEC ALLOWS — a maths section carries its MathML in a
//      real <math> element, so the source survives rather than being re-derived
//      from cells.
//   3. ENRICHED ONLY WHERE NOTHING ELSE EXISTS — the per-section MODE rides in
//      an HTML `class`, which is the mechanism the spec itself points at
//      ("eBraille content documents rely primarily on the HTML class and role
//      attributes"). Another reader ignores unknown classes and still gets
//      correct braille; it loses only the mode memory, which it never had.
//
// That third layer is a private convention and must be described as one. It is
// not a defect to be discovered later: it is the only way to express what PB
// asked for, because eBraille 1.0 has no vocabulary for it.

import { unzip } from './unmxl.mjs';

export const EBRAILLE_VERSION = 'eBraille 1.0';
export const EBRL_MEDIA_TYPE = 'application/epub+zip';   // OCF's, not eBraille-specific

// The app's four modes ↔ the class that carries them. Namespaced so a class we
// invent can never be confused with one a reading system defines.
const MODE_CLASS = { text: 'sah-mode-text', ueb: 'sah-mode-ueb-maths',
                     nem: 'sah-mode-nemeth', mus: 'sah-mode-music' };
const CLASS_MODE = Object.fromEntries(Object.entries(MODE_CLASS).map(([m, c]) => [c, m]));

// Registry strings, exactly as the eBraille Braille Codes Registry writes them.
// Note what is NOT here: there is no "UEB maths" value to declare, which is
// precisely why mode also has to ride in a class.
// The Nemeth switch signs, as cells. They are the one mode marker that lives
// IN the braille rather than in markup, so this module has to know them to say
// truthfully which systems a document contains. (translate.mjs names the same
// two cells; they are spec, not preference, so the duplication is stable.)
const NEM_OPEN = '⠸⠩', NEM_CLOSE = '⠸⠱';

const SYSTEM_FOR = {
  text: 'ueb grade2',
  ueb:  'ueb grade1',                    // UEB technical is written uncontracted
  nem:  'Nemeth no-grade math',
  mus:  'Braille-music no-grade music',
};

// ---------------------------------------------------------------------------
// ZIP writing. Reading is already solved — unmxl.mjs's unzip() handles stored
// and deflated entries with no dependency — so only the writer is new, and it
// writes STORED entries only. That is deliberate: OCF requires the mimetype
// entry to be stored anyway, stored archives need no compressor, and a braille
// document is small. Nothing in OCF requires deflate.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// EXPORTED because a .docx is a ZIP too (2026-08-11). Translate's Word export
// needs exactly this — stored entries, no deflate — and a second copy of a
// CRC32 table and a central directory is precisely the kind of duplicate that
// drifts apart unnoticed. One writer, two container formats.
export function zipStore(entries) {
  const enc = new TextEncoder();
  const locals = [], central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameB = enc.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0, true);             // flags
    lv.setUint16(8, 0, true);             // method 0 = stored
    lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);   // time, date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);  // compressed size
    lv.setUint32(22, data.length, true);  // uncompressed size
    lv.setUint16(26, nameB.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    locals.push(lh, data);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...central, end];
  const total = parts.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * doc = {
 *   title, creator, producer, language,   // language WITHOUT the Brai subtag
 *   identifier, modified, copyrightYear,
 *   sections: [{ mode:'text'|'ueb'|'nem'|'mus', lines:[cells…], mathml?:'<math…' }]
 * }
 */
function buildOPF(doc, systems) {
  const now = iso(doc.modified ?? Date.now());
  const year = doc.copyrightYear ?? new Date(now).getUTCFullYear();
  // dc:language MUST carry the Brai script subtag — en → en-Brai, en-US →
  // en-Brai-US. Inserting it after the primary subtag is what the spec's own
  // examples show.
  const langParts = String(doc.language || 'en').split('-');
  const lang = [langParts[0], 'Brai', ...langParts.slice(1)].join('-');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id"
         prefix="a11y: http://www.idpf.org/epub/vocab/package/a11y/# dcterms: http://purl.org/dc/terms/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${esc(doc.identifier ?? 'urn:uuid:' + fallbackId(doc))}</dc:identifier>
    <dc:title>${esc(doc.title || 'Braille document')}</dc:title>
    <dc:language>${esc(lang)}</dc:language>
    <dc:creator>${esc(doc.creator || 'Unknown')}</dc:creator>
    <dc:date>${esc(now.slice(0, 10))}</dc:date>
    <dc:format>${EBRAILLE_VERSION}</dc:format>
    <meta property="dcterms:modified">${esc(now)}</meta>
    <meta property="dcterms:dateCopyrighted">${esc(String(year))}</meta>
    <meta property="a11y:producer">${esc(doc.producer || 'Sensory App House Ltd')}</meta>
    <meta property="a11y:brailleCellType">6</meta>
${systems.map((s) => `    <meta property="a11y:brailleSystem">${esc(s)}</meta>`).join('\n')}
    <meta property="a11y:completeTranscription">false</meta>
    <meta property="a11y:tactileGraphics">none</meta>
  </metadata>
  <manifest>
    <item id="index" href="index.html" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="index"/>
  </spine>
</package>
`;
}

// A stable-enough identifier without pulling in a UUID dependency. Not a v4
// UUID and does not pretend to be: the spec requires an identifier, not a UUID.
function fallbackId(doc) {
  let h = 2166136261;
  for (const ch of JSON.stringify(doc.sections ?? [])) {
    h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0;
  }
  return 'sah-' + h.toString(16).padStart(8, '0');
}

// A LINE MAY CHANGE MODE PART-WAY, and the format already has the way to say
// so: the same sah-mode-* class, on a span instead of a section. UEB needs this
// and Nemeth does not — Nemeth writes real switch signs into the cells, so its
// mode is already IN the braille, whereas UEB maths is ordinary UEB and nothing
// on the page distinguishes it. Without this an inline UEB run survives only
// while the app is open.
//
// A plain string stays a plain string, so every document written before this
// existed is still written byte for byte the same way.
function lineHtml(line) {
  if (typeof line === 'string') return esc(line);
  return (line ?? []).map((run) => {
    const cls = run.mode && run.mode !== 'text' ? MODE_CLASS[run.mode] : null;
    return cls ? `<span class="${cls}">${esc(run.text ?? '')}</span>` : esc(run.text ?? '');
  }).join('');
}

function buildIndex(doc) {
  const body = (doc.sections ?? []).map((sec) => {
    const cls = MODE_CLASS[sec.mode] ?? MODE_CLASS.text;
    // MathML rides INSIDE the section, before the cells, where the spec permits
    // it. It is the source the braille was made from — not an instruction to a
    // reading system, which does no translating.
    const math = sec.mathml ? `    ${sec.mathml}\n` : '';
    const lines = (sec.lines ?? []).map((l) => `    <p>${lineHtml(l)}</p>`).join('\n');
    return `  <section class="${cls}">\n${math}${lines}\n  </section>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${esc(doc.title || 'Braille document')}</title>
</head>
<body>
  <nav epub:type="toc" hidden="hidden"><ol><li><a href="index.html">${esc(doc.title || 'Braille document')}</a></li></ol></nav>
${body}
</body>
</html>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

/** Build a .ebrl file. Returns a Uint8Array. */
export function writeEbraille(doc) {
  const enc = new TextEncoder();
  const modes = [...new Set((doc.sections ?? []).map((s) => s.mode))];
  // Declared in descending frequency, as the registry asks — and every system
  // PRESENT is declared, which is the honest publication-wide statement
  // available to us even though it cannot say which section is which.
  const freq = {};
  for (const s of doc.sections ?? []) freq[s.mode] = (freq[s.mode] ?? 0) + 1;
  const systems = modes.sort((a, b) => (freq[b] ?? 0) - (freq[a] ?? 0))
    .map((m) => SYSTEM_FOR[m]).filter(Boolean);
  // PRESENT MEANS PRESENT IN THE DOCUMENT, NOT IN THE SECTION MODES
  // (2026-08-19). Both of the app's INLINE mechanisms live below section
  // level, so a section stayed 'text' and the declaration named only
  // `ueb grade2`: a text line carrying a Nemeth expression — the app's own
  // Ctrl+M workflow, cells and all — published a file that told every other
  // reader there was no Nemeth in it. Our own loader was unharmed (it reads
  // the switch signs back out of the cells), which is exactly why this could
  // go unnoticed. Appended after the section systems so a document without
  // inline runs is written byte for byte as before.
  const extra = [];
  for (const sec of doc.sections ?? []) {
    for (const line of sec.lines ?? []) {
      if (typeof line === 'string') {
        // Nemeth carries its own switch signs in the cells (⠸⠩ … ⠸⠱).
        if (line.includes(NEM_OPEN) || line.includes(NEM_CLOSE)) extra.push('nem');
      } else {
        for (const run of line ?? []) {
          if (run && run.mode && run.mode !== 'text') extra.push(run.mode);
          const t = (run && run.text) || '';
          if (t.includes(NEM_OPEN) || t.includes(NEM_CLOSE)) extra.push('nem');
        }
      }
    }
  }
  const extraFreq = {};
  for (const m of extra) extraFreq[m] = (extraFreq[m] ?? 0) + 1;
  for (const m of Object.keys(extraFreq).sort((a, b) => extraFreq[b] - extraFreq[a])) {
    const sys = SYSTEM_FOR[m];
    if (sys && !systems.includes(sys)) systems.push(sys);
  }
  if (!systems.length) systems.push(SYSTEM_FOR.text);

  return zipStore([
    // MIMETYPE FIRST AND STORED — OCF requires it, and a reader that checks
    // will reject the archive outright if it is anywhere else.
    { name: 'mimetype', data: enc.encode(EBRL_MEDIA_TYPE) },
    { name: 'META-INF/container.xml', data: enc.encode(CONTAINER_XML) },
    { name: 'package.opf', data: enc.encode(buildOPF(doc, systems)) },
    { name: 'index.html', data: enc.encode(buildIndex(doc)) },
  ]);
}

/**
 * Read a .ebrl file back into a doc. Falls back gracefully: a file written by
 * some other producer has no sah-mode-* classes, so every section reads as
 * text — correct braille, no invented modes.
 */
export async function readEbraille(buffer) {
  const files = await unzip(buffer);
  const dec = new TextDecoder();
  const get = (n) => { const d = files.get(n); return d ? dec.decode(d) : null; };

  const opf = get('package.opf');
  const html = get('index.html');
  if (!html) throw new Error('not an eBraille file: no index.html in the publication root');

  const pick = (re) => { const m = opf && opf.match(re); return m ? m[1].trim() : ''; };
  const meta = {
    title: pick(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/),
    creator: pick(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/),
    producer: pick(/property="a11y:producer"[^>]*>([\s\S]*?)<\/meta>/),
    language: pick(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/).replace(/-Brai/i, ''),
    identifier: pick(/<dc:identifier[^>]*>([\s\S]*?)<\/dc:identifier>/),
    systems: [...(opf || '').matchAll(/property="a11y:brailleSystem"[^>]*>([\s\S]*?)<\/meta>/g)]
      .map((m) => m[1].trim()),
  };

  // Split one <p> into its runs. Anything that is not a mode span is text, so
  // markup this function does not know about degrades to cells rather than
  // being dropped — the same rule the section reader follows.
  const lineRuns = (html) => {
    const parts = [];
    let last = 0;
    for (const m of html.matchAll(/<span\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g)) {
      if (m.index > last) parts.push({ text: unesc(html.slice(last, m.index)) });
      const mode = CLASS_MODE[m[1].split(/\s+/).find((c) => CLASS_MODE[c])];
      parts.push({ text: unesc(m[2]), ...(mode && mode !== 'text' ? { mode } : {}) });
      last = m.index + m[0].length;
    }
    if (last < html.length) parts.push({ text: unesc(html.slice(last)) });
    return parts.length ? parts : [{ text: '' }];
  };

  const sections = [];
  for (const m of html.matchAll(/<section\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/section>/g)) {
    const cls = m[1].split(/\s+/).find((c) => CLASS_MODE[c]);
    const inner = m[2];
    const mathml = (inner.match(/<math[\s\S]*?<\/math>/) || [null])[0];
    const rawLines = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => p[1]);
    const lines = [], runs = [];
    rawLines.forEach((html) => {
      const parts = lineRuns(html);
      const text = parts.map((r) => r.text).join('');
      // Only braille and blanks are content; a <p> holding markup leftovers is
      // not a braille line and must not be pretended into one.
      if (text !== '' && !/[⠀-⣿]/.test(text)) return;
      lines.push(text);
      runs.push(parts.some((r) => r.mode) ? parts : null);
    });
    const sec = { mode: CLASS_MODE[cls] ?? 'text', lines, ...(mathml ? { mathml } : {}) };
    // `runs` appears ONLY when a line actually changed mode part-way, so a
    // reader that predates inline runs sees exactly the shape it always saw.
    if (runs.some(Boolean)) sec.runs = runs;
    sections.push(sec);
  }

  return { ...meta, sections };
}

const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** True if these bytes look like a ZIP/OCF container, so Load can branch. */
export function looksLikeEbraille(buffer) {
  // >= 4, NOT > 4. The signature IS four bytes and the caller reads exactly four
  // (file.slice(0, 4)), so `> 4` asked for a fifth byte that was never passed and
  // the answer was always false — every .ebrl fell through to the plain-text
  // reader, which then parsed the container's own markup as braille. Save has
  // worked all along; Load could never see what Save wrote.
  const b = new Uint8Array(buffer);
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
}
