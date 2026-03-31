import { describe, it, expect } from 'vitest';
import { buildBundles } from './bundling';

function topics(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Topic${i + 1}`);
}

describe('buildBundles', () => {
  it('5 topics → 5 bundles (1:1)', () => {
    const bundles = buildBundles(topics(5));
    expect(bundles).toHaveLength(5);
    bundles.forEach((b, i) => {
      expect(b.topics).toEqual([`Topic${i + 1}`]);
    });
  });

  it('18 topics → 18 bundles (1:1)', () => {
    const bundles = buildBundles(topics(18));
    expect(bundles).toHaveLength(18);
    bundles.forEach(b => expect(b.topics).toHaveLength(1));
  });

  it('19 topics → 18 bundles (last two merged)', () => {
    const bundles = buildBundles(topics(19));
    expect(bundles).toHaveLength(18);
    expect(bundles[17].topics).toEqual(['Topic18', 'Topic19']);
  });

  it('30 topics → 18 bundles (topics 18–30 merged)', () => {
    const bundles = buildBundles(topics(30));
    expect(bundles).toHaveLength(18);
    expect(bundles[17].topics).toHaveLength(13); // topics 18..30
    expect(bundles[17].topics[0]).toBe('Topic18');
    expect(bundles[17].topics[12]).toBe('Topic30');
  });

  it('each bundle label is a non-empty string', () => {
    const bundles = buildBundles(topics(20));
    bundles.forEach(b => expect(b.label.length).toBeGreaterThan(0));
  });

  it('total topics across all bundles equals input length', () => {
    const input = topics(25);
    const bundles = buildBundles(input);
    const total = bundles.reduce((sum, b) => sum + b.topics.length, 0);
    expect(total).toBe(25);
  });
});
