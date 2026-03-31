import { describe, it, expect } from 'vitest';
import { stripMarkdownAndLatex } from './utils';

describe('stripMarkdownAndLatex', () => {
  it('removes inline math $...$', () => {
    const result = stripMarkdownAndLatex('De formule $x^2 + y^2 = z^2$ is bekend.');
    expect(result).not.toContain('$');
    expect(result).toContain('is bekend');
  });

  it('removes display math $$...$$', () => {
    const result = stripMarkdownAndLatex('Zie: $$\\frac{a}{b} = c$$ voor details.');
    expect(result).not.toContain('$');
    expect(result).toContain('voor details');
  });

  it('removes markdown headers', () => {
    expect(stripMarkdownAndLatex('## Hoofdstuk 2')).toBe('Hoofdstuk 2');
    expect(stripMarkdownAndLatex('# Titel')).toBe('Titel');
  });

  it('removes bold markers **...**', () => {
    expect(stripMarkdownAndLatex('**vetgedrukt** woord')).toBe('vetgedrukt woord');
  });

  it('removes italic markers *...*', () => {
    expect(stripMarkdownAndLatex('een *cursief* woord')).toBe('een cursief woord');
  });

  it('normalizes diacritics', () => {
    expect(stripMarkdownAndLatex('oefénïng')).toBe('oefening');
    expect(stripMarkdownAndLatex('formülé')).toBe('formule');
  });

  it('passes plain text through unchanged (modulo whitespace)', () => {
    const plain = 'gewone tekst zonder opmaak';
    expect(stripMarkdownAndLatex(plain)).toBe(plain);
  });
});
