export function speakAst(node) {
  if (!node) return '';

  const join = (items, sep = ' ') => items.map(speakAst).filter(Boolean).join(sep);

  switch (node.k) {
    case 'seq':
      return join(node.items);
      
    case 'num':
      return node.text;
      
    case 'ident':
      return node.text;
      
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
      return `fraction ${speakAst(node.num)} over ${speakAst(node.den)}`;
      
    case 'root':
      if (node.index) {
        return `the ${speakAst(node.index)} root of ${speakAst(node.radicand)}`;
      }
      return `square root of ${speakAst(node.radicand)}`;
      
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
