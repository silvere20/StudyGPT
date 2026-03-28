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

type OnProgress = (update: ProgressUpdate) => void;
type OnResult = (plan: StudyPlan) => void;
type OnError = (message: string) => void;

type ProcessDocumentsOptions = {
  signal?: AbortSignal;
};

export async function processDocuments(
  files: File[],
  onProgress: OnProgress,
  onResult: OnResult,
  onError: OnError,
  options: ProcessDocumentsOptions = {},
): Promise<void> {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));

  const response = await fetch('/api/process', {
    method: 'POST',
    body: formData,
    signal: options.signal,
  });

  if (!response.ok) {
    onError(`Server fout: ${response.status} ${response.statusText}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError('Geen streaming response ontvangen.');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let receivedTerminalEvent = false;

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
          receivedTerminalEvent = true;
          onResult(data as StudyPlan);
          return;
        }

        if (parsed.eventType === 'error') {
          receivedTerminalEvent = true;
          onError(data.message || 'Onbekende fout');
          return;
        }
      } catch {
        onError('Ongeldige serverresponse ontvangen.');
        return;
      }
    }

    if (done) break;
  }

  if (buffer.trim().length > 0) {
    const parsed = parseSseChunk(buffer);
    if (parsed) {
      try {
        const data = JSON.parse(parsed.data);
        if (parsed.eventType === 'result') {
          receivedTerminalEvent = true;
          onResult(data as StudyPlan);
          return;
        }
        if (parsed.eventType === 'error') {
          receivedTerminalEvent = true;
          onError(data.message || 'Onbekende fout');
          return;
        }
      } catch {
        onError('Ongeldige serverresponse ontvangen.');
        return;
      }
    }
  }

  if (!receivedTerminalEvent && !options.signal?.aborted) {
    onError('De verwerking stopte onverwacht zonder eindstatus.');
  }
}

export async function checkHealth(): Promise<{ status: string; openai_configured: boolean }> {
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
