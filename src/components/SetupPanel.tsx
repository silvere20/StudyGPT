import { motion, AnimatePresence } from 'motion/react';
import { Settings, Download, Eye, Copy, Check, Package, Loader2, Map as MapIcon, Info, RotateCcw } from 'lucide-react';
import { cn } from '../utils';
import { LazyMarkdown } from './LazyMarkdown';
import { useResultsContext } from '../context/ResultsContext';

const TEMPLATE_VARS = ['{topic}', '{title}', '{summary}', '{content}'] as const;

export function SetupPanel() {
  const {
    plan,
    zipFileCount,
    zipGenerating,
    showMapPreview,
    copiedId,
    onDownloadZip,
    onDownloadMap,
    onCopyInstructions,
    onToggleMapPreview,
    promptTemplate,
    onSetPromptTemplate,
    onResetPromptTemplate,
  } = useResultsContext();

  const firstChapter = plan.chapters[0];
  const livePreview = firstChapter
    ? promptTemplate
        .replace(/\{topic\}/g, firstChapter.topic)
        .replace(/\{title\}/g, firstChapter.title)
        .replace(/\{summary\}/g, firstChapter.summary)
        .replace(/\{content\}/g, firstChapter.content.slice(0, 200) + (firstChapter.content.length > 200 ? '…' : ''))
    : promptTemplate;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0, scale: 0.98 }}
      animate={{ opacity: 1, height: 'auto', scale: 1 }}
      exit={{ opacity: 0, height: 0, scale: 0.98 }}
      className="bg-gradient-to-br from-orange-50 to-white dark:from-orange-950/30 dark:to-gray-900 border border-orange-200 dark:border-orange-900 rounded-3xl p-8 space-y-8 shadow-lg shadow-orange-100/50 dark:shadow-orange-900/20 overflow-hidden"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-md shadow-orange-500/20">
          <Settings className="text-white w-6 h-6" />
        </div>
        <div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Custom GPT Configuratie</h3>
          <p className="text-orange-700 dark:text-orange-400 font-medium mt-1">Volg deze stappen voor de perfecte AI Tutor ervaring.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-5 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-orange-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400 rounded-full flex items-center justify-center font-bold">1</div>
            <h4 className="font-bold text-lg text-gray-900 dark:text-gray-100">RAG Export downloaden</h4>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Download de ZIP ({zipFileCount} bestanden, ChatGPT-klaar) en upload <strong>alle bestanden</strong> naar de <strong>Knowledge</strong> sectie van je Custom GPT.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onDownloadZip}
              disabled={zipGenerating}
              className="flex-1 flex justify-center items-center gap-2 bg-orange-500 text-white px-4 py-3 rounded-xl font-bold text-sm hover:bg-orange-600 disabled:opacity-60 transition-all shadow-md shadow-orange-500/20"
            >
              {zipGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              Download RAG ZIP ({zipFileCount} bestanden)
            </button>
            <button
              onClick={onDownloadMap}
              className="flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-all"
              title="Download alleen de Master Map"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={onToggleMapPreview}
            className="w-full flex items-center justify-center gap-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-xl font-medium text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-all"
          >
            <Eye className="w-4 h-4" />
            {showMapPreview ? 'Verberg' : 'Preview'} Master Study Map
          </button>
        </div>

        <div className="space-y-5 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-orange-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400 rounded-full flex items-center justify-center font-bold">2</div>
            <h4 className="font-bold text-lg text-gray-900 dark:text-gray-100">System Instructions</h4>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Plak deze instructies in de <strong>Instructions</strong> box van je GPT. Dit vertelt de GPT hoe hij je moet begeleiden.
          </p>
          <button
            onClick={onCopyInstructions}
            className={cn(
              "w-full flex justify-center items-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-sm",
              copiedId === 'sys-inst'
                ? "bg-green-500 text-white shadow-green-500/20"
                : "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-black dark:hover:bg-white shadow-gray-900/20"
            )}
          >
            {copiedId === 'sys-inst' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedId === 'sys-inst' ? 'Gekopieerd!' : 'Kopieer Instructies'}
          </button>
        </div>
      </div>

      {/* Step 3 — Prompt template editor */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-orange-100 dark:border-gray-700 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400 rounded-full flex items-center justify-center font-bold shrink-0">3</div>
            <div>
              <h4 className="font-bold text-lg text-gray-900 dark:text-gray-100">Prompt Template</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Pas de prompt aan die gekopieerd wordt per hoofdstuk.
              </p>
            </div>
          </div>
          <button
            onClick={onResetPromptTemplate}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset naar standaard
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {TEMPLATE_VARS.map(v => (
            <span key={v} className="font-mono text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2 py-1 rounded-md border border-orange-200 dark:border-orange-800">
              {v}
            </span>
          ))}
        </div>

        <textarea
          value={promptTemplate}
          onChange={e => onSetPromptTemplate(e.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full font-mono text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-800 dark:text-gray-200 resize-y focus:outline-none focus:ring-2 focus:ring-orange-400 dark:focus:ring-orange-500 transition-shadow"
        />

        {firstChapter && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Live preview — {firstChapter.id}: {firstChapter.title}
            </p>
            <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-600 dark:text-gray-400 max-h-48 overflow-y-auto custom-scrollbar">
              {livePreview}
            </pre>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showMapPreview && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gray-900 rounded-2xl p-6 overflow-hidden"
          >
            <div className="flex items-center justify-between mb-4 border-b border-gray-700 pb-4">
              <h4 className="text-white font-bold flex items-center gap-2">
                <MapIcon className="w-4 h-4 text-orange-400" />
                Master Map Preview
              </h4>
              <button onClick={onToggleMapPreview} className="text-gray-400 hover:text-white">Sluiten</button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none max-h-96 overflow-y-auto custom-scrollbar pr-4">
              <LazyMarkdown loadingLabel="Preview laden...">{plan.masterStudyMap}</LazyMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-orange-100/50 dark:bg-orange-900/20 rounded-2xl p-5 flex items-start gap-4 border border-orange-200/50 dark:border-orange-800/50">
        <Info className="w-6 h-6 text-orange-600 dark:text-orange-400 shrink-0" />
        <p className="text-sm text-orange-900 dark:text-orange-300 leading-relaxed">
          <strong>Pro Tip:</strong> De RAG ZIP is geoptimaliseerd voor ChatGPT's limiet van 20 bestanden. Elk onderwerpbestand bevat alle bijbehorende hoofdstukken voor maximale context bij retrieval.
        </p>
      </div>
    </motion.div>
  );
}
