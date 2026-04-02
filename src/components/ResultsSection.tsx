import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Copy, Check, BookOpen,
  Settings, Download, Map as MapIcon,
  ChevronDown, ChevronUp,
  Search, ChevronsDownUp, ChevronsUpDown, Package,
  CircleCheck, Circle, Trash2, GripVertical,
  Pencil, X, Loader2, AlertTriangle,
} from 'lucide-react';
import { cn, countWords } from '../utils';
import { LazyMarkdown } from './LazyMarkdown';
import { SetupPanel } from './SetupPanel';
import { useResultsContext } from '../context/ResultsContext';

export function ResultsSection() {
  const {
    plan, files, filteredChapters, expandedChapters, filterQuery,
    zipFileCount, totalWords, copiedId,
    showSetup, topicRefs,
    topicOrder, onReorderTopics,
    studiedChapters, onToggleStudied, onClearProgress,
    onToggleSetup, onToggleChapter, onSetFilterQuery,
    onExpandAll, onCollapseAll, onScrollToTopic,
    onCopyChapterPrompt, onCopyAll, onDownloadAll,
    editedChapterIds, onEditChapter, searchInputRef,
  } = useResultsContext();

  // Drag-and-drop state for topic reordering
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Chapter inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; summary: string; content: string }>({
    title: '', summary: '', content: '',
  });

  // PDF export state
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const studiedCount = plan.chapters.filter(ch => studiedChapters.has(ch.id)).length;
  const totalChapters = plan.chapters.length;
  const progressPercent = totalChapters > 0 ? Math.round((studiedCount / totalChapters) * 100) : 0;
  const verificationBanner = plan.verificationReport?.status !== 'OK'
    ? plan.verificationReport
    : null;
  const wordRetentionPercent = verificationBanner
    ? Math.round(verificationBanner.word_ratio * 100)
    : null;

  return (
    <motion.div
      key="results"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* Results Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-gray-200 dark:border-gray-700 pb-6 gap-4">
        <div className="flex-1">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Jouw Studie Architectuur</h2>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <MapIcon className="w-4 h-4 text-orange-400" />
              {plan.topics.length} onderwerpen
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-orange-400" />
              {plan.chapters.length} hoofdstukken
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              ~{totalWords.toLocaleString('nl-NL')} woorden
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-sm text-emerald-600 font-semibold flex items-center gap-1">
              <Package className="w-3.5 h-3.5" />
              {zipFileCount} RAG-bestanden
            </span>
          </div>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {files.length > 0 ? files[0].file.name + (files.length > 1 ? ` en ${files.length - 1} andere(n)` : '') : ''}
          </p>

          {/* Progress bar */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                <CircleCheck className="w-3.5 h-3.5 text-emerald-500" />
                {studiedCount}/{totalChapters} bestudeerd
              </span>
              <span className="text-gray-400 dark:text-gray-500">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onToggleSetup}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm border",
              showSetup
                ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white"
                : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            )}
          >
            <Settings className="w-4 h-4" />
            GPT Setup Guide
          </button>
        </div>
      </div>

      {verificationBanner && (
        <div
          role="alert"
          className={cn(
            "rounded-2xl border px-5 py-4 shadow-sm",
            verificationBanner.status === 'CRITICAL'
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
              : "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100"
          )}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-wide">
                  {verificationBanner.status === 'CRITICAL'
                    ? 'Kritieke waarschuwing voor contentbehoud'
                    : 'Waarschuwing voor contentbehoud'}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {wordRetentionPercent}% tekst behouden · oefeningen {verificationBanner.exercise_count_generated}/{verificationBanner.exercise_count_original}
                </p>
              </div>
              <div className="space-y-1">
                {verificationBanner.issues.map((issue) => (
                  <p key={issue} className="text-sm leading-relaxed">
                    {issue}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Setup panel */}
      <AnimatePresence>
        {showSetup && <SetupPanel />}
      </AnimatePresence>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Topic Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          <div className="sticky top-20">
            <div className="flex items-center justify-between bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm mb-3">
              <h3 className="font-bold text-sm uppercase tracking-widest text-gray-500 dark:text-gray-400">Onderwerpen</h3>
              <MapIcon className="w-5 h-5 text-gray-300 dark:text-gray-600" />
            </div>
            <div className="space-y-2">
              {topicOrder.map((topicName, topicIdx) => {
                const chaptersInTopic = plan.chapters.filter(c => c.topic === topicName);
                const studiedInTopic = chaptersInTopic.filter(c => studiedChapters.has(c.id)).length;
                const allStudied = studiedInTopic === chaptersInTopic.length;
                const isDragging = dragIdx === topicIdx;
                const isOver = overIdx === topicIdx && !isDragging;

                return (
                  <div
                    key={topicName}
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(topicIdx);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (overIdx !== topicIdx) setOverIdx(topicIdx);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx !== null && dragIdx !== topicIdx) {
                        const next = [...topicOrder];
                        const [removed] = next.splice(dragIdx, 1);
                        next.splice(topicIdx, 0, removed);
                        onReorderTopics(next);
                      }
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    className={cn(
                      "w-full text-left bg-white dark:bg-gray-900 border rounded-2xl shadow-sm transition-all group",
                      isDragging   ? "opacity-40 border-orange-300 dark:border-orange-600" :
                      isOver       ? "border-orange-400 dark:border-orange-500 shadow-md ring-2 ring-orange-300/50 dark:ring-orange-600/40" :
                                     "border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-500 hover:shadow-md"
                    )}
                  >
                    <div className="flex items-start gap-1 p-4">
                      {/* Drag handle */}
                      <div
                        className="shrink-0 mt-0.5 cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
                        title="Versleep om volgorde te wijzigen"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>

                      {/* Content — click scrolls to section */}
                      <button
                        onClick={() => onScrollToTopic(topicName)}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-base text-gray-900 dark:text-gray-100 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors leading-tight">{topicName}</span>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className={cn(
                              "text-xs font-bold px-2 py-1 rounded-md",
                              allStudied
                                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                            )}>
                              {studiedInTopic}/{chaptersInTopic.length}
                              {allStudied && ' ✓'}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {chaptersInTopic.slice(0, 3).map((c, i) => (
                            <div key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-2">
                              <div className={cn(
                                "w-1 h-1 rounded-full mt-1.5 shrink-0",
                                studiedChapters.has(c.id) ? "bg-emerald-500" : "bg-orange-400"
                              )} />
                              <span className={cn(
                                "leading-snug truncate",
                                studiedChapters.has(c.id) && "line-through text-gray-400 dark:text-gray-600"
                              )}>{c.title}</span>
                            </div>
                          ))}
                          {chaptersInTopic.length > 3 && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 pl-3">+{chaptersInTopic.length - 3} meer</p>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Chapter Details */}
        <div className="lg:col-span-8 space-y-4">
          {/* Chapter toolbar */}
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-48 relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Zoek in hoofdstukken..."
                  value={filterQuery}
                  onChange={e => onSetFilterQuery(e.target.value)}
                  aria-keyshortcuts="Control+f Meta+f"
                  className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                />
              </div>
              <button
                onClick={onExpandAll}
                className="text-xs font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <ChevronsUpDown className="w-3.5 h-3.5" />
                Alles uitklappen
              </button>
              <button
                onClick={onCollapseAll}
                className="text-xs font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <ChevronsDownUp className="w-3.5 h-3.5" />
                Alles inklappen
              </button>
              {studiedCount > 0 && (
                <button
                  onClick={onClearProgress}
                  className="text-xs font-bold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Wis voortgang
                </button>
              )}
              <button
                onClick={onCopyAll}
                className={cn(
                  "text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap",
                  copiedId === 'copy-all'
                    ? "bg-green-500 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                )}
              >
                {copiedId === 'copy-all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedId === 'copy-all' ? 'Gekopieerd!' : 'Kopieer alles'}
              </button>
              <button
                onClick={onDownloadAll}
                className="text-xs font-bold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-3 py-2 rounded-lg hover:bg-black dark:hover:bg-white transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download (.md)
              </button>
              <button
                onClick={async () => {
                  setPdfGenerating(true);
                  try {
                    const { exportStudyPlanAsPdf } = await import('../utils/exportPdf');
                    await exportStudyPlanAsPdf(plan, topicOrder);
                  } finally {
                    setPdfGenerating(false);
                  }
                }}
                disabled={pdfGenerating}
                className="text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                {pdfGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Download PDF
              </button>
            </div>

            {filterQuery && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 flex items-center gap-2">
                <Search className="w-3 h-3" />
                {filteredChapters.length} van {plan.chapters.length} hoofdstukken gevonden voor "{filterQuery}"
                <button onClick={() => onSetFilterQuery('')} className="text-orange-500 hover:text-orange-700 font-semibold">Wis filter</button>
              </p>
            )}
          </div>

          {/* Chapters grouped by topic (in user-defined order) */}
          {topicOrder.map((topicName, topicIdx) => {
            const topicChapters = filteredChapters.filter(c => c.topic === topicName);
            if (topicChapters.length === 0) return null;

            return (
              <div
                key={topicName}
                ref={el => { if (el) topicRefs.current.set(topicName, el); else topicRefs.current.delete(topicName); }}
                className="space-y-3"
              >
                <div className="flex items-center gap-3 pt-2">
                  <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-black">{topicIdx + 1}</span>
                  </div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-gray-100">{topicName}</h3>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{topicChapters.length} hoofdstuk{topicChapters.length !== 1 ? 'ken' : ''}</span>
                </div>

                {topicChapters.map((chapter, i) => {
                  const isExpanded = expandedChapters.has(chapter.id);
                  const isStudied = studiedChapters.has(chapter.id);
                  const wordCount = countWords(chapter.content);
                  const globalIdx = plan.chapters.indexOf(chapter);

                  return (
                    <motion.div
                      key={chapter.id || i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: globalIdx * 0.03 }}
                      className={cn(
                        "bg-white dark:bg-gray-900 border rounded-2xl overflow-hidden transition-all duration-300",
                        isStudied
                          ? "border-emerald-300 dark:border-emerald-700 shadow-sm"
                          : isExpanded
                            ? "border-orange-300 dark:border-orange-500 shadow-md"
                            : "border-gray-200 dark:border-gray-700 shadow-sm hover:border-gray-300 dark:hover:border-gray-600"
                      )}
                    >
                      {isStudied && (
                        <div className="h-1 bg-emerald-500 w-full" />
                      )}
                      <div className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-gray-400 dark:text-gray-500 text-xs font-mono">{chapter.id}</span>
                              <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">{wordCount.toLocaleString('nl-NL')} woorden</span>
                              {isStudied && (
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                  <CircleCheck className="w-3.5 h-3.5" />
                                  Bestudeerd
                                </span>
                              )}
                              {editedChapterIds.has(chapter.id) && (
                                <span className="text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-1.5 py-0.5 rounded-md">
                                  bewerkt
                                </span>
                              )}
                            </div>
                            {editingId === chapter.id ? (
                              <input
                                autoFocus
                                value={editDraft.title}
                                onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                                className="w-full text-xl font-bold bg-gray-50 dark:bg-gray-800 border border-orange-300 dark:border-orange-500 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-300"
                              />
                            ) : (
                              <h4 className={cn(
                                "text-xl font-bold leading-tight",
                                isStudied ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"
                              )}>{chapter.title}</h4>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => onToggleStudied(chapter.id)}
                              title={isStudied ? 'Markeer als niet bestudeerd' : 'Markeer als bestudeerd'}
                              className={cn(
                                "flex items-center justify-center w-10 h-10 rounded-xl transition-all",
                                isStudied
                                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60"
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-emerald-600"
                              )}
                            >
                              {isStudied ? <CircleCheck className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                            </button>
                            {editingId === chapter.id ? (
                              <>
                                <button
                                  onClick={() => {
                                    onEditChapter(chapter.id, editDraft);
                                    setEditingId(null);
                                  }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-bold text-sm bg-orange-500 hover:bg-orange-600 text-white transition-all"
                                >
                                  <Check className="w-4 h-4" />
                                  Opslaan
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                                  title="Annuleren"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditDraft({ title: chapter.title, summary: chapter.summary, content: chapter.content });
                                    setEditingId(chapter.id);
                                  }}
                                  title="Hoofdstuk bewerken"
                                  aria-keyshortcuts=""
                                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-orange-50 dark:hover:bg-orange-900/30 hover:text-orange-600 dark:hover:text-orange-400 transition-all"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => onCopyChapterPrompt(chapter, `c-${globalIdx}`)}
                                  className={cn(
                                    "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all",
                                    copiedId === `c-${globalIdx}`
                                      ? "bg-green-500 text-white shadow-md shadow-green-500/20"
                                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                                  )}
                                >
                                  {copiedId === `c-${globalIdx}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  {copiedId === `c-${globalIdx}` ? 'Gekopieerd' : 'Kopieer Prompt'}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {editingId === chapter.id ? (
                          <div className="space-y-2 mb-4">
                            <textarea
                              rows={2}
                              value={editDraft.summary}
                              onChange={e => setEditDraft(d => ({ ...d, summary: e.target.value }))}
                              placeholder="Samenvatting"
                              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-orange-300 dark:border-orange-500 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
                            />
                            <textarea
                              rows={8}
                              value={editDraft.content}
                              onChange={e => setEditDraft(d => ({ ...d, content: e.target.value }))}
                              placeholder="Volledige content"
                              className="w-full text-sm font-mono bg-gray-50 dark:bg-gray-800 border border-orange-300 dark:border-orange-500 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 resize-y"
                            />
                          </div>
                        ) : (
                          <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed mb-4">
                            {chapter.summary}
                          </p>
                        )}

                        <button
                          onClick={() => onToggleChapter(chapter.id)}
                          className="flex items-center gap-2 text-sm font-bold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
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
                              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700">
                                <div className="flex items-center gap-2 mb-3 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                                  <FileText className="w-3.5 h-3.5" />
                                  Volledige Content
                                </div>
                                <div className="prose prose-sm dark:prose-invert max-w-none text-gray-600 dark:text-gray-300">
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
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
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
