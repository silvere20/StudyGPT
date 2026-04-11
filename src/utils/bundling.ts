import type { Chapter } from '../api/client';
import { countWords, sanitizeFilename } from '../utils';

export interface BundleItem {
  chapterId: string;
  originalTitle: string;
  title: string;
  topic: string;
  content: string;
  wordCount: number;
  partIndex: number;
  partCount: number;
  keyConcepts: string[];
  relatedSections: string[];
  searchProfile: string[];
}

export interface Bundle {
  label: string;
  topics: string[];
  chapterIds: string[];
  items: BundleItem[];
  totalWords: number;
  keyConcepts: string[];
  searchHints: string[];
}

type RawBundle = Omit<Bundle, 'label'>;

export function buildBundles(
  chapters: Chapter[],
  maxContentFiles = 18,
  maxWordsPerFile = 8000,
): Bundle[] {
  if (chapters.length === 0) return [];

  let bundles = chapters
    .flatMap((chapter) => splitChapterIntoItems(chapter, maxWordsPerFile))
    .map((item) => makeRawBundle([item]));

  while (bundles.length > maxContentFiles) {
    const bestIndex = findBestAdjacentMerge(bundles, maxWordsPerFile);
    if (bestIndex === -1) break;

    bundles = [
      ...bundles.slice(0, bestIndex),
      makeRawBundle([...bundles[bestIndex].items, ...bundles[bestIndex + 1].items]),
      ...bundles.slice(bestIndex + 2),
    ];
  }

  return bundles.map((bundle, index) => ({
    ...bundle,
    label: buildBundleLabel(bundle, index),
  }));
}

function splitChapterIntoItems(chapter: Chapter, maxWordsPerFile: number): BundleItem[] {
  const parts = splitMarkdownContent(chapter.content, maxWordsPerFile);
  const partCount = parts.length;

  return parts.map((content, index) => ({
    chapterId: chapter.id,
    originalTitle: chapter.title,
    title: partCount > 1 ? `${chapter.title} — Deel ${index + 1}` : chapter.title,
    topic: chapter.topic,
    content,
    wordCount: countWords(content),
    partIndex: index + 1,
    partCount,
    keyConcepts: uniqueStrings(Array.isArray(chapter.key_concepts) ? chapter.key_concepts : []),
    relatedSections: uniqueStrings(
      Array.isArray(chapter.related_sections) ? chapter.related_sections : [],
    ),
    // Only attach search profile to the first part of a split chapter
    searchProfile: index === 0 && Array.isArray(chapter.search_profile) ? chapter.search_profile : [],
  }));
}

function splitMarkdownContent(content: string, maxWordsPerFile: number): string[] {
  const normalized = content.trim();
  if (!normalized) return [''];
  if (countWords(normalized) <= maxWordsPerFile) return [normalized];

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    return splitOversizedBlock(normalized, maxWordsPerFile);
  }

  return packSegments(blocks, maxWordsPerFile, '\n\n');
}

function splitOversizedBlock(block: string, maxWordsPerFile: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];
  if (countWords(trimmed) <= maxWordsPerFile) return [trimmed];

  const lines = trimmed
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length > 1) {
    return packSegments(lines, maxWordsPerFile, '\n');
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length > 1) {
    return packSegments(sentences, maxWordsPerFile, ' ');
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += maxWordsPerFile) {
    chunks.push(words.slice(index, index + maxWordsPerFile).join(' '));
  }
  return chunks;
}

function packSegments(
  segments: string[],
  maxWordsPerFile: number,
  joiner: '\n\n' | '\n' | ' ',
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const segmentParts =
      countWords(trimmed) > maxWordsPerFile
        ? splitOversizedBlock(trimmed, maxWordsPerFile)
        : [trimmed];

    for (const part of segmentParts) {
      const partWords = countWords(part);
      if (currentWords > 0 && currentWords + partWords > maxWordsPerFile) {
        chunks.push(current.join(joiner).trim());
        current = [part];
        currentWords = partWords;
      } else {
        current.push(part);
        currentWords += partWords;
      }
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(joiner).trim());
  }

  return chunks;
}

function makeRawBundle(items: BundleItem[]): RawBundle {
  const topics = uniqueStrings(items.map((item) => item.topic));
  const chapterIds = uniqueStrings(items.map((item) => item.chapterId));
  const keyConcepts = uniqueStrings(items.flatMap((item) => item.keyConcepts));
  const searchHints = uniqueStrings([
    ...topics,
    ...chapterIds,
    ...items.map((item) => item.originalTitle),
    ...items.map((item) => item.title),
    ...keyConcepts,
  ]);

  return {
    topics,
    chapterIds,
    items,
    totalWords: items.reduce((sum, item) => sum + item.wordCount, 0),
    keyConcepts,
    searchHints,
  };
}

function findBestAdjacentMerge(bundles: RawBundle[], maxWordsPerFile: number): number {
  let bestIndex = -1;
  let bestScore: [number, number, number, number] | null = null;

  for (let index = 0; index < bundles.length - 1; index += 1) {
    const left = bundles[index];
    const right = bundles[index + 1];
    const combinedWords = left.totalWords + right.totalWords;
    if (combinedWords > maxWordsPerFile) continue;

    const sameTopic = hasTopicOverlap(left, right) ? 0 : 1;
    const sizeDiff = Math.abs(left.totalWords - right.totalWords);
    const score: [number, number, number, number] = [sameTopic, combinedWords, sizeDiff, index];

    if (bestScore === null || compareScores(score, bestScore) < 0) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function compareScores(
  left: [number, number, number, number],
  right: [number, number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function hasTopicOverlap(left: RawBundle, right: RawBundle): boolean {
  const rightTopics = new Set(right.topics);
  return left.topics.some((topic) => rightTopics.has(topic));
}

function buildBundleLabel(bundle: RawBundle, index: number): string {
  const primaryTopic = bundle.items[0]?.topic || bundle.topics[0] || 'Algemeen';
  const suffix = bundle.topics.length > 1 ? '_en_meer' : '';
  return `Bundle_${String(index + 1).padStart(2, '0')}_${sanitizeFilename(primaryTopic)}${suffix}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}
