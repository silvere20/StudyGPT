export interface Chapter {
  id: string;
  title: string;
  summary: string;
  topic: string;
  content: string;
  key_concepts: string[];
  related_sections: string[];
  /** Content-type tags assigned by the structure analysis, e.g. "theory" | "exercise" | "definition" | "example" | "formula" */
  section_types?: string[];
  /** Student questions this chapter can answer, used for semantic retrieval in the RAG index */
  search_profile?: string[];
}

export interface VerificationReport {
  status: 'OK' | 'WARNING' | 'CRITICAL';
  word_ratio: number;
  missing_keywords: string[];
  exercise_count_original: number;
  exercise_count_generated: number;
  issues: string[];
}

export interface CourseMetadata {
  has_formulas: boolean;
  has_exercises: boolean;
  has_code: boolean;
  primary_language: string;
  exercise_types: string[];
  total_exercises: number;
  detected_tools: string[];
  difficulty_keywords: string[];
}

export interface StudyPlan {
  chapters: Chapter[];
  topics: string[];
  masterStudyMap: string;
  gptSystemInstructions: string;
  verificationReport?: VerificationReport | null;
  courseMetadata?: CourseMetadata | null;
}

export interface ProgressUpdate {
  step: string;
  progress: number;
  message: string;
  fileIndex?: number;
  fileName?: string;
}

export type StreamErrorKind = 'offline' | 'timeout' | 'unexpected-end' | 'server-error';

type OnProgress = (update: ProgressUpdate) => void;
type OnResult = (plan: StudyPlan) => void;
type OnError = (message: string, kind?: StreamErrorKind) => void;

type ProcessDocumentsOptions = {
  signal?: AbortSignal;
  /** Maximum number of retries on unexpected stream end. Defaults to 2. */
  maxRetries?: number;
};

const STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 2000;

export async function processDocuments(
  files: File[],
  onProgress: OnProgress,
  onResult: OnResult,
  onError: OnError,
  options: ProcessDocumentsOptions = {},
): Promise<void> {
  const MAX = options.maxRetries ?? 2;
  const deadline = Date.now() + STREAM_TIMEOUT_MS;

  for (let attempt = 0; attempt <= MAX; attempt++) {
    if (options.signal?.aborted) return;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      onError(
        'Verwerking duurde te lang (timeout na 5 minuten). Probeer opnieuw met kleinere bestanden.',
        'timeout',
      );
      return;
    }

    // Build a fresh FormData for each attempt (a submitted FormData cannot be reused).
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));

    let response: Response;
    try {
      response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
        signal: options.signal,
      });
    } catch (err) {
      // Re-throw AbortError so the caller can detect cancellation.
      // Use name check instead of instanceof because DOMException may not extend Error in some environments.
      if ((err as { name?: unknown }).name === 'AbortError') throw err;
      onError('Backend niet bereikbaar. Controleer of de server draait.', 'offline');
      return;
    }

    if (!response.ok) {
      onError(`Server fout: ${response.status} ${response.statusText}`, 'server-error');
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError('Geen streaming response ontvangen.', 'server-error');
      return;
    }

    // Cancel the reader when the per-attempt time budget expires.
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, remaining);

    const decoder = new TextDecoder();
    let buffer = '';
    let receivedTerminalEvent = false;
    let readError = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk);
          if (!parsed) continue;

          try {
            const data = JSON.parse(parsed.data) as Record<string, unknown>;
            if (parsed.eventType === 'progress') {
              onProgress(data as unknown as ProgressUpdate);
              continue;
            }
            if (parsed.eventType === 'result') {
              receivedTerminalEvent = true;
              onResult(data as unknown as StudyPlan);
              return;
            }
            if (parsed.eventType === 'error') {
              receivedTerminalEvent = true;
              onError((data.message as string | undefined) ?? 'Onbekende fout', 'server-error');
              return;
            }
          } catch {
            receivedTerminalEvent = true;
            onError('Ongeldige serverresponse ontvangen.', 'server-error');
            return;
          }
        }

        if (done) break;
      }
    } catch {
      readError = true;
    } finally {
      clearTimeout(timeoutId);
    }

    if (options.signal?.aborted) return;

    // Network error mid-stream — don't retry, the whole connection is gone.
    if (readError) {
      onError(
        'De verbinding met de server is verbroken tijdens het ontvangen van data.',
        'offline',
      );
      return;
    }

    if (timedOut) {
      onError(
        'Verwerking duurde te lang (timeout na 5 minuten). Probeer opnieuw met kleinere bestanden.',
        'timeout',
      );
      return;
    }

    // Flush any remaining buffer before deciding.
    if (!receivedTerminalEvent && buffer.trim().length > 0) {
      const parsed = parseSseChunk(buffer);
      if (parsed) {
        try {
          const data = JSON.parse(parsed.data) as Record<string, unknown>;
          if (parsed.eventType === 'result') {
            receivedTerminalEvent = true;
            onResult(data as unknown as StudyPlan);
            return;
          }
          if (parsed.eventType === 'error') {
            receivedTerminalEvent = true;
            onError((data.message as string | undefined) ?? 'Onbekende fout', 'server-error');
            return;
          }
        } catch {
          onError('Ongeldige serverresponse ontvangen.', 'server-error');
          return;
        }
      }
    }

    if (receivedTerminalEvent) return;

    // Stream ended without a terminal event.
    if (attempt < MAX) {
      onProgress({
        step: 'reconnecting',
        progress: 0,
        message: `Verbinding verbroken. Opnieuw verbinden (poging ${attempt + 2} van ${MAX + 1})...`,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    } else {
      onError(
        'De verwerking stopte onverwacht. Controleer de verbinding en probeer opnieuw.',
        'unexpected-end',
      );
    }
  }
}

export async function checkHealth(): Promise<{ status: string; openai_configured: boolean; ocr_available: boolean; ocr_missing_langs: string[] }> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health check mislukt: ${res.status}`);
  }
  return res.json();
}

function parseSseChunk(chunk: string): { eventType: string; data: string } | null {
  let eventType = '';
  const dataLines: string[] = [];

  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    }
  }

  if (!eventType || dataLines.length === 0) {
    return null;
  }

  return {
    eventType,
    data: dataLines.join('\n'),
  };
}
