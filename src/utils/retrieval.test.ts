import { describe, expect, it } from 'vitest';
import { enrichForRetrieval } from './retrieval';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWords(count: number, prefix = 'woord'): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

const BOUNDARY = '<!-- CHUNK_BOUNDARY -->';
const contextLine = (chapterId: string, topicName: string) =>
  `Dit onderdeel behandelt concepten binnen het topic ${topicName} (Hoofdstuk ${chapterId}).`;
const traceMarker = (chapterId: string, topicName: string) =>
  `(Bron: ${chapterId}, ${topicName})`;

// ---------------------------------------------------------------------------
// Original four tests (updated context string to match new CONTEXT_TEMPLATE)
// ---------------------------------------------------------------------------

describe('enrichForRetrieval — boundary insertion', () => {
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

    expect(result).toContain(`Intro tekst.\n\n${BOUNDARY}\n\n### Subkop`);
    expect(result).toContain(`Meer uitleg.\n\n${BOUNDARY}\n\nDEFINITIE:`);
    expect(result).toContain(
      `DEFINITIE: Een afgeleide beschrijft verandering.\n\n${BOUNDARY}\n\nOEFENING:`,
    );
  });
});

describe('enrichForRetrieval — context injection', () => {
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
    const ctx = contextLine('T2-C3', 'Lineaire Algebra');

    expect(result).toContain(`${BOUNDARY}\n\n### Grote sectie\n\n${ctx}\n\n${longParagraph}`);
    expect(result.split(ctx)).toHaveLength(2); // exactly once
    expect(result).toContain('### Korte sectie\n\nkort1 kort2');
  });
});

describe('enrichForRetrieval — trace markers', () => {
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

    expect(result).toContain(`${paragraphTwo} ${traceMarker('T1-C1', 'Calculus')}`);
    expect(result).not.toContain(`tweede1 ${traceMarker('T1-C1', 'Calculus')} tweede2`);
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
    expect(result).not.toContain(`| x | y | ${traceMarker('T3-C2', 'Statistiek')}`);
    expect(result).not.toContain(
      `const formule = 'x + y'; ${traceMarker('T3-C2', 'Statistiek')}`,
    );
    expect(result).toContain(`${paragraphTwo} ${traceMarker('T3-C2', 'Statistiek')}`);
  });
});

// ---------------------------------------------------------------------------
// Group A — Edge cases
// ---------------------------------------------------------------------------

describe('enrichForRetrieval — edge cases', () => {
  it('geeft een lege string terug voor lege invoer', () => {
    expect(enrichForRetrieval('', 'T1-C1', 'Vak')).toBe('');
  });

  it('geeft een lege string terug voor invoer met alleen witruimte', () => {
    expect(enrichForRetrieval('   \n\n\t\n  ', 'T1-C1', 'Vak')).toBe('');
  });

  it('voegt geen boundaries toe als er geen headers of markers zijn', () => {
    const para1 = 'Dit is de eerste alinea.';
    const para2 = 'Dit is de tweede alinea.';
    const input = `${para1}\n\n${para2}`;

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    expect(result).not.toContain(BOUNDARY);
    expect(result).toContain(para1);
    expect(result).toContain(para2);
  });
});

// ---------------------------------------------------------------------------
// Group B — Boundary insertion edge cases
// ---------------------------------------------------------------------------

describe('enrichForRetrieval — boundary edge cases', () => {
  it('plaatst geen dubbele boundary tussen twee opeenvolgende headers', () => {
    const input = [
      '### Eerste sectie',
      '### Tweede sectie',
      'Wat tekst.',
    ].join('\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    // Only one BOUNDARY should appear between the two headers combined
    const doubleBoundary = `${BOUNDARY}\n\n${BOUNDARY}`;
    expect(result).not.toContain(doubleBoundary);
    // Both headers still present
    expect(result).toContain('### Eerste sectie');
    expect(result).toContain('### Tweede sectie');
  });

  it('plaatst ook een boundary vóór de allereerste header in het document', () => {
    // The spec says "immediately before any major headers" — first header included.
    const input = ['### Eerste sectie', 'Tekst.'].join('\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    expect(result.startsWith(BOUNDARY)).toBe(true);
    expect(result).toContain('### Eerste sectie');
  });

  it('plaatst ook een boundary vóór OEFENING als die het eerste blok is', () => {
    const input = "OEFENING: Los op voor x.\n\nEen korte uitleg.";

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    expect(result.startsWith(BOUNDARY)).toBe(true);
    expect(result).toContain('OEFENING:');
  });
});

// ---------------------------------------------------------------------------
// Group C — Context injection thresholds
// ---------------------------------------------------------------------------

describe('enrichForRetrieval — context injection thresholds', () => {
  it('injecteert GEEN contextzin bij exact 500 woorden (grens is > 500)', () => {
    // Heading "### Grens sectie" contributes 3 words; paragraph needs 497 for total = 500.
    const paragraph = makeWords(497, 'grens');
    const input = ['### Grens sectie', paragraph].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');
    const ctx = contextLine('T1-C1', 'Vak');

    expect(result).not.toContain(ctx);
  });

  it('injecteert WEL een contextzin bij 501 woorden', () => {
    // Heading "### Net boven de grens" contributes 5 words; paragraph needs 496 for total = 501.
    const paragraph = makeWords(496, 'ruim');
    const input = ['### Net boven de grens', paragraph].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');
    const ctx = contextLine('T1-C1', 'Vak');

    expect(result).toContain(ctx);
    expect(result.split(ctx)).toHaveLength(2); // injected exactly once
  });

  it('plaatst de contextzin ná de heading en vóór de eerste alinea', () => {
    const paragraph = makeWords(510, 'inhoud');
    const input = ['### Mijn sectie', paragraph].join('\n\n');

    const result = enrichForRetrieval(input, 'T2-C4', 'Thermodynamica');
    const ctx = contextLine('T2-C4', 'Thermodynamica');

    // Correct order: heading → context → paragraph
    const headingPos = result.indexOf('### Mijn sectie');
    const ctxPos = result.indexOf(ctx);
    const paraPos = result.indexOf('inhoud1');

    expect(headingPos).toBeLessThan(ctxPos);
    expect(ctxPos).toBeLessThan(paraPos);
  });
});

// ---------------------------------------------------------------------------
// Group D — Traceability markers (extended)
// ---------------------------------------------------------------------------

describe('enrichForRetrieval — traceability markers (uitgebreid)', () => {
  it('plaatst twee bronmarkers in content met meer dan 1200 woorden', () => {
    // Each paragraph independently exceeds 600 words → each triggers its own marker
    // after the counter resets. Two paragraphs of 620 words → exactly 2 markers.
    const para1 = makeWords(620, 'a');
    const para2 = makeWords(620, 'b');
    const input = [para1, '', para2].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Calculus');
    const marker = traceMarker('T1-C1', 'Calculus');

    const occurrences = result.split(marker).length - 1;
    expect(occurrences).toBe(2);
  });

  it('voegt bronmarker toe met een spatie (niet newline) vóór de markering', () => {
    const para = makeWords(620, 'spatie');
    const result = enrichForRetrieval(para, 'T1-C1', 'Vak');
    const marker = traceMarker('T1-C1', 'Vak');

    // The marker must be appended with a single space separator
    expect(result).toContain(`spatie620 ${marker}`);
    expect(result).not.toContain(`spatie620\n${marker}`);
  });

  it('plaatst geen bronmarker in een lijst-blok', () => {
    // A list block longer than 600 words
    const listItems = Array.from({ length: 80 }, (_, i) => `- item${i + 1} uitleg woordje`).join('\n');
    const result = enrichForRetrieval(listItems, 'T1-C1', 'Vak');
    const marker = traceMarker('T1-C1', 'Vak');

    expect(result).not.toContain(marker);
  });
});

// ---------------------------------------------------------------------------
// Group E — Structural preservation
// ---------------------------------------------------------------------------

describe('enrichForRetrieval — structural preservation', () => {
  it('behoudt ~~~-omheinde codeblokken ongewijzigd', () => {
    const codeContent = 'let x = 1;\nreturn x + 2;';
    const fencedBlock = `~~~js\n${codeContent}\n~~~`;
    const para = makeWords(350, 'pre');
    const para2 = makeWords(300, 'post');
    const input = [para, '', fencedBlock, '', para2].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    expect(result).toContain(fencedBlock);
    // No boundary or trace inside the fence
    expect(result).not.toContain(`~~~js\n${BOUNDARY}`);
    expect(result).not.toContain(`${codeContent} ${traceMarker('T1-C1', 'Vak')}`);
  });

  it('herkent een genummerde lijst als lijst-blok en voegt geen boundary toe', () => {
    const orderedList = ['1. Eerste stap', '2. Tweede stap', '3. Derde stap'].join('\n');
    const input = ['### Sectie', orderedList].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    // The ordered list itself should appear intact
    expect(result).toContain('1. Eerste stap');
    expect(result).toContain('2. Tweede stap');
    // No boundary should appear between the list items
    expect(result).not.toContain(`1. Eerste stap\n\n${BOUNDARY}`);
  });

  it('behoudt de pijpstructuur van tabellen volledig', () => {
    const table = [
      '| Kolom A | Kolom B | Kolom C |',
      '| --- | --- | --- |',
      '| waarde1 | waarde2 | waarde3 |',
      '| waarde4 | waarde5 | waarde6 |',
    ].join('\n');
    const para = makeWords(650, 'omring');
    const input = [para, '', table].join('\n\n');

    const result = enrichForRetrieval(input, 'T1-C1', 'Vak');

    // Table rows must appear consecutively, not split by boundaries or markers
    expect(result).toContain(table);
    // No partial table row mutation
    expect(result).not.toContain('| waarde6 | (Bron:');
  });
});
