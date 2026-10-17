// A SMALL, NAMESPACE-AWARE XML PARSER.
//
// WHY THIS EXISTS (PB, 10 Oct 2026: "yes, we should open other people's
// ebraille"). ebraille.mjs read .ebrl packages with regular expressions, which
// worked because every file it had ever been given was written by us. A code
// audit rated that Low-Medium and was right about the reason: the patterns
// encode OUR serialisation, not the format. They require double-quoted
// attributes, the literal prefixes `dc:` and `a11y:`, a `<math>` element with
// no prefix at all, and they match element bodies non-greedily, which any
// nesting defeats. All of those are free choices an XML producer may make
// differently while writing a perfectly valid file.
//
// WHY NOT DOMParser. The browser has one; Node does not, and the eBraille
// suites run in Node. Using DOMParser where it exists and regexes where it
// does not would mean the tests exercise a code path that never ships, which
// is the opposite of what a test is for. This parser runs in both.
//
// WHY NOT A LIBRARY. The app is build-free and self-hosts everything it uses.
//
// WHAT IT HANDLES, because a parser's value is in what it does NOT trip over:
// the XML declaration, doctype, comments, processing instructions, CDATA,
// attributes quoted either way with any spacing around `=`, self-closing
// elements, namespace declarations (default and prefixed), numeric and named
// character references, and nesting of any depth.
//
// WHAT IT DELIBERATELY DOES NOT DO: validate. A reader that refuses a file is
// no better to a teacher than one that misreads it, so unknown markup is
// carried through as structure and left to the caller to ignore.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Expand the character references an XML document may contain. */
export function unescapeXml(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] !== undefined ? NAMED[body] : whole;   // unknown: leave it alone
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attributesOf(raw) {
  const out = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(raw))) out[m[1]] = unescapeXml(m[3] !== undefined ? m[3] : m[4]);
  return out;
}

/**
 * Parse XML (or the XHTML an .ebrl carries) into a tree.
 *
 * Every element node is { name, local, ns, attrs, attr(localName), children,
 * text() }, where `local` is the name with any prefix removed and `ns` is the
 * resolved namespace URI. Reading by `local` is what makes a file that writes
 * <dc:title>, <d:title> or a default-namespaced <title> all read the same.
 */
export function parseXml(src) {
  const text = String(src ?? '');
  const root = makeNode('#document', {}, null);
  const stack = [root];
  let i = 0;

  const push = (node) => { stack[stack.length - 1].children.push(node); };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) { addText(stack[stack.length - 1], text.slice(i)); break; }
    if (lt > i) addText(stack[stack.length - 1], text.slice(i, lt));

    // CDATA is literal text, NOT markup: the one place where < and & inside
    // the document mean themselves, which is exactly why it is used.
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      const body = end === -1 ? text.slice(lt + 9) : text.slice(lt + 9, end);
      stack[stack.length - 1].children.push({ cdata: true, raw: body });
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<!--', lt)) {                    // comment
      const end = text.indexOf('-->', lt);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {                      // declaration / PI
      const end = text.indexOf('?>', lt);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {                      // doctype, internal subset and all
      let depth = 0, k = lt;
      for (; k < text.length; k += 1) {
        if (text[k] === '<') depth += 1;
        else if (text[k] === '>') { depth -= 1; if (depth === 0) break; }
      }
      i = k === text.length ? text.length : k + 1;
      continue;
    }

    const gt = findTagEnd(text, lt);
    if (gt === -1) { addText(stack[stack.length - 1], text.slice(lt)); break; }
    const inner = text.slice(lt + 1, gt);

    if (inner[0] === '/') {                               // closing tag
      const name = inner.slice(1).trim();
      // Close the nearest matching ancestor. A stray close tag that matches
      // nothing is ignored rather than unwinding the whole document.
      for (let d = stack.length - 1; d > 0; d -= 1) {
        if (stack[d].name === name) { stack.length = d; break; }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const name = (body.match(/^[^\s/>]+/) || [''])[0];
    const attrs = attributesOf(body.slice(name.length));
    const parent = stack[stack.length - 1];
    const node = makeNode(name, attrs, parent);
    push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root;
}

// The end of a tag is the first > that is not inside an attribute's quotes —
// an href or an alt may legitimately contain one.
function findTagEnd(text, from) {
  let quote = '';
  for (let k = from + 1; k < text.length; k += 1) {
    const ch = text[k];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return k;
  }
  return -1;
}

function addText(node, raw) {
  if (raw) node.children.push({ text: raw });
}

function makeNode(name, attrs, parent) {
  const colon = name.indexOf(':');
  const prefix = colon === -1 ? '' : name.slice(0, colon);
  const local = colon === -1 ? name : name.slice(colon + 1);

  // Namespaces are resolved against the ancestors as the tree is built, which
  // is what lets a caller ask for an element by meaning rather than by the
  // prefix a particular producer happened to choose.
  const declared = Object.create(parent ? parent.nsMap : null);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'xmlns') declared[''] = v;
    else if (k.startsWith('xmlns:')) declared[k.slice(6)] = v;
  }

  const node = {
    name,
    local,
    prefix,
    attrs: attrs || {},
    nsMap: declared,
    ns: declared[prefix] || (prefix ? '' : declared[''] || ''),
    children: [],
  };

  /** An attribute by LOCAL name, so id, xml:id and foo:id all answer. */
  node.attr = (want) => {
    if (node.attrs[want] !== undefined) return node.attrs[want];
    for (const [k, v] of Object.entries(node.attrs)) {
      const c = k.indexOf(':');
      if (c !== -1 && k.slice(c + 1) === want) return v;
    }
    return undefined;
  };
  /** Every descendant element whose LOCAL name matches, in document order. */
  node.find = (want) => {
    const out = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (c.local === undefined) continue;
        if (c.local === want) out.push(c);
        walk(c);
      }
    }(node));
    return out;
  };
  /** Direct children only — for cases where nesting must NOT be flattened. */
  node.kids = (want) => (node.children || [])
    .filter((c) => c.local !== undefined && (want === undefined || c.local === want));
  /** All text beneath this element, references expanded, CDATA included. */
  node.text = () => {
    let s = '';
    (function walk(n) {
      for (const c of n.children || []) {
        if (c.cdata) s += c.raw;
        else if (c.text !== undefined) s += unescapeXml(c.text);
        else walk(c);
      }
    }(node));
    return s;
  };
  /** This element serialised back, used where markup must be kept verbatim. */
  node.outerXml = () => serialise(node);
  return node;
}

function serialise(node) {
  if (node.cdata) return `<![CDATA[${node.raw}]]>`;
  if (node.text !== undefined && node.local === undefined) return node.text;
  const attrs = Object.entries(node.attrs || {})
    .map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}"`)
    .join('');
  const inner = (node.children || []).map(serialise).join('');
  return inner ? `<${node.name}${attrs}>${inner}</${node.name}>` : `<${node.name}${attrs}/>`;
}
