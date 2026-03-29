import { createContext, useContext } from 'react';
import type { StudyPlan, Chapter } from '../api/client';
import type { UploadedFile } from '../types';

export interface ResultsContextValue {
  plan: StudyPlan;
  files: UploadedFile[];
  filteredChapters: Chapter[];
  expandedChapters: Set<string>;
  filterQuery: string;
  zipFileCount: number;
  totalWords: number;
  zipGenerating: boolean;
  copiedId: string | null;
  showSetup: boolean;
  showMapPreview: boolean;
  topicRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onToggleSetup: () => void;
  onToggleChapter: (id: string) => void;
  onSetFilterQuery: (q: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onScrollToTopic: (idx: number) => void;
  onCopyChapterPrompt: (chapter: Chapter, copyId: string) => void;
  studiedChapters: Set<string>;
  onToggleStudied: (id: string) => void;
  onClearProgress: () => void;
  onCopyAll: () => void;
  onDownloadAll: () => void;
  onDownloadZip: () => void;
  onDownloadMap: () => void;
  onCopyInstructions: () => void;
  onToggleMapPreview: () => void;
}

const ResultsContext = createContext<ResultsContextValue | null>(null);

export function useResultsContext(): ResultsContextValue {
  const ctx = useContext(ResultsContext);
  if (!ctx) throw new Error('useResultsContext must be used inside ResultsContext.Provider');
  return ctx;
}

export { ResultsContext };
