import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { BookOpen, Loader2, Moon, Package, RotateCcw, Sun, ArrowLeft, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { checkHealth, type StudyPlan, type Chapter } from './api/client';
import { cn, countWords, sanitizeFilename, stripMarkdownAndLatex } from './utils';
import { buildBundles } from './utils/bundling';
import type { HealthStatus, HealthSnapshot } from './types';
import { useDocumentProcessor } from './hooks/useDocumentProcessor';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useCourses } from './hooks/useCourses';
import { ProgressBar } from './components/ProgressBar';
import { UploadSection } from './components/UploadSection';
import { ResultsSection } from './components/ResultsSection';
import { CourseDashboard } from './components/CourseDashboard';
import { ResultsContext } from './context/ResultsContext';
import type { ResultsContextValue } from './context/ResultsContext';

const DEFAULT_PROMPT_TEMPLATE =
  'Hier is de content voor {topic}: {title}\n\nSamenvatting: {summary}\n\nContent:\n{content}\n\nGebruik de Master Study Map om te zien waar we zijn. Laten we dit hoofdstuk interactief doornemen. Test me op de stof en eventuele opdrachten.';

// ── Migratie: oud formaat (studyflow_plan) → één Course ──
function migrateOldData(createCourse: (name: string) => { id: string }): void {
  try {
    const oldPlan = localStorage.getItem('studyflow_plan');
    const alreadyMigrated = localStorage.getItem('studyflow_migrated');
    if (!oldPlan || alreadyMigrated) return;

    const plan = JSON.parse(oldPlan) as StudyPlan;
    const course = createCourse('Mijn eerste vak');

    // We set plan data directly in localStorage via the courses key
    const coursesRaw = localStorage.getItem('studyflow_courses');
    const courses = coursesRaw ? JSON.parse(coursesRaw) : [];
    const idx = courses.findIndex((c: { id: string }) => c.id === course.id);
    if (idx !== -1) {
      const oldProgress = localStorage.getItem('studyflow_progress');
      const studiedChapters = oldProgress ? JSON.parse(oldProgress) as string[] : [];
      const oldTopicOrder = localStorage.getItem('studyflow_topic_order');
      const topicOrder = oldTopicOrder ? JSON.parse(oldTopicOrder) as string[] : plan.topics;

      courses[idx] = {
        ...courses[idx],
        plan,
        studiedChapters,
        topicOrder,
        sourceFileNames: [],
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem('studyflow_courses', JSON.stringify(courses));
    }

    // Clean up old keys
    localStorage.removeItem('studyflow_plan');
    localStorage.removeItem('studyflow_progress');
    localStorage.removeItem('studyflow_topic_order');
    localStorage.setItem('studyflow_migrated', '1');

    toast.info('Bestaand studieplan omgezet naar vak "Mijn eerste vak".', { duration: 4000 });
  } catch { /* silent fail */ }
}

export default function App() {
  const {
    courses,
    activeCourse,
    createCourse,
    renameCourse,
    deleteCourse,
    openCourse,
    closeCourse,
    updateCoursePlan,
    updateCourseProgress,
    updateCourseTopicOrder,
    updateCourseChapter,
    clearCoursePlan,
  } = useCourses();

  // Run migration once on mount
  const didMigrateRef = useRef(false);
  useEffect(() => {
    if (didMigrateRef.current) return;
    didMigrateRef.current = true;
    migrateOldData(createCourse);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Bronnen bijwerken" mode: user clicked to re-upload for an existing plan
  const [updatingSourcesForId, setUpdatingSourcesForId] = useState<string | null>(null);
  const isUpdatingSources = updatingSourcesForId !== null && activeCourse?.id === updatingSourcesForId;

  // Local UI state (per-session, derived from activeCourse when possible)
  const plan = activeCourse?.plan ?? null;

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showMapPreview, setShowMapPreview] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('checking');
  const [healthMessage, setHealthMessage] = useState('Backend controleren...');
  const [filterQuery, setFilterQuery] = useState('');
  const [zipGenerating, setZipGenerating] = useState(false);
  const [exportPlatform, setExportPlatform] = useState<'chatgpt' | 'gemini' | 'claude' | null>(null);

  const topicRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const didShowRestoredToastRef = useRef(false);
  // Ref to current files so onSuccess (declared before useDocumentProcessor) can access them
  const filesRef = useRef<import('./types').UploadedFile[]>([]);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [focusedChapterIdx, setFocusedChapterIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const healthPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorToastIdRef = useRef<string | number | null>(null);

  // Sync local state from activeCourse when switching
  const prevCourseIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeCourse?.id === prevCourseIdRef.current) return;
    prevCourseIdRef.current = activeCourse?.id ?? null;
    setExpandedChapters(new Set());
    setFilterQuery('');
    setShowSetup(activeCourse?.plan !== null);
    setShowMapPreview(false);
    setUpdatingSourcesForId(null);
  }, [activeCourse?.id, activeCourse?.plan]);

  const topicOrder = activeCourse?.topicOrder ?? [];
  const studiedChapters = useMemo(
    () => new Set(activeCourse?.studiedChapters ?? []),
    [activeCourse?.studiedChapters]
  );
  const editedChapterIds = useMemo(
    () => new Set(activeCourse?.editedChapterIds ?? []),
    [activeCourse?.editedChapterIds]
  );

  const [promptTemplate, setPromptTemplate] = useState<string>(() => {
    try {
      return localStorage.getItem('studyflow_prompt_template') ?? DEFAULT_PROMPT_TEMPLATE;
    } catch { return DEFAULT_PROMPT_TEMPLATE; }
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

  // Show "restored" toast once when opening a course with an existing plan
  useEffect(() => {
    if (plan && !didShowRestoredToastRef.current) {
      didShowRestoredToastRef.current = true;
      toast.info(`Studieplan van "${activeCourse?.name}" geladen.`, { duration: 3000 });
    }
    if (!plan) didShowRestoredToastRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourse?.id]);

  const onToggleStudied = useCallback((id: string) => {
    const next = new Set(studiedChapters);
    if (next.has(id)) next.delete(id); else next.add(id);
    updateCourseProgress([...next]);
  }, [studiedChapters, updateCourseProgress]);

  const onClearProgress = useCallback(() => {
    updateCourseProgress([]);
  }, [updateCourseProgress]);

  const onReorderTopics = useCallback((order: string[]) => {
    updateCourseTopicOrder(order);
  }, [updateCourseTopicOrder]);

  const onSuccess = useCallback((result: StudyPlan) => {
    const fileNames = filesRef.current.map(f => f.file.name);
    updateCoursePlan(result, fileNames);
    setShowSetup(true);
    setShowMapPreview(false);
    setExpandedChapters(new Set());
    setFilterQuery('');
    setUpdatingSourcesForId(null);
    toast.success('Studieplan gegenereerd!');
  }, [updateCoursePlan]);

  const onEditChapter = useCallback((id: string, edits: { title: string; summary: string; content: string }) => {
    updateCourseChapter(id, edits);
  }, [updateCourseChapter]);

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

  // Prompt template persistence
  useEffect(() => {
    try {
      if (promptTemplate === DEFAULT_PROMPT_TEMPLATE) {
        localStorage.removeItem('studyflow_prompt_template');
      } else {
        localStorage.setItem('studyflow_prompt_template', promptTemplate);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch { /* storage unavailable */ }
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

  // Keep filesRef in sync so onSuccess (defined before useDocumentProcessor) can access files
  filesRef.current = files;

  // Dynamic browser tab title
  useEffect(() => {
    if (loading) {
      if (progressPercent > 0) {
        document.title = `🔄 ${progressPercent}% Verwerken... — StudyFlow AI`;
      } else {
        document.title = '⏳ Documenten uploaden... — StudyFlow AI';
      }
      return;
    }
    if (connectionError) { document.title = '❌ Fout opgetreden — StudyFlow AI'; return; }
    if (plan) {
      document.title = `✅ ${activeCourse?.name ?? 'Studieplan'} — StudyFlow AI`;
      const t = setTimeout(() => { document.title = 'StudyFlow AI'; }, 5000);
      return () => clearTimeout(t);
    }
    document.title = 'StudyFlow AI';
  }, [loading, progressPercent, connectionError, plan, activeCourse?.name]);

  // Health polling every 30s
  useEffect(() => {
    healthPollingRef.current = setInterval(() => {
      if (loading) return;
      void refreshHealth(false).then(snapshot => {
        if (snapshot.status === 'backend-offline' && healthStatus !== 'backend-offline') {
          errorToastIdRef.current = toast.error('Backend niet meer bereikbaar. Herstart de FastAPI-server.', { duration: Infinity });
        } else if (snapshot.status !== 'backend-offline' && healthStatus === 'backend-offline') {
          if (errorToastIdRef.current !== null) toast.dismiss(errorToastIdRef.current);
          toast.success('Backend weer bereikbaar!', { duration: 3000 });
          errorToastIdRef.current = null;
        }
      });
    }, 30_000);
    return () => { if (healthPollingRef.current !== null) clearInterval(healthPollingRef.current); };
  }, [loading, healthStatus, refreshHealth]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      toast.success('Gekopieerd naar klembord!');
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => { toast.error('Kopiëren mislukt.'); });
  };

  const downloadStudyMap = () => {
    if (!plan) return;
    const blob = new Blob([plan.masterStudyMap], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Master_Study_Map.md'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Master Study Map gedownload!');
  };

  const orderedChapters = (targetPlan: StudyPlan): Chapter[] =>
    topicOrder.flatMap(t => targetPlan.chapters.filter(c => c.topic === t));

  const copyAllPrompts = () => {
    if (!plan) return;
    let content = '';
    orderedChapters(plan).forEach((chapter, i) => {
      content += `--- PROMPT ${i + 1}: ${chapter.topic} - ${chapter.title} ---\n\n${formatPrompt(chapter)}\n\n`;
    });
    copyToClipboard(content, 'copy-all');
  };

  const downloadAllPrompts = () => {
    if (!plan) return;
    const courseName = activeCourse?.name ?? 'Cursus';
    let content = `# ${courseName}\n\n## Master Study Map\n\n${plan.masterStudyMap}\n\n---\n\n## GPT System Instructions\n\n${plan.gptSystemInstructions}\n\n---\n\n`;
    orderedChapters(plan).forEach((chapter, i) => {
      content += `## Prompt ${i + 1}: ${chapter.topic} - ${chapter.title}\n\n${formatPrompt(chapter)}\n\n---\n\n`;
    });
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `StudyPlan_${sanitizeFilename(courseName)}.md`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Alle prompts gedownload!');
  };

  // ── RAG ZIP generation (platform-aware) ──
  const buildZipContent = useCallback(async (platform: 'chatgpt' | 'gemini' | 'claude') => {
    if (!plan || !activeCourse) return;
    setZipGenerating(true);

    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const totalChapters = plan.chapters.length;
      const totalTopics = topicOrder.length;
      const courseName = activeCourse.name;

      const topicMap = new Map<string, Chapter[]>();
      plan.chapters.forEach(ch => {
        const existing = topicMap.get(ch.topic) ?? [];
        existing.push(ch);
        topicMap.set(ch.topic, existing);
      });

      const bundles = buildBundles(topicOrder);
      const bundleCount = bundles.length;
      const zipFileCount = 2 + bundleCount;

      const injectAnchors = (content: string, topicIdx: number, chapterIdx: number): string => {
        let sectionIdx = 0;
        return content.split('\n').map(line => {
          if (line.startsWith('### ')) { sectionIdx++; return `${line} (KB_SEC: T${topicIdx + 1}-C${chapterIdx + 1}-S${sectionIdx})`; }
          return line;
        }).join('\n');
      };

      // ── Platform-specific system instructions ──
      const systemInstructions = buildSystemInstructions(platform, courseName, totalChapters, totalTopics, zipFileCount, bundleCount, plan);
      zip.file("SYSTEM_INSTRUCTIONS.md", systemInstructions);

      // ── Master index (universal) ──
      let indexContent = `# MASTER INDEX — ${courseName.toUpperCase()}\n\n## Overzicht\n- **Vak:** ${courseName}\n- **Totaal onderwerpen:** ${totalTopics}\n- **Totaal hoofdstukken:** ${totalChapters}\n- **Bestanden:** ${zipFileCount}\n\n## Onderwerpen & Hoofdstukken\n\n`;
      topicOrder.forEach((topicName, topicIdx) => {
        const chapters = topicMap.get(topicName) ?? [];
        const bundleIdx = bundles.findIndex(b => b.topics.includes(topicName));
        const safeLabel = sanitizeFilename(bundles[bundleIdx]?.label ?? topicName);
        indexContent += `### ${String(topicIdx + 1).padStart(2, '0')}. ${topicName}\n**Bestand:** \`${safeLabel}.md\` | **Hoofdstukken:** ${chapters.length}\n\n`;
        chapters.forEach((ch, chIdx) => {
          indexContent += `- **${ch.id}** [KB_ID: T${topicIdx + 1}-C${chIdx + 1}] — ${ch.title}\n  *${ch.summary}*\n`;
        });
        indexContent += `\n`;
      });
      indexContent += `---\n\n## Master Study Map\n\n${plan.masterStudyMap}\n`;
      zip.file("00_MASTER_INDEX.md", indexContent);

      // ── Per-bundle content files (universal) ──
      bundles.forEach((bundle, bundleIdx) => {
        const bundleTopics = bundle.topics;
        const allBundleChapters = bundleTopics.flatMap(t => topicMap.get(t) ?? []);
        const safeLabel = sanitizeFilename(bundle.label);

        let topicContent = `---\ntopics: [${bundleTopics.map(t => `"${t}"`).join(', ')}]\nbundle_index: ${bundleIdx + 1}\ntotal_bundles: ${bundleCount}\nchapters: [${allBundleChapters.map(c => `"${c.id}"`).join(', ')}]\ndocument_type: "course_material"\n---\n\n# ${bundleTopics.length === 1 ? `Onderwerp ${bundleIdx + 1}: ${bundleTopics[0]}` : `Onderwerpen ${bundleIdx + 1}: ${bundleTopics.join(', ')}`}\n**${allBundleChapters.length} hoofdstuk${allBundleChapters.length !== 1 ? 'ken' : ''}** | Bestand ${bundleIdx + 1} van ${bundleCount}\n\n## Inhoudsopgave\n${allBundleChapters.map((ch, i) => `${i + 1}. [${ch.id}: ${ch.title}](#${ch.id.toLowerCase().replace(/[^a-z0-9]/g, '-')})`).join('\n')}\n\n---\n\n`;

        bundleTopics.forEach(topicName => {
          const topicIdx = topicOrder.indexOf(topicName);
          const chapters = topicMap.get(topicName) ?? [];
          if (bundleTopics.length > 1) topicContent += `# Onderwerp: ${topicName}\n\n`;
          chapters.forEach((chapter, chIdx) => {
            const globalIdx = plan.chapters.indexOf(chapter);
            const prevChapter = globalIdx > 0 ? plan.chapters[globalIdx - 1] : null;
            const nextChapter = globalIdx < plan.chapters.length - 1 ? plan.chapters[globalIdx + 1] : null;
            const anchoredContent = injectAnchors(chapter.content, topicIdx, chIdx);
            topicContent += `## ${chapter.id}: ${chapter.title}\nKB_ID: T${topicIdx + 1}-C${chIdx + 1}\n\n> **Navigatie**\n> ${prevChapter ? `Vorig: ${prevChapter.id} — ${prevChapter.title}` : 'Eerste hoofdstuk'}\n> ${nextChapter ? `Volgend: ${nextChapter.id} — ${nextChapter.title}` : 'Laatste hoofdstuk'}\n\n**Samenvatting:** ${chapter.summary}\n\n### Volledige Lesstof\n\n${anchoredContent}\n\n### Tutor Instructies\n- Toets de student op alle concepten en oefeningen in dit hoofdstuk.\n${nextChapter ? `- Bij beheersing: ga door naar **${nextChapter.id} — ${nextChapter.title}**.` : '- Dit is het laatste hoofdstuk. Maak een eindtoets van alle behandelde stof.'}\n- Verwijs bij vragen naar dit hoofdstuk: "${chapter.id}: ${chapter.title}" [KB_ID: T${topicIdx + 1}-C${chIdx + 1}].\n\n`;
            if (chIdx < chapters.length - 1) topicContent += `---\n\n`;
          });
        });

        zip.file(`${safeLabel}.md`, topicContent);
      });

      // ── Platform-specific SNELSTARTGIDS ──
      zip.file("SNELSTARTGIDS.md", buildSnelstartgids(platform, courseName, zipFileCount));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${platformLabel(platform)}_RAG_${sanitizeFilename(courseName)}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${platformLabel(platform)} export gedownload — ${zipFileCount} bestanden!`);
    } catch (error) {
      console.error("Error generating ZIP:", error);
      toast.error("Fout bij het genereren van de ZIP.");
    } finally {
      setZipGenerating(false);
      setExportPlatform(null);
    }
  }, [plan, activeCourse, topicOrder]);

  const downloadOptimizedRagZip = useCallback(() => {
    // Default to ChatGPT if no platform selected, otherwise open platform picker
    setExportPlatform('picker' as unknown as 'chatgpt');
  }, []);

  // Scrolling
  const scrollToTopic = (topicName: string) => {
    const el = topicRefs.current.get(topicName);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleChapter = (id: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Derived values
  const normalizedChapters = useMemo(
    () => plan?.chapters.map(ch => ({
      ch,
      title:   ch.title.toLowerCase(),
      topic:   ch.topic.toLowerCase(),
      summary: ch.summary.toLowerCase(),
      content: stripMarkdownAndLatex(ch.content).toLowerCase(),
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
    () => (plan ? 3 + Math.min(topicOrder.length, 18) : 0), // +1 for SNELSTARTGIDS
    [plan, topicOrder],
  );

  // Keyboard shortcuts
  useKeyboardShortcuts({
    planLoaded: plan !== null,
    onFocusSearch: () => searchInputRef.current?.focus(),
    onClearSearch: () => setFilterQuery(''),
    onExpandAll: () => setExpandedChapters(new Set(filteredChapters.map(c => c.id))),
    onCollapseAll: () => setExpandedChapters(new Set()),
    onDownloadZip: downloadOptimizedRagZip,
    onNextChapter: () => setFocusedChapterIdx(i => Math.min(i + 1, (plan?.chapters.length ?? 1) - 1)),
    onPrevChapter: () => setFocusedChapterIdx(i => Math.max(i - 1, 0)),
    onShowHelp: () => setShowShortcutsHelp(prev => !prev),
  });

  // ── Screen logic ──
  // null activeCourse → dashboard
  // activeCourse + (no plan OR isUpdatingSources) + not loading → upload
  // activeCourse + plan + not isUpdatingSources → results
  const showDashboard = activeCourse === null;
  const showUpload = activeCourse !== null && (!plan || isUpdatingSources) && !loading;
  const showResults = activeCourse !== null && plan !== null && !isUpdatingSources && !loading;

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
            {activeCourse && (
              <button
                onClick={() => { closeCourse(); resetFiles(); }}
                className="ml-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Vakken
              </button>
            )}
            {activeCourse && (
              <span className="text-gray-300 dark:text-gray-600">·</span>
            )}
            {activeCourse && (
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[200px]">
                {activeCourse.name}
              </span>
            )}
            <button
              onClick={() => setDarkMode(d => !d)}
              className="ml-2 p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              aria-label="Donkere modus wisselen"
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-2">
            {showResults && (
              <>
                <button
                  onClick={downloadOptimizedRagZip}
                  disabled={zipGenerating}
                  className="text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-60 transition-colors px-4 py-2 rounded-full flex items-center gap-2 shadow-sm"
                >
                  {zipGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                  RAG Export
                </button>
                <button
                  onClick={() => { resetFiles(); setUpdatingSourcesForId(activeCourse?.id ?? null); }}
                  className="text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-4 py-2 rounded-full flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Bronnen bijwerken
                </button>
              </>
            )}
            {isUpdatingSources && (
              <button
                onClick={() => setUpdatingSourcesForId(null)}
                className="text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-4 py-2 rounded-full flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Terug naar plan
              </button>
            )}
            {showUpload && !isUpdatingSources && plan === null && activeCourse !== null && (
              <button
                onClick={() => { clearCoursePlan(activeCourse.id); resetFiles(); closeCourse(); }}
                className="text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-full flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">

          {/* Loading/processing state */}
          {loading && (
            <motion.div key="processing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <ProgressBar
                progressMessage={progressMessage}
                progressPercent={progressPercent}
                files={files}
                fileProgress={fileProgress}
                onCancel={handleCancel}
                connectionError={connectionError}
              />
            </motion.div>
          )}

          {/* Dashboard */}
          {!loading && showDashboard && (
            <CourseDashboard
              courses={courses}
              onOpen={openCourse}
              onCreate={createCourse}
              onRename={renameCourse}
              onDelete={deleteCourse}
            />
          )}

          {/* Upload screen */}
          {!loading && showUpload && (
            <motion.div key={`upload-${activeCourse?.id}`}>
              {isUpdatingSources && (
                <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-2xl">
                  <p className="text-sm text-orange-800 dark:text-orange-300 font-medium">
                    Je uploadt nieuwe bronbestanden voor <strong>{activeCourse?.name}</strong>.
                    Het bestaande studieplan blijft bewaard totdat het nieuwe gegenereerd is.
                  </p>
                </div>
              )}
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
            </motion.div>
          )}

          {/* Results screen */}
          {!loading && showResults && plan && (
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
              editedChapterIds,
              onEditChapter,
              searchInputRef,
            } satisfies ResultsContextValue}>
              <ResultsSection />
            </ResultsContext.Provider>
          )}
        </AnimatePresence>
      </main>

      {/* Platform export picker overlay */}
      <AnimatePresence>
        {exportPlatform === ('picker' as unknown as 'chatgpt') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setExportPlatform(null)}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-200 dark:border-gray-700"
            >
              <h3 className="font-extrabold text-xl text-gray-900 dark:text-gray-100 mb-2">RAG Export</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Kies het platform waarvoor je de export wilt optimaliseren.</p>
              <div className="grid grid-cols-3 gap-3">
                {(['chatgpt', 'gemini', 'claude'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => { setExportPlatform(null); void buildZipContent(p); }}
                    className="flex flex-col items-center gap-2 p-4 border-2 border-gray-200 dark:border-gray-700 rounded-xl hover:border-orange-400 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-all group"
                  >
                    <span className="text-2xl">{platformEmoji(p)}</span>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                      {platformLabel(p)}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 text-center leading-tight">
                      {platformDescription(p)}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyboard shortcuts overlay */}
      <AnimatePresence>
        {showShortcutsHelp && (
          <motion.div
            key="shortcuts-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowShortcutsHelp(false)}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700"
            >
              <h2 className="font-extrabold text-lg mb-4 text-gray-900 dark:text-gray-100">Sneltoetsen</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {[
                    ['Ctrl/⌘ + F', 'Zoeken'],
                    ['Ctrl/⌘ + E', 'Alles uitvouwen'],
                    ['Ctrl/⌘ + Shift + E', 'Alles invouwen'],
                    ['Ctrl/⌘ + D', 'RAG ZIP downloaden'],
                    ['J / K', 'Volgend / Vorig hoofdstuk'],
                    ['Escape', 'Zoekbalk wissen'],
                    ['?', 'Sneltoetsen tonen/verbergen'],
                  ].map(([key, desc]) => (
                    <tr key={key}>
                      <td className="py-2 pr-4 font-mono text-xs bg-gray-50 dark:bg-gray-800 px-2 rounded text-gray-700 dark:text-gray-300">{key}</td>
                      <td className="py-2 pl-3 text-gray-600 dark:text-gray-400">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Platform helpers ──
function platformLabel(p: 'chatgpt' | 'gemini' | 'claude'): string {
  return { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }[p];
}
function platformEmoji(p: 'chatgpt' | 'gemini' | 'claude'): string {
  return { chatgpt: '🤖', gemini: '♊', claude: '🔷' }[p];
}
function platformDescription(p: 'chatgpt' | 'gemini' | 'claude'): string {
  return {
    chatgpt: 'Custom GPT via file_search (≤20 bestanden)',
    gemini: 'Gem met Google grounding',
    claude: 'Project Knowledge Base',
  }[p];
}

// ── System instructions per platform ──
function buildSystemInstructions(
  platform: 'chatgpt' | 'gemini' | 'claude',
  courseName: string,
  totalChapters: number,
  totalTopics: number,
  zipFileCount: number,
  bundleCount: number,
  plan: StudyPlan
): string {
  const base = `# STUDIEPLAN: ${courseName.toUpperCase()}\n\n`;
  const shared = `## KERNPRINCIPES\n1. **EVIDENCE-FIRST**: Elk feitelijk antwoord MOET beginnen met \`Volgens [KB_ID: T#-C#]:\` of \`Zie (KB_SEC: T#-C#-S#):\`.\n2. **ZERO HALLUCINATION**: Als een onderwerp NIET in de Knowledge Base staat, antwoord dan exact: "Dit staat niet in het studiemateriaal." Geef NOOIT antwoorden gebaseerd op eigen kennis voor cursusinhoud.\n3. **ACTIVE RECALL**: Stel de student vragen in plaats van direct antwoorden te geven. Gebruik de socratische methode.\n4. **PER ONDERWERP**: Werk onderwerp voor onderwerp — rond elk af voordat je naar het volgende gaat.\n5. **VOLLEDIGHEID**: Neem ALLE stof door — sla niets over.\n\n## EXAMEN MODUS\nWanneer de student begint met \`[EXAMEN]\`, genereer:\n1. Vijf open vragen over het gevraagde onderwerp\n2. Modelantwoorden voor elke vraag (met KB_SEC: verwijzingen)\n\n## STUDIEPLAN OVERZICHT\n${plan.masterStudyMap}\n\n${plan.gptSystemInstructions}`;

  if (platform === 'chatgpt') {
    return `${base}## JOUW IDENTITEIT\nJe bent een gespecialiseerde academische AI Tutor. Je hebt toegang tot een Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen (${zipFileCount} bestanden, geoptimaliseerd voor ChatGPT's 20-bestanden limiet).\n\n## RETRIEVAL STRATEGIE (file_search)\n1. Bij een nieuwe sessie: zoek \`00_MASTER_INDEX.md\` om de cursusstructuur te begrijpen.\n2. Bij een inhoudelijke vraag: zoek het relevante onderwerpbestand (\`Topic_XX_...\`).\n3. Bij een oefening: zoek op "OEFENING:" binnen het onderwerpbestand.\n4. Bij een definitie: zoek op "DEFINITIE:" binnen het onderwerpbestand.\n\n## BESTANDSSTRUCTUUR (${zipFileCount} bestanden)\n- \`SYSTEM_INSTRUCTIONS.md\` — Dit bestand\n- \`00_MASTER_INDEX.md\` — Volledige cursuskaart (raadpleeg EERST)\n- \`Topic_01_*.md\` t/m \`Topic_${String(bundleCount).padStart(2, '0')}_*.md\` — Eén bestand per onderwerp\n- \`SNELSTARTGIDS.md\` — Opzetinstructies\n\n${shared}`;
  }
  if (platform === 'gemini') {
    return `${base}## JOUW IDENTITEIT\nJe bent een academische Gem Tutor voor het vak "${courseName}". Je hebt toegang tot een Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen.\n\n## RETRIEVAL STRATEGIE (Gems)\n1. Raadpleeg \`00_MASTER_INDEX.md\` voor de structuur.\n2. Zoek het relevante onderwerpbestand voor inhoudelijke vragen.\n3. Gebruik de KB_SEC ankertags om exacte secties te citeren.\n4. Verwijs altijd naar het onderwerp en hoofdstuk bij je antwoord.\n\n## BESTANDSSTRUCTUUR\n- \`SYSTEM_INSTRUCTIONS.md\` — Dit bestand (plak dit als System Instruction)\n- \`00_MASTER_INDEX.md\` — Volledige cursuskaart\n- Onderwerpbestanden — Alle cursusinhoud\n- \`SNELSTARTGIDS.md\` — Opzetinstructies\n\n${shared}`;
  }
  // claude
  return `${base}## JOUW IDENTITEIT\nJe bent een academische Claude Project Tutor voor het vak "${courseName}". Je hebt toegang tot een Project Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen.\n\n## RETRIEVAL STRATEGIE (Project Knowledge)\n1. Raadpleeg \`00_MASTER_INDEX.md\` voor de volledige cursusstructuur.\n2. Citeer content met artefact-stijl verwijzingen: "[Zie: {onderwerp}, KB_ID: T#-C#]".\n3. Gebruik de KB_SEC ankertags voor sectieverwijzingen.\n4. Maak gebruik van Claude's lange contextvenster — je kunt meerdere bestanden tegelijk raadplegen.\n\n## BESTANDSSTRUCTUUR\n- \`SYSTEM_INSTRUCTIONS.md\` — Plak dit als Project Instructions\n- \`00_MASTER_INDEX.md\` — Volledige cursuskaart\n- Onderwerpbestanden — Alle cursusinhoud\n- \`SNELSTARTGIDS.md\` — Opzetinstructies\n\n${shared}`;
}

// ── Platform-specific SNELSTARTGIDS ──
function buildSnelstartgids(
  platform: 'chatgpt' | 'gemini' | 'claude',
  courseName: string,
  fileCount: number
): string {
  if (platform === 'chatgpt') {
    return `# SNELSTARTGIDS — ChatGPT Custom GPT\n\n## Vak: ${courseName}\n\n## Stap 1: Maak een Custom GPT\n1. Ga naar chatgpt.com → Explore GPTs → Create\n2. Klik op "Configure"\n\n## Stap 2: Plak de System Instructions\n1. Open \`SYSTEM_INSTRUCTIONS.md\` uit deze ZIP\n2. Kopieer de volledige inhoud\n3. Plak dit in het veld "Instructions"\n\n## Stap 3: Upload de Knowledge Base bestanden\n1. Klik op "Knowledge" → "Upload files"\n2. Upload alle ${fileCount} bestanden uit deze ZIP\n   (**Let op:** ChatGPT heeft een limiet van 20 bestanden — deze export is daar exact op afgestemd)\n\n## Stap 4: Sla op & begin met studeren\n1. Klik "Save" en geef je GPT een naam\n2. Begin het gesprek met: "Laten we beginnen met [onderwerp]"\n3. Typ \`[EXAMEN]\` gevolgd door een onderwerp voor een oefentoets\n\n## Tips\n- De tutor werkt het beste als je één onderwerp per sessie behandelt\n- Gebruik de socratische methode: de tutor stelt vragen, jij antwoordt\n- Vraag om herhaling als een concept niet duidelijk is\n`;
  }
  if (platform === 'gemini') {
    return `# SNELSTARTGIDS — Google Gemini Gem\n\n## Vak: ${courseName}\n\n## Stap 1: Maak een nieuwe Gem\n1. Ga naar gemini.google.com → Gem Manager → New Gem\n\n## Stap 2: Voeg de System Instruction toe\n1. Open \`SYSTEM_INSTRUCTIONS.md\` uit deze ZIP\n2. Kopieer de volledige inhoud\n3. Plak dit in het "Instructions" veld van de Gem\n\n## Stap 3: Upload de Knowledge Base bestanden\n1. Klik op "Knowledge" of "Files"\n2. Upload alle ${fileCount} bestanden uit deze ZIP\n\n## Stap 4: Sla op & begin met studeren\n1. Klik "Save" en geef je Gem een naam\n2. Begin het gesprek met: "Laten we beginnen met [onderwerp]"\n3. Typ \`[EXAMEN]\` gevolgd door een onderwerp voor een oefentoets\n\n## Tips\n- Gemini Gems zijn beschikbaar via Google One Advanced\n- De tutor is geoptimaliseerd voor Gemini's grounding capabilities\n`;
  }
  // claude
  return `# SNELSTARTGIDS — Claude Project\n\n## Vak: ${courseName}\n\n## Stap 1: Maak een nieuw Project\n1. Ga naar claude.ai → Projects → New Project\n2. Geef het project de naam "${courseName}"\n\n## Stap 2: Voeg de Project Instructions toe\n1. Open \`SYSTEM_INSTRUCTIONS.md\` uit deze ZIP\n2. Kopieer de volledige inhoud\n3. Plak dit in "Project Instructions"\n\n## Stap 3: Upload de Knowledge Base bestanden\n1. Klik op "Add Content" of het upload-icoon\n2. Upload alle ${fileCount} bestanden uit deze ZIP\n   (Claude Projects heeft geen strikte bestandslimiet)\n\n## Stap 4: Begin met studeren\n1. Open een nieuw gesprek binnen het project\n2. Begin met: "Laten we beginnen met [onderwerp]"\n3. Typ \`[EXAMEN]\` gevolgd door een onderwerp voor een oefentoets\n\n## Tips\n- Claude heeft een groot contextvenster — je kunt meerdere onderwerpen per sessie behandelen\n- Gebruik artefacten voor samenvattingen en schema's\n- De tutor kan automatisch alle bestanden tegelijk doorzoeken\n`;
}
