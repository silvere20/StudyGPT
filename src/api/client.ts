export interface Chapter {
  id: string;
  title: string;
  summary: string;
  topic: string;
  content: string;
}

export interface StudyPlan {
  chapters: Chapter[];
  topics: string[];
  masterStudyMap: string;
  gptSystemInstructions: string;
}

export interface ProgressUpdate {
  step: string;
  progress: number;
  message: string;
  fileIndex?: number;
  fileName?: string;
}

export type ConnectionErrorType = 'offline' | 'timeout' | 'stream-end';

type OnProgress = (update: ProgressUpdate) => void;
type OnResult = (plan: StudyPlan) => void;
type OnError = (message: string) => void;
type OnConnectionError = (type: ConnectionErrorType, message: string) => void;

type ProcessDocumentsOptions = {
  signal?: AbortSignal;
  onConnectionError?: OnConnectionError;
};

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 2;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

type StreamResult =
  | { type: 'success'; plan: StudyPlan }
  | { type: 'error'; message: string }
  | { type: 'stream-end' };

async function attemptStream(
  files: File[],
  onProgress: OnProgress,
  signal: AbortSignal,
): Promise<StreamResult> {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));

  const response = await fetch('/api/process', {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    return { type: 'error', message: `Server fout: ${response.status} ${response.statusText}` };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { type: 'error', message: 'Geen streaming response ontvangen.' };
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const parsed = parseSseChunk(chunk);
      if (!parsed) continue;

      try {
        const data = JSON.parse(parsed.data);
        if (parsed.eventType === 'progress') {
          onProgress(data as ProgressUpdate);
          continue;
        }
        if (parsed.eventType === 'result') {
          return { type: 'success', plan: data as StudyPlan };
        }
        if (parsed.eventType === 'error') {
          return { type: 'error', message: data.message || 'Onbekende fout' };
        }
      } catch {
        return { type: 'error', message: 'Ongeldige serverresponse ontvangen.' };
      }
    }

    if (done) break;
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(buffer);
    if (parsed) {
      try {
        const data = JSON.parse(parsed.data);
        if (parsed.eventType === 'result') return { type: 'success', plan: data as StudyPlan };
        if (parsed.eventType === 'error') return { type: 'error', message: data.message || 'Onbekende fout' };
      } catch {
        return { type: 'error', message: 'Ongeldige serverresponse ontvangen.' };
      }
    }
  }

  return { type: 'stream-end' };
}

export async function processDocuments(
  files: File[],
  onProgress: OnProgress,
  onResult: OnResult,
  onError: OnError,
  options: ProcessDocumentsOptions = {},
): Promise<void> {
  const { signal, onConnectionError } = options;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return;

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);

    // Combine user abort signal with our timeout signal
    const signals = signal ? [signal, timeoutController.signal] : [timeoutController.signal];
    const combinedSignal = AbortSignal.any(signals);

    try {
      const result = await attemptStream(files, onProgress, combinedSignal);
      clearTimeout(timeoutId);

      if (result.type === 'success') {
        onResult(result.plan);
        return;
      }

      if (result.type === 'error') {
        onError(result.message);
        return;
      }

      // stream-end without terminal event
      if (attempt < MAX_RETRIES) {
        onConnectionError?.(
          'stream-end',
          `Verbinding verbroken (poging ${attempt + 1}/${MAX_RETRIES + 1}), opnieuw proberen...`,
        );
        await sleep(RETRY_DELAY_MS, signal);
        continue;
      }

      onError('De verwerking stopte onverwacht. Alle pogingen zijn mislukt.');
      return;
    } catch (err) {
      clearTimeout(timeoutId);

      if (signal?.aborted) return;

      if (timeoutController.signal.aborted) {
        onConnectionError?.('timeout', 'Verwerking duurt te lang (5 minuten overschreden).');
        onError('Verwerking afgebroken: timeout van 5 minuten bereikt.');
        return;
      }

      // network / backend offline error
      if (attempt < MAX_RETRIES) {
        onConnectionError?.(
          'offline',
          `Backend niet bereikbaar (poging ${attempt + 1}/${MAX_RETRIES + 1}), opnieuw proberen...`,
        );
        await sleep(RETRY_DELAY_MS, signal);
        continue;
      }

      onError('Backend niet bereikbaar. Controleer of de server draait.');
      return;
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
