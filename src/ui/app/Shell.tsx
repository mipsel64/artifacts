import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { VStack } from '@astryxdesign/core/Layout';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Text } from '@astryxdesign/core/Text';
import { SideNav, SideNavHeading, SideNavItem } from '@astryxdesign/core/SideNav';
import { useClipboard } from '@astryxdesign/core/hooks';
import type { Identity } from './identity';
import { Logo, Icon } from './icons';
import { useThemeMode } from './theme-mode';
import type { ThemeMode } from './mode';
import { copyLater } from './clipboard';

export interface ShellProps {
  me: Identity | null;
  viewerEmail?: string | null;
  signIn?: boolean;
  settingsActive?: boolean;
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

function AccountMenu({ me, settingsActive }: { me: Identity; settingsActive?: boolean }) {
  const { mode, setMode } = useThemeMode();
  const name = displayName(me);
  return (
    <DropdownMenu
      alignment="end"
      renderTrigger={(props) => (
        <Button {...props} label={name} variant="ghost" width="100%" className="account-trigger" icon={<Avatar name={name} src={me.avatarUrl ?? undefined} size="sm" tooltip={false} />} />
      )}
      header={<VStack gap={1}><Text weight="semibold">{name}</Text><Text color="secondary" type="supporting">{me.email}</Text></VStack>}
      footer={<form method="post" action="/auth/logout"><Button label="Sign out" type="submit" variant="ghost" /></form>}
    >
      <DropdownMenuItem label="Settings" href="/settings" aria-current={settingsActive ? 'page' : undefined} />
      <DropdownMenuDivider />
      <Text id="appearance-label" type="supporting" color="secondary" className="menu-group-label">Appearance</Text>
      <DropdownMenuItem label="System" onClick={() => setMode('system')} endContent={mode === 'system' ? <Icon name="check" /> : undefined} />
      <DropdownMenuItem label="Light" onClick={() => setMode('light')} endContent={mode === 'light' ? <Icon name="check" /> : undefined} />
      <DropdownMenuItem label="Dark" onClick={() => setMode('dark')} endContent={mode === 'dark' ? <Icon name="check" /> : undefined} />
    </DropdownMenu>
  );
}

function ThemeCycle() {
  const { mode, setMode } = useThemeMode();
  const choices: ThemeMode[] = ['system', 'light', 'dark'];
  const next = choices[(choices.indexOf(mode) + 1) % choices.length];
  const label = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
  return <Button label={label} variant="ghost" width="100%" onClick={() => setMode(next)} />;
}

function SidebarFooter({ me, viewerEmail, signIn = true, settingsActive }: ShellProps) {
  if (me) return <AccountMenu me={me} settingsActive={settingsActive} />;
  return (
    <VStack gap={2} hAlign="stretch">
      <ThemeCycle />
      {viewerEmail ? (
        <>
          <Text type="supporting" color="secondary" className="viewer-email">{viewerEmail}</Text>
          <form method="post" action="/auth/logout"><Button label="Sign out" type="submit" width="100%" /></form>
        </>
      ) : signIn && <Button label="Sign in" href="/auth/login" width="100%" />}
    </VStack>
  );
}

function Sidebar(props: ShellProps) {
  const { settingsActive } = props;
  return (
    <SideNav
      aria-label="Main navigation"
      header={<SideNavHeading icon={<Logo size={28} />} heading="Artifacts" headingHref="/" />}
      topContent={<Button label="+ New artifact" href="/new" variant="primary" width="100%" />}
      footer={<SidebarFooter {...props} />}
    >
      <SideNavItem label="Artifacts" href="/" icon="viewColumns" isSelected={!settingsActive} />
      <SideNavItem label="Settings" href="/settings" icon="wrench" isSelected={Boolean(settingsActive)} />
    </SideNav>
  );
}

export function Shell({ shell, children }: { shell: ShellProps; children: ReactNode }) {
  const { error, clearError } = useFeedback();
  const width = shell.width ?? 'medium';
  const className = width === 'fill' ? 'app-width-fill' : width === 'narrow' ? 'app-width-narrow' : 'app-width';
  return (
    <AppShell
      banner={error ? <Banner status="error" title={error} role="alert" container="section" isDismissable onDismiss={clearError} /> : undefined}
      sideNav={<Sidebar {...shell} />}
      height={width === 'fill' ? 'fill' : 'auto'}
      contentPadding={width === 'fill' ? 0 : 8}
      variant="section"
    >
      <VStack gap={4} className={className}>{children}</VStack>
    </AppShell>
  );
}
