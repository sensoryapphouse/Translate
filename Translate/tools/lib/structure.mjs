// Structural verification: does our output have the same SHAPE as the source?
//
// Why this exists. The faithfulness check compares CONTENT as a multiset, so by
// construction it cannot tell
//     \frac{a}{b}   from  \frac{b}{a}
//     x^{2}+1       from  x^{2+1}
//     \sqrt[3]{27}  from  \sqrt[27]{3}
// Every one of those has identical content and opposite meaning. For a teacher
// reading a child's work, inverted structure is worse than a dropped symbol:
// it is confidently, legibly wrong. That was our largest blind spot.
//
// How it works. Temml (which the app already ships to render the maths) turns
// our LaTeX back into MathML, so both sides end up in the same language and can
// be compared directly:
//
//     braille --(our parser)--> LaTeX --(Temml)--> MathML   vs   source MathML
//
// Comparing whole trees would be far too strict — authored MathML is full of
// redundant <mrow>s and <mspace>s that carry no meaning. Instead we extract the
// RELATIONS that do carry meaning (what is over what, what is inside what) and
// compare those as a multiset:
//
//     <mfrac><mn>1</mn><mn>2</mn></mfrac>   ->   frac(1|2)
//     <msup><mi>x</mi><mn>2</mn></msup>     ->   sup(x|2)
//
// A relation set that matches means every fraction, script, root and modifier
// contains what it should. It deliberately says nothing about ordering at the
// top level — that is the content check's job.

import { readFileSync } from 'node:fs';

// Temml ships as `var temml = …`, which under require() is module-scoped and
// therefore invisible. Evaluate it and hand the binding back.
let temml = null;
// Render the way the APP does. Temml changes STRUCTURE with the mode: in display
// mode \\sum_{a}^{b} becomes <munderover> (limits above and below), inline it is
// <msubsup> (limits beside). The app renders in display mode, so a bench that
// renders inline reports differences that do not exist on screen — it was
// counting every large operator and every \\lim as a structural error.
export function toMathML(temml, latex) {
  return temml.renderToString(String(latex), { displayMode: true });
}

export function loadTemml(bundlePath) {
  if (temml) return temml;
  const src = readFileSync(bundlePath, 'utf8');
  temml = new Function(`${src}; return temml;`)();
  return temml;
}

// --- a minimal MathML reader ------------------------------------------------
// The corpus is well-formed XML fragments, so a tag scanner is enough and keeps
// this dependency-free.
const VOID = new Set(['mspace', 'mprescripts', 'none']);

export function parseMathML(xml) {
  // Strip XML comments FIRST. MathCAT's tests annotate operators as
  // <mo>&#x2212;<!-- &#x2212; --></mo>, and a scanner that keeps the comment
  // reads its text as content: every such operand gained the tokens
  // "!,-,-,-,>" and the structural comparison failed on cases that were right.
  xml = String(xml).replace(/<!--[\s\S]*?-->/g, '');
  const root = { name: '#root', children: [] };
  const stack = [root];
  const re = /<\/?([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) {
      const text = m[4];
      if (text.trim()) stack[stack.length - 1].children.push({ name: '#text', text });
      continue;
    }
    const closing = m[0][1] === '/';
    const name = m[1].replace(/^\w+:/, '');       // drop any namespace prefix
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const node = { name, children: [], parent };
    parent.children.push(node);
    if (!m[3] && !VOID.has(name)) stack.push(node);
  }
  return root;
}

// Wrappers with no mathematical meaning. Flattened away before comparison, or
// the two sides differ purely on how someone chose to nest their markup.
const TRANSPARENT = new Set([
  '#root', 'math', 'mrow', 'mstyle', 'mpadded', 'semantics', 'mtext',
  'menclose', 'mphantom', 'annotation', 'annotation-xml',
]);
const IGNORED = new Set(['mspace', 'annotation', 'annotation-xml', 'none', 'mprescripts']);

// The structural elements whose ARGUMENT ORDER is the meaning.
const RELATIONS = {
  mfrac: 'frac', msup: 'sup', msub: 'sub', msubsup: 'subsup',
  msqrt: 'sqrt', mroot: 'root', munder: 'under', mover: 'over',
  munderover: 'underover',
};

// Flatten a node to its content tokens, using the SAME normaliser as the content
// check so the two measures cannot disagree about what a symbol is.
function tokensOf(node, normLeaf) {
  const out = [];
  const walk = (n) => {
    if (IGNORED.has(n.name)) return;
    if (n.name === '#text') { out.push(...normLeaf(n.text)); return; }
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

// Children that actually count as arguments (skipping empty wrappers).
function argsOf(node) {
  const args = [];
  for (const c of node.children || []) {
    if (IGNORED.has(c.name)) continue;
    if (c.name === '#text' && !c.text.trim()) continue;
    args.push(c);
  }
  return args;
}

export function relationsOf(xml, normLeaf) {
  const rels = [];
  const walk = (n) => {
    const kind = RELATIONS[n.name];
    if (kind) {
      const args = argsOf(n);
      let sig = '';
      if (n.name === 'msqrt') {
        sig = tokensOf(n, normLeaf).join(',');
      } else {
        const base = args[0];
        let baseTokens = tokensOf(base, normLeaf);
        
        // MathCAT quirk: superscripts on matrices are often attached to the closing parenthesis.
        // e.g. <mo>(</mo> <mn>123</mn> <msup> <mo>)</mo> <mi>t</mi> </msup>
        // If the base is a closing bracket, walk backwards among siblings to gather the true base contents.
        if (base && base.name === 'mo' && base.children[0] && /^[\)\]\}]$/.test(base.children[0].text.trim())) {
           const siblings = n.parent ? n.parent.children : [];
           const myIdx = siblings.indexOf(n);
           if (myIdx > 0) {
             const extraTokens = [];
             for (let i = myIdx - 1; i >= 0; i--) {
               const sib = siblings[i];
               if (sib.name === 'mo' && sib.children[0] && /^[\(\[\{]$/.test(sib.children[0].text.trim())) break;
               extraTokens.unshift(...tokensOf(sib, normLeaf));
             }
             baseTokens = extraTokens.concat(baseTokens);
           }
        } else if (base && base.name === 'mi' && baseTokens.length > 1) {
           // Chemistry quirk: MathCAT outputs <msub><mi>FeCl</mi><mn>3</mn></msub>
           // temml/LaTeX outputs <mi>F</mi><mi>e</mi><mi>C</mi><msub><mi>l</mi><mn>3</mn></msub>
           // Normalise the source base to just the last token.
           baseTokens = [baseTokens[baseTokens.length - 1]];
        }
        
        sig = [baseTokens.join(','), ...args.slice(1).map(a => tokensOf(a, normLeaf).join(','))].join('|');
      }
      rels.push(`${kind}(${sig})`);
    }
    for (const c of n.children || []) if (!IGNORED.has(c.name)) walk(c);
  };
  walk(parseMathML(xml));
  return rels;
}

// Compare as multisets. Returns {ok, onlySource, onlyOurs}. `ok` is true when a
// case has no structure at all on either side — nothing to get wrong.
export function compareStructure(sourceXml, ourXml, normLeaf) {
  const a = relationsOf(sourceXml, normLeaf);
  const b = relationsOf(ourXml, normLeaf);
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const onlySource = [], onlyOurs = [];
  for (const [k, n] of ca) { const d = n - (cb.get(k) || 0); if (d > 0) onlySource.push(`${k}×${d}`); }
  for (const [k, n] of cb) { const d = n - (ca.get(k) || 0); if (d > 0) onlyOurs.push(`${k}×${d}`); }
  return { ok: !onlySource.length && !onlyOurs.length, onlySource, onlyOurs, nSource: a.length };
}
