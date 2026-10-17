export function speakAst(node) {
  if (!node) return '';

  const join = (items, sep = ' ') => items.map(speakAst).filter(Boolean).join(sep);

  switch (node.k) {
    case 'seq': {
      // A MIXED NUMBER IS "2 AND A HALF", not "2 fraction 1 over 2" (the audit).
      // A fraction sitting directly after a number with no operator between is
      // one, and that is the only case where "and" is added.
      const parts = [];
      const items = node.items || [];
      for (let k = 0; k < items.length; k++) {
        const said = speakAst(items[k]);
        if (!said) continue;
        const prev = items[k - 1];
        if (items[k].k === 'frac' && !items[k].binom && prev && prev.k === 'num') {
          // "2 and a half", not "2 and fraction 1 over 2": in a mixed number the
          // fraction is the familiar kind, so it is named the familiar way.
          const NAMED = { '1/2': 'a half', '1/3': 'a third', '2/3': 'two thirds',
                          '1/4': 'a quarter', '3/4': 'three quarters', '1/5': 'a fifth',
                          '2/5': 'two fifths', '3/5': 'three fifths', '4/5': 'four fifths',
                          '1/8': 'an eighth', '3/8': 'three eighths', '1/10': 'a tenth' };
          const key = `${speakAst(items[k].num).trim()}/${speakAst(items[k].den).trim()}`;
          parts.push('and', NAMED[key] || said);
          continue;
        }
        parts.push(said);
      }
      return parts.join(' ');
    }
      
    case 'num':
      // A THIN SPACE IS HOW LATEX GROUPS DIGITS, and it reached the ear as a
      // backslash: "5\\,000\\,000" (2026-09-02, the audit). A voice wants the
      // groups run together - five million, not five backslash comma nought.
      return String(node.text).replace(/\\[,;!:> ]/g, '');
      
    case 'ident':
      // A GREEK LETTER IS AN IDENT WHOSE TEXT IS A COMMAND (2026-09-02, the
      // audit). "x = alpha" spoke as "x equals \\alpha" - a backslash in a
      // child's ear, the same class of fault fixed for \\mathrm{A} the day
      // before, through a path that fix did not cover. 38 of the 735 Nemeth
      // corpus lines carry a Greek letter.
      return /\\/.test(node.text) ? speakTex(node.text) : node.text;
      
    case 'op':
      return speakTex(node.tex);
      
    case 'sym':
      if (node.name === 'open nemeth' || node.name === 'close nemeth') return '';
      return node.name || speakTex(node.tex);
      
    case 'space':
      return '';
      
    case 'chembond':
      if (node.tex === '-') return 'single bond';
      if (node.tex === '=') return 'double bond';
      if (node.tex === '\\equiv ') return 'triple bond';
      return 'bond';
      
    case 'frac':
      // A BINOMIAL IS NOT A FRACTION: "n choose r" is what it is called, and
      // "fraction n over r" is a different thing entirely (2026-09-02).
      if (node.binom) return `${speakAst(node.num)} choose ${speakAst(node.den)}`;
      return `fraction ${speakAst(node.num)} over ${speakAst(node.den)}`;
      
    case 'root': {
      // "the 3 root of" is not how anyone says it (2026-09-02, the audit).
      if (!node.index) return `square root of ${speakAst(node.radicand)}`;
      const ROOT_WORD = { 2: 'square', 3: 'cube', 4: 'fourth', 5: 'fifth', 6: 'sixth',
                          7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' };
      const idx = speakAst(node.index).trim();
      const word = ROOT_WORD[Number(idx)];
      return word
        ? `${word} root of ${speakAst(node.radicand)}`
        : `the ${idx} root of ${speakAst(node.radicand)}`;
    }
      
    case 'group':
      if (node.open === '\\left|' && node.close === '\\right|') {
        return `absolute value of ${speakAst(node.body)}`;
      }
      return `${node.open ? speakTex(node.open) + ' ' : ''}${speakAst(node.body)}${node.close ? ' ' + speakTex(node.close) : ''}`;
      
    case 'table':
      let tOut = `matrix with ${node.rows.length} rows. `;
      node.rows.forEach((row, r) => {
        tOut += `Row ${r+1}: `;
        row.forEach((cell, c) => {
          tOut += speakAst(cell) + (c < row.length - 1 ? ', ' : '. ');
        });
      });
      return tOut;
      
    case 'attached':
      let out = speakAst(node.base);
      if (node.sub) out += ` subscript ${speakAst(node.sub)}`;
      if (node.sup) {
        // Special case common powers
        const supText = speakAst(node.sup);
        if (supText === '2') out += ` squared`;
        else if (supText === '3') out += ` cubed`;
        else out += ` to the power of ${supText}`;
      }
      if (node.over) out += ` over-script ${speakAst(node.over)}`;
      if (node.under) out += ` under-script ${speakAst(node.under)}`;
      return out;
      
    case 'unreadable':
      return 'unreadable';
      
    default:
      return '';
  }
}

// Convert common LaTeX math symbols to English words
function speakTex(tex) {
  const map = {
    '+': 'plus',
    '-': 'minus',
    '\\pm': 'plus or minus',
    // ∓ arrived here the day the Nemeth parser learned to read ⠤⠬ as one
    // sign. Unmapped, the fallback DROPS a command it cannot name, so
    // "3 ∓ 4" was spoken "3 4" - a sign gone with nothing in its place.
    '\\mp': 'minus or plus',
    '=': 'equals',
    '\\neq': 'not equal to',
    '\\approx': 'approximately equal to',
    '<': 'less than',
    '>': 'greater than',
    '\\le': 'less than or equal to',
    '\\ge': 'greater than or equal to',
    '\\cdot': 'times',
    '\\times': 'times',
    '\\div': 'divided by',
    '\\infty': 'infinity',
    // SIGNS THE AUDIT FOUND SILENT OR WRONG (2026-09-02). Each was probed
    // against this speaker: the arrows and shapes came out as a stripped word
    // or nothing at all, and a slashed relation spoke as its opposite - the
    // worst of the set, since "not less than" was being read as "less than".
    '\\leftrightarrow': 'double arrow',
    '\\Leftrightarrow': 'if and only if',
    '\\to': 'goes to',
    '\\mapsto': 'maps to',
    '\\angle': 'angle',
    '\\triangle': 'triangle',
    '\\square': 'square',
    '\\emptyset': 'the empty set',
    '\\varnothing': 'the empty set',
    '\\therefore': 'therefore',
    '\\because': 'because',
    '\\in': 'is in',
    '\\notin': 'is not in',
    '\\cap': 'intersection',
    '\\cup': 'union',
    '\\subset': 'is a subset of',
    '\\subseteq': 'is a subset of or equal to',
    '\\supset': 'contains',
    '\\vee': 'or',
    '\\wedge': 'and',
    '\\neg': 'not',
    '\\lnot': 'not',
    '\\equiv': 'is identical to',
    '\\sim': 'is similar to',
    '\\sum': 'sum of',
    '\\prod': 'product of',
    '\\int': 'integral of',
    '\\oint': 'contour integral of',
    '\\iint': 'double integral of',
    '\\iiint': 'triple integral of',
    '\\land': 'and',
    '\\lor': 'or',
    '\\cong': 'congruent to',
    '\\hbar': 'h-bar',
    '\\Re': 'real part of',
    '\\Im': 'imaginary part of',
    '\\vec': 'vector',
    '\\hat': 'hat',
    '\\bar': 'bar',
    '\\tilde': 'tilde',
    '\\dot': 'dot',
    '\\ddot': 'double dot',
    '\\lim': 'limit',
    '\\infty': 'infinity',
    '\\ldots': 'and so on',
    '\\cdots': 'and so on',
    '\\ast': 'star',
    '\\setminus': 'without',
    '\\circ': 'degrees',
    '\\prime': 'prime',
    '\\partial': 'partial',
    '\\nabla': 'nabla',
    '\\aleph': 'aleph',
    '\\mp': 'minus or plus',
    '\\div': 'divided by',
    '\\times': 'times',
    '\\cdot': 'times',
    '\\le': 'is less than or equal to',
    '\\ge': 'is greater than or equal to',
    '\\ne': 'is not equal to',
    '\\neq': 'is not equal to',
    '\\lambda': 'lambda', '\\mu': 'mu', '\\nu': 'nu', '\\xi': 'xi',
    '\\rho': 'rho', '\\sigma': 'sigma', '\\tau': 'tau', '\\phi': 'phi',
    '\\chi': 'chi', '\\psi': 'psi', '\\omega': 'omega', '\\epsilon': 'epsilon',
    '\\zeta': 'zeta', '\\eta': 'eta', '\\iota': 'iota', '\\kappa': 'kappa',
    '\\delta': 'delta', '\\upsilon': 'upsilon', '\\omicron': 'omicron',
    '\\Gamma': 'capital gamma', '\\Theta': 'capital theta', '\\Lambda': 'capital lambda',
    '\\Xi': 'capital xi', '\\Pi': 'capital pi', '\\Sigma': 'capital sigma',
    '\\Upsilon': 'capital upsilon', '\\Phi': 'capital phi', '\\Psi': 'capital psi',
    '\\Omega': 'capital omega',
    '\\rightarrow': 'right arrow',
    '\\leftarrow': 'left arrow',
    '\\uparrow': 'up arrow',
    '\\downarrow': 'down arrow',
    '\\Rightarrow': 'implies',
    '\\iff': 'if and only if',
    '\\forall': 'for all',
    '\\exists': 'there exists',
    '\\pi': 'pi',
    '\\theta': 'theta',
    '\\alpha': 'alpha',
    '\\beta': 'beta',
    '\\gamma': 'gamma',
    '\\Delta': 'delta',
    '\\sin': 'sine',
    '\\cos': 'cosine',
    '\\tan': 'tangent',
    '\\log': 'log',
    '\\ln': 'natural log',
    '\\sum': 'sum of',
    '\\int': 'integral of',
    '(': 'open bracket',
    ')': 'close bracket',
    '[': 'open bracket',
    ']': 'close bracket',
    '{': 'open bracket',
    '}': 'close bracket',
    '\\left(': 'open bracket',
    '\\right)': 'close bracket',
    '\\left[': 'open bracket',
    '\\right]': 'close bracket',
    '\\left\\{': 'open bracket',
    '\\right\\}': 'close bracket',
    '|': 'vertical bar',
    '\\left|': 'vertical bar',
    '\\right|': 'vertical bar',
    '\\left\\|': 'double vertical bar',
    '\\right\\|': 'double vertical bar',
    ',': 'comma',
    '.': 'point',
    '!': 'factorial',
    '\\%': 'percent'
  };
  const raw = tex.trim();
  if (map[raw]) return map[raw];
  // NOTHING WITH A BACKSLASH IN IT REACHES A CHILD'S EAR (2026-08-28). The
  // fallback simply removed backslashes and spoke the remains, so a LaTeX
  // wrapper the map had no entry for was read out as itself: the Nemeth
  // quadratic ended "over 2 mathrm{A}". Wrappers that carry no sound of their
  // own - \mathrm, \text, the font commands, the thin spaces - are unwrapped
  // to what is INSIDE them, which is the part that was written in braille.
  let t = raw;
  for (let pass = 0; pass < 4; pass++) {
    const was = t;
    t = t.replace(/\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|operatorname|text(?:bf|it|rm)?)\s*\{([^{}]*)\}/g, '$1');
    if (t === was) break;
  }
  t = t.replace(/\\[,;!:> ]/g, ' ')          // thin/medium spaces
       .replace(/[{}]/g, ' ')
       .replace(/\\left|\\right/g, ' ');
  // A trailing command we still do not know is better dropped than spoken:
  // the reader hears the parts we DO know rather than a word of LaTeX.
  t = t.replace(/\\[a-zA-Z]+/g, ' ').replace(/\\/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
