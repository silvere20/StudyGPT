import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { BookOpen, Loader2, Moon, Package, RotateCcw, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { checkHealth, type StudyPlan, type Chapter } from './api/client';
import { cn, countWords, sanitizeFilename } from './utils';
import type { HealthStatus, HealthSnapshot } from './types';
import { useDocumentProcessor } from './hooks/useDocumentProcessor';
import { ProgressBar } from './components/ProgressBar';
import { UploadSection } from './components/UploadSection';
import { ResultsSection } from './components/ResultsSection';
import { ResultsContext } from './context/ResultsContext';
import type { ResultsContextValue } from './context/ResultsContext';

const DEFAULT_PROMPT_TEMPLATE =
  'Hier is de content voor {topic}: {title}\n\nSamenvatting: {summary}\n\nContent:\n{content}\n\nGebruik de Master Study Map om te zien waar we zijn. Laten we dit hoofdstuk interactief doornemen. Test me op de stof en eventuele opdrachten.';

export default function App() {
  const [plan, setPlan] = useState<StudyPlan | null>(() => {
    try {
      const saved = localStorage.getItem('studyflow_plan');
      return saved ? (JSON.parse(saved) as StudyPlan) : null;
    } catch { return null; }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(() => {
    try { return localStorage.getItem('studyflow_plan') !== null; } catch { return false; }
  });
  const [showMapPreview, setShowMapPreview] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('checking');
  const [healthMessage, setHealthMessage] = useState('Backend controleren...');
  const [filterQuery, setFilterQuery] = useState('');
  const [zipGenerating, setZipGenerating] = useState(false);
  const [studiedChapters, setStudiedChapters] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('studyflow_progress');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [promptTemplate, setPromptTemplate] = useState<string>(() => {
    try {
      return localStorage.getItem('studyflow_prompt_template') ?? DEFAULT_PROMPT_TEMPLATE;
    } catch { return DEFAULT_PROMPT_TEMPLATE; }
  });
  const topicRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const didShowRestoredToastRef = useRef(false);

  // ── Topic order ──
  // Loaded from localStorage; validated against plan.topics so stale orders are discarded.
  const [topicOrder, setTopicOrder] = useState<string[]>(() => {
    const loadedPlan = (() => {
      try { const s = localStorage.getItem('studyflow_plan'); return s ? (JSON.parse(s) as StudyPlan) : null; } catch { return null; }
    })();
    if (!loadedPlan) return [];
    try {
      const saved = localStorage.getItem('studyflow_topic_order');
      if (saved) {
        const order = JSON.parse(saved) as string[];
        const planSet = new Set(loadedPlan.topics);
        if (order.length === loadedPlan.topics.length && order.every(t => planSet.has(t))) return order;
      }
    } catch { /* ignore */ }
    return loadedPlan.topics;
  });

  const [darkMode, setDarkMode] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const applyHealthSnapshot = useCallback((snapshot: HealthSnapshot) => {
    setHealthStatus(snapshot.status);
    setHealthMessage(snapshot.message);
  }, []);

  const refreshHealth = useCallback(async (showChecking = true): Promise<HealthSnapshot> => {
    if (showChecking) {
      setHealthStatus('checking');
      setHealthMessage('Backend controleren...');
    }

    try {
      const health = await checkHealth();
      if (health.status === 'ok' && health.openai_configured) {
        if (!health.ocr_available) {
          const snapshot = { status: 'warning' as const, message: 'Backend draait, maar Tesseract-taaldata ontbreekt. OCR werkt mogelijk niet correct.' };
          applyHealthSnapshot(snapshot);
          return snapshot;
        }
        const snapshot = { status: 'healthy' as const, message: 'Backend en OpenAI zijn klaar voor verwerking.' };
        applyHealthSnapshot(snapshot);
        return snapshot;
      }
      const snapshot = { status: 'missing-key' as const, message: 'Backend draait, maar OPENAI_API_KEY ontbreekt in backend/.env.' };
      applyHealthSnapshot(snapshot);
      return snapshot;
    } catch {
      const snapshot = { status: 'backend-offline' as const, message: 'Backend niet bereikbaar. Start de FastAPI-server en controleer /api/health opnieuw.' };
      applyHealthSnapshot(snapshot);
      return snapshot;
    }
  }, [applyHealthSnapshot]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  // Persist plan to localStorage; show startup toast when a saved plan is restored
  useEffect(() => {
    try {
      if (plan) {
        localStorage.setItem('studyflow_plan', JSON.stringify(plan));
      } else {
        localStorage.removeItem('studyflow_plan');
      }
    } catch { /* storage unavailable */ }
  }, [plan]);

  useEffect(() => {
    if (plan && !didShowRestoredToastRef.current) {
      didShowRestoredToastRef.current = true;
      toast.info('Vorig studieplan geladen vanuit opslag.', { duration: 3000 });
    }
  // Only run once on mount — plan is intentionally omitted from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist topic order (skip when it matches the plan default to keep storage clean)
  useEffect(() => {
    if (topicOrder.length === 0) return;
    try { localStorage.setItem('studyflow_topic_order', JSON.stringify(topicOrder)); } catch { /* storage unavailable */ }
  }, [topicOrder]);

  const onReorderTopics = useCallback((order: string[]) => setTopicOrder(order), []);

  // Persist study progress
  useEffect(() => {
    try {
      localStorage.setItem('studyflow_progress', JSON.stringify([...studiedChapters]));
    } catch { /* storage unavailable */ }
  }, [studiedChapters]);

  const onToggleStudied = useCallback((id: string) => {
    setStudiedChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onClearProgress = useCallback(() => {
    setStudiedChapters(new Set());
  }, []);

  const resetPlanState = useCallback(() => {
    setPlan(null);
    setShowSetup(false);
    setShowMapPreview(false);
    setExpandedChapters(new Set());
    setFilterQuery('');
    setStudiedChapters(new Set());
    setTopicOrder([]);
    topicRefs.current.clear();
    try { localStorage.removeItem('studyflow_plan'); } catch { /* storage unavailable */ }
    try { localStorage.removeItem('studyflow_progress'); } catch { /* storage unavailable */ }
    try { localStorage.removeItem('studyflow_topic_order'); } catch { /* storage unavailable */ }
  }, []);

  const onSuccess = useCallback((result: StudyPlan) => {
    setPlan(result);
    setTopicOrder(result.topics);
    try { localStorage.removeItem('studyflow_topic_order'); } catch { /* storage unavailable */ }
    setShowSetup(true);
    setShowMapPreview(false);
    setExpandedChapters(new Set());
    setFilterQuery('');
  }, []);

  const onBeforeGenerate = useCallback(async (): Promise<boolean> => {
    const health = await refreshHealth();
    if (health.status === 'warning') {
      toast.warning(health.message);
      return true;
    }
    if (health.status !== 'healthy') {
      toast.error(health.message);
      return false;
    }
    return true;
  }, [refreshHealth]);

  // ── Prompt template hooks (no dependency on useDocumentProcessor — must stay above it) ──
  useEffect(() => {
    try {
      if (promptTemplate === DEFAULT_PROMPT_TEMPLATE) {
        localStorage.removeItem('studyflow_prompt_template');
      } else {
        localStorage.setItem('studyflow_prompt_template', promptTemplate);
      }
    } catch { /* storage unavailable */ }
  // DEFAULT_PROMPT_TEMPLATE is a stable constant — no need in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptTemplate]);

  const onSetPromptTemplate = useCallback((t: string) => setPromptTemplate(t), []);
  const onResetPromptTemplate = useCallback(() => setPromptTemplate(DEFAULT_PROMPT_TEMPLATE), []);

  const formatPrompt = useCallback((chapter: Chapter) =>
    promptTemplate
      .replace(/\{topic\}/g, chapter.topic)
      .replace(/\{title\}/g, chapter.title)
      .replace(/\{summary\}/g, chapter.summary)
      .replace(/\{content\}/g, chapter.content),
  [promptTemplate]);

  const {
    files, loading, progressMessage, progressPercent, fileProgress, connectionError,
    onDrop, removeFile, reorderFiles, sortFiles, handleGenerate, handleCancel, resetFiles,
  } = useDocumentProcessor(onSuccess, onBeforeGenerate);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      toast.success('Gekopieerd naar klembord!');
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      toast.error('Kopiëren mislukt.');
    });
  };

  const downloadStudyMap = () => {
    if (!plan) return;
    const blob = new Blob([plan.masterStudyMap], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Master_Study_Map.md';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Master Study Map gedownload!');
  };

  // Build chapter list in topic order (respects user reordering)
  const orderedChapters = (targetPlan: StudyPlan): Chapter[] =>
    topicOrder.flatMap(t => targetPlan.chapters.filter(c => c.topic === t));

  const copyAllPrompts = () => {
    if (!plan) return;
    let content = '';
    orderedChapters(plan).forEach((chapter, i) => {
      content += `--- PROMPT ${i + 1}: ${chapter.topic} - ${chapter.title} ---\n\n`;
      content += `${formatPrompt(chapter)}\n\n`;
    });
    copyToClipboard(content, 'copy-all');
  };

  const downloadAllPrompts = () => {
    if (!plan) return;
    let content = `# ${files.length > 0 ? files[0].file.name + (files.length > 1 ? ' e.a.' : '') : 'Study Plan'}\n\n`;
    content += `## Master Study Map\n\n${plan.masterStudyMap}\n\n---\n\n`;
    content += `## GPT System Instructions\n\n${plan.gptSystemInstructions}\n\n---\n\n`;

    orderedChapters(plan).forEach((chapter, i) => {
      content += `## Prompt ${i + 1}: ${chapter.topic} - ${chapter.title}\n\n`;
      content += `${formatPrompt(chapter)}\n\n---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `StudyPlan_${files.length > 0 ? files[0].file.name.replace(/\.[^/.]+$/, "") : 'export'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Alle prompts gedownload!');
  };

  // ── RAG ZIP: altijd per-topic bestanden → altijd ≤ 20 bestanden ──
  const downloadOptimizedRagZip = async () => {
    if (!plan) return;
    setZipGenerating(true);

    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const totalChapters = plan.chapters.length;
      const totalTopics = topicOrder.length;

      const topicMap = new Map<string, Chapter[]>();
      plan.chapters.forEach(ch => {
        const existing = topicMap.get(ch.topic) ?? [];
        existing.push(ch);
        topicMap.set(ch.topic, existing);
      });

      const zipFileCount = 2 + totalTopics;

      // ── 1. SYSTEM INSTRUCTIONS ──
      const systemInstructions = `# SYSTEM INSTRUCTIONS VOOR CUSTOM GPT

## JOUW IDENTITEIT
Je bent een gespecialiseerde academische AI Tutor. Je hebt toegang tot een complete Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen (${zipFileCount} bestanden totaal — geoptimaliseerd voor ChatGPT's 20-bestanden limiet).

## KERNPRINCIPES
1. **ZERO HALLUCINATION**: Gebruik ALTIJD \`file_search\` om informatie op te zoeken. Geef NOOIT antwoorden gebaseerd op je eigen kennis als het gaat om cursusinhoud.
2. **ACTIVE RECALL**: Stel de student vragen in plaats van direct antwoorden te geven. Gebruik de socratische methode.
3. **PER ONDERWERP STUDEREN**: Volg de onderwerpstructuur. Rond een onderwerp af voordat je naar het volgende gaat.
4. **BRONVERMELDING**: Vermeld ALTIJD uit welk onderwerp/hoofdstuk informatie komt (bijv. "Volgens [onderwerp], Hoofdstuk [nr]...").
5. **VOLLEDIGHEID**: Neem ALLE stof door — sla niets over. Elke definitie, tabel, formule en oefening is belangrijk.

## BESTANDSSTRUCTUUR (${zipFileCount} bestanden)
- \`00_MASTER_INDEX.md\` — Complete cursuskaart en bestandsindex. Raadpleeg dit EERST.
- \`Topic_01_*.md\` t/m \`Topic_${String(totalTopics).padStart(2, '0')}_*.md\` — Eén bestand per onderwerp, bevat ALLE bijbehorende hoofdstukken.

### Zoekstrategie
1. Bij een nieuwe sessie: zoek \`00_MASTER_INDEX.md\` om de cursusstructuur te begrijpen.
2. Bij een inhoudelijke vraag: zoek het relevante onderwerpbestand (\`Topic_XX_...\`).
3. Bij een oefening: zoek op "OEFENING:" binnen het onderwerpbestand.
4. Bij een definitie: zoek op "DEFINITIE:" binnen het onderwerpbestand.
5. Elk onderwerpbestand bevat een inhoudsopgave — gebruik die om snel het juiste hoofdstuk te vinden.

### Interactie Protocol
1. **Start**: Vraag de student waar hij/zij is gebleven of welk onderwerp ze willen behandelen.
2. **Uitleg**: Zoek de relevante content op via file_search en leg uit MET verwijzing naar het hoofdstuk.
3. **Toets**: Gebruik de OEFENING-blokken om de student te toetsen na elke sectie.
4. **Herhaling**: Als de student een concept niet begrijpt, zoek gerelateerde secties op.
5. **Voortgang**: Houd bij welke hoofdstukken de student heeft afgerond en welke nog komen.

## STUDIEPLAN OVERZICHT
${plan.masterStudyMap}

${plan.gptSystemInstructions}
`;
      zip.file("SYSTEM_INSTRUCTIONS.md", systemInstructions);

      // ── 2. MASTER INDEX ──
      let indexContent = `# MASTER INDEX — COMPLETE CURSUSKAART

## Cursus Overzicht
- **Totaal onderwerpen:** ${totalTopics}
- **Totaal hoofdstukken:** ${totalChapters}
- **Bestanden in Knowledge Base:** ${zipFileCount} (geoptimaliseerd voor ChatGPT)

## Onderwerpen & Hoofdstukken

`;
      topicOrder.forEach((topicName, topicIdx) => {
        const chapters = topicMap.get(topicName) ?? [];
        const safeTopicName = sanitizeFilename(topicName);
        const topicFileName = `Topic_${String(topicIdx + 1).padStart(2, '0')}_${safeTopicName}.md`;
        indexContent += `### ${String(topicIdx + 1).padStart(2, '0')}. ${topicName}\n`;
        indexContent += `**Bestand:** \`${topicFileName}\` | **Hoofdstukken:** ${chapters.length}\n\n`;
        chapters.forEach(ch => {
          indexContent += `- **${ch.id}** — ${ch.title}\n`;
          indexContent += `  *${ch.summary}*\n`;
        });
        indexContent += `\n`;
      });

      indexContent += `---\n\n## Master Study Map\n\n${plan.masterStudyMap}\n\n`;
      indexContent += `---\n\n## Bestandsindex\n\n`;
      indexContent += `| # | Bestand | Onderwerpen | Hoofdstukken |\n`;
      indexContent += `|---|---------|-------------|---------------|\n`;
      topicOrder.forEach((topicName, topicIdx) => {
        const chapters = topicMap.get(topicName) ?? [];
        const safeTopicName = sanitizeFilename(topicName);
        const topicFileName = `Topic_${String(topicIdx + 1).padStart(2, '0')}_${safeTopicName}.md`;
        indexContent += `| ${topicIdx + 1} | \`${topicFileName}\` | ${topicName} | ${chapters.map(c => c.id).join(', ')} |\n`;
      });

      zip.file("00_MASTER_INDEX.md", indexContent);

      // ── 3. PER-TOPIC BESTANDEN ──
      topicOrder.forEach((topicName, topicIdx) => {
        const chapters = topicMap.get(topicName) ?? [];
        const safeTopicName = sanitizeFilename(topicName);
        const topicFileName = `Topic_${String(topicIdx + 1).padStart(2, '0')}_${safeTopicName}.md`;

        let topicContent = `---
topic: "${topicName}"
topic_index: ${topicIdx + 1}
total_topics: ${totalTopics}
chapters: [${chapters.map(c => `"${c.id}"`).join(', ')}]
chapter_count: ${chapters.length}
document_type: "course_material"
---

# Onderwerp ${topicIdx + 1}: ${topicName}
**${chapters.length} hoofdstuk${chapters.length !== 1 ? 'ken' : ''}** | Knowledge Base bestand ${topicIdx + 1} van ${totalTopics}

## Inhoudsopgave
${chapters.map((ch, i) => `${i + 1}. [${ch.id}: ${ch.title}](#${ch.id.toLowerCase().replace(/[^a-z0-9]/g, '-')})`).join('\n')}

---

`;

        chapters.forEach((chapter, chIdx) => {
          const globalIdx = plan.chapters.indexOf(chapter);
          const prevChapter = globalIdx > 0 ? plan.chapters[globalIdx - 1] : null;
          const nextChapter = globalIdx < plan.chapters.length - 1 ? plan.chapters[globalIdx + 1] : null;

          topicContent += `## ${chapter.id}: ${chapter.title}

> **Navigatie**
> ${prevChapter ? `Vorig: ${prevChapter.id} — ${prevChapter.title}` : 'Eerste hoofdstuk'}
> ${nextChapter ? `Volgend: ${nextChapter.id} — ${nextChapter.title}` : 'Laatste hoofdstuk'}

**Samenvatting:** ${chapter.summary}

### Volledige Lesstof

${chapter.content}

### Tutor Instructies
- Toets de student op alle concepten en oefeningen in dit hoofdstuk.
${nextChapter ? `- Bij beheersing: ga door naar **${nextChapter.id} — ${nextChapter.title}**.` : '- Dit is het laatste hoofdstuk. Maak een eindtoets van alle behandelde stof.'}
- Verwijs bij vragen naar dit hoofdstuk: "${chapter.id}: ${chapter.title}".

`;
          if (chIdx < chapters.length - 1) {
            topicContent += `---\n\n`;
          }
        });

        zip.file(topicFileName, topicContent);
      });

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GPT_RAG_Export_${files.length > 0 ? sanitizeFilename(files[0].file.name.replace(/\.[^/.]+$/, "")) : 'Cursus'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`RAG ZIP gedownload — ${zipFileCount} bestanden, ChatGPT-klaar!`);
    } catch (error) {
      console.error("Error generating ZIP:", error);
      toast.error("Fout bij het genereren van de ZIP.");
    } finally {
      setZipGenerating(false);
    }
  };

  const scrollToTopic = (topicName: string) => {
    const el = topicRefs.current.get(topicName);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleChapter = (id: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Derived — memoized to avoid re-scanning chapter content on every render

  // Normalise once per plan; reused by the filter below
  const normalizedChapters = useMemo(
    () => plan?.chapters.map(ch => ({
      ch,
      title:   ch.title.toLowerCase(),
      topic:   ch.topic.toLowerCase(),
      summary: ch.summary.toLowerCase(),
      content: ch.content.toLowerCase(),
    })) ?? [],
    [plan],
  );

  const filteredChapters = useMemo(() => {
    if (!plan) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return plan.chapters;
    return normalizedChapters
      .filter(n => n.title.includes(q) || n.topic.includes(q) || n.summary.includes(q) || n.content.includes(q))
      .map(n => n.ch);
  }, [plan, filterQuery, normalizedChapters]);

  const totalWords = useMemo(
    () => plan?.chapters.reduce((sum, ch) => sum + countWords(ch.content), 0) ?? 0,
    [plan],
  );

  const zipFileCount = useMemo(
    () => (plan ? 2 + topicOrder.length : 0),
    [plan, topicOrder],
  );

  // ── RENDER ──

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans selection:bg-orange-100 pb-24">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-sm">
              <BookOpen className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">StudyFlow AI</h1>
            <button
              onClick={() => setDarkMode(d => !d)}
              className="ml-2 p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              aria-label="Donkere modus wisselen"
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
          {plan && (
            <div className="flex items-center gap-3">
              <button
                onClick={downloadOptimizedRagZip}
                disabled={zipGenerating}
                className="text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-60 transition-colors px-4 py-2 rounded-full flex items-center gap-2 shadow-sm"
              >
                {zipGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                RAG Export ({zipFileCount} bestanden)
              </button>
              <button
                onClick={() => {
                  resetFiles();
                  resetPlanState();
                  void refreshHealth(false);
                }}
                className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-full flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Nieuw Studieplan
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <ProgressBar
                progressMessage={progressMessage}
                progressPercent={progressPercent}
                files={files}
                fileProgress={fileProgress}
                onCancel={handleCancel}
                connectionError={connectionError}
              />
            </motion.div>
          ) : !plan ? (
            <UploadSection
              files={files}
              onDrop={onDrop}
              healthStatus={healthStatus}
              healthMessage={healthMessage}
              onRefreshHealth={() => void refreshHealth()}
              onRemoveFile={removeFile}
              onReorderFiles={reorderFiles}
              onSortFiles={sortFiles}
              onGenerate={handleGenerate}
            />
          ) : (
            <ResultsContext.Provider value={{
              plan,
              files,
              filteredChapters,
              expandedChapters,
              filterQuery,
              zipFileCount,
              totalWords,
              zipGenerating,
              copiedId,
              showSetup,
              showMapPreview,
              topicRefs,
              topicOrder,
              onReorderTopics,
              onToggleSetup: () => setShowSetup(!showSetup),
              onToggleChapter: toggleChapter,
              onSetFilterQuery: setFilterQuery,
              onExpandAll: () => setExpandedChapters(new Set(filteredChapters.map(c => c.id))),
              onCollapseAll: () => setExpandedChapters(new Set()),
              onScrollToTopic: scrollToTopic,
              onCopyChapterPrompt: (chapter, id) => copyToClipboard(formatPrompt(chapter), id),
              studiedChapters,
              onToggleStudied,
              onClearProgress,
              onCopyAll: copyAllPrompts,
              onDownloadAll: downloadAllPrompts,
              onDownloadZip: downloadOptimizedRagZip,
              onDownloadMap: downloadStudyMap,
              onCopyInstructions: () => copyToClipboard(plan.gptSystemInstructions, 'sys-inst'),
              onToggleMapPreview: () => setShowMapPreview(!showMapPreview),
              promptTemplate,
              onSetPromptTemplate,
              onResetPromptTemplate,
            } satisfies ResultsContextValue}>
              <ResultsSection />
            </ResultsContext.Provider>
          )}
        </AnimatePresence>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
      `}} />
    </div>
  );
}
