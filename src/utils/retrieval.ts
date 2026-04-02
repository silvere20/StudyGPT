const CHUNK_BOUNDARY = '<!-- CHUNK_BOUNDARY -->';
const CONTEXT_THRESHOLD_WORDS = 500;
const TRACE_THRESHOLD_WORDS = 600;
const CONTEXT_TEMPLATE = (
  chapterId: string,
  topicName: string,
) => `*Dit onderdeel behandelt de concepten uit sectie ${chapterId} binnen het topic ${topicName}.*`;
const TRACE_TEMPLATE = (
  chapterId: string,
  topicName: string,
) => `(Bron: ${chapterId}, ${topicName})`;

type BlockType =
  | 'paragraph'
  | 'heading'
  | 'marker'
  | 'list'
  | 'table'
  | 'code'
  | 'boundary';

interface Block {
  type: BlockType;
  text: string;
}

export function enrichForRetrieval(
  content: string,
  chapterId: string,
  topicName: string,
): string {
  const baseBlocks = parseBlocks(content);
  const blocksWithBoundaries = insertBoundaries(baseBlocks);
  const sectionAwareBlocks = injectSectionContext(
    blocksWithBoundaries,
    chapterId,
    topicName,
  );
  const tracedBlocks = injectTraceMarkers(sectionAwareBlocks, chapterId, topicName);

  return tracedBlocks.map((block) => block.text).join('\n\n').trim();
}

function parseBlocks(content: string): Block[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isFenceStart(trimmed)) {
      const { block, nextIndex } = readCodeBlock(lines, index);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (isTableLine(trimmed)) {
      const { block, nextIndex } = readTableBlock(lines, index);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (isImportantHeader(trimmed)) {
      blocks.push({ type: 'heading', text: line });
      index += 1;
      continue;
    }

    if (isMarkerLine(trimmed)) {
      blocks.push({ type: 'marker', text: line });
      index += 1;
      continue;
    }

    if (isListLine(trimmed)) {
      const { block, nextIndex } = readListBlock(lines, index);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    const { block, nextIndex } = readParagraphBlock(lines, index);
    blocks.push(block);
    index = nextIndex;
  }

  return blocks;
}

function insertBoundaries(blocks: Block[]): Block[] {
  const enriched: Block[] = [];

  blocks.forEach((block) => {
    if ((block.type === 'heading' || block.type === 'marker')
      && enriched[enriched.length - 1]?.type !== 'boundary') {
      enriched.push({ type: 'boundary', text: CHUNK_BOUNDARY });
    }

    enriched.push(block);
  });

  return enriched;
}

function injectSectionContext(
  blocks: Block[],
  chapterId: string,
  topicName: string,
): Block[] {
  const result: Block[] = [];
  let sectionBlocks: Block[] = [];

  const flushSection = () => {
    if (sectionBlocks.length === 0) return;

    const totalWords = sectionBlocks.reduce((sum, block) => sum + countSectionWords(block), 0);
    if (totalWords > CONTEXT_THRESHOLD_WORDS) {
      const insertIndex = findContextInsertIndex(sectionBlocks);
      const contextBlock: Block = {
        type: 'paragraph',
        text: CONTEXT_TEMPLATE(chapterId, topicName),
      };

      sectionBlocks = [
        ...sectionBlocks.slice(0, insertIndex),
        contextBlock,
        ...sectionBlocks.slice(insertIndex),
      ];
    }

    result.push(...sectionBlocks);
    sectionBlocks = [];
  };

  blocks.forEach((block) => {
    if (block.type === 'boundary') {
      flushSection();
      result.push(block);
      return;
    }

    sectionBlocks.push(block);
  });

  flushSection();
  return result;
}

function injectTraceMarkers(
  blocks: Block[],
  chapterId: string,
  topicName: string,
): Block[] {
  let runningWords = 0;
  const traceMarker = TRACE_TEMPLATE(chapterId, topicName);

  return blocks.map((block) => {
    if (!isNaturalParagraph(block)) {
      return block;
    }

    const wordCount = countWords(block.text);
    if (wordCount === 0) {
      return block;
    }

    runningWords += wordCount;
    if (runningWords < TRACE_THRESHOLD_WORDS) {
      return block;
    }

    runningWords = 0;
    return {
      ...block,
      text: appendTraceMarker(block.text, traceMarker),
    };
  });
}

function findContextInsertIndex(blocks: Block[]): number {
  let index = 0;
  while (index < blocks.length && (blocks[index].type === 'heading' || blocks[index].type === 'marker')) {
    index += 1;
  }
  return index;
}

function countSectionWords(block: Block): number {
  if (block.type === 'boundary' || block.type === 'code') {
    return 0;
  }
  return countWords(block.text);
}

function appendTraceMarker(text: string, marker: string): string {
  const trimmed = text.trimEnd();
  return `${trimmed} ${marker}`;
}

function readCodeBlock(lines: string[], startIndex: number): { block: Block; nextIndex: number } {
  const openingLine = lines[startIndex];
  const trimmed = openingLine.trim();
  const fence = trimmed.startsWith('~~~') ? '~~~' : '```';
  const collected = [openingLine];
  let index = startIndex + 1;

  while (index < lines.length) {
    collected.push(lines[index]);
    if (lines[index].trim().startsWith(fence)) {
      index += 1;
      break;
    }
    index += 1;
  }

  return {
    block: { type: 'code', text: collected.join('\n') },
    nextIndex: index,
  };
}

function readTableBlock(lines: string[], startIndex: number): { block: Block; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed || !isTableLine(trimmed)) {
      break;
    }
    collected.push(lines[index]);
    index += 1;
  }

  return {
    block: { type: 'table', text: collected.join('\n') },
    nextIndex: index,
  };
}

function readListBlock(lines: string[], startIndex: number): { block: Block; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed) break;
    if (index !== startIndex && isStructuralStart(trimmed)) break;

    collected.push(rawLine);
    index += 1;
  }

  return {
    block: { type: 'list', text: collected.join('\n') },
    nextIndex: index,
  };
}

function readParagraphBlock(lines: string[], startIndex: number): { block: Block; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed) break;
    if (index !== startIndex && isStructuralStart(trimmed)) break;

    collected.push(rawLine);
    index += 1;
  }

  return {
    block: { type: 'paragraph', text: collected.join('\n') },
    nextIndex: index,
  };
}

function isStructuralStart(line: string): boolean {
  return isFenceStart(line)
    || isTableLine(line)
    || isImportantHeader(line)
    || isMarkerLine(line)
    || isListLine(line);
}

function isFenceStart(line: string): boolean {
  return line.startsWith('```') || line.startsWith('~~~');
}

function isTableLine(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|');
}

function isImportantHeader(line: string): boolean {
  return line.startsWith('### ');
}

function isMarkerLine(line: string): boolean {
  return line.startsWith('OEFENING:') || line.startsWith('DEFINITIE:');
}

function isListLine(line: string): boolean {
  return line.startsWith('- ')
    || line.startsWith('* ')
    || line.startsWith('+ ')
    || startsWithOrderedList(line);
}

function startsWithOrderedList(line: string): boolean {
  let index = 0;
  while (index < line.length && isDigit(line[index])) {
    index += 1;
  }
  return index > 0 && line[index] === '.' && line[index + 1] === ' ';
}

function isNaturalParagraph(block: Block): boolean {
  return block.type === 'paragraph';
}

function countWords(text: string): number {
  let count = 0;
  let inWord = false;

  for (const char of text) {
    if (isWhitespace(char)) {
      if (inWord) {
        count += 1;
        inWord = false;
      }
      continue;
    }

    inWord = true;
  }

  return inWord ? count + 1 : count;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r';
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

