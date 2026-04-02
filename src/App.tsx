import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { BookOpen, Loader2, Moon, Package, RotateCcw, Sun, ArrowLeft, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { checkHealth, type StudyPlan, type Chapter } from './api/client';
import { cn, countWords, sanitizeFilename, stripMarkdownAndLatex } from './utils';
import { buildBundles, type Bundle, type BundleItem } from './utils/bundling';
import { enrichForRetrieval } from './utils/retrieval';
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

const LEGACY_DEFAULT_PROMPT_TEMPLATE =
  'Hier is de content voor {topic}: {title}\n\nSamenvatting: {summary}\n\nContent:\n{content}\n\nGebruik de Master Study Map om te zien waar we zijn. Laten we dit hoofdstuk interactief doornemen. Test me op de stof en eventuele opdrachten.';

const DEFAULT_PROMPT_TEMPLATE =
  'Hier is de content voor {title}\n\nSamenvatting: {summary}\n\nContent:\n{content}\n\nGebruik de Master Study Map om te zien waar we zijn. Laten we dit hoofdstuk interactief doornemen. Test me op de stof en eventuele opdrachten.';

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
      const saved = localStorage.getItem('studyflow_prompt_template');
      if (!saved || saved === LEGACY_DEFAULT_PROMPT_TEMPLATE) return DEFAULT_PROMPT_TEMPLATE;
      return saved;
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
          const snapshot = { status: 'warning' as const, message: 'Backend draait, maar Nederlandse/Engelse Tesseract-taaldata ontbreekt. OCR werkt mogelijk niet correct.' };
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

  const orderedChapters = (targetPlan: StudyPlan): Chapter[] => {
    const ordered = topicOrder.flatMap(t => targetPlan.chapters.filter(c => c.topic === t));
    const seen = new Set(ordered.map(chapter => chapter.id));
    const remainder = targetPlan.chapters.filter(chapter => !seen.has(chapter.id));
    return [...ordered, ...remainder];
  };

  const copyAllPrompts = () => {
    if (!plan) return;
    let content = '';
    orderedChapters(plan).forEach((chapter, i) => {
      content += `--- PROMPT ${i + 1}: ${chapter.title} ---\n\n${formatPrompt(chapter)}\n\n`;
    });
    copyToClipboard(content, 'copy-all');
  };

  const downloadAllPrompts = () => {
    if (!plan) return;
    const courseName = activeCourse?.name ?? 'Cursus';
    let content = `# ${courseName}\n\n## Master Study Map\n\n${plan.masterStudyMap}\n\n---\n\n## GPT System Instructions\n\n${plan.gptSystemInstructions}\n\n---\n\n`;
    orderedChapters(plan).forEach((chapter, i) => {
      content += `## Prompt ${i + 1}: ${chapter.title}\n\n${formatPrompt(chapter)}\n\n---\n\n`;
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
      const courseName = activeCourse.name;
      const chaptersInOrder = orderedChapters(plan);
      const totalChapters = chaptersInOrder.length;
      const totalTopics = new Set(chaptersInOrder.map(chapter => chapter.topic)).size;
      const chapterById = new Map(chaptersInOrder.map(chapter => [chapter.id, chapter]));
      const bundles = buildBundles(chaptersInOrder);
      const bundleCount = bundles.length;
      const zipFileCount = 3 + bundleCount;
      const fileNameByChapterId = buildChapterFileMap(bundles);
      const sectionOffsets = buildSectionOffsetMap(bundles);

      const injectAnchors = (content: string, chapterId: string, item: BundleItem): string => {
        let sectionIdx = 0;
        const itemKey = getBundleItemKey(item);
        const existingOffset = sectionOffsets.get(itemKey);
        if (existingOffset !== undefined) {
          sectionIdx = existingOffset;
        }

        return content.split('\n').map(line => {
          if (line.startsWith('### ')) {
            sectionIdx++;
            return `${line} (KB_SEC: ${chapterId}-S${sectionIdx})`;
          }
          return line;
        }).join('\n');
      };

      // ── Platform-specific system instructions ──
      const systemInstructions = buildSystemInstructions(platform, courseName, totalChapters, totalTopics, zipFileCount, bundleCount, plan);
      zip.file("SYSTEM_INSTRUCTIONS.md", systemInstructions);

      // ── Master index (universal) ──
      const indexContent = buildMasterIndexContent(
        courseName,
        totalTopics,
        totalChapters,
        zipFileCount,
        bundles,
        chapterById,
        plan.masterStudyMap,
      );
      zip.file("00_MASTER_INDEX.md", indexContent);

      // ── Per-bundle content files (universal) ──
      bundles.forEach((bundle, bundleIdx) => {
        const safeLabel = sanitizeFilename(bundle.label);
        const fileName = `${safeLabel}.md`;
        const tableOfContents = bundle.items
          .map((item, index) => `${index + 1}. [${item.chapterId}: ${item.title}](#${slugify(`${item.chapterId}-${item.title}`)})`)
          .join('\n');

        const bundleSections = bundle.items.map((item) => {
          const chapter = chapterById.get(item.chapterId);
          const anchoredContent = injectAnchors(item.content, item.chapterId, item);
          const enrichedContent = enrichForRetrieval(
            anchoredContent,
            item.chapterId,
            item.topic,
          );
          const keyConcepts = formatInlineList(
            uniqueStrings([...(chapter?.key_concepts ?? []), ...item.keyConcepts]),
          );
          const splitLabel = item.partCount > 1
            ? `**Deel:** ${item.partIndex} van ${item.partCount}\n`
            : '';
          const summary = chapter?.summary ? `**Samenvatting:** ${chapter.summary}\n` : '';

          return [
            `## ${item.chapterId}: ${item.title}`,
            `<a id="${slugify(`${item.chapterId}-${item.title}`)}"></a>`,
            `KB_ID: ${item.chapterId}`,
            '',
            `**Onderwerp:** ${item.topic}`,
            splitLabel.trimEnd(),
            summary.trimEnd(),
            `**Kernbegrippen:** ${keyConcepts}`,
            '',
            enrichedContent,
          ].filter(Boolean).join('\n');
        }).join('\n\n---\n\n');

        const bundleContent = [
          buildBundleFrontmatter(bundle, bundleIdx + 1, bundleCount),
          `# Smart Bundle ${bundleIdx + 1}: ${bundle.topics.join(', ')}`,
          '',
          buildRetrievalPreamble(bundle, chapterById),
          '',
          '## Inhoudsopgave',
          tableOfContents || '- Geen hoofdstukken gevonden.',
          '',
          '---',
          '',
          bundleSections,
          '',
          '---',
          '',
          buildSeeAlsoSection(bundle, chapterById, fileNameByChapterId, fileName),
          '',
        ].join('\n');

        zip.file(fileName, bundleContent);
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
    () => (plan ? 3 + buildBundles(orderedChapters(plan)).length : 0),
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

function buildChapterFileMap(bundles: Bundle[]): Map<string, string> {
  const map = new Map<string, string>();

  bundles.forEach((bundle) => {
    const fileName = `${sanitizeFilename(bundle.label)}.md`;
    bundle.chapterIds.forEach((chapterId) => {
      if (!map.has(chapterId)) {
        map.set(chapterId, fileName);
      }
    });
  });

  return map;
}

function buildSectionOffsetMap(bundles: Bundle[]): Map<string, number> {
  const offsets = new Map<string, number>();
  const headingCountsByChapterId = new Map<string, number>();

  bundles.forEach((bundle) => {
    bundle.items.forEach((item) => {
      const itemKey = getBundleItemKey(item);
      const currentOffset = headingCountsByChapterId.get(item.chapterId) ?? 0;
      offsets.set(itemKey, currentOffset);
      headingCountsByChapterId.set(
        item.chapterId,
        currentOffset + countLevelThreeHeadings(item.content),
      );
    });
  });

  return offsets;
}

function getBundleItemKey(item: BundleItem): string {
  return `${item.chapterId}::${item.partIndex}/${item.partCount}`;
}

function countLevelThreeHeadings(content: string): number {
  return (content.match(/^###\s+/gm) ?? []).length;
}

function buildMasterIndexContent(
  courseName: string,
  totalTopics: number,
  totalChapters: number,
  zipFileCount: number,
  bundles: Bundle[],
  chapterById: Map<string, Chapter>,
  masterStudyMap: string,
): string {
  const lines = [
    `# MASTER INDEX — ${courseName.toUpperCase()}`,
    '',
    '## Overzicht',
    `- **Vak:** ${courseName}`,
    `- **Totaal onderwerpen:** ${totalTopics}`,
    `- **Totaal hoofdstukken:** ${totalChapters}`,
    `- **Bestanden:** ${zipFileCount}`,
    `- **Smart bundles:** ${bundles.length}`,
    '',
    '## Smart Bundles',
    '',
  ];

  bundles.forEach((bundle, bundleIndex) => {
    const fileName = `${sanitizeFilename(bundle.label)}.md`;
    lines.push(`### ${String(bundleIndex + 1).padStart(2, '0')}. ${fileName}`);
    lines.push(`- Onderwerpen: ${formatInlineList(bundle.topics)}`);
    lines.push(`- Hoofdstukken: ${formatInlineList(bundle.chapterIds)}`);
    lines.push(`- Kernbegrippen: ${formatInlineList(bundle.keyConcepts)}`);
    lines.push(`- Zoekhints: ${formatInlineList(bundle.searchHints.slice(0, 12))}`);
    lines.push('');

    bundle.items.forEach((item) => {
      const chapter = chapterById.get(item.chapterId);
      lines.push(`- **${item.chapterId}** — ${item.title}`);
      if (chapter?.summary) {
        lines.push(`  *${chapter.summary}*`);
      }
    });

    lines.push('');
  });

  lines.push('---', '', '## Master Study Map', '', masterStudyMap, '');
  return lines.join('\n');
}

function buildBundleFrontmatter(
  bundle: Bundle,
  bundleIndex: number,
  totalBundles: number,
): string {
  return [
    '---',
    yamlList('chapter_ids', bundle.chapterIds),
    yamlList('topics', bundle.topics),
    yamlList('key_concepts', bundle.keyConcepts),
    yamlList('search_hints', bundle.searchHints),
    `bundle_index: ${bundleIndex}`,
    `total_bundles: ${totalBundles}`,
    'document_type: "course_material"',
    '---',
  ].join('\n');
}

function buildRetrievalPreamble(
  bundle: Bundle,
  chapterById: Map<string, Chapter>,
): string {
  const chapterLabels = bundle.chapterIds
    .map((chapterId) => {
      const chapter = chapterById.get(chapterId);
      return chapter ? `${chapterId} (${chapter.title})` : chapterId;
    })
    .join(', ');
  const conceptLabel = bundle.keyConcepts.length > 0
    ? bundle.keyConcepts.slice(0, 12).join(', ')
    : 'de centrale begrippen uit deze hoofdstukken';

  return `Dit smart-bundlebestand ondersteunt retrieval voor de onderwerpen ${formatInlineList(bundle.topics)}. Het bevat de hoofdstukken ${chapterLabels} en bundelt kernbegrippen zoals ${conceptLabel}. Gebruik deze termen bij file_search om definities, voorbeelden, oefeningen, tabellen en formules snel te vinden. De YAML frontmatter bovenaan geeft een compacte index met chapter_ids, topics, key_concepts en search_hints. Zoek bij detailvragen eerst op een chapter ID of kernbegrip en gebruik daarna de KB_ID- en KB_SEC-tags in de markdown om exact naar de juiste passage of sectie te verwijzen. Bij lange hoofdstukken markeren Deel-bestanden opeenvolgende stukken van hetzelfde hoofdstuk zodat ook gesplitste content volledig vindbaar blijft.`;
}

function buildSeeAlsoSection(
  bundle: Bundle,
  chapterById: Map<string, Chapter>,
  fileNameByChapterId: Map<string, string>,
  currentFileName: string,
): string {
  const chapterIdsInBundle = new Set(bundle.chapterIds);
  const relatedIds = uniqueStrings(bundle.items.flatMap((item) => item.relatedSections))
    .filter((chapterId) => !chapterIdsInBundle.has(chapterId))
    .filter((chapterId) => {
      const targetFile = fileNameByChapterId.get(chapterId);
      return Boolean(targetFile) && targetFile !== currentFileName;
    });

  if (relatedIds.length === 0) {
    return '## Zie ook\n- Geen externe cross-references buiten dit bundlebestand.';
  }

  return [
    '## Zie ook',
    ...relatedIds.map((chapterId) => {
      const chapter = chapterById.get(chapterId);
      const fileName = fileNameByChapterId.get(chapterId) ?? 'Onbekend bestand';
      const title = chapter?.title ?? 'Onbekend hoofdstuk';
      return `- ${chapterId} — ${title} → \`${fileName}\``;
    }),
  ].join('\n');
}

function yamlList(key: string, values: string[]): string {
  if (values.length === 0) {
    return `${key}: []`;
  }

  return [ `${key}:`, ...values.map((value) => `  - ${yamlQuote(value)}`) ].join('\n');
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatInlineList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function buildAdaptiveCourseInstructions(plan: StudyPlan): string {
  const metadata = plan.courseMetadata;
  if (!metadata) {
    return '';
  }

  const sections: string[] = [];

  if (metadata.has_formulas) {
    sections.push(
      '### Formules\n- Wanneer de student een formule-gerelateerde vraag stelt, toon ALTIJD de formule in LaTeX.\n- Leg elke variabele expliciet uit.\n- Geef daarnaast een concreet rekenvoorbeeld met echte getallen voordat je abstraheert.'
    );
  }

  if (metadata.has_code) {
    const toolsLabel = metadata.detected_tools.length > 0
      ? metadata.detected_tools.join(', ')
      : 'de zichtbare programmeertaal uit het studiemateriaal';
    sections.push(
      `### Code En Tools\n- Bij programmeervragen, toon altijd werkende code in ${toolsLabel} wanneer dat relevant is.\n- Leg de code regel voor regel uit.\n- Vraag de student eerst om de output of het effect van de code te voorspellen voordat je het antwoord onthult.`
    );
  }

  if (metadata.exercise_types.includes('meerkeuze')) {
    sections.push(
      '### Meerkeuzevragen\n- Presenteer de antwoordopties stap voor stap.\n- Laat de student eerst redeneren voordat je het juiste antwoord geeft.\n- Leg vervolgens uit waarom elk fout antwoord fout is.'
    );
  }

  if (metadata.exercise_types.includes('berekening')) {
    sections.push(
      '### Reken- En Uitwerkingsvragen\n- Laat de student EERST zelf proberen.\n- Geef eerst hints of tussenstappen als de student vastloopt.\n- Toon de volledige uitwerking pas na hun poging of wanneer zij daar expliciet om vragen.'
    );
  }

  if (sections.length === 0) {
    return '';
  }

  return `## VAKSPECIFIEKE RICHTLIJNEN\n${sections.join('\n\n')}`;
}

// ── System instructions per platform ──
export function buildSystemInstructions(
  platform: 'chatgpt' | 'gemini' | 'claude',
  courseName: string,
  totalChapters: number,
  totalTopics: number,
  zipFileCount: number,
  bundleCount: number,
  plan: StudyPlan
): string {
  const base = `# STUDIEPLAN: ${courseName.toUpperCase()}\n\n`;
  const adaptiveInstructions = buildAdaptiveCourseInstructions(plan);
  const examModes = `## EXAMEN MODI\n### [OEFENEXAMEN]\n- Geef vragen één voor één.\n- Geef directe feedback na elk antwoord.\n- Bied hints en stapsgewijze coaching wanneer de student vastloopt.\n\n### [EXAMEN]\n- Geef alle vragen tegelijk als een echte toetssimulatie.\n- Houd feedback en modelantwoorden achter tot na de poging of op expliciet verzoek.\n- Gebruik KB_SEC-verwijzingen in het antwoordmodel.`;
  const shared = [
    '## KERNPRINCIPES',
    '1. **EVIDENCE-FIRST**: Elk feitelijk antwoord MOET beginnen met `Volgens [KB_ID: T#-C#]:` of `Zie (KB_SEC: T#-C#-S#):`.',
    '2. **ZERO HALLUCINATION**: Als een onderwerp NIET in de Knowledge Base staat, antwoord dan exact: "Dit staat niet in het studiemateriaal." Geef NOOIT antwoorden gebaseerd op eigen kennis voor cursusinhoud.',
    '3. **ACTIVE RECALL**: Stel de student vragen in plaats van direct antwoorden te geven. Gebruik de socratische methode.',
    '4. **SMART RETRIEVAL**: Lees altijd eerst de YAML frontmatter en retrieval preamble van het relevante bundlebestand voordat je inhoudelijk antwoordt.',
    '5. **VOLLEDIGHEID**: Neem ALLE stof door — ook wanneer een lang hoofdstuk is opgesplitst in meerdere Deel-bestanden.',
    '',
    examModes,
    adaptiveInstructions ? `\n${adaptiveInstructions}` : '',
    '',
    '## STUDIEPLAN OVERZICHT',
    plan.masterStudyMap,
    '',
    plan.gptSystemInstructions,
  ].filter(Boolean).join('\n');

  if (platform === 'chatgpt') {
    return `${base}## JOUW IDENTITEIT\nJe bent een gespecialiseerde academische AI Tutor. Je hebt toegang tot een Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen in ${bundleCount} smart bundles (${zipFileCount} bestanden totaal, geoptimaliseerd voor ChatGPT's 20-bestandenlimiet).\n\n## RETRIEVAL STRATEGIE (file_search)\n1. Begin altijd met \`00_MASTER_INDEX.md\` om de bundle-indeling en hoofdstuk-ID's te begrijpen.\n2. Zoek daarna het relevante \`Bundle_XX_*.md\` bestand en lees eerst de YAML frontmatter plus retrieval preamble.\n3. Gebruik \`chapter_ids\`, \`topics\`, \`key_concepts\` en \`search_hints\` om exact te bepalen welk bundlebestand relevant is.\n4. Zoek voor oefeningen op \`OEFENING:\`, voor definities op \`DEFINITIE:\`, voor voorbeelden op \`VOORBEELD:\`, en voor formules op zowel het kernbegrip als de LaTeX-notatie.\n5. Als een hoofdstuk in meerdere Deel-bestanden voorkomt, doorzoek alle delen voordat je concludeert dat informatie ontbreekt.\n\n## BESTANDSSTRUCTUUR (${zipFileCount} bestanden)\n- \`SYSTEM_INSTRUCTIONS.md\` — Dit bestand\n- \`00_MASTER_INDEX.md\` — Volledige cursuskaart en bundle-overzicht (raadpleeg EERST)\n- \`Bundle_01_*.md\` t/m \`Bundle_${String(bundleCount).padStart(2, '0')}_*.md\` — Smart bundles met frontmatter, retrieval preamble, lesstof en \`Zie ook\`\n- \`SNELSTARTGIDS.md\` — Opzetinstructies\n\n${shared}`;
  }
  if (platform === 'gemini') {
    return `${base}## JOUW IDENTITEIT\nJe bent een academische Gem Tutor voor het vak "${courseName}". Je hebt toegang tot een Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen in ${bundleCount} smart bundles.\n\n## RETRIEVAL STRATEGIE (Gems)\n1. Raadpleeg \`00_MASTER_INDEX.md\` voor de structuur en de bestandsindeling.\n2. Open daarna het relevante \`Bundle_XX_*.md\` bestand en lees eerst de frontmatter en retrieval preamble.\n3. Gebruik \`search_hints\`, \`key_concepts\` en \`chapter_ids\` als primaire zoektermen.\n4. Gebruik de KB_SEC ankertags om exacte secties te citeren.\n5. Verwijs altijd naar onderwerp, chapter ID en bestandsnaam bij je antwoord.\n\n## BESTANDSSTRUCTUUR\n- \`SYSTEM_INSTRUCTIONS.md\` — Dit bestand (plak dit als System Instruction)\n- \`00_MASTER_INDEX.md\` — Volledige cursuskaart en bundle-overzicht\n- Smart bundle-bestanden — Alle cursusinhoud met metadata-rijke frontmatter\n- \`SNELSTARTGIDS.md\` — Opzetinstructies\n\n${shared}`;
  }
  // claude
  return `${base}## JOUW IDENTITEIT\nJe bent een academische Claude Project Tutor voor het vak "${courseName}". Je hebt toegang tot een Project Knowledge Base met ${totalChapters} hoofdstukken verdeeld over ${totalTopics} onderwerpen in ${bundleCount} smart bundles.\n\n## RETRIEVAL STRATEGIE (Project Knowledge)\n1. Raadpleeg \`00_MASTER_INDEX.md\` voor de volledige cursusstructuur en bundle-volgorde.\n2. Open vervolgens het relevante \`Bundle_XX_*.md\` bestand en lees eerst de frontmatter en retrieval preamble.\n3. Citeer content met verwijzingen zoals "[Zie: KB_ID T#-C#]" of "[Zie: KB_SEC T#-C#-S#]".\n4. Gebruik \`Zie ook\` om aangrenzende hoofdstukken of gerelateerde onderwerpen erbij te pakken.\n5. Maak gebruik van Claude's lange contextvenster om meerdere bundles tegelijk te combineren, vooral bij gesplitste hoofdstukken.\n\n## BESTANDSSTRUCTUUR\n- \`SYSTEM_INSTRUCTIONS.md\` — Plak dit als Project Instructions\n- \`00_MASTER_INDEX.md\` — Volledige cursuskaart en bundle-overzicht\n- Smart bundle-bestanden — Alle cursusinhoud met metadata, preambles en cross-links\n- \`SNELSTARTGIDS.md\` — Opzetinstructies\n\n${shared}`;
}

// ── Platform-specific SNELSTARTGIDS ──
function buildSnelstartgids(
  platform: 'chatgpt' | 'gemini' | 'claude',
  courseName: string,
  fileCount: number
): string {
  if (platform === 'chatgpt') {
    return `# SNELSTARTGIDS — ChatGPT Custom GPT\n\n## Vak: ${courseName}\n\n## Stap 1: Maak een Custom GPT\n1. Ga naar chatgpt.com → Explore GPTs → Create\n2. Klik op "Configure"\n\n## Stap 2: Plak de System Instructions\n1. Open \`SYSTEM_INSTRUCTIONS.md\` uit deze ZIP\n2. Kopieer de volledige inhoud\n3. Plak dit in het veld "Instructions"\n\n## Stap 3: Upload de Knowledge Base bestanden\n1. Klik op "Knowledge" → "Upload files"\n2. Upload alle ${fileCount} bestanden uit deze ZIP\n3. ChatGPT zit op een limiet van 20 bestanden; deze export gebruikt daarom smart bundles in plaats van één bestand per onderwerp\n\n## Stap 4: Gebruik de bundelstructuur goed\n1. Laat de GPT eerst \`00_MASTER_INDEX.md\` lezen\n2. Elk \`Bundle_XX_*.md\` bestand start met YAML frontmatter, gevolgd door een retrieval preamble\n3. Lange hoofdstukken kunnen als \`Deel 1\`, \`Deel 2\` enzovoort over meerdere bundlebestanden verdeeld zijn\n4. Onderaan elk bundlebestand staat \`Zie ook\` voor gerelateerde hoofdstukken in andere bestanden\n\n## Stap 5: Sla op & begin met studeren\n1. Klik "Save" en geef je GPT een naam\n2. Begin bijvoorbeeld met: "Laten we beginnen met hoofdstuk T1-C1" of "Zoek alle informatie over [kernbegrip]"\n3. Typ \`[EXAMEN]\` gevolgd door een onderwerp voor een oefentoets\n\n## Tips\n- Gebruik chapter IDs en kernbegrippen als zoektermen\n- Vraag de tutor expliciet om het relevante bundlebestand te noemen\n- Laat de tutor bij gesplitste hoofdstukken altijd alle delen controleren\n`;
  }
  if (platform === 'gemini') {
    return `# SNELSTARTGIDS — Google Gemini Gem\n\n## Vak: ${courseName}\n\n## Stap 1: Maak een nieuwe Gem\n1. Ga naar gemini.google.com → Gem Manager → New Gem\n\n## Stap 2: Voeg de System Instruction toe\n1. Open \`SYSTEM_INSTRUCTIONS.md\` uit deze ZIP\n2. Kopieer de volledige inhoud\n3. Plak dit in het "Instructions" veld van de Gem\n\n## Stap 3: Upload de Knowledge Base bestanden\n1. Klik op "Knowledge" of "Files"\n2. Upload alle ${fileCount} bestanden uit deze ZIP\n\n## Stap 4: Begrijp de smart-bundle opbouw\n1. Start retrieval altijd via \`00_MASTER_INDEX.md\`\n2. Elk bundlebestand bevat YAML frontmatter met \`chapter_ids\`, \`topics\`, \`key_concepts\` en \`search_hints\`\n3. De retrieval preamble bovenaan geeft extra zoektermen voor Gemini\n4. Gebruik \`Zie ook\` om gerelateerde hoofdstukken in andere bestanden te volgen\n\n## Stap 5: Sla op & begin met studeren\n1. Klik "Save" en geef je Gem een naam\n2. Begin het gesprek met: "Laten we beginnen met hoofdstuk T1-C1"\n3. Typ \`[EXAMEN]\` gevolgd door een onderwerp voor een oefentoets\n\n## Tips\n- Zoek op chapter IDs of kernbegrippen voor de beste grounding\n- Controleer bij lange hoofdstukken ook de Deel-bestanden\n`;
  }
  // claude
  return `# SNELSTARTGIDS — Claude Project\n\n## Vak: ${courseName}\n\n## Stap 1: Maak een nieuw Project\n1. Ga naar claude.ai → Projects → New Project\n2. Geef het project de naam "${courseName}"\n\n## Stap 2: Voeg de Project Instructions toe\n1. Open \`SYSTEM_INSTRUCTIONS.md\` uit deze ZIP\n2. Kopieer de volledige inhoud\n3. Plak dit in "Project Instructions"\n\n## Stap 3: Upload de Knowledge Base bestanden\n1. Klik op "Add Content" of het upload-icoon\n2. Upload alle ${fileCount} bestanden uit deze ZIP\n\n## Stap 4: Gebruik de smart bundles slim\n1. Open eerst \`00_MASTER_INDEX.md\` voor de bundlekaart\n2. Lees bij elk bundlebestand eerst de YAML frontmatter en retrieval preamble\n3. Gebruik \`Zie ook\` om context uit gerelateerde bundles erbij te pakken\n4. Houd rekening met Deel-bestanden wanneer een hoofdstuk is opgesplitst\n\n## Stap 5: Begin met studeren\n1. Open een nieuw gesprek binnen het project\n2. Begin met: "Laten we beginnen met hoofdstuk T1-C1" of "Zoek alles over [kernbegrip]"\n3. Typ \`[EXAMEN]\` gevolgd door een onderwerp voor een oefentoets\n\n## Tips\n- Claude kan meerdere bundles tegelijk vergelijken\n- Laat Claude expliciet chapter IDs en KB_SEC-verwijzingen citeren\n- Gebruik artefacten voor samenvattingen en schema's op basis van de bundlebestanden\n`;
}
