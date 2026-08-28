// Scoring shared by the UEB and Nemeth benchmarks.
//
// ONE implementation on purpose. Two copies of a metric drift, and then the two
// codes' numbers stop being comparable without anyone noticing.
//
// TWO MEASURES, because the first one lies:
//
//   clean     — parsed and produced output with no warnings. This is a coverage
//               FLOOR, not an accuracy figure: a confidently wrong answer scores
//               just as well as a right one. UEB sat at "98% clean" while nobody
//               had checked whether the 98% said the right thing.
//
//   faithful  — every identifier, number and operator in the SOURCE MathML also
//               appears in our LaTeX, and we invented nothing extra. This is the
//               automated form of reading the output by eye, which is how x̄ →
//               "xη" and "4-sided shape" → "▫η" were caught. Both parsed clean.
//
// Faithfulness is deliberately a CONTENT check, not a structural one. It cannot
// tell x^{2}+1 from x^{2+1} — bracketing lives in the markup on one side and in
// LaTeX grouping on the other, and comparing those reports differences that are
// not real. What it does catch is content dropped or invented, which is the
// failure mode that hurts a reader most and hides best.

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export const unescapeXml = (s) => s
  .replace(/<!--.*?-->/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(\w+);/g, (_, e) => ENTITY[e] ?? '');

// Characters whose LaTeX spelling differs from the Unicode character, plus
// variants that mean the same thing to a reader (n-ary vs binary set operators,
// the several dot-run and minus characters). Compared on a normalised form so
// "≡" and "\equiv" count as one token.
const NORM = {
  '−': '-', '–': '-', '—': '-', '‐': '-', '⁢': '', '⁡': '', '⁣': '', '⁤': '',
  ' ': '', '⁢': '', '⁡': '',
  '⋅': '*', '·': '*', '×': '*', '∗': '*', '*': '*', '⨯': '*',
  '≡': 'equiv', '≠': 'neq', '≤': 'le', '≥': 'ge', '∈': 'in', '∉': 'notin',
  '⊂': 'subset', '⊆': 'subseteq', '⊃': 'supset', '⊇': 'supseteq',
  '∪': 'cup', '∩': 'cap', '⋃': 'cup', '⋂': 'cap', '∅': 'emptyset', '⌀': 'emptyset',
  '→': 'to', '←': 'gets', '↔': 'lrarrow', '↦': 'mapsto', '⇒': 'implies', '⇔': 'iff',
  '∞': 'infty', '∑': 'sum', '∏': 'prod', '∫': 'int', '√': 'sqrt',
  '∘': 'circ', '≅': 'cong', '∼': 'sim', '≈': 'approx', '∝': 'propto',
  '±': 'pm', '∓': 'mp', '÷': 'div', '∕': '/', '⁄': '/',
  '⋮': 'vdots', '⋱': 'ddots',
  '¯': 'bar', '‾': 'bar', '∠': 'angle', '∥': 'parallel', '⊥': 'perp',
  '∧': 'land', '∨': 'lor', '¬': 'lnot', '∀': 'forall', '∃': 'exists',
  '∂': 'partial', '∇': 'nabla', '∴': 'therefore', '∵': 'because',
  '°': 'circ', '′': "'", '″': "''", '∣': '|', '‖': '|',
  '∶': ':', '⁚': ':', '˚': 'circ',
  // A low line used as an over/under mark is a bar, not punctuation.
  '_': 'bar', '‗': 'bar',
  '▫': 'box', '□': 'box', '⬚': 'box', '▭': 'box',
  // COMBINING accents. A bar written over a letter may arrive as U+00AF,
  // U+203E, U+0304 or U+0305 depending on who produced it; they are one
  // symbol to a reader and must compare equal.
  '̄': 'bar', '̅': 'bar', '̃': 'tilde', '̂': 'hat',
  '̇': 'dot', '̈': 'ddot', '⃗': 'vec', '̲': 'bar',
  '~': 'tilde', '˜': 'tilde', '^': 'hat', 'ˆ': 'hat',
};

// Characters that stand for MORE than one source token, so they must expand or
// they read as content silently dropped: 100℉ carries both ° and F.
const EXPAND = { 
  '℉': ['circ', 'F'], '℃': ['circ', 'C'], '№': ['N', 'o'], '℅': ['c', '/', 'o'],
  '…': ['.', '.', '.'], '⋯': ['.', '.', '.'] 
};

// Function names are ONE LaTeX command but a multi-letter <mi> in the source.
// Expanding them to letters is what makes \log comparable with <mi>log</mi>.
const FUNCTION_CMDS = new Set([
  'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth',
  'lim', 'limsup', 'liminf', 'max', 'min', 'det', 'gcd', 'deg', 'arg',
  'dim', 'ker', 'hom', 'sup', 'inf', 'Pr',
]);

// Presentational spacing, and thousands separators. Both sides must agree on
// these or every large number and every spaced expression reports a difference:
// "3,000" is one <mn> in the source but 3 + , + 000 to a naive tokeniser.
const stripNoise = (s) => String(s)
  .replace(/\\[,;!:]|\\ /g, '')             // \, \; \! \: and escaped space
    .replace(/(\d)[,\s\u00a0\u2009\u202f](?=\d{3}(?!\d))/g, '$1');

const NORM_GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa',
  'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho',
  'σ': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'phi',
  'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi',
  'Π': 'Pi', 'Σ': 'Sigma', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
};

const norm = (t) => NORM[t] ?? NORM_GREEK[t] ?? t;

// Content tokens of the source MathML. Only <mi>/<mn>/<mo>/<mtext> carry
// content; the rest is layout with no token-level equivalent in LaTeX.
export function sourceTokens(mathml) {
  // MathCAT quirk: uses literal period for overdot, which gets slurped by joinNumbers
  mathml = String(mathml).replace(/<mo>\s*\.\s*<\/mo>\s*<\/(mover|munderover)>/g, '<mo>&#x0307;</mo></$1>');

  const toks = [];
  const re = /<(mi|mn|mo|mtext)\b[^>]*>(.*?)<\/\1>/gs;
  let m;
  while ((m = re.exec(mathml))) {
    // NFKC folds the mathematical alphanumerics (U+1D400–U+1D7FF) onto their
    // plain equivalents: a bold digit 𝟖 becomes 8, 𝐱 becomes x. Without this
    // every typeform test scored as content invented-and-dropped, because our
    // output says 8 and the source says 𝟖.
    const raw = stripNoise(unescapeXml(m[2]).normalize('NFKC').trim());
    if (!raw) continue;
    for (const piece of raw.split(/\s+/)) {
      for (const tok of splitPiece(piece)) toks.push(tok);
    }
  }
  return toks;
}

function* splitPiece(piece) {
  // Brackets are structural on our side (\left(, {…}) and would only ever
  // report differences that are not there.
  if ('()[]{}⟨⟩'.includes(piece)) return;
  if (EXPAND[piece]) { yield* EXPAND[piece]; return; }
  const mapped = NORM[piece] ?? NORM_GREEK[piece];
  if (mapped !== undefined) { if (mapped) yield mapped; return; }
  // A multi-letter IDENTIFIER (<mi>sin</mi>, <mi>mod</mi>) has no bracketing in
  // LaTeX, so our side yields the letters separately. Split so both agree — but
  // never a normalised operator name like "equiv", which is one token on both.
  if (/^[A-Za-z]{2,}$/.test(piece)) { yield* piece.split(''); return; }
  // A mixed run such as "5:30" or "x+1" inside one element: split it the same
  // way the LaTeX side will be split, so the two are comparable.
  if (/^[0-9]*\.?[0-9]+$/.test(piece)) { yield piece; return; }
  // Count CODE POINTS, not UTF-16 units: an astral character (𝔽, 𝐱) has
  // .length === 2, so a length test recursed on itself for ever.
  const chars = [...piece];
  if (chars.length > 1 && /[^A-Za-z0-9]/.test(piece)) {
    for (const ch of chars) for (const t of splitPiece(ch)) yield t;
    return;
  }
  if (piece) yield piece;
}

// LaTeX commands that map onto a source character.
const CMD = {
  equiv: 'equiv', neq: 'neq', ne: 'neq', le: 'le', leq: 'le', ge: 'ge', geq: 'ge',
  in: 'in', notin: 'notin', subset: 'subset', subseteq: 'subseteq',
  supset: 'supset', supseteq: 'supseteq', cup: 'cup', cap: 'cap',
  emptyset: 'emptyset', varnothing: 'emptyset', to: 'to', rightarrow: 'to',
  gets: 'gets', leftarrow: 'gets', leftrightarrow: 'lrarrow', mapsto: 'mapsto',
  Rightarrow: 'implies', Leftrightarrow: 'iff', infty: 'infty',
  sum: 'sum', prod: 'prod', int: 'int', circ: 'circ', cong: 'cong',
  sim: 'sim', approx: 'approx', propto: 'propto', pm: 'pm', mp: 'mp',
  div: 'div', ldots: 'ldots', cdots: 'ldots', vdots: 'vdots', ddots: 'ddots',
  ell: 'l',
  angle: 'angle', parallel: 'parallel', perp: 'perp', land: 'land', wedge: 'land',
  lor: 'lor', vee: 'lor', lnot: 'lnot', neg: 'lnot', forall: 'forall',
  exists: 'exists', partial: 'partial', nabla: 'nabla', therefore: 'therefore',
  because: 'because', cdot: '*', times: '*', ast: '*',
  // Accents, normalised to the same names the CHARACTERS normalise to.
  bar: 'bar', overline: 'bar', underline: 'bar', vec: 'vec',
  overrightarrow: 'vec', hat: 'hat', widehat: 'hat', tilde: 'tilde',
  widetilde: 'tilde', dot: 'dot', ddot: 'ddot',
  // \overset/\underset put a mark over/under a base, which is what <mover>
  // and <munder> do; the mark itself is counted, the wrapper is not.
  overset: '', underset: '',
  // Greek commands normalise to the same names as the characters
  ...Object.fromEntries(Object.values(NORM_GREEK).map((g) => [g, g])),
};

// Commands carrying LAYOUT or TYPEFACE rather than content. The source says the
// same thing in markup (msqrt, mfrac, mathvariant), not as a token, so counting
// them as content makes CORRECT output look invented — \mathbf{c} for a bold
// vector was being scored as a fabrication.
// NOTE what is NOT here: the accent commands. An accent is CONTENT — x̄ is not
// x — and the source expresses it as a character (<mo>¯</mo>). Listing \bar and
// \ddot as layout while counting ¯ and ¨ as content made the two sides
// disagree, so correcting x^{¨} to \ddot{x} was scored as a REGRESSION.
const NON_CONTENT = /^(left|right|frac|dfrac|tfrac|begin|end|mathrm|mathbf|mathbb|mathscr|mathcal|mathfrak|mathsf|mathit|boldsymbol|text|textbf|textit|binom|sqrt|square|displaystyle|limits|nolimits|quad|qquad|operatorname|underset|overset|,|;|!|:|\s)$/;

export function latexTokens(latex) {
  const toks = [];
  // Order matters. \\[a-zA-Z]+ first (commands), then escaped punctuation which
  // must be IGNORED, then numbers, letters, operators, and finally any other
  // non-space character.
  //
  // That last branch is not tidiness — without it every non-ASCII character we
  // emit is invisible to the comparison, so output could contain ▫ or ℉ or an
  // outright wrong glyph and still score as faithful. The check for INVENTED
  // content only works if everything we produce is actually counted.
  const re = /\\([a-zA-Z]+)|\\(.)|([0-9]*\.?[0-9]+)|([a-zA-Z])|(\S)/g;
  let m;
  // NFKC on THIS side too. Normalising only the source made correct output look
  // wrong wherever we emit a mathematical alphanumeric ourselves: the source
  // folded 𝐱 to x while our side still said 𝐱.
  let src = stripNoise(String(latex).normalize('NFKC'));
  // \begin{pmatrix} … \end{pmatrix}: the environment NAME is scaffolding, not
  // content — left in, it tokenised as the letters p,m,a,t,r,i,x and made
  // every correctly-read matrix score as invented content. The & separator is
  // layout for the same reason.
  if (/\\begin\{/.test(src)) src = src.replace(/&/g, ' ');   // & is layout only inside an environment
  src = src.replace(/\\(?:begin|end)\{[a-zA-Z*]+\}/g, ' ');
  while ((m = re.exec(src))) {
    if (m[1]) {
      const name = m[1];
      if (FUNCTION_CMDS.has(name)) { toks.push(...name.split('')); continue; }
      const c = CMD[name];
      if (c) toks.push(c);
      else if (NON_CONTENT.test(name)) continue;
      else toks.push(name);
    } else if (m[2]) {
      // \{ \} \| \% … — escaped punctuation. Braces are structural; the rest
      // are content and normalise like any other character.
      if ('{}'.includes(m[2])) continue;
      const t = norm(m[2]);
      if (t) toks.push(t);
    } else if (m[3]) {
      toks.push(m[3]);
    } else if (m[4]) {
      toks.push(m[4]);
    } else if (m[5]) {
      const ch = m[5];
      if ('(){}[]^_&⟨⟩'.includes(ch)) continue;       // grouping / markup ($ is CONTENT)
      if (EXPAND[ch]) { toks.push(...EXPAND[ch]); continue; }
      const t = norm(ch);
      if (t) toks.push(t);
    }
  }
  return toks;
}

// Numbers get SPLIT ACROSS ELEMENTS by MathML authors — 5.72 is very often
// <mn>5</mn><mo>.</mo><mn>72</mn>, and "67 845" is two <mn>s — while our LaTeX
// says 5.72 and 67845. Stripping separators inside one element cannot fix that,
// so adjacent numeric tokens are joined on BOTH sides before comparing.
// Without this, ordinary arithmetic — the commonest thing a child brailles —
// was scoring as wrong far more often than it was wrong.
export function joinNumbers(toks) {
  const out = [];
  const isAcc = (t) => /^(dot|ddot|bar|hat|tilde|vec)$/.test(t);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isNum = /^[0-9]+$/.test(t);
    const isSep = t === '.' || t === ',';
    
    // Check if we have a number/sep, maybe preceded by an accent, preceded by a number/sep
    if (isNum || isSep) {
      let prevIdx = out.length - 1;
      while (prevIdx >= 0 && isAcc(out[prevIdx])) {
        prevIdx--;
      }
      const prev = out[prevIdx];
      if (prev !== undefined && /^[0-9][0-9.,]*$/.test(prev)) {
        out[prevIdx] = prev + t;
        continue;
      }
    }
    out.push(t);
  }
  // a trailing separator was punctuation, not part of the number
  return out.map((t) => (/^[0-9][0-9.,]*[.,]$/.test(t) ? t.slice(0, -1) : t))
            .map((t) => (/^[0-9.,]+$/.test(t) ? t.replace(/,/g, '') : t));
}

// Multiset comparison. Missing = we dropped content; extra = we invented it
// (the "xη" signature).
export function faithfulness(srcToks, gotToks) {
  const count = (a) => a.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const cs = count(joinNumbers(srcToks)), cg = count(joinNumbers(gotToks));
  const missing = [], extra = [];
  for (const [t, n] of cs) { const d = n - (cg.get(t) || 0); if (d > 0) missing.push(`${t}×${d}`); }
  for (const [t, n] of cg) { const d = n - (cs.get(t) || 0); if (d > 0) extra.push(`${t}×${d}`); }
  return { missing, extra, ok: !missing.length && !extra.length };
}

// Run a corpus through `convert` (braille -> {latex, warnings}).
// Cases MathCAT itself marks #[ignore] are carried through but never scored:
// their expected braille is aspirational, so measuring against it is meaningless.
export function scoreCorpus(cases, convert, opts = {}) {
  // Optional third measure. Requires Temml, so the caller supplies it; without
  // it the structural fields are simply absent rather than silently zero.
  const structural = opts.structure || null;
  const results = cases.map((c) => {
    let r;
    try { r = convert(c.braille); }
    catch (err) { r = { latex: '', warnings: ['threw: ' + err.message] }; }
    const latex = r.latex || '';
    const warnings = r.warnings || [];
    const clean = !!latex.trim() && !warnings.length;
    const src = sourceTokens(c.mathml || '');
    const f = src.length
      ? faithfulness(src, latexTokens(latex))
      : { ok: false, missing: ['<no source mathml>'], extra: [] };
    let st = null;
    if (structural && c.mathml) {
      try { st = structural(c.mathml, latex); }
      catch (err) { st = { ok: false, onlySource: ['<temml: ' + err.message + '>'], onlyOurs: [] }; }
    }
    return { ...c, latex, warnings, clean, f, st };
  });

  const scored = results.filter((r) => !r.ignored);
  const n = scored.length;
  return {
    total: n,
    skipped: results.length - n,
    clean: scored.filter((r) => r.clean).length,
    faithful: scored.filter((r) => r.f.ok).length,
    both: scored.filter((r) => r.clean && r.f.ok).length,
    // Only cases that HAVE structure are counted: a flat expression cannot get
    // its shape wrong, and including them would inflate the figure.
    structuralTotal: scored.filter((r) => r.st && r.st.nSource > 0).length,
    structuralOk: scored.filter((r) => r.st && r.st.nSource > 0 && r.st.ok).length,
    results,
    scored,
  };
}
