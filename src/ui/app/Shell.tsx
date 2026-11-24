import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Text } from '@astryxdesign/core/Text';
import { useClipboard } from '@astryxdesign/core/hooks';
import type { Identity } from './identity';
import { Logo, Icon } from './icons';
import { useThemeMode } from './theme-mode';
import type { ThemeMode } from './mode';
import { copyLater } from './clipboard';
import type { PageName } from './pages';

export interface ShellProps {
  me: Identity | null;
  viewerEmail?: string | null;
  signIn?: boolean;
  width?: 'medium' | 'narrow' | 'fill';
}

export interface ConfirmOptions {
  title: string;
  description: string;
  actionLabel: string;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface FeedbackValue {
  error: string | null;
  showError: (message: string) => void;
  clearError: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const showError = useCallback((message: string) => setError(message), []);
  const clearError = useCallback(() => setError(null), []);
  const confirm = useCallback((options: ConfirmOptions) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    setRequest({ ...options, resolve });
    return promise;
  }, []);
  const value = useMemo(() => ({ error, showError, clearError, confirm }), [error, showError, clearError, confirm]);
  const settle = (confirmed: boolean) => {
    request?.resolve(confirmed);
    setRequest(null);
  };
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <AlertDialog
        isOpen={request !== null}
        onOpenChange={(open) => { if (!open) settle(false); }}
        title={request?.title ?? ''}
        description={request?.description ?? ''}
        actionLabel={request?.actionLabel ?? 'Confirm'}
        onAction={() => settle(true)}
      />
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('useFeedback must be used inside FeedbackProvider');
  return value;
}

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string | (() => Promise<string>); label?: string; size?: 'sm' | 'md' | 'lg' }) {
  const { copy, isCopied } = useClipboard({ announce: 'Copied' });
  const [failed, setFailed] = useState(false);
  const [functionCopied, setFunctionCopied] = useState(false);
  useEffect(() => {
    if (!functionCopied) return;
    const timer = setTimeout(() => setFunctionCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [functionCopied]);
  const copied = typeof text === 'function' ? functionCopied : isCopied;
  const visible = failed ? 'Copy failed' : copied ? 'Copied' : label;
  return (
    <>
      <Button
        label={visible}
        size={size}
        variant="ghost"
        icon={<Icon name={copied ? 'check' : 'copy'} />}
        clickAction={() => {
          setFailed(false);
          setFunctionCopied(false);
          if (typeof text === 'function') {
            return copyLater(text).then((succeeded) => {
              if (succeeded) setFunctionCopied(true);
              else setFailed(true);
            });
          }
          return copy(text).then((succeeded) => {
            if (!succeeded) setFailed(true);
          });
        }}
      />
      <Text type="supporting" role="status">{visible === label ? '' : visible}</Text>
    </>
  );
}

function displayName(me: Identity): string {
  return me.name?.trim() || me.email.split('@')[0] || me.email;
}

const accountThemes = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
] as const;

function AccountMenu({ me, page }: { me: Identity; page: PageName }) {
  const { mode, setMode } = useThemeMode();
  const [themeControlsReady, setThemeControlsReady] = useState(false);
  const popoverId = useId();
  const appearanceId = `${popoverId}-appearance`;
  const name = displayName(me);
  useEffect(() => setThemeControlsReady(true), []);

  return (
    <>
      <button
        type="button"
        className="account-trigger"
        aria-label={name}
        aria-haspopup="dialog"
        popoverTarget={popoverId}
        // Safari may not focus a button on click. Give native dismissal a return target.
        onClickCapture={event => event.currentTarget.focus({ preventScroll: true })}
      >
        <Avatar name={name} src={me.avatarUrl ?? undefined} size="sm" tooltip={false} />
        <Text className="workspace-account-name" type="label" maxLines={1}>{name}</Text>
      </button>
      <section id={popoverId} popover="auto" role="dialog" aria-label="Account" className="workspace-account-popover">
        <VStack gap={3}>
          <VStack gap={1}>
            <Text weight="semibold">{name}</Text>
            <Text color="secondary" type="supporting">{me.email}</Text>
          </VStack>
          <a className="workspace-account-link" href="/settings" aria-current={page === 'settings' ? 'page' : undefined} autoFocus>Settings</a>
          {themeControlsReady && (
            <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
              <Text id={appearanceId} type="supporting" color="secondary">Appearance</Text>
              <fieldset role="radiogroup" aria-labelledby={appearanceId} className="workspace-theme-track">
                {accountThemes.map(({ value, label, icon }) => (
                  <label className="workspace-theme-option" key={value}>
                    <input type="radio" name={appearanceId} value={value} checked={mode === value} onChange={() => setMode(value)} />
                    <Icon name={icon} />
                    <Text className="workspace-theme-option-label">{label}</Text>
                  </label>
                ))}
              </fieldset>
            </HStack>
          )}
          <form method="post" action="/auth/logout"><Button label="Sign out" size="sm" type="submit" variant="ghost" /></form>
        </VStack>
      </section>
    </>
  );
}

function ThemeCycle() {
  const { mode, setMode } = useThemeMode();
  const choices: ThemeMode[] = ['system', 'light', 'dark'];
  const next = choices[(choices.indexOf(mode) + 1) % choices.length];
  const label = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
  return <Button label={label} size="sm" variant="ghost" onClick={() => setMode(next)} />;
}

function WorkspaceHeader({ shell: { me, viewerEmail, signIn = true }, page }: { shell: ShellProps; page: PageName }) {
  return (
    <HStack className="workspace-bar" gap={2} vAlign="center" wrap="wrap">
      <a className="workspace-brand" href="/" aria-current={page === 'library' ? 'page' : undefined}><Logo size={28} />Artifacts</a>
      {me && (
        <HStack className="workspace-crumb" gap={3} vAlign="center">
          <Text type="supporting" color="secondary" aria-hidden="true">/</Text>
          <Text type="supporting" color="secondary">Personal workspace</Text>
        </HStack>
      )}
      <HStack className="workspace-tools" gap={2} vAlign="center" wrap="wrap">
        {me ? (
          <>
            <Button
              label="New artifact"
              size="sm"
              href="/new"
              aria-current={page === 'newArtifact' ? 'page' : undefined}
              icon={
                <svg className="artifact-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
            />
            <AccountMenu me={me} page={page} />
          </>
        ) : (
          <>
            <ThemeCycle />
            {viewerEmail ? (
              <>
                <Text type="supporting" color="secondary" className="viewer-email">{viewerEmail}</Text>
                <form method="post" action="/auth/logout"><Button label="Sign out" size="sm" type="submit" /></form>
              </>
            ) : signIn && <Button label="Sign in" size="sm" href="/auth/login" />}
          </>
        )}
      </HStack>
    </HStack>
  );
}

export function Shell({ shell, page, children }: { shell: ShellProps; page: PageName; children: ReactNode }) {
  const { error, clearError } = useFeedback();
  const fill = shell.width === 'fill';
  const width = page === 'library' || page === 'settings' ? 'wide' : shell.width;
  const className = fill
    ? 'app-width-fill'
    : `workspace-content ${width === 'wide' ? 'app-width-wide' : width === 'narrow' ? 'app-width-narrow' : 'app-width'}${page === 'landing' ? ' workspace-landing' : ''}`;
  return (
    <AppShell
      banner={error ? <Banner status="error" title={error} role="alert" container="section" isDismissable onDismiss={clearError} /> : undefined}
      topNav={<WorkspaceHeader shell={shell} page={page} />}
      mobileNav={false}
      height={fill ? 'fill' : 'auto'}
      variant="section"
    >
      <VStack gap={4} className={className}>{children}</VStack>
    </AppShell>
  );
}
