import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useThemeMode, themeMessage } from './theme-mode';

interface PreviewBridgeOptions {
  shareInputRef?: RefObject<HTMLInputElement | null>;
  shareBaseUrl?: string;
  onHashChange?: (hash: string) => void;
  // Quick looks render the document but don't mirror its section links into the library URL.
  syncHash?: boolean;
}

export function usePreviewBridge(frameRef: RefObject<HTMLIFrameElement | null>, options: PreviewBridgeOptions = {}) {
  const { mode } = useThemeMode();
  const syncHash = options.syncHash ?? true;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const syncShareLink = useCallback(() => {
    const input = optionsRef.current.shareInputRef?.current;
    const base = optionsRef.current.shareBaseUrl;
    if (input && base) input.value = base + window.location.hash;
    optionsRef.current.onHashChange?.(window.location.hash);
  }, []);

  const sendTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(themeMessage(mode), '*');
  }, [frameRef, mode]);

  const sendHash = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'artifact-hash', hash: window.location.hash }, '*');
  }, [frameRef]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null || !('type' in data)) return;
      if (data.type === 'artifact-theme-request') sendTheme();
      if (!syncHash) return;
      if (data.type === 'artifact-hash-request') sendHash();
      if (data.type !== 'artifact-hash' || !('hash' in data) || typeof data.hash !== 'string') return;
      if (data.hash !== '' && !data.hash.startsWith('#')) return;
      history.replaceState(history.state, '', data.hash || location.pathname + location.search);
      syncShareLink();
    };
    const onHashChange = () => {
      sendHash();
      syncShareLink();
    };
    const main = frame.closest('main[id], [role="main"][id]');
    const onShellSkip = (event: MouseEvent) => {
      if (!main || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      // AppShell already focuses its main landmark. Keep that jump from replacing an artifact fragment.
      if (link?.getAttribute('href') === `#${main.id}`) event.preventDefault();
    };
    frame.addEventListener('load', sendTheme);
    window.addEventListener('message', onMessage);
    sendTheme();
    if (syncHash) {
      frame.addEventListener('load', sendHash);
      window.addEventListener('hashchange', onHashChange);
      document.addEventListener('click', onShellSkip);
      sendHash();
      syncShareLink();
    }
    return () => {
      frame.removeEventListener('load', sendTheme);
      frame.removeEventListener('load', sendHash);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('click', onShellSkip);
    };
  }, [frameRef, sendHash, sendTheme, syncHash, syncShareLink]);
}
