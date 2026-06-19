/**
 * Lightweight math rendering for Telegram, which has no native LaTeX/MathML.
 *
 * Two halves of a "hybrid" approach:
 *   • prettifyMath  — rewrites simple inline math to Unicode (x^2 → x², \pi → π,
 *     \frac{a}{b} → (a)/(b)). Markdown-SAFE: it only touches `^`/`_` when
 *     followed by a digit or `{…}`, so it never mangles `*bold*` / `_italic_`.
 *   • splitMathSegments + codecogsUrl — pulls out DISPLAY math ($$…$$ or \[…\])
 *     so the caller can render those as images (you can't embed an image
 *     mid-sentence in Telegram, so only block/display math becomes a picture).
 */

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷',
  '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
};
const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇',
  '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

// LaTeX command → Unicode symbol. Replaced longest-key-first so `\int` wins over `\in`.
const SYMBOLS: Record<string, string> = {
  '\\times': '×', '\\div': '÷', '\\pm': '±', '\\mp': '∓', '\\cdot': '·',
  '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\equiv': '≡',
  '\\infty': '∞', '\\propto': '∝', '\\angle': '∠', '\\degree': '°',
  '\\rightarrow': '→', '\\Rightarrow': '⇒', '\\leftarrow': '←', '\\to': '→',
  '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\partial': '∂', '\\nabla': '∇',
  '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\cup': '∪', '\\cap': '∩',
  '\\forall': '∀', '\\exists': '∃', '\\ldots': '…', '\\cdots': '⋯',
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
  '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\kappa': 'κ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
  '\\sigma': 'σ', '\\tau': 'τ', '\\phi': 'φ', '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
  '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ', '\\Pi': 'Π',
  '\\Sigma': 'Σ', '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
};
const SYMBOL_KEYS = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length);

/** Map a string to super/subscript, or null if any char has no equivalent. */
function toScript(s: string, map: Record<string, string>): string | null {
  let out = '';
  for (const ch of s) {
    if (!(ch in map)) return null;
    out += map[ch];
  }
  return out;
}

/**
 * Rewrite simple inline math to Unicode. Safe to run on Markdown text: `_`/`^`
 * are only consumed when followed by a digit or a `{…}` group (never letters),
 * so italic/bold markers survive.
 */
export function prettifyMath(text: string): string {
  let out = text;

  // \frac{a}{b} → (a)/(b); \sqrt{x} → √(x)
  out = out.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
  out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');

  // Symbols & Greek (longest first).
  for (const key of SYMBOL_KEYS) out = out.split(key).join(SYMBOLS[key]);

  // Superscripts / subscripts: ^{…} or ^<single>, _{…} or _<digit>.
  out = out.replace(/\^\{([^{}]+)\}/g, (m, g) => toScript(g, SUPERSCRIPT) ?? m);
  out = out.replace(/\^([0-9+\-=()ni])/g, (m, g) => toScript(g, SUPERSCRIPT) ?? m);
  out = out.replace(/_\{([0-9+\-=()]+)\}/g, (m, g) => toScript(g, SUBSCRIPT) ?? m);
  out = out.replace(/_([0-9])/g, (m, g) => toScript(g, SUBSCRIPT) ?? m);

  // Tidy leftover LaTeX scaffolding and inline delimiters.
  out = out.replace(/\\left|\\right/g, '');
  out = out.replace(/\\[,;!]/g, ' ');
  out = out.replace(/\\\(|\\\)/g, '');
  out = out.replace(/(?<!\\)\$([^$]+)\$/g, '$1'); // strip inline $…$ delimiters

  return out;
}

export interface MathSegment {
  type: 'text' | 'math';
  content: string;
}

/**
 * Split text into ordered text / display-math segments. Display math is `$$…$$`
 * or `\[…\]`; everything else (including inline `$…$`) stays as text.
 */
export function splitMathSegments(text: string): MathSegment[] {
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
  const segments: MathSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: text.slice(last, m.index) });
    segments.push({ type: 'math', content: (m[1] ?? m[2] ?? '').trim() });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'text', content: text.slice(last) });
  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

/** True if the text contains any display-math block worth rendering as an image. */
export function hasDisplayMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/.test(text);
}

/** Build a CodeCogs URL that renders the given LaTeX as a PNG (no API key needed). */
export function codecogsUrl(latex: string): string {
  return `https://latex.codecogs.com/png.image?${encodeURIComponent(`\\dpi{200}\\bg{white} ${latex}`)}`;
}
