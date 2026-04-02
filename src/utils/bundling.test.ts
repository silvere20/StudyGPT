import { describe, expect, it } from 'vitest';
import type { Chapter } from '../api/client';
import { buildBundles } from './bundling';

function makeWords(count: number): string {
  return Array.from({ length: count }, (_, index) => `woord${index + 1}`).join(' ');
}

function makeContent(paragraphWordCounts: number[]): string {
  return paragraphWordCounts
    .map((count, index) => `## Paragraaf ${index + 1}\n${makeWords(count)}`)
    .join('\n\n');
}

function makeChapter(
  id: string,
  topic: string,
  paragraphWordCounts: number[],
  overrides: Partial<Chapter> = {},
): Chapter {
  return {
    id,
    title: overrides.title ?? `${topic} ${id}`,
    summary: overrides.summary ?? `${topic} samenvatting voor ${id}`,
    topic,
    content: overrides.content ?? makeContent(paragraphWordCounts),
    key_concepts: overrides.key_concepts ?? [`kern-${id}`],
    related_sections: overrides.related_sections ?? [],
  };
}

describe('buildBundles', () => {
  it('houdt hoofdstukken onder de limiet 1-op-1', () => {
    const bundles = buildBundles([
      makeChapter('T1-C1', 'Calculus', [1200]),
      makeChapter('T1-C2', 'Algebra', [1500]),
      makeChapter('T1-C3', 'Statistiek', [1700]),
    ]);

    expect(bundles).toHaveLength(3);
    expect(bundles.map((bundle) => bundle.chapterIds)).toEqual([
      ['T1-C1'],
      ['T1-C2'],
      ['T1-C3'],
    ]);
  });

  it('splitst een hoofdstuk boven 8000 woorden in meerdere delen', () => {
    const bundles = buildBundles([
      makeChapter('T1-C1', 'Calculus', [4500, 4500]),
    ]);

    expect(bundles).toHaveLength(2);
    expect(bundles[0].items[0].title).toContain('Deel 1');
    expect(bundles[1].items[0].title).toContain('Deel 2');
    expect(bundles[0].chapterIds).toEqual(['T1-C1']);
    expect(bundles[1].chapterIds).toEqual(['T1-C1']);
  });

  it('merge kleine hoofdstukken tot minder bundles wanneer dat past', () => {
    const bundles = buildBundles(
      [
        makeChapter('T1-C1', 'Calculus', [1000]),
        makeChapter('T1-C2', 'Calculus', [1000]),
        makeChapter('T1-C3', 'Calculus', [1000]),
      ],
      2,
      8000,
    );

    expect(bundles).toHaveLength(2);
    expect(bundles[0].chapterIds).toEqual(['T1-C1', 'T1-C2']);
    expect(bundles[1].chapterIds).toEqual(['T1-C3']);
  });

  it('laat same-topic merges winnen van cross-topic merges', () => {
    const bundles = buildBundles(
      [
        makeChapter('T1-C1', 'Algebra', [2000]),
        makeChapter('T1-C2', 'Algebra', [2000]),
        makeChapter('T2-C1', 'Statistiek', [2000]),
        makeChapter('T3-C1', 'Mechanica', [2000]),
      ],
      2,
      8000,
    );

    expect(bundles).toHaveLength(2);
    expect(bundles[0].chapterIds).toEqual(['T1-C1', 'T1-C2']);
    expect(bundles[1].chapterIds).toEqual(['T2-C1', 'T3-C1']);
  });

  it('laat geen bundle boven de woordlimiet uitkomen', () => {
    const bundles = buildBundles(
      Array.from({ length: 20 }, (_, index) =>
        makeChapter(`T1-C${index + 1}`, 'Calculus', [1000]),
      ),
      2,
      8000,
    );

    expect(bundles.every((bundle) => bundle.totalWords <= 8000)).toBe(true);
  });

  it('blijft boven 18 bundles als verdere merges de woordlimiet zouden breken', () => {
    const bundles = buildBundles(
      Array.from({ length: 19 }, (_, index) =>
        makeChapter(`T1-C${index + 1}`, `Topic${index + 1}`, [5000]),
      ),
      18,
      8000,
    );

    expect(bundles).toHaveLength(19);
  });
});
