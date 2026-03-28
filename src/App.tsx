import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  FileText, Upload, Loader2, Copy, Check, BookOpen,
  ArrowRight, Settings, Download, Info, Map as MapIcon,
  ChevronDown, ChevronUp, Eye, X, AlertCircle, CheckCircle2, Clock,
  Search, ChevronsDownUp, ChevronsUpDown, RotateCcw, Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster, toast } from 'sonner';
import { LazyMarkdown } from './components/LazyMarkdown';
import { checkHealth, processDocuments, type StudyPlan, type Chapter, type ProgressUpdate } from './api/client';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type UploadedFile = {
  file: File;
  type: string;
};

type FileProgressInfo = {
  status: 'waiting' | 'processing' | 'done' | 'error';
  progress: number;
  message: string;
};

type HealthStatus = 'checking' | 'healthy' | 'backend-offline' | 'missing-key';

type HealthSnapshot = {
  status: Exclude<HealthStatus, 'checking'>;
  message: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showMapPreview, setShowMapPreview] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [fileProgress, setFileProgress] = useState<Map<number, FileProgressInfo>>(new Map());
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('checking');
  const [healthMessage, setHealthMessage] = useState('Backend controleren...');
  const [filterQuery, setFilterQuery] = useState('');
  const [zipGenerating, setZipGenerating] = useState(false);
  const isCancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const topicRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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
        const snapshot = {
          status: 'healthy' as const,
          message: 'Backend en OpenAI zijn klaar voor verwerking.',
        };
        applyHealthSnapshot(snapshot);
        return snapshot;
      }

      const snapshot = {
        status: 'missing-key' as const,
        message: 'Backend draait, maar OPENAI_API_KEY ontbreekt in backend/.env.',
      };
      applyHealthSnapshot(snapshot);
      return snapshot;
    } catch {
      const snapshot = {
        status: 'backend-offline' as const,
        message: 'Backend niet bereikbaar. Start de FastAPI-server en controleer /api/health opnieuw.',
      };
      applyHealthSnapshot(snapshot);
      return snapshot;
    }
  }, [applyHealthSnapshot]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const resetProcessingState = useCallback(() => {
    abortControllerRef.current = null;
    setLoading(false);
    setProgressMessage('');
    setProgressPercent(0);
    setFileProgress(new Map());
  }, []);

  const resetPlanState = useCallback(() => {
    setPlan(null);
    setShowSetup(false);
    setShowMapPreview(false);
    setExpandedChapters(new Set());
    setFilterQuery('');
    topicRefs.current.clear();
  }, []);

  const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

  const handleCancel = () => {
    isCancelledRef.current = true;
    abortControllerRef.current?.abort();
    setFiles([]);
    resetProcessingState();
    resetPlanState();
    toast.info("Verwerking geannuleerd.");
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFiles(prev => {
        const duplicates: string[] = [];
        const newFiles = acceptedFiles
          .filter(f => {
            const isDupe = prev.some(p => p.file.name === f.name && p.file.size === f.size);
            if (isDupe) duplicates.push(f.name);
            return !isDupe;
          })
          .map(f => ({ file: f, type: 'auto' }));

        if (duplicates.length > 0) {
          toast.warning(`Overgeslagen (al toegevoegd): ${duplicates.join(', ')}`);
        }

        const combined = [...prev, ...newFiles];
        return combined.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'text/markdown': ['.md'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/plain': ['.txt'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    },
    multiple: true
  });

  const handleGenerate = async () => {
    if (files.length === 0) return;

    const health = await refreshHealth();
    if (health.status !== 'healthy') {
      toast.error(health.message);
      return;
    }

    isCancelledRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    setLoading(true);
    setProgressMessage('Bestanden uploaden naar server...');
    setProgressPercent(5);

    const initialProgress = new Map<number, FileProgressInfo>();
    files.forEach((_, idx) => {
      initialProgress.set(idx, { status: 'waiting', progress: 0, message: 'Wachtend...' });
    });
    setFileProgress(initialProgress);

    try {
      await processDocuments(
        files.map(f => f.file),
        (update: ProgressUpdate) => {
          if (isCancelledRef.current) return;
          setProgressMessage(update.message);
          setProgressPercent(update.progress);

          if (update.fileIndex !== undefined) {
            setFileProgress(prev => {
              const next = new Map(prev);
              const isComplete = update.step === 'document' && update.progress === 100;
              next.set(update.fileIndex!, {
                status: isComplete ? 'done' : 'processing',
                progress: update.progress,
                message: update.message.replace(/^\[\d+\/\d+\]\s*/, ''),
              });
              return next;
            });
          }

          if (update.step === 'ai' && update.fileIndex === undefined) {
            setFileProgress(prev => {
              const next = new Map(prev);
              for (const [key, val] of next) {
                if (val.status !== 'done') {
                  next.set(key, { status: 'done', progress: 100, message: 'Verwerkt.' });
                }
              }
              return next;
            });
          }
        },
        (result: StudyPlan) => {
          if (isCancelledRef.current) return;
          setPlan(result);
          setShowSetup(true);
          setShowMapPreview(false);
          setExpandedChapters(new Set());
          setFilterQuery('');
          resetProcessingState();
          toast.success('Studieplan succesvol gegenereerd!');
        },
        (message: string) => {
          if (isCancelledRef.current) return;
          resetProcessingState();
          toast.error(message);
        },
        { signal: abortControllerRef.current.signal }
      );
    } catch (error) {
      if (isAbortError(error) || isCancelledRef.current) return;
      resetProcessingState();
      void refreshHealth(false);
      toast.error('Er is een onverwachte fout opgetreden. Controleer of de backend draait.');
    }
  };

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

  const formatPrompt = (chapter: Chapter) => {
    return `Hier is de content voor ${chapter.topic}: ${chapter.title}\n\nSamenvatting: ${chapter.summary}\n\nContent:\n${chapter.content}\n\nGebruik de Master Study Map om te zien waar we zijn. Laten we dit hoofdstuk interactief doornemen. Test me op de stof en eventuele opdrachten.`;
  };

  const copyAllPrompts = () => {
    if (!plan) return;
    let content = '';
    plan.chapters.forEach((chapter, i) => {
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

    plan.chapters.forEach((chapter, i) => {
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
      const totalTopics = plan.topics.length;

      // Groepeer hoofdstukken per onderwerp
      const topicMap = new Map<string, Chapter[]>();
      plan.chapters.forEach(ch => {
        const existing = topicMap.get(ch.topic) ?? [];
        existing.push(ch);
        topicMap.set(ch.topic, existing);
      });

      const zipFileCount = 2 + totalTopics; // SYSTEM + INDEX + 1 per topic

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
      plan.topics.forEach((topicName, topicIdx) => {
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
      plan.topics.forEach((topicName, topicIdx) => {
        const chapters = topicMap.get(topicName) ?? [];
        const safeTopicName = sanitizeFilename(topicName);
        const topicFileName = `Topic_${String(topicIdx + 1).padStart(2, '0')}_${safeTopicName}.md`;
        indexContent += `| ${topicIdx + 1} | \`${topicFileName}\` | ${topicName} | ${chapters.map(c => c.id).join(', ')} |\n`;
      });

      zip.file("00_MASTER_INDEX.md", indexContent);

      // ── 3. PER-TOPIC BESTANDEN (één bestand per onderwerp) ──
      plan.topics.forEach((topicName, topicIdx) => {
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

  const scrollToTopic = (topicIdx: number) => {
    const el = topicRefs.current.get(topicIdx);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const toggleChapter = (id: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Derived: gefilterde hoofdstukken
  const filteredChapters = plan
    ? filterQuery.trim()
      ? plan.chapters.filter(ch =>
          ch.title.toLowerCase().includes(filterQuery.toLowerCase()) ||
          ch.topic.toLowerCase().includes(filterQuery.toLowerCase()) ||
          ch.summary.toLowerCase().includes(filterQuery.toLowerCase()) ||
          ch.content.toLowerCase().includes(filterQuery.toLowerCase())
        )
      : plan.chapters
    : [];

  // Stats
  const totalWords = plan ? plan.chapters.reduce((sum, ch) => sum + countWords(ch.content), 0) : 0;
  const zipFileCount = plan ? 2 + plan.topics.length : 0;

  // ── RENDER ──

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-orange-100 pb-24">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-sm">
              <BookOpen className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">StudyFlow AI</h1>
          </div>
          {plan && (
            <div className="flex items-center gap-3">
              <button
                onClick={downloadOptimizedRagZip}
                disabled={zipGenerating}
                className="text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-60 transition-colors px-4 py-2 rounded-full flex items-center gap-2 shadow-sm"
              >
                {zipGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Package className="w-4 h-4" />
                )}
                RAG Export ({zipFileCount} bestanden)
              </button>
              <button
                onClick={() => {
                  setFiles([]);
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
            /* ── PROCESSING VIEW ── */
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto bg-white rounded-3xl p-8 border border-gray-200 shadow-xl"
            >
              <div className="text-center mb-8">
                <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900">Documenten verwerken</h2>
                <p className="text-gray-500 mt-2">{progressMessage || 'Bezig met verwerken...'}</p>
              </div>

              <div className="mb-6">
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-orange-500 h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.max(5, progressPercent)}%` }}
                  />
                </div>
                <p className="text-center text-sm text-gray-400 mt-2">{progressPercent}%</p>
              </div>

              <div className="space-y-3">
                {files.map((fMeta, idx) => {
                  const fp = fileProgress.get(idx);
                  const status = fp?.status ?? 'waiting';
                  const filePercent = fp?.progress ?? 0;
                  const fileMsg = fp?.message ?? 'Wachtend...';

                  return (
                    <div key={idx} className={cn(
                      "p-4 rounded-xl border transition-all",
                      status === 'done' ? "bg-emerald-50 border-emerald-200" :
                      status === 'processing' ? "bg-orange-50 border-orange-200" :
                      status === 'error' ? "bg-red-50 border-red-200" :
                      "bg-gray-50 border-gray-200"
                    )}>
                      <div className="flex items-center gap-3 mb-2">
                        {status === 'done' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                        ) : status === 'processing' ? (
                          <Loader2 className="w-5 h-5 text-orange-500 animate-spin shrink-0" />
                        ) : status === 'error' ? (
                          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                        ) : (
                          <Clock className="w-5 h-5 text-gray-400 shrink-0" />
                        )}
                        <span className="text-sm font-medium text-gray-800 flex-1 truncate">{fMeta.file.name}</span>
                        <span className="text-xs text-gray-400">{formatFileSize(fMeta.file.size)}</span>
                      </div>

                      {status !== 'waiting' && (
                        <div className="ml-8">
                          <div className="w-full bg-white/60 rounded-full h-1.5 overflow-hidden mb-1">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500 ease-out",
                                status === 'done' ? "bg-emerald-500" :
                                status === 'error' ? "bg-red-500" :
                                "bg-orange-500"
                              )}
                              style={{ width: `${Math.max(5, filePercent)}%` }}
                            />
                          </div>
                          <p className={cn(
                            "text-xs",
                            status === 'done' ? "text-emerald-600" :
                            status === 'error' ? "text-red-600" :
                            "text-orange-600"
                          )}>
                            {fileMsg}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex justify-center">
                <button
                  onClick={handleCancel}
                  className="px-6 py-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-full font-medium transition-colors flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Annuleren
                </button>
              </div>
            </motion.div>

          ) : !plan ? (
            /* ── UPLOAD VIEW ── */
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="text-center mb-12">
                <h2 className="text-4xl md:text-5xl font-extrabold mb-6 tracking-tight text-gray-900">
                  Verander je documenten in een <br/>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-orange-600">
                    Interactieve Tutor
                  </span>
                </h2>
                <p className="text-gray-500 text-lg max-w-xl mx-auto">
                  Upload je documenten en laat AI een Master Study Map en GPT-instructies genereren.
                  Ondersteunt PDF, slides, Word-documenten, afbeeldingen en meer.
                </p>
              </div>

              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-3xl p-12 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 relative overflow-hidden",
                  isDragActive ? "border-orange-500 bg-orange-50 scale-[1.02]" : "border-gray-300 bg-white hover:border-orange-400 hover:shadow-lg hover:shadow-orange-100"
                )}
              >
                <input {...getInputProps()} />
                <div className={cn(
                  "w-20 h-20 rounded-full flex items-center justify-center mb-2 transition-colors",
                  isDragActive ? "bg-orange-200" : "bg-orange-50"
                )}>
                  <Upload className={cn("w-10 h-10 transition-colors", isDragActive ? "text-orange-700" : "text-orange-500")} />
                </div>
                <div className="text-center z-10">
                  <p className="font-bold text-xl text-gray-800">
                    {files.length > 0 ? "Voeg meer bestanden toe" : "Sleep je bestanden hierheen"}
                  </p>
                  <p className="text-gray-500 text-sm mt-2">
                    Of klik om bestanden te selecteren (PDF, PPTX, DOCX, XLSX, MD, TXT, afbeeldingen)
                  </p>
                </div>
              </div>

              <div className={cn(
                "mt-6 rounded-2xl border p-4 flex items-start gap-3",
                healthStatus === 'healthy'
                  ? "border-emerald-200 bg-emerald-50"
                  : healthStatus === 'checking'
                    ? "border-gray-200 bg-white"
                    : "border-amber-200 bg-amber-50"
              )}>
                {healthStatus === 'healthy' ? (
                  <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : healthStatus === 'checking' ? (
                  <Loader2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5 animate-spin" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className="font-semibold text-sm text-gray-900">
                    {healthStatus === 'healthy'
                      ? 'Verwerkingsstack beschikbaar'
                      : healthStatus === 'checking'
                        ? 'Beschikbaarheid controleren'
                        : 'Actie nodig voor verwerking'}
                  </p>
                  <p className={cn(
                    "text-sm mt-1",
                    healthStatus === 'healthy' ? "text-emerald-800" : "text-gray-600"
                  )}>
                    {healthMessage}
                  </p>
                </div>
                <button
                  onClick={() => void refreshHealth()}
                  className="text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Opnieuw controleren
                </button>
              </div>

              {files.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 space-y-3"
                >
                  {files.map((fMeta, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 bg-white border rounded-xl shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{fMeta.file.name}</p>
                          <p className="text-sm text-gray-500">{formatFileSize(fMeta.file.size)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}

                  <div className="flex flex-col items-center justify-center mt-8 gap-4">
                    <button
                      onClick={handleGenerate}
                      disabled={healthStatus !== 'healthy'}
                      className={cn(
                        "px-10 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 transition-all shadow-xl",
                        healthStatus === 'healthy'
                          ? "bg-gradient-to-r from-orange-500 to-orange-600 text-white hover:scale-105 shadow-orange-500/20"
                          : "bg-gray-200 text-gray-400 shadow-none cursor-not-allowed"
                      )}
                    >
                      Genereer Studieplan
                      <ArrowRight className="w-6 h-6" />
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-gray-200 pt-12">
                <div className="space-y-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 font-bold">1</div>
                  <h3 className="font-bold text-lg">Upload & Analyse</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">GPT-4.1 analyseert je bestanden met geavanceerde OCR en documentherkenning. Tabellen, formules en tekst worden exact overgenomen.</p>
                </div>
                <div className="space-y-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 font-bold">2</div>
                  <h3 className="font-bold text-lg">Master Map</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">Ontvang een Markdown 'GPS' kaart die je Custom GPT precies vertelt hoe de cursus in elkaar zit.</p>
                </div>
                <div className="space-y-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 font-bold">3</div>
                  <h3 className="font-bold text-lg">Interactieve Tutor</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">Upload de RAG ZIP naar ChatGPT (altijd ≤ 20 bestanden) en laat je stap-voor-stap overhoren.</p>
                </div>
              </div>
            </motion.div>

          ) : (
            /* ── RESULTS VIEW ── */
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
                  {/* Stats bar */}
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
                    onClick={() => setShowSetup(!showSetup)}
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
                            onClick={downloadOptimizedRagZip}
                            disabled={zipGenerating}
                            className="flex-1 flex justify-center items-center gap-2 bg-orange-500 text-white px-4 py-3 rounded-xl font-bold text-sm hover:bg-orange-600 disabled:opacity-60 transition-all shadow-md shadow-orange-500/20"
                          >
                            {zipGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                            Download RAG ZIP ({zipFileCount} bestanden)
                          </button>
                          <button
                            onClick={downloadStudyMap}
                            className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all"
                            title="Download alleen de Master Map"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                        <button
                          onClick={() => setShowMapPreview(!showMapPreview)}
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
                          onClick={() => copyToClipboard(plan.gptSystemInstructions, 'sys-inst')}
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
                            <button onClick={() => setShowMapPreview(false)} className="text-gray-400 hover:text-white">Sluiten</button>
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
                            onClick={() => scrollToTopic(topicIdx)}
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
                      {/* Search */}
                      <div className="flex-1 min-w-48 relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Zoek in hoofdstukken..."
                          value={filterQuery}
                          onChange={e => setFilterQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all"
                        />
                      </div>
                      {/* Expand/collapse all */}
                      <button
                        onClick={() => setExpandedChapters(new Set(filteredChapters.map(c => c.id)))}
                        className="text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                        Alles uitklappen
                      </button>
                      <button
                        onClick={() => setExpandedChapters(new Set())}
                        className="text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <ChevronsDownUp className="w-3.5 h-3.5" />
                        Alles inklappen
                      </button>
                      {/* Copy/download actions */}
                      <button
                        onClick={copyAllPrompts}
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
                        onClick={downloadAllPrompts}
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
                        <button onClick={() => setFilterQuery('')} className="text-orange-500 hover:text-orange-700 font-semibold">Wis filter</button>
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
                        {/* Topic section header */}
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
                                    onClick={() => copyToClipboard(formatPrompt(chapter), `c-${globalIdx}`)}
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
                                  onClick={() => toggleChapter(chapter.id)}
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
                      <button onClick={() => setFilterQuery('')} className="mt-2 text-sm text-orange-500 hover:text-orange-700 font-semibold">Wis filter</button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
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
