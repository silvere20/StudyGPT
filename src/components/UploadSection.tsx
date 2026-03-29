import { useDropzone } from 'react-dropzone';
import { motion } from 'motion/react';
import { FileText, Upload, Loader2, Check, AlertCircle, ArrowRight, X } from 'lucide-react';
import { cn, formatFileSize } from '../utils';
import type { UploadedFile, HealthStatus } from '../types';

interface Props {
  files: UploadedFile[];
  onDrop: (files: File[]) => void;
  healthStatus: HealthStatus;
  healthMessage: string;
  onRefreshHealth: () => void;
  onRemoveFile: (idx: number) => void;
  onGenerate: () => void;
}

export function UploadSection({ files, onDrop, healthStatus, healthMessage, onRefreshHealth, onRemoveFile, onGenerate }: Props) {
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
    multiple: true,
  });

  return (
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
          isDragActive ? "border-orange-500 bg-orange-50 dark:bg-orange-950 scale-[1.02]" : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:border-orange-400 hover:shadow-lg hover:shadow-orange-100"
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
            : healthStatus === 'warning'
              ? "border-orange-200 bg-orange-50"
              : "border-amber-200 bg-amber-50"
      )}>
        {healthStatus === 'healthy' ? (
          <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        ) : healthStatus === 'checking' ? (
          <Loader2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5 animate-spin" />
        ) : (
          <AlertCircle className={cn("w-5 h-5 shrink-0 mt-0.5", healthStatus === 'warning' ? "text-orange-500" : "text-amber-600")} />
        )}
        <div className="flex-1">
          <p className="font-semibold text-sm text-gray-900">
            {healthStatus === 'healthy'
              ? 'Verwerkingsstack beschikbaar'
              : healthStatus === 'checking'
                ? 'Beschikbaarheid controleren'
                : healthStatus === 'warning'
                  ? 'OCR gedeeltelijk beschikbaar'
                  : 'Actie nodig voor verwerking'}
          </p>
          <p className={cn(
            "text-sm mt-1",
            healthStatus === 'healthy' ? "text-emerald-800" : healthStatus === 'warning' ? "text-orange-700" : "text-gray-600"
          )}>
            {healthMessage}
          </p>
        </div>
        <button
          onClick={onRefreshHealth}
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
            <div key={idx} className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
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
                onClick={() => onRemoveFile(idx)}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ))}

          <div className="flex flex-col items-center justify-center mt-8 gap-4">
            <button
              onClick={onGenerate}
              disabled={healthStatus !== 'healthy' && healthStatus !== 'warning'}
              className={cn(
                "px-10 py-5 rounded-2xl font-bold text-lg flex items-center gap-3 transition-all shadow-xl",
                healthStatus === 'healthy' || healthStatus === 'warning'
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
  );
}
