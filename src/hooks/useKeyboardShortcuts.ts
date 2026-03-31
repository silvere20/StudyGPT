import { useEffect } from 'react';

interface KeyboardShortcutOptions {
  planLoaded: boolean;
  onFocusSearch: () => void;
  onClearSearch: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onDownloadZip: () => void;
  onNextChapter: () => void;
  onPrevChapter: () => void;
  onShowHelp: () => void;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(opts: KeyboardShortcutOptions): void {
  const {
    planLoaded,
    onFocusSearch,
    onClearSearch,
    onExpandAll,
    onCollapseAll,
    onDownloadZip,
    onNextChapter,
    onPrevChapter,
    onShowHelp,
  } = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!planLoaded) return;

      const isMeta = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+F — focus search (always, regardless of input focus)
      if (isMeta && e.key === 'f') {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      // Ctrl/Cmd+E — expand all
      if (isMeta && !e.shiftKey && e.key === 'e') {
        e.preventDefault();
        onExpandAll();
        return;
      }

      // Ctrl/Cmd+Shift+E — collapse all
      if (isMeta && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        onCollapseAll();
        return;
      }

      // Ctrl/Cmd+D — download ZIP
      if (isMeta && e.key === 'd') {
        e.preventDefault();
        onDownloadZip();
        return;
      }

      // Keys below only fire when not in an input
      if (isInputFocused()) return;

      if (e.key === 'Escape') {
        onClearSearch();
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        onNextChapter();
        return;
      }

      if (e.key === 'k' || e.key === 'K') {
        onPrevChapter();
        return;
      }

      if (e.key === '?') {
        onShowHelp();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    planLoaded,
    onFocusSearch,
    onClearSearch,
    onExpandAll,
    onCollapseAll,
    onDownloadZip,
    onNextChapter,
    onPrevChapter,
    onShowHelp,
  ]);
}
