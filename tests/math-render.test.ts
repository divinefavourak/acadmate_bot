import { describe, expect, it } from 'vitest';
import { prettifyMath, splitMathSegments, hasDisplayMath, codecogsUrl } from '@/utils/math-render';

describe('prettifyMath', () => {
  it('converts superscripts and subscripts with digits', () => {
    expect(prettifyMath('x^2 + y^{10}')).toBe('x² + y¹⁰');
    expect(prettifyMath('a_1 + H_{2}O')).toBe('a₁ + H₂O');
  });

  it('converts symbols, Greek letters, frac and sqrt', () => {
    expect(prettifyMath('\\pi r^2')).toBe('π r²');
    expect(prettifyMath('\\frac{a}{b}')).toBe('(a)/(b)');
    expect(prettifyMath('\\sqrt{2} \\times 3')).toBe('√(2) × 3');
    expect(prettifyMath('\\int x \\leq \\infty')).toBe('∫ x ≤ ∞');
  });

  it('strips inline $…$ delimiters', () => {
    expect(prettifyMath('area is $\\pi r^2$ units')).toBe('area is π r² units');
  });

  it('is Markdown-safe: leaves *bold* and _italic_ untouched', () => {
    expect(prettifyMath('*Score* and _good effort_')).toBe('*Score* and _good effort_');
  });

  it('does not rewrite a digit-leading Markdown italic (_2x_)', () => {
    // The leading `_` opens italics, not a subscript — it must survive.
    expect(prettifyMath('_2x_ is emphasised')).toBe('_2x_ is emphasised');
    // But a real subscript with a base char is still converted.
    expect(prettifyMath('H_2O')).toBe('H₂O');
  });

  it('leaves unmappable superscripts as-is rather than corrupting them', () => {
    // No Unicode superscript for arbitrary letters → keep the literal text.
    expect(prettifyMath('x^a')).toBe('x^a');
  });
});

describe('splitMathSegments', () => {
  it('separates display math from surrounding text', () => {
    const segs = splitMathSegments('Solve: $$x^2 = 9$$ for x.');
    expect(segs).toEqual([
      { type: 'text', content: 'Solve: ' },
      { type: 'math', content: 'x^2 = 9' },
      { type: 'text', content: ' for x.' },
    ]);
  });

  it('handles \\[ … \\] display blocks', () => {
    const segs = splitMathSegments('\\[ E = mc^2 \\]');
    expect(segs).toEqual([{ type: 'math', content: 'E = mc^2' }]);
  });

  it('returns a single text segment when there is no display math', () => {
    expect(splitMathSegments('just text $x^2$')).toEqual([
      { type: 'text', content: 'just text $x^2$' },
    ]);
  });
});

describe('hasDisplayMath', () => {
  it('detects display blocks only', () => {
    expect(hasDisplayMath('inline $x$ only')).toBe(false);
    expect(hasDisplayMath('block $$x$$ here')).toBe(true);
  });
});

describe('codecogsUrl', () => {
  it('builds an encoded PNG url', () => {
    const url = codecogsUrl('x^2');
    expect(url.startsWith('https://latex.codecogs.com/png.image?')).toBe(true);
    expect(url).toContain(encodeURIComponent('x^2'));
  });
});
