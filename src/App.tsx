import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  FileText, 
  Upload, 
  Loader2, 
  Calendar, 
  Copy, 
  Check, 
  BookOpen,
  ArrowRight,
  Settings,
  Download,
  Info,
  Map as MapIcon,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  CheckCircle2,
  Circle,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Toaster, toast } from 'sonner';
import JSZip from 'jszip';
import { processDocument, type StudyPlan, type Chapter } from './lib/ai';
import { splitPdfIntoChunks, type PdfChunk } from './lib/pdfSplitter';
import { preprocessPdf } from './lib/pdfPreprocessor';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ProcessItem = {
  id: string;
  file: File;
  originalName: string;
  isChunk: boolean;
  startPage?: number;
  endPage?: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  docType: string;
};

type UploadedFile = {
  file: File;
  type: string;
};

const LOADING_MESSAGES = [
  "Document uploaden en voorbereiden (dit kan even duren bij grote bestanden)...",
  "AI analyseert de pagina's en structuur...",
  "Tekst, wiskunde en tabellen exact overnemen...",
  "Handschrift en afbeeldingen verwerken...",
  "Master Study Map genereren...",
  "GPT Instructies schrijven...",
  "Bijna klaar..."
];

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showMapPreview, setShowMapPreview] = useState(false);
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [processQueue, setProcessQueue] = useState<ProcessItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [maxChunkSizeMB, setMaxChunkSizeMB] = useState(45);
  const [useAdvancedOcr, setUseAdvancedOcr] = useState(false);
  const [ocrSharpen, setOcrSharpen] = useState(false);
  const [ocrNoiseReduction, setOcrNoiseReduction] = useState(false);
  const [ocrAdaptiveThreshold, setOcrAdaptiveThreshold] = useState(false);
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai'>('gemini');
  const [processingStats, setProcessingStats] = useState({ startTime: 0, completed: 0, total: 0 });
  const isCancelledRef = useRef(false);

  const handleCancel = () => {
    isCancelledRef.current = true;
    setFiles([]);
    setProcessQueue([]);
    setLoading(false);
    setIsProcessingQueue(false);
    setProgressText(null);
    setPlan(null);
    setShowSetup(false);
    toast.info("Verwerking geannuleerd en bestanden verwijderd.");
  };

  useEffect(() => {
    let interval: number;
    if (loading) {
      interval = window.setInterval(() => {
        setLoadingMsgIdx((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 4000);
    } else {
      setLoadingMsgIdx(0);
      setProgressText(null);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFiles(prev => {
        const newFiles = acceptedFiles.map(f => ({ file: f, type: 'auto' }));
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
      'text/plain': ['.txt']
    },
    multiple: true
  });

  const prepareQueue = async () => {
    if (files.length === 0) return;
    
    isCancelledRef.current = false;
    setLoading(true);
    setProgressText("Bestanden analyseren...");
    let queue: ProcessItem[] = [];

    for (let fMeta of files) {
      if (isCancelledRef.current) return;
      
      let f = fMeta.file;
      const docType = fMeta.type;
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        if (useAdvancedOcr) {
          setProgressText(`"${f.name}" aan het voorbereiden met geavanceerde OCR preprocessing...`);
          try {
            f = await preprocessPdf(f, (progress) => {
              if (isCancelledRef.current) return;
              setProgressText(`"${f.name}" aan het voorbereiden met geavanceerde OCR preprocessing... ${progress}%`);
            }, {
              sharpen: ocrSharpen,
              noiseReduction: ocrNoiseReduction,
              adaptiveThreshold: ocrAdaptiveThreshold
            });
          } catch (err) {
            console.error("Preprocessing error", err);
            toast.error(`Fout bij preprocessing van ${f.name}. We gaan door zonder preprocessing.`);
          }
        }

        if (isCancelledRef.current) return;

        if (f.size > maxChunkSizeMB * 1024 * 1024) {
          setProgressText(`"${f.name}" slim aan het splitsen op basis van hoofdstukken (dit kan even duren)...`);
          try {
            const chunks = await splitPdfIntoChunks(f, maxChunkSizeMB * 1024 * 1024, undefined, aiProvider);
            if (isCancelledRef.current) return;
            chunks.forEach((chunk, idx) => {
              queue.push({
                id: `${f.name}-chunk-${idx}`,
                file: chunk.file,
                originalName: f.name,
                isChunk: true,
                startPage: chunk.startPage,
                endPage: chunk.endPage,
                status: 'pending',
                docType: docType
              });
            });
          } catch (err) {
            console.error("Split error", err);
            toast.error(`Fout bij het splitsen van ${f.name}. Probeer het bestand zelf te splitsen.`);
            setLoading(false);
            return;
          }
        } else {
          queue.push({
            id: f.name,
            file: f,
            originalName: f.name,
            isChunk: false,
            status: 'pending',
            docType: docType
          });
        }
      } else {
        // Non-PDF file handling
        if (f.size > maxChunkSizeMB * 1024 * 1024) {
          toast.warning(`"${f.name}" is groter dan ${maxChunkSizeMB}MB. Niet-PDF bestanden kunnen momenteel niet automatisch worden gesplitst.`);
        }
        queue.push({
          id: f.name,
          file: f,
          originalName: f.name,
          isChunk: false,
          status: 'pending',
          docType: docType
        });
      }
    }

    if (isCancelledRef.current) return;
    setProcessQueue(queue);
    setLoading(false);
    startProcessing(queue);
  };

  const startProcessing = async (queueToProcess: ProcessItem[]) => {
    setIsProcessingQueue(true);
    setProcessingStats({ startTime: Date.now(), completed: 0, total: queueToProcess.length });
    let combinedPlan: StudyPlan | null = null;
    
    for (let i = 0; i < queueToProcess.length; i++) {
      if (isCancelledRef.current) return;
      
      const item = queueToProcess[i];
      
      setProcessQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'processing' } : p));
      
      try {
        const result = await processDocument(item.file, item.docType, aiProvider);
        if (isCancelledRef.current) return;
        
        if (!combinedPlan) {
          combinedPlan = result;
          if (queueToProcess.length > 1) {
            combinedPlan.masterStudyMap = `\n\n--- Document: ${item.originalName}${item.isChunk ? ` (Pagina ${item.startPage}-${item.endPage})` : ''} ---\n\n` + combinedPlan.masterStudyMap;
          }
        } else {
          combinedPlan.chapters = [...combinedPlan.chapters, ...result.chapters];
          combinedPlan.masterStudyMap += `\n\n--- Document: ${item.originalName}${item.isChunk ? ` (Pagina ${item.startPage}-${item.endPage})` : ''} ---\n\n` + result.masterStudyMap;
        }
        
        setProcessQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'done' } : p));
        setProcessingStats(prev => ({ ...prev, completed: prev.completed + 1 }));
      } catch (error) {
        console.error("Error processing document:", error);
        setProcessQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'error' } : p));
        setProcessingStats(prev => ({ ...prev, completed: prev.completed + 1 }));
        toast.error(`Fout bij verwerken van ${item.originalName}${item.isChunk ? ` (deel)` : ''}.`);
      }
    }
    
    if (isCancelledRef.current) return;
    
    if (combinedPlan) {
      combinedPlan.totalWeeks = new Set(combinedPlan.chapters.map(c => c.week)).size;
      setPlan(combinedPlan);
      setShowSetup(true);
    }
    setIsProcessingQueue(false);
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
    toast.success('Master Study Map gedownload!');
  };

  const formatPrompt = (chapter: Chapter) => {
    return `Hier is de content voor Week ${chapter.week}: ${chapter.title}\n\nSamenvatting: ${chapter.summary}\n\nContent:\n${chapter.content}\n\nGebruik de Master Study Map om te zien waar we zijn. Laten we dit hoofdstuk interactief doornemen. Test me op de stof en eventuele opdrachten.`;
  };

  const copyAllPrompts = () => {
    if (!plan) return;
    let content = '';
    plan.chapters.forEach((chapter, i) => {
      content += `--- PROMPT ${i + 1}: Week ${chapter.week} - ${chapter.title} ---\n\n`;
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
      content += `## Prompt ${i + 1}: Week ${chapter.week} - ${chapter.title}\n\n`;
      content += `${formatPrompt(chapter)}\n\n---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `StudyPlan_${files.length > 0 ? files[0].file.name.replace(/\.[^/.]+$/, "") : 'export'}.md`;
    a.click();
    toast.success('Alle prompts gedownload!');
  };

  const downloadOptimizedRagZip = async () => {
    if (!plan) return;
    
    const zip = new JSZip();
    
    // 1. Create the Master Index & Instructions file for ChatGPT
    let indexContent = `# SYSTEM INSTRUCTIONS & MASTER INDEX\n\n`;
    
    indexContent += `## 🤖 JOUW ROL EN DOEL (SYSTEM PROMPT)\n`;
    indexContent += `Je bent een gespecialiseerde, academische AI Tutor. Je doel is om de student te helpen de onderstaande cursus te beheersen door middel van actieve herinnering (active recall) en de socratische methode.\n`;
    indexContent += `Geef NOOIT direct het antwoord op een vraag, maar stel wedervragen om de student zelf tot het inzicht te laten komen. Wees aanmoedigend, geduldig en pas je niveau aan op de student.\n\n`;
    
    indexContent += `## ⚙️ HOE JE DEZE KNOWLEDGE BASE GEBRUIKT (RAG INSTRUCTIES)\n`;
    indexContent += `1. **Zoek Altijd Eerst:** Gebruik ALTIJD je \`file_search\` tool om de relevante \`.md\` bestanden te raadplegen voordat je feitelijke antwoorden geeft. Vertrouw niet op je eigen basiskennis.\n`;
    indexContent += `2. **Gebruik de Index:** Gebruik de onderstaande 'Bestanden Index' als je routekaart. Als een student over een specifiek onderwerp begint, zoek dan de exacte bestandsnaam op in de index en lees dat bestand.\n`;
    indexContent += `3. **Eén Stap Tegelijk:** Overhoor de student per specifiek hoofdstuk. Ga pas door naar het volgende hoofdstuk als de student de huidige stof begrijpt.\n`;
    indexContent += `4. **Strikte Bronvermelding:** Als je informatie uit een bestand gebruikt, benoem dan ALTIJD kort uit welk bestand of welke week dit komt (bijv. *"Zoals we in Week 2 zagen..."*). Dit voorkomt hallucinaties.\n\n`;
    
    indexContent += `## 🗺️ MASTER STUDY MAP (CURSUS OVERZICHT)\n`;
    indexContent += `${plan.masterStudyMap}\n\n`;
    
    indexContent += `## 📁 BESTANDEN INDEX (KNOWLEDGE BASE ROUTER)\n`;
    indexContent += `Hieronder staat de exacte mapping van alle bestanden in je knowledge base. Gebruik deze bestandsnamen in je \`file_search\` queries:\n\n`;
    
    // 2. Create individual Markdown files for each chapter with advanced RAG formatting
    plan.chapters.forEach((chapter, index) => {
      const safeTitle = chapter.title.replace(/[^a-z0-9]/gi, '_');
      const fileName = `Week_${String(chapter.week).padStart(2, '0')}_Hoofdstuk_${String(index + 1).padStart(2, '0')}_${safeTitle}.md`;
      
      // Determine previous and next chapters for sequential breadcrumbs
      const prevChapter = index > 0 ? plan.chapters[index - 1].title : "Geen (Dit is het begin)";
      const nextChapter = index < plan.chapters.length - 1 ? plan.chapters[index + 1].title : "Geen (Dit is het einde)";
      
      // Add to Master Index
      indexContent += `- **Bestand:** \`${fileName}\`\n  - **Week:** ${chapter.week}\n  - **Onderwerp:** ${chapter.title}\n  - **Wanneer gebruiken:** Raadpleeg dit bestand als de student vragen heeft over ${chapter.title} of als je de student over dit onderwerp wilt overhoren.\n\n`;
      
      // Create the actual chapter file with YAML Frontmatter, Keywords, Breadcrumbs and Micro-prompting
      let chapterContent = `---
title: "${chapter.title}"
week: ${chapter.week}
chapter_index: ${index + 1}
document_type: "course_material"
tags: ["studie_materiaal", "week_${chapter.week}", "hoofdstuk_${index + 1}"]
context_breadcrumbs:
  previous: "${prevChapter}"
  current: "${chapter.title}"
  next: "${nextChapter}"
---

# Week ${chapter.week}: ${chapter.title}

> **[AI TUTOR INSTRUCTIE & CONTEXT]** 
> *Dit is een verborgen instructie voor jou, de LLM. Dit document bevat de lesstof voor week ${chapter.week}.*
> *Context: Het vorige hoofdstuk was "${prevChapter}". Het volgende hoofdstuk is "${nextChapter}".*
> *Instructie: Gebruik de 'Kern Samenvatting' voor een snel overzicht, en de 'Volledige Lesstof' voor diepgaande details. Als je de student overhoort over dit document, stel dan 1 open vraag tegelijk en wacht op antwoord.*

## 1. Kern Samenvatting
${chapter.summary}

---

## 2. Volledige Lesstof
${chapter.content}

---
> **[EINDE DOCUMENT]** *Controleer of de student deze concepten begrijpt voordat je doorgaat naar het volgende bestand in de index.*
`;
      
      zip.file(fileName, chapterContent);
    });
    
    // Add the index file to the zip
    zip.file("00_SYSTEM_INSTRUCTIONS_AND_INDEX.md", indexContent);
    
    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GPT_RAG_Export_${files.length > 0 ? files[0].file.name.replace(/\.[^/.]+$/, "") : 'Cursus'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success("Geavanceerde RAG-Optimized ZIP gedownload!");
    } catch (error) {
      console.error("Error generating ZIP:", error);
      toast.error("Fout bij het genereren van de ZIP map.");
    }
  };

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
                className="text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 transition-colors px-4 py-2 rounded-full flex items-center gap-2 shadow-sm"
              >
                <Download className="w-4 h-4" />
                Download GPT RAG-Export (ZIP)
              </button>
              <button 
                onClick={() => { setPlan(null); setFiles([]); setShowSetup(false); setShowMapPreview(false); setProcessQueue([]); setIsProcessingQueue(false); }}
                className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-full"
              >
                Nieuw Document
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {isProcessingQueue ? (
            <motion.div 
              key="processing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto bg-white rounded-3xl p-8 border border-gray-200 shadow-xl"
            >
              <div className="text-center mb-8">
                <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900">AI Analyse in uitvoering</h2>
                <p className="text-gray-500 mt-2">Gemini 3.1 Pro leest de documenten, herkent tabellen en wiskunde, en corrigeert automatisch scheve scans en contrast.</p>
              </div>

              <div className="mb-8">
                <div className="flex justify-between text-sm font-medium text-gray-600 mb-2">
                  <span>Voortgang: {processingStats.completed} van {processingStats.total} bestanden</span>
                  <span>
                    {processingStats.completed > 0 
                      ? `Nog ~${Math.floor(Math.max(0, ((Date.now() - processingStats.startTime) / processingStats.completed) * processingStats.total - (Date.now() - processingStats.startTime)) / 60000)} min ${Math.floor((Math.max(0, ((Date.now() - processingStats.startTime) / processingStats.completed) * processingStats.total - (Date.now() - processingStats.startTime)) % 60000) / 1000)} sec`
                      : "Schatting maken..."}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-orange-500 h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${processingStats.total > 0 ? (processingStats.completed / processingStats.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
              
              <div className="space-y-3">
                {processQueue.map((item) => (
                  <div key={item.id} className={cn(
                    "flex items-center justify-between p-4 rounded-xl border transition-colors",
                    item.status === 'processing' ? "bg-orange-50 border-orange-200" :
                    item.status === 'done' ? "bg-green-50 border-green-200" :
                    item.status === 'error' ? "bg-red-50 border-red-200" :
                    "bg-gray-50 border-gray-200"
                  )}>
                    <div className="flex items-center gap-3">
                      {item.status === 'pending' && <Circle className="w-5 h-5 text-gray-400" />}
                      {item.status === 'processing' && <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />}
                      {item.status === 'done' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                      {item.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                      
                      <div>
                        <p className={cn("font-medium", item.status === 'done' ? "text-green-900" : "text-gray-900")}>
                          {item.originalName}
                        </p>
                        {item.isChunk && (
                          <p className="text-xs text-gray-500">Deel: Pagina {item.startPage} t/m {item.endPage}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      {item.status === 'pending' && <span className="text-gray-500">Wachtrij</span>}
                      {item.status === 'processing' && <span className="text-orange-600">Bezig...</span>}
                      {item.status === 'done' && <span className="text-green-600">Klaar</span>}
                      {item.status === 'error' && <span className="text-red-600">Fout</span>}
                    </div>
                  </div>
                ))}
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
                  Upload je documenten en laat AI een Master Study Map en GPT-instructies genereren. Perfect voor gigantische PDF's, slides, Word-documenten en samenvattingen.
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
                    Of klik om bestanden te selecteren (PDF, PPTX, DOCX, XLSX, MD, TXT)
                  </p>
                </div>
              </div>

              {files.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 space-y-3"
                >
                  {files.map((fMeta, idx) => (
                    <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-white border rounded-xl shadow-sm gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{fMeta.file.name}</p>
                          <p className="text-sm text-gray-500">{(fMeta.file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <select 
                          value={fMeta.type}
                          onChange={(e) => {
                            const newFiles = [...files];
                            newFiles[idx].type = e.target.value;
                            setFiles(newFiles);
                          }}
                          className="text-sm border-gray-300 rounded-lg focus:ring-orange-500 focus:border-orange-500 py-2 px-3 bg-gray-50"
                        >
                          <option value="auto">Auto Detect</option>
                          <option value="slides">Slides / College</option>
                          <option value="summary">Samenvatting</option>
                          <option value="literature">Literatuur</option>
                          <option value="exercises">Oefenopdrachten</option>
                          <option value="exam">Oefententamen</option>
                        </select>
                        <button 
                          onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}

              {files.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-10 space-y-8"
                >
                  <div className="flex flex-col items-center gap-3 mt-6">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Geavanceerde Instellingen</label>
                    <div className="flex flex-col gap-3 w-full max-w-md">
                      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-200 shadow-sm">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-700">AI Model Provider</span>
                          <span className="text-xs text-gray-500">Kies tussen Gemini of OpenAI</span>
                        </div>
                        <select 
                          value={aiProvider}
                          onChange={(e) => setAiProvider(e.target.value as 'gemini' | 'openai')}
                          className="px-3 py-2 border border-gray-300 rounded-lg font-medium focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-sm"
                        >
                          <option value="gemini">Google Gemini</option>
                          <option value="openai">OpenAI (GPT-4o)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-200 shadow-sm">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-700">Max Chunk Grootte (MB)</span>
                          <span className="text-xs text-gray-500">Voor grote bestanden (standaard 45MB)</span>
                        </div>
                        <input 
                          type="number" 
                          min="10" 
                          max="100" 
                          value={maxChunkSizeMB}
                          onChange={(e) => setMaxChunkSizeMB(Number(e.target.value) || 45)}
                          className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center font-medium focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
                        />
                      </div>
                      
                      <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-200 shadow-sm cursor-pointer" onClick={() => setUseAdvancedOcr(!useAdvancedOcr)}>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-gray-700">Geavanceerde OCR Preprocessing</span>
                          <span className="text-xs text-gray-500">Contrast & ruisonderdrukking (Trager)</span>
                        </div>
                        <div className={cn(
                          "w-12 h-6 rounded-full transition-colors relative",
                          useAdvancedOcr ? "bg-orange-500" : "bg-gray-200"
                        )}>
                          <div className={cn(
                            "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                            useAdvancedOcr ? "left-7" : "left-1"
                          )} />
                        </div>
                      </div>
                      
                      {useAdvancedOcr && (
                        <div className="flex flex-col gap-2 pl-4 border-l-2 border-orange-200 ml-2 mt-2">
                          <label className="flex items-center space-x-3 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ocrNoiseReduction}
                              onChange={(e) => setOcrNoiseReduction(e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                            />
                            <span>Ruisreductie (vervaagt lichte ruis)</span>
                          </label>
                          <label className="flex items-center space-x-3 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ocrSharpen}
                              onChange={(e) => setOcrSharpen(e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                            />
                            <span>Verscherpen (voor wazige scans)</span>
                          </label>
                          <label className="flex items-center space-x-3 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ocrAdaptiveThreshold}
                              onChange={(e) => setOcrAdaptiveThreshold(e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                            />
                            <span>Adaptieve Drempelwaarde (voor slechte belichting)</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center mt-8 gap-4">
                    <button
                      onClick={prepareQueue}
                      disabled={loading}
                      className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-10 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 hover:scale-105 transition-all disabled:opacity-70 disabled:hover:scale-100 shadow-xl shadow-orange-500/20"
                    >
                      {loading ? (
                        <AnimatePresence mode="wait">
                          <motion.div 
                            key={loadingMsgIdx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex flex-col items-center gap-1"
                          >
                            <div className="flex items-center gap-3">
                              <Loader2 className="w-6 h-6 animate-spin" />
                              {progressText || LOADING_MESSAGES[loadingMsgIdx]}
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      ) : (
                        <>
                          Genereer Studie Architectuur
                          <ArrowRight className="w-6 h-6" />
                        </>
                      )}
                    </button>
                    {loading && (
                      <button
                        onClick={handleCancel}
                        className="text-red-500 hover:text-red-700 font-medium flex items-center gap-2 px-4 py-2 rounded-full hover:bg-red-50 transition-colors"
                      >
                        <X className="w-4 h-4" /> Annuleren
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-gray-200 pt-12">
                <div className="space-y-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 font-bold">1</div>
                  <h3 className="font-bold text-lg">Upload & Analyse</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">Gemini 3.1 Pro leest gigantische bestanden, herkent slides, opdrachten en structureert de chaos.</p>
                </div>
                <div className="space-y-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 font-bold">2</div>
                  <h3 className="font-bold text-lg">Master Map</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">Ontvang een Markdown 'GPS' kaart die je Custom GPT precies vertelt hoe de cursus in elkaar zit.</p>
                </div>
                <div className="space-y-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 font-bold">3</div>
                  <h3 className="font-bold text-lg">Interactieve Tutor</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">Kopieer de gegenereerde systeeminstructies naar ChatGPT en laat je stap-voor-stap overhoren.</p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-gray-200 pb-6 gap-4">
                <div>
                  <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Jouw Studie Architectuur</h2>
                  <p className="text-gray-500 mt-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
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
                  <div className="bg-white border border-gray-200 px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-sm">
                    <Calendar className="w-4 h-4 text-orange-500" />
                    <span className="font-bold text-gray-700">{new Set(plan.chapters.map(c => c.week)).size} Weken</span>
                  </div>
                </div>
              </div>

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
                          <h4 className="font-bold text-lg">Master Study Map</h4>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed">
                          Dit bestand bevat de volledige architectuur van je studie. Upload dit naar de <strong>Knowledge</strong> sectie van je Custom GPT.
                        </p>
                        <div className="flex gap-3">
                          <button 
                            onClick={downloadStudyMap}
                            className="flex-1 flex justify-center items-center gap-2 bg-orange-500 text-white px-4 py-3 rounded-xl font-bold text-sm hover:bg-orange-600 transition-all shadow-md shadow-orange-500/20"
                          >
                            <Download className="w-4 h-4" />
                            Download Map (.md)
                          </button>
                          <button 
                            onClick={() => setShowMapPreview(!showMapPreview)}
                            className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all"
                            title="Preview Map"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
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
                            <Markdown remarkPlugins={[remarkGfm]}>{plan.masterStudyMap}</Markdown>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="bg-orange-100/50 rounded-2xl p-5 flex items-start gap-4 border border-orange-200/50">
                      <Info className="w-6 h-6 text-orange-600 shrink-0" />
                      <p className="text-sm text-orange-900 leading-relaxed">
                        <strong>Pro Tip:</strong> Nadat je de GPT hebt ingesteld, kun je de individuele hoofdstuk-content (hieronder) kopiëren en plakken wanneer de GPT erom vraagt. De GPT zal de opdrachten in de tekst herkennen en je overhoren!
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Weekly Timeline */}
                <div className="lg:col-span-4 space-y-4">
                  <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                    <h3 className="font-bold text-sm uppercase tracking-widest text-gray-500">Studie Pad</h3>
                    <MapIcon className="w-5 h-5 text-gray-300" />
                  </div>
                  <div className="space-y-3">
                    {Array.from(new Set(plan.chapters.map(c => c.week))).sort((a, b) => a - b).map((weekNum) => {
                      const chaptersInWeek = plan.chapters.filter(c => c.week === weekNum);
                      return (
                        <div key={weekNum} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:border-orange-300 transition-colors">
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-extrabold text-lg text-gray-900">Week {weekNum}</span>
                            <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-md">{chaptersInWeek.length} items</span>
                          </div>
                          <div className="space-y-2">
                            {chaptersInWeek.map((c, idx) => (
                              <div key={idx} className="text-sm text-gray-600 flex items-start gap-3">
                                <div className="w-1.5 h-1.5 bg-orange-400 rounded-full mt-1.5 shrink-0" />
                                <span className="leading-snug">{c.title}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Chapter Details */}
                <div className="lg:col-span-8 space-y-4">
                  <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-200 shadow-sm mb-2">
                    <h3 className="font-bold text-sm uppercase tracking-widest text-gray-500">Hoofdstukken & Prompts</h3>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={copyAllPrompts}
                        className={cn(
                          "text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5",
                          copiedId === 'copy-all' 
                            ? "bg-green-500 text-white" 
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                      >
                        {copiedId === 'copy-all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === 'copy-all' ? 'Gekopieerd!' : 'Kopieer Alles'}
                      </button>
                      <button 
                        onClick={downloadAllPrompts}
                        className="text-xs font-bold bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-black transition-colors flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Alles (.md)
                      </button>
                      <button 
                        onClick={downloadOptimizedRagZip}
                        className="text-xs font-bold bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        GPT RAG-Export (ZIP)
                      </button>
                      <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1.5 rounded-lg">Klaar voor ChatGPT</span>
                    </div>
                  </div>
                  
                  {plan.chapters.map((chapter, i) => {
                    const isExpanded = expandedChapter === chapter.id;
                    return (
                      <motion.div 
                        key={chapter.id || i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={cn(
                          "bg-white border rounded-2xl overflow-hidden transition-all duration-300",
                          isExpanded ? "border-orange-300 shadow-md" : "border-gray-200 shadow-sm hover:border-gray-300"
                        )}
                      >
                        <div className="p-6">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="bg-orange-100 text-orange-700 text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-md tracking-wider">
                                  Week {chapter.week}
                                </span>
                                <span className="text-gray-400 text-xs font-mono">{chapter.id}</span>
                              </div>
                              <h4 className="text-xl font-bold text-gray-900 leading-tight">{chapter.title}</h4>
                            </div>
                            <button
                              onClick={() => copyToClipboard(formatPrompt(chapter), `c-${i}`)}
                              className={cn(
                                "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shrink-0",
                                copiedId === `c-${i}` 
                                  ? "bg-green-500 text-white shadow-md shadow-green-500/20" 
                                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                              )}
                            >
                              {copiedId === `c-${i}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                              {copiedId === `c-${i}` ? 'Gekopieerd' : 'Kopieer Prompt'}
                            </button>
                          </div>
                          
                          <p className="text-gray-600 text-sm leading-relaxed mb-4">
                            {chapter.summary}
                          </p>

                          <button 
                            onClick={() => setExpandedChapter(isExpanded ? null : chapter.id)}
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
                                    Geëxtraheerde Content
                                  </div>
                                  <div className="prose prose-sm max-w-none text-gray-600">
                                    <Markdown remarkPlugins={[remarkGfm]}>{chapter.content}</Markdown>
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}} />
    </div>
  );
}
