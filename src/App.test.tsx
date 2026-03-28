import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
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

describe('App', () => {
  it('renders a healthy status and shows generated results after processing', async () => {
    mockedCheckHealth.mockResolvedValue({
      status: 'ok',
      openai_configured: true,
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
          },
        ],
        topics: ['Algemeen'],
        masterStudyMap: '| onderwerp | chapter |',
        gptSystemInstructions: 'Use the KB.',
      });
    });

    const { container } = render(<App />);

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

  it('shows a visible warning when the backend is up but the API key is missing', async () => {
    mockedCheckHealth.mockResolvedValue({
      status: 'ok',
      openai_configured: false,
    });
    mockedProcessDocuments.mockResolvedValue();

    render(<App />);

    expect(await screen.findByText('Actie nodig voor verwerking')).toBeTruthy();
    expect(await screen.findByText(/OPENAI_API_KEY ontbreekt/i)).toBeTruthy();
  });
});
