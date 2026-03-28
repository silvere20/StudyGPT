import { useEffect, useState, type ComponentType } from 'react';

type MarkdownComponent = ComponentType<{
  children: string;
  remarkPlugins?: unknown[];
}>;

type MarkdownRenderer = {
  Component: MarkdownComponent;
  remarkPlugins: unknown[];
};

type LazyMarkdownProps = {
  children: string;
  loadingLabel?: string;
};

export function LazyMarkdown({
  children,
  loadingLabel = 'Markdown laden...',
}: LazyMarkdownProps) {
  const [renderer, setRenderer] = useState<MarkdownRenderer | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const [{ default: Markdown }, { default: remarkGfm }] = await Promise.all([
          import('react-markdown'),
          import('remark-gfm'),
        ]);

        if (!isActive) return;

        setRenderer({
          Component: Markdown as MarkdownComponent,
          remarkPlugins: [remarkGfm],
        });
      } catch {
        if (isActive) {
          setLoadError(true);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  if (loadError) {
    return <p className="text-sm text-red-600">Markdown preview kon niet worden geladen.</p>;
  }

  if (!renderer) {
    return <p className="text-sm text-gray-400">{loadingLabel}</p>;
  }

  const { Component, remarkPlugins } = renderer;
  return <Component remarkPlugins={remarkPlugins}>{children}</Component>;
}
