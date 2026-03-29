import { Loader2, CheckCircle2, AlertCircle, Clock, X } from 'lucide-react';
import { cn, formatFileSize } from '../utils';
import type { UploadedFile, FileProgressInfo } from '../types';
import { SkeletonLoader } from './SkeletonLoader';

interface Props {
  progressMessage: string;
  progressPercent: number;
  files: UploadedFile[];
  fileProgress: Map<number, FileProgressInfo>;
  onCancel: () => void;
}

export function ProgressBar({ progressMessage, progressPercent, files, fileProgress, onCancel }: Props) {
  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200 dark:border-gray-700 shadow-xl">
      <div className="text-center mb-8">
        <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900">Documenten verwerken</h2>
        <p className="text-gray-500 mt-2">{progressMessage || 'Bezig met verwerken...'}</p>
      </div>

      <div className="mb-6">
        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
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
              "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
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
          onClick={onCancel}
          className="px-6 py-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-full font-medium transition-colors flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Annuleren
        </button>
      </div>

      <SkeletonLoader />
    </div>
  );
}
