import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Strip LaTeX math blocks, markdown formatting, and normalize diacritics so
 * that content is searchable as plain text (e.g. "$x^2$" → "x^2", "oefénïng" → "oefening").
 */
export function stripMarkdownAndLatex(text: string): string {
  // Remove display math: $$...$$ (may span newlines)
  let result = text.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  // Remove inline math: $...$
  result = result.replace(/\$[^$\n]+?\$/g, ' ');
  // Remove markdown headers
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Remove bold/italic: **, *, __, _
  result = result.replace(/(\*\*|__)(.*?)\1/gs, '$2');
  result = result.replace(/([*_])(.*?)\1/gs, '$2');
  // Normalize diacritics (ë → e, é → e, etc.)
  result = result.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  // Collapse extra whitespace
  return result.replace(/\s+/g, ' ').trim();
}
