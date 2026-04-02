import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App, { buildSystemInstructions } from './App';
import { checkHealth, processDocuments } from './api/client';

vi.mock('motion/react', () => {
  const MockComponent = ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  );

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: () => MockComponent,
    }),
  };
});

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client');
  return {
    ...actual,
    checkHealth: vi.fn(),
    processDocuments: vi.fn(),
  };
});

const mockedCheckHealth = vi.mocked(checkHealth);
const mockedProcessDocuments = vi.mocked(processDocuments);

async function createCourse(name = 'Statistiek 1') {
  fireEvent.click(await screen.findByRole('button', { name: /maak je eerste vak/i }));
  fireEvent.change(
    screen.getByPlaceholderText(/Naam van het vak/i),
    { target: { value: name } },
  );
  fireEvent.click(screen.getByRole('button', { name: /aanmaken/i }));
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage?.removeItem?.('studyflow_plan');
    window.localStorage?.removeItem?.('studyflow_progress');
    window.localStorage?.removeItem?.('studyflow_topic_order');
    window.localStorage?.removeItem?.('studyflow_prompt_template');
    mockedCheckHealth.mockReset();
    mockedProcessDocuments.mockReset();
  });

  it('renders a healthy status and shows generated results after processing', async () => {
    mockedCheckHealth.mockResolvedValue({
      status: 'ok',
      openai_configured: true,
      ocr_available: true,
      ocr_missing_langs: [],
    });

    mockedProcessDocuments.mockImplementation(async (_files, onProgress, onResult) => {
      onProgress({ step: 'document', progress: 50, message: 'Halfway there' });
      onResult({
        chapters: [
          {
            id: 'T1-C1',
            title: 'Introductie',
            summary: 'Samenvatting',
            topic: 'Algemeen',
            content: 'Lesstof',
            key_concepts: ['introductie'],
            related_sections: [],
          },
        ],
        topics: ['Algemeen'],
        masterStudyMap: '| onderwerp | chapter |',
        gptSystemInstructions: 'Use the KB.',
      });
    });

    const { container } = render(<App />);
    await createCourse();

    await screen.findByText('Verwerkingsstack beschikbaar');

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    fireEvent.change(input!, {
      target: {
        files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    const generateButton = await screen.findByRole('button', { name: /Genereer Studieplan/i });
    await waitFor(() => expect(generateButton.hasAttribute('disabled')).toBe(false));

    fireEvent.click(generateButton);

    expect(await screen.findByText('Jouw Studie Architectuur')).toBeTruthy();
    expect(await screen.findAllByText('Introductie')).toHaveLength(2);
  });

  it('uses the chapter-only prompt template without exposing the old topic variable', async () => {
    mockedCheckHealth.mockResolvedValue({
      status: 'ok',
      openai_configured: true,
      ocr_available: true,
      ocr_missing_langs: [],
    });

    mockedProcessDocuments.mockImplementation(async (_files, onProgress, onResult) => {
      onProgress({ step: 'document', progress: 100, message: 'Klaar' });
      onResult({
        chapters: [
          {
            id: 'T1-C1',
            title: 'Introductie',
            summary: 'Samenvatting',
            topic: 'Algemeen',
            content: 'Lesstof',
            key_concepts: ['introductie'],
            related_sections: [],
          },
        ],
        topics: ['Algemeen'],
        masterStudyMap: '| onderwerp | chapter |',
        gptSystemInstructions: 'Use the KB.',
      });
    });

    const { container } = render(<App />);
    await createCourse();

    await screen.findByText('Verwerkingsstack beschikbaar');

    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Genereer Studieplan/i }));

    await screen.findByText('Prompt Template');

    expect(screen.queryByText('{topic}')).toBeNull();

    const promptTextarea = container.querySelector('textarea');
    expect(promptTextarea?.value).toContain('Hier is de content voor {title}');
    expect(promptTextarea?.value).not.toContain('{topic}');
  });

  it('shows a persistent verification warning banner when content loss is detected', async () => {
    mockedCheckHealth.mockResolvedValue({
      status: 'ok',
      openai_configured: true,
      ocr_available: true,
      ocr_missing_langs: [],
    });

    mockedProcessDocuments.mockImplementation(async (_files, onProgress, onResult) => {
      onProgress({ step: 'document', progress: 100, message: 'Klaar' });
      onResult({
        chapters: [
          {
            id: 'T1-C1',
            title: 'Introductie',
            summary: 'Samenvatting',
            topic: 'Algemeen',
            content: 'Lesstof',
            key_concepts: ['introductie'],
            related_sections: [],
          },
        ],
        topics: ['Algemeen'],
        masterStudyMap: '| onderwerp | chapter |',
        gptSystemInstructions: 'Use the KB.',
        verificationReport: {
          status: 'WARNING',
          word_ratio: 0.82,
          missing_keywords: ['regressie'],
          exercise_count_original: 3,
          exercise_count_generated: 2,
          issues: ['1 oefening ontbreekt', 'Tekstbehoud is gedaald naar 82%'],
        },
      });
    });

    const { container } = render(<App />);
    await createCourse();

    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Genereer Studieplan/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(await screen.findByText('Waarschuwing voor contentbehoud')).toBeTruthy();
    expect(await screen.findByText('1 oefening ontbreekt')).toBeTruthy();
    expect(await screen.findByText(/82% tekst behouden/i)).toBeTruthy();
  });

  it('shows a visible warning when the backend is up but the API key is missing', async () => {
    mockedCheckHealth.mockResolvedValue({
      status: 'ok',
      openai_configured: false,
      ocr_available: true,
      ocr_missing_langs: [],
    });
    mockedProcessDocuments.mockResolvedValue();

    render(<App />);
    await createCourse();

    expect(await screen.findByText('Actie nodig voor verwerking')).toBeTruthy();
    expect(await screen.findByText(/OPENAI_API_KEY ontbreekt/i)).toBeTruthy();
  });

  it('builds adaptive system instructions from course metadata', () => {
    const instructions = buildSystemInstructions(
      'chatgpt',
      'Statistiek 1',
      4,
      2,
      7,
      4,
      {
        chapters: [],
        topics: ['Statistiek'],
        masterStudyMap: '| onderwerp | hoofdstuk |',
        gptSystemInstructions: 'Gebruik de knowledge base.',
        courseMetadata: {
          has_formulas: true,
          has_exercises: true,
          has_code: true,
          primary_language: 'nl',
          exercise_types: ['meerkeuze', 'berekening'],
          total_exercises: 12,
          detected_tools: ['R'],
          difficulty_keywords: ['regressie'],
        },
      },
    );

    expect(instructions).toContain('[OEFENEXAMEN]');
    expect(instructions).toContain('[EXAMEN]');
    expect(instructions).toContain('toon ALTIJD de formule in LaTeX');
    expect(instructions).toContain('werkende code in R');
    expect(instructions).toContain('waarom elk fout antwoord fout is');
    expect(instructions).toContain('Geef eerst hints of tussenstappen');
  });

  it('falls back to generic system instructions when course metadata is missing', () => {
    const instructions = buildSystemInstructions(
      'chatgpt',
      'Geschiedenis',
      3,
      1,
      6,
      3,
      {
        chapters: [],
        topics: ['Geschiedenis'],
        masterStudyMap: '| onderwerp | hoofdstuk |',
        gptSystemInstructions: 'Gebruik de knowledge base.',
      },
    );

    expect(instructions).toContain('[OEFENEXAMEN]');
    expect(instructions).toContain('[EXAMEN]');
    expect(instructions).not.toContain('## VAKSPECIFIEKE RICHTLIJNEN');
    expect(instructions).toContain('## KERNPRINCIPES');
  });
});
