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
import { parseXml, unescapeXml } from './xml.mjs';

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
// en → en-Brai, en-US → en-Brai-US: the script subtag sits after the primary
// subtag, which is what the spec's own examples show (§5.3.3.5).
const braiTag = (language) => {
  const parts = String(language || 'en').split('-');
  return [parts[0], 'Brai', ...parts.slice(1)].join('-');
};

// ONE PACKAGE BUILDER FOR EVERY APP (2026-09-02). Translate and BrlDuet write
// sections of braille with modes; Emboss writes volumes of embosser pages with
// tactile graphics beside them. They used to have two writers, and the second
// was not eBraille at all (format/ebraille.mjs wrote an invented XML that the
// DAISY checker rejects as "Corrupted EPUB ZIP header"). The container, the
// package document and the entry page are the same for all of them, so they
// are built here ONCE from a spec:
//
//   { title, titleBraille, creator, producer, publisher?, language, identifier, modified,   // publisher: dc:publisher; absent = the producer (S3b #18, optional)
//     copyrightYear, systems: [registry strings], cellType: '6',
//     completeTranscription: true, tactileGraphics: 'none' | 'SVG' | …,
//     toc: [{ href, label, children?: [...] }], // label in braille where possible; children nest (8.3.1)
//     documents: [{ href, body, mathml, svg,    // body = the inside of <body>
//                   title?, stylesheets? }],    // title = the <title>; stylesheets = hrefs to <link> (2026-10-01)
//     resources: [{ href, mediaType, data }],   // tactile graphics, style sheets and the like
//     pageList?: [{ href, title, label }],      // 8.3.2: print page number in `title`, label in braille
//     accessibilityFeatures?: ['printPageNumbers', ...],  // schema:accessibilityFeature, one <meta> each
//     landmarks?: [{ href, type, label }] }     // 8.3.3: epub:type from the Structural Semantics Vocabulary
//
// THESE FIELDS ARE OPTIONAL AND ARE THERE FOR EMBOSS (2026-10-01, Paul): its export is now structured
// (several content documents, a nested contents list, a page list, a style sheet). A spec without them is
// written byte for byte as before - Translate and BrlDuet's files do not change.
//
// writeEbraille() below is the mode-sections adapter over this; Emboss has its
// own adapter in format/ebraille.mjs.
function buildOPF(spec) {
  const now = iso(spec.modified ?? Date.now());
  const year = spec.copyrightYear ?? new Date(now).getUTCFullYear();
  const langParts = String(spec.language || 'en').split('-');
  const lang = braiTag(spec.language);
  const docs = spec.documents ?? [];
  const res = spec.resources ?? [];
  const systems = (spec.systems && spec.systems.length) ? spec.systems : [SYSTEM_FOR.text];
  const pubId = spec.identifier ?? 'urn:uuid:' + stableUuid(spec.identitySeed ?? JSON.stringify(docs.map((d) => d.body)));
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id"
         xml:lang="${esc(langParts[0])}"
         prefix="a11y: http://www.idpf.org/epub/vocab/package/a11y/# dcterms: http://purl.org/dc/terms/ sah: https://sensoryapphouse.com/ns/braille#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${esc(pubId)}</dc:identifier>
    <dc:title>${esc(spec.title || 'Braille document')}</dc:title>
    <dc:language>${esc(lang)}</dc:language>
    <dc:creator>${esc(spec.creator || 'Unknown')}</dc:creator>
    <dc:publisher>${esc(spec.publisher || spec.producer || 'Sensory App House Ltd')}</dc:publisher>
    <dc:date>${esc(now.slice(0, 10))}</dc:date>
    <dc:format>${EBRAILLE_VERSION}</dc:format>
    <meta property="dcterms:modified">${esc(now)}</meta>
    <meta property="dcterms:dateCopyrighted">${esc(String(year))}</meta>
    <meta property="a11y:producer">${esc(spec.producer || 'Sensory App House Ltd')}</meta>
    <meta property="a11y:brailleCellType">${esc(spec.cellType ?? '6')}</meta>${spec.brailleCode ? `
    <!-- THE EXACT TABLE THE TEXT WAS WRITTEN WITH (audit TR-03, 15 Oct 2026).
         a11y:brailleSystem says "ueb grade2" or "Nemeth no-grade math" - a
         publication-wide statement from a small registry vocabulary, and the
         only thing the standard offers. It cannot distinguish French from
         Spanish, or either from UEB, so a file saved in one language reopened
         in another, silently, with the cells intact and every word changed.
         This names the liblouis table instead, under our own prefix because
         eBraille has nowhere for it. Additive: a reader that does not know
         sah: ignores it and is no worse off than before. -->
    <meta property="sah:brailleCode">${esc(spec.brailleCode)}</meta>` : ''}
${systems.map((sy) => `    <meta property="a11y:brailleSystem">${esc(sy)}</meta>`).join('\n')}
    <meta property="a11y:completeTranscription">${spec.completeTranscription === false ? 'false' : 'true'}</meta>
    <meta property="a11y:tactileGraphics">${esc(spec.tactileGraphics || 'none')}</meta>${(spec.accessibilityFeatures || []).map((f) => `\n    <meta property="schema:accessibilityFeature">${esc(f)}</meta>`).join('')}
  </metadata>
  <manifest>
    <item id="nav" href="index.html" media-type="application/xhtml+xml" properties="nav"/>
${docs.map((d, i) => { const props = [d.mathml && 'mathml', d.svg && 'svg'].filter(Boolean); return `    <item id="doc${i + 1}" href="${esc(d.href)}" media-type="application/xhtml+xml"${props.length ? ` properties="${props.join(' ')}"` : ''}/>`; }).join('\n')}
${res.map((r, i) => `    <item id="res${i + 1}" href="${esc(r.href)}" media-type="${esc(r.mediaType)}"/>`).join('\n')}
  </manifest>
  <spine>
${docs.map((d, i) => `    <itemref idref="doc${i + 1}"/>`).join('\n')}
  </spine>
</package>
`;
}

// A STABLE IDENTIFIER THAT IS ALSO A WELL-FORMED UUID (2026-09-02).
//
// The first version hashed the sections to 32 bits and wrote `urn:uuid:sah-…`
// round it, on the reasoning that "the spec requires an identifier, not a
// UUID". True — but a URN in the uuid namespace IS a claim to be a UUID, and
// the DAISY checker said so on every file we had ever written (OPF-085: "marked
// as a UUID, but is an invalid UUID"). The stability was the right instinct:
// the same document saved twice is the same publication. So the hash is kept,
// widened to 128 bits (four FNV-1a passes, distinct seeds) and laid out as RFC
// 9562's version-8 UUID — the version reserved for exactly this, an identifier
// whose bits mean something to its producer. No dependency, no randomness.
function stableUuid(src) {
  const words = [];
  for (const seed of [0x811c9dc5, 0x1b873593, 0xcc9e2d51, 0xe6546b64]) {
    let h = seed >>> 0;
    for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    words.push(h);
  }
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('');   // 32 hex digits
  // version nibble → 8 (custom), variant bits → 10xx
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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

// THE ENTRY PAGE AND THE CONTENT ARE TWO FILES (2026-09-02).
//
// The first version wrote ONE index.html that was the navigation document, the
// only content document, and the spine's only item. Every part of that is
// something the spec says not to do, and the DAISY checker
// (daisy/ebraille-checker 1.0.0-beta.1) said so on all ten files we had:
//   • the primary entry page MUST carry <link rel="publication"> pointing at
//     package.opf (§8.2, Example 46)                          — EBR-080
//   • the table of contents nav MUST carry role="doc-toc" (§8.3, Example 48)
//                                                              — EBR-084
//   • the entry page should not be in the spine                — EBR-083
//   • content text SHOULD be braille and whitespace only (§3), and the
//     nav's link text was the PRINT title                      — EBR-030
// So now index.html is the entry page and nothing else — the link to the
// package, and a table of contents whose one entry points at the content —
// and the braille lives in content.html, which is what the spine names. The
// spec's own example writes the TOC heading in braille, so the caller may hand
// over `titleBraille`; without it the print title is used and the checker will
// still warn, which is the honest outcome — better a warned print title than a
// silent empty heading.
const CONTENT_DOC = 'content.html';

const htmlHead = (doc, lang, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(doc.title || 'Braille document')}</title>
${extra}</head>
`;

// A TITLE IN BRAILLE WHEN NO TRANSLATOR IS TO HAND (2026-09-05). The entry
// page's heading and its table-of-contents link are CONTENT, and eBraille
// content should be braille and whitespace only (§3): the DAISY checker
// warns EBR-030 on every print character there. BrlDuet translates the title
// with liblouis when it can, Emboss and Translate hand one over — but a
// title can still arrive as print (liblouis not loaded, a caller with no
// translator), and the file then ships warned. This is the fallback: UEB
// grade 1 for the characters a title is made of — letters, capitals, digits
// with the numeric indicator (restated after a hyphen, kept across a full
// stop or comma), the blank cell, and the common punctuation. Checked
// against liblouis's own en-ueb-g1 table on six titles, cell for cell
// identical (2026-09-05, main session). Cells are BUILT FROM DOT NUMBERS,
// never typed. Anything outside the table is dropped from the braille
// title rather than guessed at.
const cellOf = (...ds) => String.fromCodePoint(0x2800 + ds.reduce((m, d) => m | (1 << (d - 1)), 0));
const G1_AJ = [[1], [1, 2], [1, 4], [1, 4, 5], [1, 5], [1, 2, 4], [1, 2, 4, 5], [1, 2, 5], [2, 4], [2, 4, 5]];
const G1_LETTER = (() => {
  const t = {};
  'abcdefghij'.split('').forEach((c, i) => { t[c] = G1_AJ[i]; });
  'klmnopqrst'.split('').forEach((c, i) => { t[c] = [...G1_AJ[i], 3]; });
  'uvxyz'.split('').forEach((c, i) => { t[c] = [...G1_AJ[i], 3, 6]; });
  t.w = [2, 4, 5, 6];
  return t;
})();
const G1_PUNCT = { '-': [3, 6], '.': [2, 5, 6], ',': [2], ':': [2, 5], ';': [2, 3], '!': [2, 3, 5], '?': [2, 3, 6], "'": [3], '/': [3, 4] };
function titleToGrade1(title) {
  let out = '', inNumber = false;
  for (const ch of String(title ?? '')) {
    const lower = ch.toLowerCase();
    if (G1_LETTER[lower]) {
      if (inNumber) { out += cellOf(5, 6); inNumber = false; }   // grade 1 indicator: a letter a-j after digits
      if (ch !== lower) out += cellOf(6);
      out += cellOf(...G1_LETTER[lower]);
    } else if (ch >= '0' && ch <= '9') {
      if (!inNumber) { out += cellOf(3, 4, 5, 6); inNumber = true; }
      out += cellOf(...G1_AJ[(Number(ch) + 9) % 10]);           // 1-9 are a-i, 0 is j
    } else if (ch === ' ') { out += cellOf(); inNumber = false; }
    else if (ch === '(' || ch === ')') { out += cellOf(5) + cellOf(...(ch === '(' ? [1, 2, 6] : [3, 4, 5])); inNumber = false; }
    else if (G1_PUNCT[ch]) { out += cellOf(...G1_PUNCT[ch]); if (ch !== '.' && ch !== ',') inNumber = false; }
    else inNumber = false;
  }
  return out;
}

// A nested contents list (8.3.1, Example 50): an entry's sub-sections go in an <ol> after its link. A flat
// entry is written exactly as it always was.
function tocItems(items, shown, indent) {
  const pad = ' '.repeat(indent);
  return items.map((t) => {
    const a = `<a href="${esc(t.href)}">${esc(t.label || shown)}</a>`;
    if (!t.children || !t.children.length) return `${pad}<li>${a}</li>`;
    return `${pad}<li>${a}\n${pad}  <ol>\n${tocItems(t.children, shown, indent + 4)}\n${pad}  </ol>\n${pad}</li>`;
  }).join('\n');
}

function buildEntryPage(spec, lang) {
  const shown = spec.titleBraille || titleToGrade1(spec.title || 'Braille document');
  const toc = (spec.toc && spec.toc.length) ? spec.toc : [{ href: CONTENT_DOC, label: shown }];
  // The page list (8.3.2): one flat <ol>, the braille page number inside the link and the PRINT number in `title`,
  // which is how a reader matches the number a user types. Its heading is braille too (EBR-030).
  const pages = (spec.pageList && spec.pageList.length)
    ? `  <nav epub:type="page-list" role="doc-pagelist" aria-label="Page list">
    <h2>${esc(spec.pageListHeading || shown)}</h2>
    <ol>
${spec.pageList.map((p) => `      <li><a href="${esc(p.href)}" title="${esc(p.title)}">${esc(p.label)}</a></li>`).join('\n')}
    </ol>
  </nav>
` : '';
  const marks = (spec.landmarks && spec.landmarks.length)
    ? `  <nav epub:type="landmarks" aria-label="Landmarks">
    <h2>${esc(spec.landmarksHeading || shown)}</h2>
    <ol>
${spec.landmarks.map((l) => `      <li><a href="${esc(l.href)}" epub:type="${esc(l.type)}">${esc(l.label)}</a></li>`).join('\n')}
    </ol>
  </nav>
` : '';
  return htmlHead(spec, lang,
    '  <link rel="publication" href="package.opf" type="application/oebps-package+xml"/>\n') +
`<body>
  <nav epub:type="toc" role="doc-toc" aria-label="Table of contents">
    <h2>${esc(shown)}</h2>
    <ol>
${tocItems(toc, shown, 6)}
    </ol>
  </nav>
${pages}${marks}</body>
</html>
`;
}

const wrapContent = (spec, lang, body, d = {}) => htmlHead(d.title ? { ...spec, title: d.title } : spec, lang,
  (d.stylesheets || []).map((h) => `  <link rel="stylesheet" type="text/css" href="${esc(h)}"/>\n`).join('')) + `<body>
${body}
</body>
</html>
`;

// The inside of <body> for a mode-sections document: one <section> per section,
// its mode in a class, its MathML (if any) before its lines.
function sectionsBody(doc) {
  return (doc.sections ?? []).map((sec) => {
    const cls = MODE_CLASS[sec.mode] ?? MODE_CLASS.text;
    // MathML rides INSIDE the section, before the cells, where the spec permits
    // it. It is the source the braille was made from — not an instruction to a
    // reading system, which does no translating.
    const math = sec.mathml ? `    ${sec.mathml}\n` : '';
    const lines = (sec.lines ?? []).map((l) => `    <p>${lineHtml(l)}</p>`).join('\n');
    return `  <section class="${cls}">\n${math}${lines}\n  </section>`;
  }).join('\n');
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

/** Build a .ebrl from a package SPEC (see buildOPF). Returns a Uint8Array. */
export function packageEbraille(spec) {
  const enc = new TextEncoder();
  const brai = braiTag(spec.language);
  const docs = spec.documents ?? [];
  return zipStore([
    // MIMETYPE FIRST AND STORED — OCF requires it, and a reader that checks
    // will reject the archive outright if it is anywhere else.
    { name: 'mimetype', data: enc.encode(EBRL_MEDIA_TYPE) },
    { name: 'META-INF/container.xml', data: enc.encode(CONTAINER_XML) },
    { name: 'package.opf', data: enc.encode(buildOPF(spec)) },
    { name: 'index.html', data: enc.encode(buildEntryPage(spec, brai)) },
    ...docs.map((d) => ({ name: d.href, data: enc.encode(wrapContent(spec, brai, d.body, d)) })),
    ...(spec.resources ?? []).map((r) => ({ name: r.href, data: r.data })),
  ]);
}

/** Build a .ebrl file from mode-sections (Translate, BrlDuet). Returns a Uint8Array. */
export function writeEbraille(doc) {
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

  // A document AUTHORED in braille omits nothing from any original, because
  // there is no original: it is the work itself. So it is a complete
  // transcription (PB, 2026-09-02); it used to say false, which tells a reader
  // "parts of this are missing".
  return packageEbraille({
    ...doc,
    systems,
    completeTranscription: doc.completeTranscription ?? true,
    tactileGraphics: 'none',
    identitySeed: JSON.stringify(doc.sections ?? []),
    toc: [{ href: CONTENT_DOC, label: doc.titleBraille || titleToGrade1(doc.title || 'Braille document') }],
    documents: [{ href: CONTENT_DOC, body: sectionsBody(doc), mathml: (doc.sections ?? []).some((sec) => sec.mathml) }],
  });
}

// WHAT ENDS A BRAILLE LINE. Both readers below — the one that walks sections
// and the one for files that have none — share this list, because they are
// answering the same question and disagreeing about <li> or <td> would mean a
// file read differently depending on whether its producer used sections.
const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'tr',
  'caption', 'figcaption', 'div', 'aside', 'ul', 'ol', 'dl', 'dt', 'dd', 'table',
  'thead', 'tbody', 'tfoot', 'section', 'nav', 'main', 'article', 'header', 'footer',
  'blockquote', 'pre', 'figure', 'hr', 'br']);

// Elements whose text is never braille content. <math> is the interesting one:
// it is read whole, as MathML, so walking into it as well would turn an <mtext>
// into a bogus line.
const NOT_CONTENT = new Set(['head', 'script', 'style', 'math']);

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
  if (!get('index.html')) throw new Error('not an eBraille file: no index.html in the publication root');
  // THE CONTENT IS WHATEVER THE SPINE NAMES (2026-09-02). Files written before
  // this date put their sections in index.html and listed it in the spine;
  // files written since put them in content.html. Following the spine reads
  // both without knowing which it has. A file whose spine cannot be resolved
  // at all falls back to index.html, which is where a foreign producer's
  // single-document publication would keep its sections too.
  // PARSED, NOT PATTERN-MATCHED (PB, 10 Oct 2026: "yes, we should open other
  // people's ebraille"). Everything below used to be regular expressions, and
  // they encoded OUR serialisation rather than the format: double-quoted
  // attributes, the literal prefixes dc: and a11y:, a <math> with no prefix,
  // and non-greedy bodies that any nesting defeats. A valid file from another
  // producer could differ in every one of those and be misread or read as
  // empty. xml.mjs resolves names and namespaces so elements are found by what
  // they MEAN; the shape returned from here is unchanged.
  const pkg = parseXml(opf || '');
  const manifest = {};
  for (const item of pkg.find('item')) {
    const id = item.attr('id');
    const href = item.attr('href');
    if (id && href) manifest[id] = decodeURIComponent(href);
  }
  const spine = pkg.find('itemref').map((r) => manifest[r.attr('idref')]).filter(Boolean);
  const docs = spine.map(get).filter((d) => d !== null);
  const html = docs.length ? docs.join('\n') : get('index.html');

  const first = (local) => {
    const n = pkg.find(local)[0];
    return n ? n.text().trim() : '';
  };
  // a11y:producer and a11y:brailleSystem are prefixed in the ATTRIBUTE VALUE,
  // where the prefix is just as free a choice, so the local part decides.
  const byProperty = (want) => pkg.find('meta')
    .filter((m) => String(m.attr('property') || '').split(':').pop() === want)
    .map((m) => m.text().trim());
  const meta = {
    title: first('title'),
    creator: first('creator'),
    producer: byProperty('producer')[0] || '',
    language: first('language').replace(/-Brai/i, ''),
    identifier: first('identifier'),
    systems: byProperty('brailleSystem'),
    // Absent from any file written before 15 Oct 2026, and from every other
    // producer's: '' then, and the caller leaves the reader's code alone rather
    // than guessing one.
    brailleCode: byProperty('brailleCode')[0] || '',
  };

  const doc = parseXml(html || '');

  // ONE CHILD OF A LINE. Anything that is not a mode span is text, so markup
  // this function does not know about degrades to cells rather than being
  // dropped — the same rule the section reader follows.
  //
  // unescapeXml, NOT the module's old five-replacement unesc (TR-06, found by
  // an audit 15 Oct 2026; mine, from the parser rewrite on the 12th). Element
  // children were decoded by xml.mjs, which expands every character reference,
  // while text sitting directly in a <p> went through unesc, which knew only
  // &lt; &gt; &quot; &#39; &amp;. So <p>&#x2801;</p> kept its reference as
  // literal text, the cell filter then found no braille in it and dropped the
  // line, while the same reference inside a <span> read correctly. Two
  // decoders on one document is the bug; there is now one.
  const runOf = (child) => {
    if (child.local === undefined) {
      const t = child.cdata ? child.raw : unescapeXml(child.text || '');
      return t ? [{ text: t }] : [];
    }
    const cls = String(child.attr('class') || '').split(/\s+/).find((c) => CLASS_MODE[c]);
    const mode = CLASS_MODE[cls];
    if (mode) return [{ text: child.text(), ...(mode !== 'text' ? { mode } : {}) }];
    const t = child.text();
    return t ? [{ text: t }] : [];
  };

  /** Every run of one line, in document order. */
  const lineRuns = (node) => {
    const parts = (node.children || []).flatMap(runOf);
    return parts.length ? parts : [{ text: '' }];
  };

  // EVERY BLOCK IS A LINE, NOT JUST <p> (TR-05, same audit, also mine). The
  // section reader asked for sec.find('p'), so a section holding a heading, a
  // list or a table returned its paragraphs and lost the rest without a word —
  // a silent read, which is worse for a teacher than a refusal.
  //
  // The rule now matches the no-section reader's: a block ends a line. A LEAF
  // block — one with no block inside it — is one line, kept even when empty
  // because an empty <p> IS a blank braille line. A block that holds other
  // blocks is a container to walk, so <ul> contributes nothing itself and its
  // <li>s are the lines. A <br> ends a line where it stands.
  const holdsBlock = (n) => (n.children || []).some((c) => c.local !== undefined
    && (BLOCK.has(c.local) || holdsBlock(c)));

  const blockLines = (from) => {
    const out = [];
    let loose = [];
    // Inline content sitting directly in a container is a line only when it
    // says something: a </ul> must not manufacture a blank line.
    const flushLoose = () => {
      if (loose.some((r) => r.text !== '')) out.push(loose);
      loose = [];
    };
    for (const c of from.children || []) {
      if (c.local === undefined) { loose.push(...runOf(c)); continue; }
      if (NOT_CONTENT.has(c.local)) continue;    // <math> is captured whole, below
      // <br> and <hr> END a line; neither is a line of its own, because
      // neither carries a cell and inventing a blank one is the same fault as
      // dropping a real one.
      if (c.local === 'br' || c.local === 'hr') { flushLoose(); continue; }
      if (!BLOCK.has(c.local)) { loose.push(...runOf(c)); continue; }
      flushLoose();
      if (holdsBlock(c)) out.push(...blockLines(c));
      else out.push(lineRuns(c));
    }
    flushLoose();
    return out;
  };

  // TOP-LEVEL SECTIONS ONLY. find() reaches every depth, which is right for
  // metadata and wrong here: a section nested in another would be read twice,
  // once on its own and once as part of its parent's content.
  const topSections = (from) => {
    const out = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (c.local === undefined) continue;
        if (c.local === 'section') out.push(c);
        else walk(c);
      }
    }(from));
    return out;
  };

  const sections = [];
  for (const sec of topSections(doc)) {
    const cls = String(sec.attr('class') || '').split(/\s+/).find((c) => CLASS_MODE[c]);
    const math = sec.find('math')[0];
    const lines = [], runs = [];
    for (const parts of blockLines(sec)) {
      const text = parts.map((r) => r.text).join('');
      // Only braille and blanks are content; a block holding markup leftovers
      // or print text is not a braille line and must not be pretended into one.
      if (text !== '' && !/[⠀-⣿]/.test(text)) continue;
      lines.push(text);
      runs.push(parts.some((r) => r.mode) ? parts : null);
    }
    const out = { mode: CLASS_MODE[cls] ?? 'text', lines, ...(math ? { mathml: math.outerXml() } : {}) };
    // `runs` appears ONLY when a line actually changed mode part-way, so a
    // reader that predates inline runs sees exactly the shape it always saw.
    if (runs.some(Boolean)) out.runs = runs;
    sections.push(out);
  }

  // A FILE WITH NO <section> AT ALL (2026-10-01). Emboss's export is structured braille - headings, paragraphs, lists,
  // tables, notes - in several content documents, with no sah-mode sections; a file from another producer is the same.
  // Reading it as nothing would be a regression from the days Emboss wrote pages of <p> lines, so every block's end is a
  // line end and the braille lines come back as one text section. Since 15 Oct 2026 the section reader applies the same
  // rule, so the two agree; before that it read only <p> and a sectioned file lost its headings, lists and tables.
  if (!sections.length && html) {
    let flat = '';
    (function walk(n) {
      for (const c of n.children || []) {
        if (c.local === undefined) { flat += c.cdata ? c.raw : unescapeXml(c.text || ''); continue; }
        if (NOT_CONTENT.has(c.local)) continue;           // not content
        if (c.local === 'br') { flat += '\n'; continue; }
        walk(c);
        if (BLOCK.has(c.local)) flat += '\n';
      }
    }(doc));
    const lines = flat.split('\n').map((l) => l.trim()).filter((l) => /[⠀-⣿]/.test(l));
    if (lines.length) sections.push({ mode: 'text', lines });
  }

  return { ...meta, sections };
}

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
