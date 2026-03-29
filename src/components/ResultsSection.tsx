import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Copy, Check, BookOpen,
  Settings, Download, Map as MapIcon,
  ChevronDown, ChevronUp,
  Search, ChevronsDownUp, ChevronsUpDown, Package
} from 'lucide-react';
import { cn, countWords } from '../utils';
import { LazyMarkdown } from './LazyMarkdown';
import { SetupPanel } from './SetupPanel';
import type { StudyPlan, Chapter } from '../api/client';
import type { UploadedFile } from '../types';

interface Props {
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
  onCopyAll: () => void;
  onDownloadAll: () => void;
  onDownloadZip: () => void;
  onDownloadMap: () => void;
  onCopyInstructions: () => void;
  onToggleMapPreview: () => void;
}

export function ResultsSection({
  plan, files, filteredChapters, expandedChapters, filterQuery,
  zipFileCount, totalWords, zipGenerating, copiedId,
  showSetup, showMapPreview, topicRefs,
  onToggleSetup, onToggleChapter, onSetFilterQuery,
  onExpandAll, onCollapseAll, onScrollToTopic,
  onCopyChapterPrompt, onCopyAll, onDownloadAll,
  onDownloadZip, onDownloadMap, onCopyInstructions, onToggleMapPreview,
}: Props) {
  return (
    <motion.div
      key="results"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* Results Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-gray-200 pb-6 gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Jouw Studie Architectuur</h2>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <MapIcon className="w-4 h-4 text-orange-400" />
              {plan.topics.length} onderwerpen
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-orange-400" />
              {plan.chapters.length} hoofdstukken
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">
              ~{totalWords.toLocaleString('nl-NL')} woorden
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-emerald-600 font-semibold flex items-center gap-1">
              <Package className="w-3.5 h-3.5" />
              {zipFileCount} RAG-bestanden
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {files.length > 0 ? files[0].file.name + (files.length > 1 ? ` en ${files.length - 1} andere(n)` : '') : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onToggleSetup}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm border",
              showSetup
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            )}
          >
            <Settings className="w-4 h-4" />
            GPT Setup Guide
          </button>
        </div>
      </div>

      {/* Setup panel */}
      <AnimatePresence>
        {showSetup && (
          <SetupPanel
            plan={plan}
            zipFileCount={zipFileCount}
            zipGenerating={zipGenerating}
            showMapPreview={showMapPreview}
            copiedId={copiedId}
            onDownloadZip={onDownloadZip}
            onDownloadMap={onDownloadMap}
            onCopyInstructions={onCopyInstructions}
            onToggleMapPreview={onToggleMapPreview}
          />
        )}
      </AnimatePresence>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Topic Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          <div className="sticky top-20">
            <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-200 shadow-sm mb-3">
              <h3 className="font-bold text-sm uppercase tracking-widest text-gray-500">Onderwerpen</h3>
              <MapIcon className="w-5 h-5 text-gray-300" />
            </div>
            <div className="space-y-2">
              {plan.topics.map((topicName, topicIdx) => {
                const chaptersInTopic = plan.chapters.filter(c => c.topic === topicName);
                return (
                  <button
                    key={topicIdx}
                    onClick={() => onScrollToTopic(topicIdx)}
                    className="w-full text-left bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:border-orange-300 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-base text-gray-900 group-hover:text-orange-600 transition-colors leading-tight">{topicName}</span>
                      <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md shrink-0 ml-2">{chaptersInTopic.length}</span>
                    </div>
                    <div className="space-y-1">
                      {chaptersInTopic.slice(0, 3).map((c, i) => (
                        <div key={i} className="text-xs text-gray-500 flex items-start gap-2">
                          <div className="w-1 h-1 bg-orange-400 rounded-full mt-1.5 shrink-0" />
                          <span className="leading-snug truncate">{c.title}</span>
                        </div>
                      ))}
                      {chaptersInTopic.length > 3 && (
                        <p className="text-xs text-gray-400 pl-3">+{chaptersInTopic.length - 3} meer</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Chapter Details */}
        <div className="lg:col-span-8 space-y-4">
          {/* Chapter toolbar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-48 relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Zoek in hoofdstukken..."
                  value={filterQuery}
                  onChange={e => onSetFilterQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                />
              </div>
              <button
                onClick={onExpandAll}
                className="text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <ChevronsUpDown className="w-3.5 h-3.5" />
                Alles uitklappen
              </button>
              <button
                onClick={onCollapseAll}
                className="text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <ChevronsDownUp className="w-3.5 h-3.5" />
                Alles inklappen
              </button>
              <button
                onClick={onCopyAll}
                className={cn(
                  "text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap",
                  copiedId === 'copy-all'
                    ? "bg-green-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                {copiedId === 'copy-all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedId === 'copy-all' ? 'Gekopieerd!' : 'Kopieer alles'}
              </button>
              <button
                onClick={onDownloadAll}
                className="text-xs font-bold bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-black transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download (.md)
              </button>
            </div>

            {filterQuery && (
              <p className="text-xs text-gray-400 mt-3 flex items-center gap-2">
                <Search className="w-3 h-3" />
                {filteredChapters.length} van {plan.chapters.length} hoofdstukken gevonden voor "{filterQuery}"
                <button onClick={() => onSetFilterQuery('')} className="text-orange-500 hover:text-orange-700 font-semibold">Wis filter</button>
              </p>
            )}
          </div>

          {/* Chapters grouped by topic */}
          {plan.topics.map((topicName, topicIdx) => {
            const topicChapters = filteredChapters.filter(c => c.topic === topicName);
            if (topicChapters.length === 0) return null;

            return (
              <div
                key={topicIdx}
                ref={el => { if (el) topicRefs.current.set(topicIdx, el); else topicRefs.current.delete(topicIdx); }}
                className="space-y-3"
              >
                <div className="flex items-center gap-3 pt-2">
                  <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-black">{topicIdx + 1}</span>
                  </div>
                  <h3 className="font-extrabold text-lg text-gray-900">{topicName}</h3>
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 font-medium">{topicChapters.length} hoofdstuk{topicChapters.length !== 1 ? 'ken' : ''}</span>
                </div>

                {topicChapters.map((chapter, i) => {
                  const isExpanded = expandedChapters.has(chapter.id);
                  const wordCount = countWords(chapter.content);
                  const globalIdx = plan.chapters.indexOf(chapter);

                  return (
                    <motion.div
                      key={chapter.id || i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: globalIdx * 0.03 }}
                      className={cn(
                        "bg-white border rounded-2xl overflow-hidden transition-all duration-300",
                        isExpanded ? "border-orange-300 shadow-md" : "border-gray-200 shadow-sm hover:border-gray-300"
                      )}
                    >
                      <div className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-gray-400 text-xs font-mono">{chapter.id}</span>
                              <span className="text-xs text-gray-300">·</span>
                              <span className="text-xs text-gray-400">{wordCount.toLocaleString('nl-NL')} woorden</span>
                            </div>
                            <h4 className="text-xl font-bold text-gray-900 leading-tight">{chapter.title}</h4>
                          </div>
                          <button
                            onClick={() => onCopyChapterPrompt(chapter, `c-${globalIdx}`)}
                            className={cn(
                              "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shrink-0",
                              copiedId === `c-${globalIdx}`
                                ? "bg-green-500 text-white shadow-md shadow-green-500/20"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            )}
                          >
                            {copiedId === `c-${globalIdx}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copiedId === `c-${globalIdx}` ? 'Gekopieerd' : 'Kopieer Prompt'}
                          </button>
                        </div>

                        <p className="text-gray-600 text-sm leading-relaxed mb-4">
                          {chapter.summary}
                        </p>

                        <button
                          onClick={() => onToggleChapter(chapter.id)}
                          className="flex items-center gap-2 text-sm font-bold text-orange-600 hover:text-orange-700 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {isExpanded ? 'Verberg Content' : 'Bekijk Volledige Content'}
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-4"
                            >
                              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                                <div className="flex items-center gap-2 mb-3 text-xs font-bold text-gray-400 uppercase tracking-widest">
                                  <FileText className="w-3.5 h-3.5" />
                                  Volledige Content
                                </div>
                                <div className="prose prose-sm max-w-none text-gray-600">
                                  <LazyMarkdown loadingLabel="Hoofdstuk laden...">{chapter.content}</LazyMarkdown>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            );
          })}

          {filteredChapters.length === 0 && filterQuery && (
            <div className="text-center py-16 text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Geen hoofdstukken gevonden voor "{filterQuery}"</p>
              <button onClick={() => onSetFilterQuery('')} className="mt-2 text-sm text-orange-500 hover:text-orange-700 font-semibold">Wis filter</button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
