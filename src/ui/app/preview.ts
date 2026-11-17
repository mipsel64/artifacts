import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useThemeMode, themeMessage } from './theme-mode';

interface PreviewBridgeOptions {
  shareInputRef?: RefObject<HTMLInputElement | null>;
  shareBaseUrl?: string;
  onHashChange?: (hash: string) => void;
}

export function usePreviewBridge(frameRef: RefObject<HTMLIFrameElement | null>, options: PreviewBridgeOptions = {}) {
  const { mode } = useThemeMode();
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
      if (data.type === 'artifact-hash-request') sendHash();
      if (data.type !== 'artifact-hash' || !('hash' in data) || typeof data.hash !== 'string') return;
      if (data.hash !== '' && !data.hash.startsWith('#')) return;
      history.replaceState(history.state, '', data.hash || location.pathname + location.search);
      syncShareLink();
    };
    const onHashChange = () => {
      if (document.getElementById(location.hash.slice(1))) return;
      sendHash();
      syncShareLink();
    };
    frame.addEventListener('load', sendTheme);
    frame.addEventListener('load', sendHash);
    window.addEventListener('message', onMessage);
    window.addEventListener('hashchange', onHashChange);
    sendTheme();
    sendHash();
    syncShareLink();
    return () => {
      frame.removeEventListener('load', sendTheme);
      frame.removeEventListener('load', sendHash);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [frameRef, sendHash, sendTheme, syncShareLink]);
}
