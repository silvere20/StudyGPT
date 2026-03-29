import { motion, AnimatePresence } from 'motion/react';
import { Settings, Download, Eye, Copy, Check, Package, Loader2, Map as MapIcon, Info } from 'lucide-react';
import { cn } from '../utils';
import { LazyMarkdown } from './LazyMarkdown';
import { useResultsContext } from '../context/ResultsContext';

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
  } = useResultsContext();

  return (
    <motion.div
      initial={{ opacity: 0, height: 0, scale: 0.98 }}
      animate={{ opacity: 1, height: 'auto', scale: 1 }}
      exit={{ opacity: 0, height: 0, scale: 0.98 }}
      className="bg-gradient-to-br from-orange-50 to-white border border-orange-200 rounded-3xl p-8 space-y-8 shadow-lg shadow-orange-100/50 overflow-hidden"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-md shadow-orange-500/20">
          <Settings className="text-white w-6 h-6" />
        </div>
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Custom GPT Configuratie</h3>
          <p className="text-orange-700 font-medium mt-1">Volg deze stappen voor de perfecte AI Tutor ervaring.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-5 bg-white p-6 rounded-2xl border border-orange-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center font-bold">1</div>
            <h4 className="font-bold text-lg">RAG Export downloaden</h4>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
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
              className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all"
              title="Download alleen de Master Map"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={onToggleMapPreview}
            className="w-full flex items-center justify-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-medium text-sm hover:bg-gray-100 transition-all"
          >
            <Eye className="w-4 h-4" />
            {showMapPreview ? 'Verberg' : 'Preview'} Master Study Map
          </button>
        </div>

        <div className="space-y-5 bg-white p-6 rounded-2xl border border-orange-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center font-bold">2</div>
            <h4 className="font-bold text-lg">System Instructions</h4>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            Plak deze instructies in de <strong>Instructions</strong> box van je GPT. Dit vertelt de GPT hoe hij je moet begeleiden.
          </p>
          <button
            onClick={onCopyInstructions}
            className={cn(
              "w-full flex justify-center items-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-sm",
              copiedId === 'sys-inst'
                ? "bg-green-500 text-white shadow-green-500/20"
                : "bg-gray-900 text-white hover:bg-black shadow-gray-900/20"
            )}
          >
            {copiedId === 'sys-inst' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedId === 'sys-inst' ? 'Gekopieerd!' : 'Kopieer Instructies'}
          </button>
        </div>
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

      <div className="bg-orange-100/50 rounded-2xl p-5 flex items-start gap-4 border border-orange-200/50">
        <Info className="w-6 h-6 text-orange-600 shrink-0" />
        <p className="text-sm text-orange-900 leading-relaxed">
          <strong>Pro Tip:</strong> De RAG ZIP is geoptimaliseerd voor ChatGPT's limiet van 20 bestanden. Elk onderwerpbestand bevat alle bijbehorende hoofdstukken voor maximale context bij retrieval.
        </p>
      </div>
    </motion.div>
  );
}
