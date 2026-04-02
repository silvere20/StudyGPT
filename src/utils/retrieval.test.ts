import { describe, expect, it } from 'vitest';
import { enrichForRetrieval } from './retrieval';

function makeWords(count: number, prefix = 'woord'): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

describe('enrichForRetrieval', () => {
  it('plaatst CHUNK_BOUNDARY direct voor headers, definities en oefeningen', () => {
    const input = [
      'Intro tekst.',
      '',
      '### Subkop',
      'Meer uitleg.',
      '',
      'DEFINITIE: Een afgeleide beschrijft verandering.',
      '',
      "OEFENING: Bereken f'(x).",
    ].join('\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Calculus');

    expect(result).toContain('Intro tekst.\n\n<!-- CHUNK_BOUNDARY -->\n\n### Subkop');
    expect(result).toContain('Meer uitleg.\n\n<!-- CHUNK_BOUNDARY -->\n\nDEFINITIE:');
    expect(result).toContain('DEFINITIE: Een afgeleide beschrijft verandering.\n\n<!-- CHUNK_BOUNDARY -->\n\nOEFENING:');
  });

  it('injecteert een contextzin alleen in secties groter dan 500 woorden', () => {
    const longParagraph = makeWords(520, 'lang');
    const shortParagraph = makeWords(40, 'kort');
    const input = [
      '### Grote sectie',
      longParagraph,
      '',
      '### Korte sectie',
      shortParagraph,
    ].join('\n\n');

    const result = enrichForRetrieval(input, 'T2-C3', 'Lineaire Algebra');
    const contextLine = '*Dit onderdeel behandelt de concepten uit sectie T2-C3 binnen het topic Lineaire Algebra.*';

    expect(result).toContain(`<!-- CHUNK_BOUNDARY -->\n\n### Grote sectie\n\n${contextLine}\n\n${longParagraph}`);
    expect(result.split(contextLine)).toHaveLength(2);
    expect(result).toContain('### Korte sectie\n\nkort1 kort2');
  });

  it('plaatst bronmarkers aan het einde van een natuurlijke alinea', () => {
    const paragraphOne = makeWords(320, 'eerste');
    const paragraphTwo = makeWords(320, 'tweede');
    const input = [
      '### Trace sectie',
      paragraphOne,
      '',
      paragraphTwo,
    ].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Calculus');

    expect(result).toContain(`${paragraphTwo} (Bron: T1-C1, Calculus)`);
    expect(result).not.toContain(`tweede1 (Bron: T1-C1, Calculus) tweede2`);
  });

  it('plaatst geen bronmarker in tabellen of codeblokken', () => {
    const paragraphOne = makeWords(350, 'theorie');
    const paragraphTwo = makeWords(300, 'vervolg');
    const table = ['| kolom | waarde |', '| --- | --- |', '| x | y |'].join('\n');
    const codeBlock = ['```ts', "const formule = 'x + y';", '```'].join('\n');
    const input = [
      '### Sectie',
      paragraphOne,
      '',
      table,
      '',
      codeBlock,
      '',
      paragraphTwo,
    ].join('\n\n');

    const result = enrichForRetrieval(input, 'T3-C2', 'Statistiek');

    expect(result).toContain(table);
    expect(result).toContain(codeBlock);
    expect(result).not.toContain('| x | y | (Bron: T3-C2, Statistiek)');
    expect(result).not.toContain("const formule = 'x + y'; (Bron: T3-C2, Statistiek)");
    expect(result).toContain(`${paragraphTwo} (Bron: T3-C2, Statistiek)`);
  });
});
