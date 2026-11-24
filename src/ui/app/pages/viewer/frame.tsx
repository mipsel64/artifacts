import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { usePreviewBridge } from '../../preview';

export type LoadContent = () => Promise<string>;

interface ViewerFrameProps {
  previewSrc: string;
  contentUrl: string;
  bar: (loadContent: LoadContent) => ReactNode;
  details: ReactNode;
  onHashChange?: (hash: string) => void;
  fitWidth?: boolean;
}

// html and react artifacts are laid out for a desktop viewport. Below this width we render them at a
// desktop width and scale the iframe down, so the whole layout fits the phone instead of being cut off.
const FIT_DESKTOP_WIDTH = 1024;

export function ViewerFrame({ previewSrc, contentUrl, bar, details, onHashChange, fitWidth = false }: ViewerFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const loadedRef = useRef<string | null>(null);
  const pendingRef = useRef<Promise<string> | null>(null);
  const [view, setView] = useState<'preview' | 'code' | 'details'>('preview');
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);
  usePreviewBridge(frameRef, { onHashChange });

  useEffect(() => {
    const pane = paneRef.current;
    if (!fitWidth || !pane) {
      setFit(null);
      return;
    }
    const measure = () => {
      const width = pane.clientWidth;
      const height = pane.clientHeight;
      if (width === 0 || height === 0) return;
      const scale = Math.min(1, width / FIT_DESKTOP_WIDTH);
      setFit(scale < 1 ? { scale, height: height / scale } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [fitWidth]);

  const loadContent = useCallback<LoadContent>(() => {
    if (loadedRef.current !== null) return Promise.resolve(loadedRef.current);
    if (pendingRef.current) return pendingRef.current;
    setLoading(true);
    setError(null);
    const request = fetch(contentUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load artifact content (${response.status})`);
        return response.text();
      })
      .then((text) => {
        loadedRef.current = text;
        setContent(text);
        return text;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load artifact content');
        throw cause;
      })
      .finally(() => {
        pendingRef.current = null;
        setLoading(false);
      });
    pendingRef.current = request;
    return request;
  }, [contentUrl]);

  const changeView = (next: string) => {
    if (next !== 'preview' && next !== 'code' && next !== 'details') return;
    setView(next);
    if (next === 'code') void loadContent().catch(() => {});
  };

  return (
    <VStack gap={0} className="viewer">
      <HStack gap={2} vAlign="center" wrap="wrap" className="viewer-bar">
        {bar(loadContent)}
      </HStack>
      <TabList value={view} onChange={changeView} role="tablist" aria-label="Artifact view" size="md" className="viewer-tabs">
        <Tab value="preview" label="Preview" panelId="panel-preview" />
        <Tab value="code" label="Source" panelId="panel-code" />
        <Tab value="details" label="Details" panelId="panel-details" />
      </TabList>
      <Divider />
      <section role="tabpanel" id="panel-preview" aria-label="Preview" className="viewer-pane viewer-preview" hidden={view !== 'preview'} ref={paneRef}>
        <iframe
          ref={frameRef}
          data-artifact-preview
          src={previewSrc}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
          allow="fullscreen"
          title="Artifact preview"
          style={fit ? { flex: 'none', width: FIT_DESKTOP_WIDTH, height: fit.height, transform: `scale(${fit.scale})`, transformOrigin: '0 0' } : undefined}
        />
      </section>
      <section role="tabpanel" id="panel-code" aria-label="Source" className="viewer-pane viewer-code" hidden={view !== 'code'} tabIndex={content === null ? 0 : undefined}>
        {loading && <VStack padding={4}><Text role="status">Loading source…</Text></VStack>}
        {error && !loading && (
          <VStack gap={3} padding={4} hAlign="start">
            <Text role="alert">{error}</Text>
            <Button label="Retry" size="sm" clickAction={async () => { await loadContent().catch(() => {}); }} />
          </VStack>
        )}
        {content !== null && <pre className="viewer-code-content" tabIndex={0}><code>{content}</code></pre>}
      </section>
      <section role="tabpanel" id="panel-details" aria-label="Details" className="viewer-pane viewer-details" hidden={view !== 'details'} tabIndex={0}>
        {details}
      </section>
    </VStack>
  );
}
