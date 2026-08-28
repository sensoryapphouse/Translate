// Export the PRINT side as a Word document (PB, 2026-08-11).
//
// WHY WORD AND NOT PDF. A teacher marks work, and marking means editing. A PDF
// is a photograph of an answer; a .docx can be corrected, commented on and
// handed back. It also keeps the maths ALIVE: Word stores equations as OMML,
// which screen readers read as maths. A PDF flattens them to glyphs, so a blind
// pupil's own equations become unreadable in the file their teacher returns —
// which would be a strange thing for this app to produce.
//
// WHAT A .docx IS. A ZIP of XML parts. We already write one ZIP — eBraille — so
// the container costs nothing: zipStore comes from ebraille.mjs rather than
// being written a second time and left to drift.
//
// THE WORK IS THE MATHS. Word does not read MathML; it reads OMML, a different
// vocabulary for the same ideas. The maths pane holds MathML, produced by
// Temml, so this file translates between them. That is tractable only because
// the vocabulary is OURS and therefore finite — measured across both example
// files, the whole corpus of elements in use is:
//
//     mrow mi mn mo mfrac msup msub msqrt mroot munderover mspace mphantom
//
// with msubsup, mtext and mtable reachable from expressions the app can write
// but those files happen not to contain. Everything here is handled; anything
// unknown degrades to its text rather than vanishing, because a wrong-looking
// equation can be spotted and a missing one cannot.

import { zipStore } from '/Translate/ebraille.mjs';

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => XML_ESC[c]);
const enc = (s) => new TextEncoder().encode(s);

// ---- MathML -> OMML ------------------------------------------------------

/** A run of literal maths text: <m:r><m:t>x</m:t></m:r>. */
function omRun(text) {
  if (!text) return '';
  // xml:space="preserve" or Word eats the spacing that separates operators.
  return `<m:r><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

/** Children of an element, converted and concatenated. */
function omKids(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += omRun(node.nodeValue);
    else if (node.nodeType === 1) out += omNode(node);
  }
  return out;
}

/** One MathML element as OMML. */
function omNode(el) {
  const tag = el.tagName.toLowerCase().replace(/^m:/, '');
  const kids = [...el.children];
  const arg = (i) => (kids[i] ? omNode(kids[i]) : '');

  switch (tag) {
    // Leaves. mi is a variable and Word italicises it by default, which is the
    // right typography and matches what the maths pane shows.
    case 'mi': case 'mn': case 'mo': case 'mtext':
      return omRun(el.textContent);

    // Grouping carries no meaning of its own in OMML — its children simply run on.
    case 'mrow': case 'mstyle': case 'msemantics': case 'math':
      return omKids(el);

    // PHANTOM IS INVISIBLE BY DEFINITION. Temml uses it for the switch
    // indicators, which are braille apparatus and have no print form at all —
    // emitting them would put stray characters in the teacher's document.
    case 'mphantom':
      return '';

    // Spacing: Word lays maths out itself, and honouring Temml's pixel widths
    // would fight it. A single space keeps operands apart where it mattered.
    case 'mspace':
      return el.getAttribute('width') && parseFloat(el.getAttribute('width')) > 0 ? omRun(' ') : '';

    case 'mfrac':
      return `<m:f><m:fPr><m:ctrlPr/></m:fPr><m:num>${arg(0)}</m:num><m:den>${arg(1)}</m:den></m:f>`;

    case 'msup':
      return `<m:sSup><m:e>${arg(0)}</m:e><m:sup>${arg(1)}</m:sup></m:sSup>`;
    case 'msub':
      return `<m:sSub><m:e>${arg(0)}</m:e><m:sub>${arg(1)}</m:sub></m:sSub>`;
    case 'msubsup':
      return `<m:sSubSup><m:e>${arg(0)}</m:e><m:sub>${arg(1)}</m:sub><m:sup>${arg(2)}</m:sup></m:sSubSup>`;

    // A square root is a radical with the degree hidden — that is exactly what
    // degHide means, and it is why msqrt and mroot share one shape.
    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${omKids(el)}</m:e></m:rad>`;
    case 'mroot':
      return `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr><m:deg>${arg(1)}</m:deg><m:e>${arg(0)}</m:e></m:rad>`;

    // Sums, products, integrals: the operator with something under and over it.
    // undOvr puts the limits above and below, which is what munderover means;
    // msubsup on the same operator would have put them beside it.
    case 'munderover': {
      const op = kids[0] ? kids[0].textContent.trim() : '';
      return `<m:nary><m:naryPr><m:chr m:val="${esc(op)}"/><m:limLoc m:val="undOvr"/>`
        + `<m:subHide m:val="0"/><m:supHide m:val="0"/></m:naryPr>`
        + `<m:sub>${arg(1)}</m:sub><m:sup>${arg(2)}</m:sup><m:e/></m:nary>`;
    }
    case 'munder':
      return `<m:limLow><m:e>${arg(0)}</m:e><m:lim>${arg(1)}</m:lim></m:limLow>`;
    case 'mover':
      return `<m:limUpp><m:e>${arg(0)}</m:e><m:lim>${arg(1)}</m:lim></m:limUpp>`;

    case 'mtable': {
      const rows = [...el.children].map((tr) =>
        `<m:mr>${[...tr.children].map((td) => `<m:e>${omKids(td)}</m:e>`).join('')}</m:mr>`).join('');
      const cols = Math.max(1, ...[...el.children].map((tr) => tr.children.length));
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/>`
        + `<m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${rows}</m:m>`;
    }
    case 'mtr': case 'mtd':
      return omKids(el);

    // ANYTHING UNKNOWN KEEPS ITS TEXT. A construct we have not taught this
    // converter should look wrong, not disappear: a teacher can query an odd
    // equation and cannot query one that is not there.
    default:
      return omKids(el) || omRun(el.textContent);
  }
}

/** A <math> element as a Word equation. */
export function mathmlToOmml(mathEl) {
  const body = omNode(mathEl);
  return body ? `<m:oMath>${body}</m:oMath>` : '';
}

// ---- the document --------------------------------------------------------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * Build a .docx from the print side.
 *
 * `blocks` is one entry per line: { runs: [ {text} | {omml} ] }. A line that
 * mixes words and an equation — which this app can now produce — comes through
 * as several runs in order, so the sentence reads as it was written.
 */
export function buildDocx(blocks, { title = 'Translate document' } = {}) {
  const paras = blocks.map((b) => {
    const inner = (b.runs || []).map((r) => {
      if (r.omml) return r.omml;
      if (!r.text) return '';
      return `<w:r><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
    }).join('');
    // An empty paragraph still has to exist, or blank lines in the child's work
    // silently close up and the layout stops matching what they wrote.
    return `<w:p>${inner}</w:p>`;
  }).join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<w:body>${paras}<w:sectPr/></w:body>
</w:document>`;

  // [Content_Types].xml goes first: it is how a reader discovers what the other
  // parts are, and some readers insist on finding it at the front.
  return zipStore([
    { name: '[Content_Types].xml', data: enc(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc(ROOT_RELS) },
    { name: 'word/document.xml', data: enc(document) },
  ]);
}
