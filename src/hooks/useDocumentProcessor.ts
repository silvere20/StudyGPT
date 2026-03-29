import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { processDocuments, type StudyPlan, type ProgressUpdate, type ConnectionErrorType } from '../api/client';
import type { UploadedFile, FileProgressInfo } from '../types';

export type ProcessorState = {
  files: UploadedFile[];
  loading: boolean;
  progressMessage: string;
  progressPercent: number;
  fileProgress: Map<number, FileProgressInfo>;
  connectionErrorType: ConnectionErrorType | null;
};

export type ProcessorActions = {
  onDrop: (acceptedFiles: File[]) => void;
  removeFile: (idx: number) => void;
  handleGenerate: () => Promise<void>;
  handleCancel: () => void;
  resetFiles: () => void;
};

export function useDocumentProcessor(
  onSuccess: (plan: StudyPlan) => void,
  onBeforeGenerate: () => Promise<boolean>
): ProcessorState & ProcessorActions {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [fileProgress, setFileProgress] = useState<Map<number, FileProgressInfo>>(new Map());
  const [connectionErrorType, setConnectionErrorType] = useState<ConnectionErrorType | null>(null);

  const isCancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastProgressMessageRef = useRef('');

  const resetProcessingState = useCallback(() => {
    abortControllerRef.current = null;
    setLoading(false);
    setProgressMessage('');
    setProgressPercent(0);
    setFileProgress(new Map());
    setConnectionErrorType(null);
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
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
      return combined.sort((a, b) =>
        a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })
      );
    });
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (files.length === 0) return;

    const canProceed = await onBeforeGenerate();
    if (!canProceed) return;

    isCancelledRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    lastProgressMessageRef.current = '';
    setLoading(true);
    setConnectionErrorType(null);
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
          lastProgressMessageRef.current = update.message;
          setConnectionErrorType(null); // clear error banner on successful progress event
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
          resetProcessingState();
          onSuccess(result);
          toast.success('Studieplan succesvol gegenereerd!');
        },
        (message: string) => {
          if (isCancelledRef.current) return;
          resetProcessingState();
          toast.error(message);
        },
        {
          signal: abortControllerRef.current.signal,
          onConnectionError: (type: ConnectionErrorType) => {
            if (isCancelledRef.current) return;
            setConnectionErrorType(type);
            // Restore last known progress message so the UI stays where it was
            if (lastProgressMessageRef.current) {
              setProgressMessage(lastProgressMessageRef.current);
            }
          },
        }
      );
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (isAbortError || isCancelledRef.current) return;
      resetProcessingState();
      toast.error('Er is een onverwachte fout opgetreden. Controleer of de backend draait.');
    }
  }, [files, onBeforeGenerate, onSuccess, resetProcessingState]);

  const handleCancel = useCallback(() => {
    isCancelledRef.current = true;
    abortControllerRef.current?.abort();
    setFiles([]);
    resetProcessingState();
    toast.info("Verwerking geannuleerd.");
  }, [resetProcessingState]);

  const resetFiles = useCallback(() => {
    setFiles([]);
  }, []);

  return {
    files,
    loading,
    progressMessage,
    progressPercent,
    fileProgress,
    connectionErrorType,
    onDrop,
    removeFile,
    handleGenerate,
    handleCancel,
    resetFiles,
  };
}
