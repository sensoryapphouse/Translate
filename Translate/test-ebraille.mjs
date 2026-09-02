// WHAT AN .ebrl WE WRITE LOOKS LIKE, AND WHETHER IT STILL READS.
//
// Pinned on 2026-09-02 after the DAISY eBraille checker (daisy/ebraille-checker
// 1.0.0-beta.1) was run over every file this app had ever written and found the
// same two errors and three warnings in all of them. The writer had put the
// navigation, the content and the spine's only entry into ONE index.html; the
// spec wants an entry page that links to the package and a table of contents
// with role="doc-toc", kept out of the spine, with the braille in a content
// document of its own. This file holds that shape so it cannot drift back, and
// holds the reader to BOTH layouts, because every file written before that date
// has the old one.
//
// If the checker's jar is on this machine, the files are also handed to it and
// must come back with no errors and no warnings. Point EBRAILLE_CHECKER_JAR at
// ebraille-checker.jar (release zip: github.com/daisy/ebraille-checker); without
// it that part is skipped and says so - it is never silently green.
//
// Cells are BUILT from dot numbers, never typed.
// Run: node test-ebraille.mjs        (from Translate/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeEbraille, readEbraille, looksLikeEbraille, zipStore } from './ebraille.mjs';
import { unzip, ZipLimitError, ZIP_LIMITS } from './unmxl.mjs';
import zlib from 'node:zlib';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`); }
};
const dots = (...ds) => String.fromCodePoint(0x2800 + ds.reduce((m, d) => m | (1 << (d - 1)), 0));
const cells = (...specs) => specs.map((s) => (s === ' ' ? ' ' : dots(...s))).join('');
const CAT = cells([1, 4], [1], [2, 3, 4, 5]);
const HALF = dots(3, 4, 5, 6) + cells([1], [3, 4], [1, 2]);
const NEM = dots(4, 5, 6) + dots(1, 4, 6) + ' ' + dots(3, 4, 5, 6) + dots(2, 3) + dots(3, 4, 6) + dots(2, 3) + ' ' + dots(4, 5, 6) + dots(1, 5, 6);
const MUSIC = cells([1, 3, 4, 5, 6], [1, 3, 4, 5]);
const TITLE_BRL = cells([1], [2, 3, 4], [2, 3, 4, 5]);
const dec = new TextDecoder();
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const text = async (bytes, name) => { const f = await unzip(ab(bytes)); const d = f.get(name); return d ? dec.decode(d) : null; };

const DOC = {
  title: 'Mixed document', titleBraille: TITLE_BRL, creator: 'A. Teacher', language: 'en-GB',
  sections: [
    { mode: 'text', lines: [CAT, `${CAT} ${CAT}`] },
    { mode: 'ueb',  lines: [HALF], mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>' },
    { mode: 'text', lines: [[{ text: `${CAT} ` }, { text: HALF, mode: 'ueb' }, { text: ` ${CAT}` }], NEM] },
    { mode: 'mus',  lines: [MUSIC] },
  ],
};

console.log('the shape the spec asks for');
const bytes = writeEbraille(DOC);
const names = [...(await unzip(ab(bytes))).keys()];
ok('mimetype is the first entry', names[0] === 'mimetype');
ok('five entries: mimetype, container, package, entry page, content', names.join(',') === 'mimetype,META-INF/container.xml,package.opf,index.html,content.html', names.join(','));
const opf = await text(bytes, 'package.opf');
const entry = await text(bytes, 'index.html');
const content = await text(bytes, 'content.html');
const contentId = (opf.match(/<item id="([^"]+)" href="content.html"/) || [])[1];
ok('the spine names the content document, not the entry page', !!contentId && new RegExp(`<spine>\\s*<itemref idref="${contentId}"/>\\s*</spine>`).test(opf) && !/idref="nav"/.test(opf), opf.match(/<spine>[\s\S]*?<\/spine>/)?.[0]);
ok('the entry page is the nav item', /<item id="nav" href="index.html"[^>]*properties="nav"/.test(opf));
ok('the entry page links to the package', /<link rel="publication" href="package.opf" type="application\/oebps-package\+xml"\/>/.test(entry));
ok('the table of contents carries role="doc-toc" and epub:type="toc"', /<nav epub:type="toc" role="doc-toc"/.test(entry));
ok('the table of contents is written in BRAILLE when a braille title is given', entry.includes(`<h2>${TITLE_BRL}</h2>`) && entry.includes(`>${TITLE_BRL}</a>`));
ok('the entry page holds no braille sections', !/<section/.test(entry));
ok('the content document holds every section', (content.match(/<section /g) || []).length === DOC.sections.length);
ok('a section with MathML makes the content item declare it', /href="content.html"[^>]*properties="mathml"/.test(opf));
ok('dc:identifier is a well-formed UUID URN', /<dc:identifier id="pub-id">urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}<\/dc:identifier>/.test(opf), (opf.match(/<dc:identifier[^<]*/) || [''])[0]);
ok('the identifier is STABLE: the same document gets the same identifier', /urn:uuid:[^<]+/.exec(opf)[0] === /urn:uuid:[^<]+/.exec(await text(writeEbraille(DOC), 'package.opf'))[0]);
ok('dc:language carries the Brai script subtag', /<dc:language>en-Brai-GB<\/dc:language>/.test(opf));
// The writer's rule: SECTION modes first, by how many sections use them, then
// anything found only INSIDE lines (an inline run, Nemeth switch cells) after.
// Here text has two sections, so ueb grade2 leads; Nemeth appears only inside
// a text line, so it comes last, after the music section.
const declared = [...opf.matchAll(/property="a11y:brailleSystem">([^<]+)</g)].map((m) => m[1]);
ok('every system present is declared, section modes first by use, inline ones after',
   declared.join(' | ') === 'ueb grade2 | ueb grade1 | Braille-music no-grade music | Nemeth no-grade math', declared.join(' | '));
ok('both documents state their language', /<html [^>]*xml:lang="en-Brai-GB"/.test(entry) && /<html [^>]*xml:lang="en-Brai-GB"/.test(content));
const noMath = writeEbraille({ ...DOC, sections: DOC.sections.map((s) => ({ ...s, mathml: undefined })) });
ok('...and no MathML means no mathml property', !/properties="mathml"/.test(await text(noMath, 'package.opf')));
const printTitle = writeEbraille({ ...DOC, titleBraille: undefined });
ok('without a braille title the PRINT title is used, never an empty heading', (await text(printTitle, 'index.html')).includes('<h2>Mixed document</h2>'));

console.log('\nthe round trip');
const back = await readEbraille(ab(bytes));
ok('every section comes back with its mode', back.sections.map((s) => s.mode).join() === DOC.sections.map((s) => s.mode).join());
ok('every line comes back cell for cell', JSON.stringify(back.sections.map((s) => s.lines)) === JSON.stringify(DOC.sections.map((s) => s.lines.map((l) => typeof l === 'string' ? l : l.map((r) => r.text).join('')))));
ok('the inline UEB run comes back as a run', back.sections[2].runs && back.sections[2].runs[0][1].mode === 'ueb' && back.sections[2].runs[0][1].text === HALF);
ok('the MathML comes back with its section', back.sections[1].mathml === DOC.sections[1].mathml);
ok('the title, creator and language come back', back.title === 'Mixed document' && back.creator === 'A. Teacher' && back.language === 'en-GB');
ok('looksLikeEbraille recognises the container', looksLikeEbraille(ab(bytes).slice(0, 4)));

console.log('\nfiles written BEFORE 2026-09-02 still read (the old layout, built here as the old writer built it)');
const enc = new TextEncoder();
const oldIndex = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n<head><meta charset="utf-8"/><title>Old</title></head>\n<body>\n  <nav epub:type="toc" hidden="hidden"><ol><li><a href="index.html">Old</a></li></ol></nav>\n  <section class="sah-mode-text">\n    <p>${CAT}</p>\n  </section>\n  <section class="sah-mode-nemeth">\n    <p>${NEM}</p>\n  </section>\n</body>\n</html>\n`;
const oldOpf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="pub-id">urn:uuid:sah-00000000</dc:identifier><dc:title>Old</dc:title><dc:language>en-Brai</dc:language><meta property="a11y:brailleSystem">ueb grade2</meta></metadata>\n  <manifest><item id="index" href="index.html" media-type="application/xhtml+xml" properties="nav"/></manifest>\n  <spine><itemref idref="index"/></spine>\n</package>\n`;
const oldBytes = zipStore([
  { name: 'mimetype', data: enc.encode('application/epub+zip') },
  { name: 'META-INF/container.xml', data: enc.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
  { name: 'package.opf', data: enc.encode(oldOpf) },
  { name: 'index.html', data: enc.encode(oldIndex) },
]);
const old = await readEbraille(ab(oldBytes));
ok('an old-layout file reads its sections out of index.html', old.sections.length === 2 && old.sections[0].lines[0] === CAT && old.sections[1].mode === 'nem' && old.sections[1].lines[0] === NEM);
ok('its title and systems come back too', old.title === 'Old' && old.systems[0] === 'ueb grade2');
const foreign = zipStore([
  { name: 'mimetype', data: enc.encode('application/epub+zip') },
  { name: 'index.html', data: enc.encode(oldIndex) },
]);
ok('a file with no package document at all still yields its braille (a foreign producer)', (await readEbraille(ab(foreign))).sections.length === 2);
let refused = false;
try { await readEbraille(ab(zipStore([{ name: 'mimetype', data: enc.encode('application/epub+zip') }]))); } catch { refused = true; }
ok('a container with no index.html is refused, not read as empty', refused);

console.log('\nthe DAISY checker');
const jar = process.env.EBRAILLE_CHECKER_JAR;
if (jar && fs.existsSync(jar)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebrl-'));
  const cases = { 'mixed-braille-title': DOC, 'mixed-print-title': { ...DOC, titleBraille: undefined }, 'text-only': { ...DOC, sections: [DOC.sections[0]] } };
  for (const [name, doc] of Object.entries(cases)) {
    const f = path.join(dir, name + '.ebrl');
    fs.writeFileSync(f, writeEbraille(doc));
    let out = '';
    try { out = execFileSync('java', ['-jar', jar, '--profile', 'ebraille', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    const m = /Messages: (\d+) fatals \/ (\d+) errors \/ (\d+) warnings/.exec(out) || [];
    const ids = [...out.matchAll(/^(?:FATAL|ERROR|WARNING)\(([A-Z]+-\d+)\)/gm)].map((x) => x[1]);
    if (name === 'mixed-print-title') {
      ok(`${name}: no errors; the print title earns EBR-030 and nothing else`, m[1] === '0' && m[2] === '0' && ids.every((i) => i === 'EBR-030'), ids.join(','));
    } else {
      ok(`${name}: 0 fatals, 0 errors, 0 warnings`, m[1] === '0' && m[2] === '0' && m[3] === '0', ids.join(',') || out.slice(-200));
    }
  }
} else {
  console.log('  skip - set EBRAILLE_CHECKER_JAR to ebraille-checker.jar to run the DAISY checker here');
}

console.log('\nthe Emboss adapter (format/ebraille.mjs) - the same container from embosser pages');
// Emboss's exporter reaches this writer through format/document.mjs and the
// whole input/ chain, which other work may have mid-edit; a chain that will
// not load is reported, never silently passed over.
let emboss = null;
try { emboss = (await import('../format/ebraille.mjs')).exportToEbraille; }
catch (e) { console.log('  skip - format/ebraille.mjs could not be loaded: ' + String(e.message).split('\n')[0]); }
if (emboss) {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><path d="M10 90 L10 10 L90 90 Z" fill="none" stroke="#000"/></svg>';
  const eDocs = {
    'emboss-plain':   [{ title: 'Emboss test', blocks: [{ type: 'para', text: 'Hello world' }, { type: 'para', text: 'Knowledge is power.' }] }, {}],
    'emboss-svg':     [{ title: 'Emboss graphics', blocks: [{ type: 'para', text: 'A diagram follows.' }, { type: 'graphic', title: 'Right angle', svg: SVG }] }, {}],
    'emboss-volumes': [{ title: 'Emboss long', blocks: Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `Paragraph ${i + 1} of a document long enough to need volumes.` })) }, { depth: 12, volumePages: 3 }],
  };
  const eBytes = {};
  const translate = (print) => print.toUpperCase();   // BRF ASCII stand-in for the app's liblouis
  for (const [name, [doc, extra]] of Object.entries(eDocs)) eBytes[name] = emboss(doc, { width: 40, depth: 25, mode: 'ukaaf', translate, ...extra });
  const opfP = await text(eBytes['emboss-plain'], 'package.opf');
  ok('an Emboss export is an OCF container with the entry page and one volume document', (await text(eBytes['emboss-plain'], 'mimetype')) === 'application/epub+zip' && /<itemref idref="doc1"\/>/.test(opfP) && (await text(eBytes['emboss-plain'], 'volume-1.html')) !== null);
  ok('every page line is braille cells and nothing else', [...(await text(eBytes['emboss-plain'], 'volume-1.html')).matchAll(/<p>(.*?)<\/p>/g)].every((m) => /^[\u2800-\u28ff]*$/.test(m[1])));
  const opfS = await text(eBytes['emboss-svg'], 'package.opf');
  ok('a tactile graphic travels as an SVG resource, declared in the package', /tactileGraphics">SVG</.test(opfS) && /href="graphics\/graphic-1.svg" media-type="image\/svg\+xml"/.test(opfS) && /href="volume-1.html"[^>]*properties="svg"/.test(opfS) && (await text(eBytes['emboss-svg'], 'graphics/graphic-1.svg')) === SVG);
  ok('...and the figure\'s caption and alt are braille, like everything else the reader meets', /<img [^>]*alt="[\u2800-\u28ff]+"\/>[\s\S]*<figcaption>[\u2800-\u28ff]+<\/figcaption>/.test(await text(eBytes['emboss-svg'], 'volume-1.html')));
  const opfV = await text(eBytes['emboss-volumes'], 'package.opf');
  ok('a long document becomes one content document per volume, all in the spine', (opfV.match(/<itemref /g) || []).length >= 3 && (await text(eBytes['emboss-volumes'], 'volume-3.html')) !== null);
  ok('the table of contents lists every volume, in braille', ((await text(eBytes['emboss-volumes'], 'index.html')).match(/<li><a href="volume-\d+.html">[\u2800-\u28ff]+<\/a><\/li>/g) || []).length >= 3);
  ok('it declares itself a complete transcription', /completeTranscription">true</.test(opfP));
  let refused = false;
  try { emboss(eDocs['emboss-plain'][0], { width: 40, depth: 25 }); } catch (e) { refused = /translate/.test(e.message); }
  ok('without a translator it refuses, rather than upper-casing print into "braille"', refused);
  if (jar && fs.existsSync(jar)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebrl-emboss-'));
    for (const [name, bytes] of Object.entries(eBytes)) {
      const f = path.join(dir, name + '.ebrl'); fs.writeFileSync(f, bytes);
      let out = '';
      try { out = execFileSync('java', ['-jar', jar, '--profile', 'ebraille', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
      const m = /Messages: (\d+) fatals \/ (\d+) errors \/ (\d+) warnings/.exec(out) || [];
      const ids = [...out.matchAll(/^(?:FATAL|ERROR|WARNING)\(([A-Z]+-\d+)\)/gm)].map((x) => x[1]);
      ok(`${name}: 0 fatals, 0 errors, 0 warnings from the DAISY checker`, m[1] === '0' && m[2] === '0' && m[3] === '0', ids.join(',') || out.slice(-200));
    }
  }
}

// A HOSTILE ZIP MUST NOT TAKE THE TAB DOWN (Translate audit, 2026-09-02). The
// caps live inside unzip's read loop; these archives are built by hand with a
// local header only, which is all unzip reads.
console.log('a hostile ZIP is refused, a big honest one is not');
{
  const enc8 = new TextEncoder();
  const entry = (name, data, { method = 0, claimSize } = {}) => {
    const nb = enc8.encode(name);
    const h = new Uint8Array(30 + nb.length + data.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(8, method, true);
    v.setUint32(18, data.length, true); v.setUint32(22, claimSize ?? data.length, true);
    v.setUint16(26, nb.length, true); h.set(nb, 30); h.set(data, 30 + nb.length);
    return h;
  };
  const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const deflated = (buf) => new Uint8Array(zlib.deflateRawSync(buf));
  const refusal = async (bytes, limits) => { try { await unzip(ab(bytes), limits); return null; } catch (e) { return e; } };

  const zeros = deflated(Buffer.alloc(4 * 1024 * 1024));          // 4 MB of zeros: a few KB deflated
  let e = await refusal(entry('bomb.xml', zeros, { method: 8 }));
  ok('4 MB of zeros in a few KB is refused under the default limits', e instanceof ZipLimitError && /expands more than 200 times/.test(e.message), e && e.message);
  ok('the refusal names the entry', e && e.entry === 'bomb.xml');
  e = await refusal(entry('bomb.xml', zeros, { method: 8, claimSize: 10 }));
  ok('a header that claims 10 bytes does not get past the loop', e instanceof ZipLimitError, e && e.message);

  const noisy = Buffer.alloc(3 * 1024 * 1024); for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 7919 + (i >> 3)) & 0xff;
  const honest = deflated(noisy);
  ok('a 3 MB entry that deflates honestly (ratio under 2) is accepted', (await unzip(ab(entry('big.xml', honest, { method: 8 })))).get('big.xml')?.length === noisy.length);

  const half = new Uint8Array(600 * 1024).fill(0x41);
  e = await refusal(cat(entry('a.txt', half), entry('b.txt', half)), { maxTotal: 1024 * 1024 });
  ok('two stored entries over a 1 MB total are refused at the second', e instanceof ZipLimitError && e.entry === 'b.txt' && /larger than 1 MB/.test(e.message), e && e.message);
  e = await refusal(entry('one.txt', deflated(noisy), { method: 8 }), { maxEntry: 1024 * 1024, ratioFloor: Infinity });
  ok('one entry over the per-entry cap is refused mid-stream', e instanceof ZipLimitError && /one part of it is larger than 1 MB/.test(e.message), e && e.message);
  e = await refusal(cat(entry('a.txt', half), entry('b.txt', half), entry('c.txt', half)), { maxEntries: 2 });
  ok('more entries than allowed is refused', e instanceof ZipLimitError && /more than 2 entries/.test(e.message), e && e.message);
  ok('the default caps are generous for real documents (64 MB total, 32 MB per entry)', ZIP_LIMITS.maxTotal === 64 * 1024 * 1024 && ZIP_LIMITS.maxEntry === 32 * 1024 * 1024);
  ok('a real .ebrl still reads', (await readEbraille(ab(bytes))).sections.length === DOC.sections.length);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
