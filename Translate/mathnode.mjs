// The shared representation: a small tree of maths nodes, and a renderer.
//
// WHY A TREE. Both converters currently build LaTeX text as they walk, which
// means the base of an expression is gone by the time a modifier that FOLLOWS it
// needs to attach — braille puts the bar after the x, so x̄ cannot be written
// once "x" has been flattened into a string. It also means the parser cannot
// answer "what did I just read?", which is what every scope rule in both
// standards is phrased in terms of.
//
// WHY PROVENANCE ON EVERY NODE. The app colours braille cells to show which
// produced which characters, and tells a teacher which cell defeated it. That is
// a product requirement, not a nicety, so `at` and `len` are part of the node
// rather than something reconstructed afterwards from warning text.
//
// WHY AN `unreadable` NODE. A child's braille is half-finished and often wrong.
// A parser that throws on bad input is useless here — MathCAT's own
// back-translator returns nothing on a parse error and so reads only 6% of UEB
// and 25% of Nemeth. Unreadable input has to be a VALUE we can carry, render as
// a visible gap, and point at.

// ---- constructors ---------------------------------------------------------
// `at` is the index of the first cell, `len` the number of cells consumed.
export const Seq        = (items, at, len)          => ({ k: 'seq', items, at, len });
export const Num        = (text, at, len)           => ({ k: 'num', text, at, len });
export const Ident      = (text, at, len, upright)  => ({ k: 'ident', text, at, len, upright: !!upright });
export const Op         = (tex, at, len, spaced)    => ({ k: 'op', tex, at, len, spaced: !!spaced });
export const Sym        = (tex, at, len)            => ({ k: 'sym', tex, at, len });
export const Space      = (at)                      => ({ k: 'space', at, len: 1 });
export const Frac       = (num, den, at, len)       => ({ k: 'frac', num, den, at, len });
export const Root       = (radicand, index, at, len) => ({ k: 'root', radicand, index, at, len });
export const Group      = (body, open, close, at, len) => ({ k: 'group', body, open, close, at, len });
export const Table      = (rows, env, at, len)      => ({ k: 'table', rows, env, at, len });
export const ChemBond   = (tex, at, len)            => ({ k: 'chembond', tex, at, len });
export const Unreadable = (cells, at)               => ({ k: 'unreadable', cells, at, len: cells.length });

// A base with scripts and/or marks above and below. One node rather than four,
// because both standards treat "the thing and everything attached to it" as a
// single item, and because a sub and a sup on one base must render as one
// msubsup rather than two separate scripts.
export const Attached = (base, parts, at, len) =>
  ({ k: 'attached', base, sup: parts.sup || null, sub: parts.sub || null,
     over: parts.over || null, under: parts.under || null, at, len });

// ---- rendering ------------------------------------------------------------
// Accents render far better than a stacked character, and a reader expects them:
// x with a bar over it is x̄, not x followed by a macron.
const ACCENT_OVER = {
  bar: '\\bar', tilde: '\\tilde', hat: '\\hat', dot: '\\dot', ddot: '\\ddot',
  vec: '\\vec', arc: '\\overset{\\frown}',
};
const ACCENT_UNDER = { bar: '\\underline' };

// Operators that take their marks ABOVE and BELOW rather than beside: LaTeX
// already does this for _ and ^ in display mode, which is how the app renders.
const LARGE_OP = /\\(sum|prod|int|oint|bigcup|bigcap|lim|limsup|liminf|max|min|sup|inf)(?![a-zA-Z])|[∑∏∫⋃⋂]/;

const needsBraces = (s) => [...String(s)].length !== 1;
const wrap = (s) => (needsBraces(s) ? `{${s}}` : `{${s}}`);

export function render(node) {
  const chunks = renderChunk(node);
  const spans = [];
  let tex = '';
  for (const c of chunks) {
    if (!c.str) continue;
    const t0 = tex.length;
    tex += c.str;
    if (c.n && c.n.at !== undefined) {
      spans.push({ c0: c.n.at, c1: c.n.at + (c.n.len || 1), t0, t1: tex.length });
    }
  }
  return { latex: tex, spans };
}

function renderChunk(node) {
  if (!node) return [];
  switch (node.k) {
    case 'seq':   return node.items.flatMap(renderChunk);
    case 'num':   return [{ str: node.text, n: node }];
    case 'ident': return [{ str: node.upright ? `\\mathrm{${node.text}}` : node.text, n: node }];
    case 'op':    return [{ str: node.spaced ? ` ${node.tex} ` : node.tex, n: node }];
    case 'sym':   return [{ str: node.tex, n: node }];
    case 'space': return [{ str: ' ', n: node }];
    case 'frac':  return [
      { str: '\\frac{', n: node }, ...renderChunk(node.num),
      { str: '}{', n: node }, ...renderChunk(node.den), { str: '}', n: node }
    ];
    case 'root':  return node.index
      ? [{ str: '\\sqrt[', n: node }, ...renderChunk(node.index), { str: ']{', n: node }, ...renderChunk(node.radicand), { str: '}', n: node }]
      : [{ str: '\\sqrt{', n: node }, ...renderChunk(node.radicand), { str: '}', n: node }];
    case 'group': return [{ str: node.open, n: node }, ...renderChunk(node.body), { str: node.close, n: node }];
    case 'table': return renderTableChunk(node);
    case 'chembond': return [{ str: node.tex, n: node }];
    case 'attached': return renderAttachedChunk(node);
    case 'unreadable': return [{ str: '\\square ', n: node }];
    default: return [];
  }
}

function renderAttachedChunk(n) {
  let baseChunks = renderChunk(n.base);
  const baseTex = baseChunks.map(c => c.str).join('');
  const isLarge = LARGE_OP.test(baseTex);

  if (n.over || n.under) {
    if (isLarge) {
      if (n.under) baseChunks = [...baseChunks, { str: '_{', n }, ...renderChunk(n.under), { str: '}', n }];
      if (n.over) baseChunks = [...baseChunks, { str: '^{', n }, ...renderChunk(n.over), { str: '}', n }];
    } else {
      if (n.over) {
        const acc = n.over.accent && ACCENT_OVER[n.over.accent];
        if (acc) {
          baseChunks = [{ str: acc + '{', n: n.over }, ...baseChunks, { str: '}', n: n.over }];
        } else {
          baseChunks = [{ str: '\\overset{', n: n.over }, ...renderChunk(n.over), { str: '}{', n: n.over }, ...baseChunks, { str: '}', n: n.over }];
        }
      }
      if (n.under) {
        const acc = n.under.accent && ACCENT_UNDER[n.under.accent];
        if (acc) {
          baseChunks = [{ str: acc + '{', n: n.under }, ...baseChunks, { str: '}', n: n.under }];
        } else {
          baseChunks = [{ str: '\\underset{', n: n.under }, ...renderChunk(n.under), { str: '}{', n: n.under }, ...baseChunks, { str: '}', n: n.under }];
        }
      }
    }
  }
  if (n.sub) baseChunks = [...baseChunks, { str: '_{', n }, ...renderChunk(n.sub), { str: '}', n }];
  if (n.sup) baseChunks = [...baseChunks, { str: '^{', n }, ...renderChunk(n.sup), { str: '}', n }];
  return baseChunks;
}

function renderTableChunk(node) {
  let chunks = [{ str: `\\begin{${node.env}}`, n: node }];
  for (let r = 0; r < node.rows.length; r++) {
    const row = node.rows[r];
    for (let c = 0; c < row.length; c++) {
      chunks.push(...renderChunk(row[c]));
      if (c < row.length - 1) chunks.push({ str: ' & ', n: node });
    }
    if (r < node.rows.length - 1) chunks.push({ str: ' \\\\ ', n: node });
  }
  chunks.push({ str: `\\end{${node.env}}`, n: node });
  return chunks;
}

// ---- provenance -----------------------------------------------------------
// Which cells could not be read, so the display can mark them.
export function badCells(node, into = []) {
  if (!node) return into;
  if (node.k === 'unreadable') {
    for (let i = 0; i < node.len; i++) into.push(node.at + i);
    return into;
  }
  if (node.k === 'table') {
    node.rows.forEach(r => r.forEach(c => badCells(c, into)));
    return into;
  }
  for (const key of ['items', 'base', 'num', 'den', 'radicand', 'index', 'body', 'sup', 'sub', 'over', 'under']) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => badCells(x, into));
    else if (v && typeof v === 'object') badCells(v, into);
  }
  return into;
}
