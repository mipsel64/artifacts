import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading, Text } from '@astryxdesign/core/Text';
import { DEFAULT_READING_SIZE, READING_FONTS, READING_SIZES, type ReadingFont } from '../../../types';
import { formatDate } from '../../format';
import { api } from '../api';
import { CopyButton, useFeedback } from '../Shell';
import type { ThemeMode } from '../mode';
import { themeMessage, useThemeMode } from '../theme-mode';

interface SettingsItem {
  id: string;
  name: string;
  createdAt: string;
}

interface CreatedToken extends SettingsItem {
  token: string;
}

export interface SettingsProps {
  tokens: SettingsItem[];
  apps: SettingsItem[];
  origin: string;
}

type SettingsSection = 'general' | 'connect' | 'apps' | 'tokens';
type ConnectionMethod = 'claude-ai' | 'claude-code' | 'token' | 'json';

const SETTINGS_NAV: { group: string; items: { id: SettingsSection; label: string }[] }[] = [
  { group: 'Preferences', items: [{ id: 'general', label: 'Appearance' }] },
  {
    group: 'Agent access',
    items: [
      { id: 'connect', label: 'Connect an agent' },
      { id: 'apps', label: 'Connected apps' },
      { id: 'tokens', label: 'API tokens' },
    ],
  },
];

const READING_FONT_LABELS: Record<ReadingFont, string> = { serif: 'Serif', sans: 'Sans', mono: 'Mono' };
const READING_FONT_VALUES = Object.keys(READING_FONTS) as ReadingFont[];
const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function sectionFromHash(hash: string): SettingsSection {
  const value = hash.slice(1);
  return SETTINGS_NAV.some((group) => group.items.some((item) => item.id === value)) ? value as SettingsSection : 'general';
}

function notifyArtifactFrames(mode: ThemeMode) {
  const message = themeMessage(mode);
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-artifact-preview]')) {
    frame.contentWindow?.postMessage(message, '*');
  }
}

function SettingsPanel({
  id,
  title,
  intro,
  active,
  headingRef,
  children,
}: {
  id: SettingsSection;
  title: string;
  intro: string;
  active: boolean;
  headingRef: (node: HTMLHeadingElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section className="preferences-panel" data-settings-panel={id} aria-labelledby={`settings-${id}-heading`} hidden={!active}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2} id={`settings-${id}-heading`} tabIndex={-1} ref={headingRef}>{title}</Heading>
          <Text as="p" color="secondary">{intro}</Text>
        </VStack>
        {children}
      </VStack>
    </section>
  );
}

function ThemeThumbnail({ mode }: { mode: ThemeMode }) {
  const pane = (scheme: 'light' | 'dark', x: number, width: number) => (
    <svg x={x} width={width} height="54" viewBox="0 0 85 54" preserveAspectRatio="xMinYMid slice" data-scheme={scheme}>
      <path className="preferences-theme-paper" d="M0 0h85v54H0z" />
      <path fill="currentColor" d="M7 8h22v3H7z" />
      <path fill="currentColor" opacity=".32" d="M7 17h14v30H7zM26 28h34v3H26zM26 36h28v3H26z" />
      <path fill="currentColor" opacity=".55" d="M26 18h45v4H26z" />
    </svg>
  );
  return (
    <svg className="preferences-theme-thumbnail" viewBox="0 0 85 54" preserveAspectRatio="none" aria-hidden="true">
      {mode === 'system' ? <>{pane('light', 0, 43)}{pane('dark', 43, 42)}</> : pane(mode, 0, 85)}
    </svg>
  );
}

function ReadingSpecimen({ font, size }: { font: ReadingFont; size: number }) {
  return (
    <aside className="preferences-specimen" aria-labelledby="reading-specimen-heading">
      <header className="preferences-specimen-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" />
        </svg>
        <Text id="reading-specimen-heading" type="label">Live reading preview</Text>
      </header>
      <figure className="preferences-specimen-art" aria-hidden="true">
        <svg viewBox="0 0 204 75">
          <circle cx="125" cy="19" r="11" fill="var(--color-artifact-html)" />
          <g fill="none" stroke="currentColor" strokeWidth="1.45">
            {Array.from({ length: 12 }, (_, i) => (
              <path key={i} d={`M0 ${65 - i * 2} Q35 ${69 - i * 3} 65 ${42 - i * 1.8} T128 ${55 - i * 2.5} T204 ${28 - i * 1.8}`} />
            ))}
          </g>
        </svg>
      </figure>
      <article className="preferences-specimen-text" style={{ fontFamily: READING_FONTS[font], fontSize: size }}>
        <Text type="code" color="secondary" className="preferences-serial">Field journal / 03</Text>
        <h3>At the ridge</h3>
        <p>From the pass, the trail looks like a single line. Up close, each bend marks a different view.</p>
      </article>
    </aside>
  );
}

function ReadingSetting({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <section className="preferences-reading-setting">
      <label htmlFor={id}><Text type="label">{label}</Text></label>
      {children}
      <Text as="p" id={`${id}-hint`} type="supporting">{hint}</Text>
    </section>
  );
}

function GeneralPanel() {
  const { mode, setMode } = useThemeMode();
  const [readingFont, setReadingFont] = useState<ReadingFont>('serif');
  const [readingSize, setReadingSize] = useState<number>(DEFAULT_READING_SIZE);

  useEffect(() => {
    try {
      const font = localStorage.getItem('reading-font');
      const size = Number(localStorage.getItem('reading-size'));
      if (font !== null && READING_FONT_VALUES.includes(font as ReadingFont)) setReadingFont(font as ReadingFont);
      setReadingSize(READING_SIZES.find((option) => option === size) ?? DEFAULT_READING_SIZE);
    } catch {}
  }, []);

  const changeFont = (font: ReadingFont) => {
    setReadingFont(font);
    try { localStorage.setItem('reading-font', font); } catch {}
    notifyArtifactFrames(mode);
  };
  const changeSize = (size: number) => {
    setReadingSize(size);
    try { localStorage.setItem('reading-size', String(size)); } catch {}
    notifyArtifactFrames(mode);
  };

  return (
    <section className="preferences-appearance" aria-label="Reading and theme preferences">
      <VStack gap={3} className="preferences-choices">
        <fieldset className="preferences-theme">
          <legend>Theme</legend>
          <HStack gap={2} className="preferences-theme-options">
            {THEME_OPTIONS.map(({ value, label }) => (
              <label className="preferences-theme-choice" key={value}>
                <ThemeThumbnail mode={value} />
                <Text className="preferences-theme-caption" type="label">
                  <input type="radio" name="theme" value={value} checked={mode === value} onChange={() => setMode(value)} />
                  {label}
                </Text>
              </label>
            ))}
          </HStack>
        </fieldset>
        <ReadingSetting id="reading-font" label="Reading font" hint="Markdown, slides, react, and html that uses the theme font.">
          <select className="preferences-select" id="reading-font" name="reading-font" aria-describedby="reading-font-hint"
            value={readingFont} onChange={(event) => changeFont(event.currentTarget.value as ReadingFont)}>
            {READING_FONT_VALUES.map((font) => <option key={font} value={font}>{READING_FONT_LABELS[font]}</option>)}
          </select>
        </ReadingSetting>
        <ReadingSetting id="reading-size" label="Text size" hint="Markdown, react, and html that uses the theme size. Slides keep their size.">
          <select className="preferences-select" id="reading-size" name="reading-size" aria-describedby="reading-size-hint"
            value={readingSize} onChange={(event) => changeSize(Number(event.currentTarget.value))}>
            {READING_SIZES.map((size) => (
              <option key={size} value={size}>{size === DEFAULT_READING_SIZE ? `Default · ${size} px` : `${size} px`}</option>
            ))}
          </select>
        </ReadingSetting>
        <Text as="p" type="supporting">Saved in this browser.</Text>
      </VStack>
      <ReadingSpecimen font={readingFont} size={readingSize} />
    </section>
  );
}

function Snippet({ label, children }: { label: string; children: string }) {
  return (
    <VStack gap={0} className="settings-snippet">
      <HStack hAlign="between" vAlign="center" className="settings-snippet-bar">
        <Text type="code" color="secondary">{label}</Text>
        <CopyButton text={children} />
      </HStack>
      <pre tabIndex={0}><code>{children}</code></pre>
    </VStack>
  );
}

function ConnectPanel({ origin }: { origin: string }) {
  const [method, setMethod] = useState<ConnectionMethod>('claude-ai');
  const url = `${origin}/mcp`;
  const oauthCommand = `claude mcp add --transport http artifacts ${url}`;
  const tokenCommand = `${oauthCommand} --header "Authorization: Bearer <YOUR_TOKEN>"`;
  const json = `{ "mcpServers": { "artifacts": { "type": "http", "url": "${url}", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }`;
  return (
    <>
      <label className="preferences-method">
        <Text type="label">Connection method</Text>
        <select className="preferences-select" value={method} onChange={(event) => setMethod(event.currentTarget.value as ConnectionMethod)}>
          <option value="claude-ai">Claude.ai &amp; Desktop</option>
          <option value="claude-code">Claude Code</option>
          <option value="token">API token</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <section hidden={method !== 'claude-ai'}>
        <VStack gap={3}>
          <Text as="p">Add a custom connector using this address.</Text>
          <Snippet label="Connector URL">{url}</Snippet>
          <Text as="p" type="supporting">Sign in with Google and review the access request.</Text>
        </VStack>
      </section>
      <section hidden={method !== 'claude-code'}>
        <VStack gap={3}>
          <Text as="p">Run this command in a terminal.</Text>
          <Snippet label="Shell">{oauthCommand}</Snippet>
          <Text as="p" color="secondary" type="supporting">Run it, then type <code>/mcp</code> in Claude Code and choose artifacts to sign in.</Text>
        </VStack>
      </section>
      <section hidden={method !== 'token'}>
        <VStack gap={3}>
          <Text as="p">Create a named token, then run this command in a terminal.</Text>
          <Snippet label="Shell">{tokenCommand}</Snippet>
          <Text as="p" color="secondary" type="supporting">Replace &lt;YOUR_TOKEN&gt; with a token from <Link href="#tokens">API tokens</Link>.</Text>
          <HStack><Button label="Open API tokens" href="#tokens" /></HStack>
        </VStack>
      </section>
      <section hidden={method !== 'json'}>
        <VStack gap={3}>
          <Text as="p">Add this entry to your MCP client configuration.</Text>
          <Snippet label="JSON">{json}</Snippet>
          <Text as="p" type="supporting">Replace &lt;YOUR_TOKEN&gt; with your own token before connecting.</Text>
          <HStack><Button label="Open API tokens" href="#tokens" /></HStack>
        </VStack>
      </section>
    </>
  );
}

function AppsPanel({ initialApps }: { initialApps: SettingsItem[] }) {
  const [apps, setApps] = useState(initialApps);
  const [pending, setPending] = useState<string | null>(null);
  const { clearError, showError, confirm } = useFeedback();

  const revoke = async (app: SettingsItem) => {
    clearError();
    if (!await confirm({
      title: `Revoke access for "${app.name}"?`,
      description: 'This app will no longer have access to your artifacts.',
      actionLabel: 'Revoke',
    })) return;
    setPending(app.id);
    try {
      await api('DELETE', `/api/grants/${app.id}`);
      setApps((items) => items.filter((item) => item.id !== app.id));
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  if (apps.length === 0) return (
    <VStack gap={3} hAlign="start">
      <Text as="p" color="secondary" type="supporting">No connected apps.</Text>
      <Button label="Connect an agent" href="#connect" />
    </VStack>
  );
  return (
    <List hasDividers edge="flush">
      {apps.map((app) => (
        <ListItem
          key={app.id}
          itemKey={app.id}
          label={<Text weight="medium">{app.name}</Text>}
          description={<Text type="supporting">Connected <time dateTime={app.createdAt}>{formatDate(app.createdAt)}</time></Text>}
          startContent={<Avatar name={app.name} size="sm" tooltip={false} />}
          endContent={<Button label="Revoke" variant="destructive" size="sm" isLoading={pending === app.id} onClick={() => revoke(app)} />}
        />
      ))}
    </List>
  );
}

function TokensPanel({ initialTokens, active }: { initialTokens: SettingsItem[]; active: boolean }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<CreatedToken | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const shownTokenId = useRef<string | null>(null);
  const newTokenRef = useRef<HTMLElement>(null);
  const tokenNameRef = useRef<HTMLElement>(null);
  const { clearError, showError, confirm } = useFeedback();

  useEffect(() => {
    const field = tokenNameRef.current?.querySelector<HTMLInputElement>('input');
    if (field) {
      field.required = true;
      field.maxLength = 100;
    }
  }, []);

  useEffect(() => {
    if (newToken === null) return;
    if (!active) {
      // A response can arrive after the user leaves. Retain it until it has been shown once.
      if (shownTokenId.current === newToken.id) {
        setNewToken((current) => current?.id === newToken.id ? null : current);
      }
      return;
    }
    shownTokenId.current = newToken.id;
    const field = newTokenRef.current?.querySelector<HTMLInputElement>('input');
    field?.focus();
    field?.select();
  }, [active, newToken]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    clearError();
    setCreating(true);
    try {
      const created = await api<CreatedToken>('POST', '/api/tokens', { name });
      if (created === null) throw new Error('Token creation returned no token');
      setNewToken(created);
      setTokens((items) => [...items, { id: created.id, name: created.name, createdAt: created.createdAt }]);
      setName('');
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token: SettingsItem) => {
    clearError();
    if (!await confirm({
      title: `Revoke token "${token.name}"?`,
      description: 'Agents using this token will no longer have access.',
      actionLabel: 'Revoke',
    })) return;
    setPending(token.id);
    try {
      await api('DELETE', `/api/tokens/${token.id}`);
      setTokens((items) => items.filter((item) => item.id !== token.id));
      setNewToken((current) => current?.id === token.id ? null : current);
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <form className="settings-token-form" method="post" aria-labelledby="settings-tokens-heading" data-form="token" onSubmit={create}>
        <StackItem size="fill" ref={tokenNameRef}>
          <TextInput label="Token name" htmlName="name" isRequired autoComplete="off" placeholder="e.g. Field notebook" value={name} onChange={setName} />
        </StackItem>
        <Button label="Create token" type="submit" variant="primary" isLoading={creating} />
      </form>
      {active && newToken !== null && (
        <section id="new-token">
          <Banner status="success" title="New token" description="Copy it now: you will not see it again." collapsible={false}>
            <HStack gap={2} wrap="wrap" vAlign="center" className="settings-secret-row" ref={newTokenRef}>
              <StackItem size="fill">
                <TextInput label="New token" isLabelHidden isReadOnly autoComplete="off" value={newToken.token} width="100%" controlClassName="settings-secret-input" />
              </StackItem>
              <CopyButton text={newToken.token} />
              <Button label="Done" type="button" onClick={() => {
                setNewToken(null);
                tokenNameRef.current?.querySelector('input')?.focus();
              }} />
            </HStack>
          </Banner>
        </section>
      )}
      {tokens.length > 0 ? (
        <List hasDividers edge="flush">
          {tokens.map((token) => (
            <ListItem
              key={token.id}
              itemKey={token.id}
              label={<Text weight="medium">{token.name}</Text>}
              description={<Text type="supporting">Created <time dateTime={token.createdAt}>{formatDate(token.createdAt)}</time></Text>}
              endContent={<Button label="Revoke" variant="destructive" size="sm" isLoading={pending === token.id} onClick={() => revoke(token)} />}
            />
          ))}
        </List>
      ) : <Text as="p" type="supporting">No tokens yet.</Text>}
    </>
  );
}

export function Settings({ tokens, apps, origin }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>('general');
  const headings = useRef<Record<SettingsSection, HTMLHeadingElement | null>>({ general: null, connect: null, apps: null, tokens: null });
  const focusSection = useRef<SettingsSection | null>(null);

  useEffect(() => {
    const showSection = () => {
      const next = sectionFromHash(location.hash);
      const active = document.activeElement;
      const panel = active instanceof Element ? active.closest<HTMLElement>('[data-settings-panel]') : null;
      focusSection.current = panel !== null && panel.dataset.settingsPanel !== next ? next : null;
      setSection(next);
    };
    window.addEventListener('hashchange', showSection);
    showSection();
    return () => window.removeEventListener('hashchange', showSection);
  }, []);

  useEffect(() => {
    if (focusSection.current === section) {
      focusSection.current = null;
      headings.current[section]?.focus();
    }
  }, [section]);

  const headingRef = (id: SettingsSection) => (node: HTMLHeadingElement | null) => { headings.current[id] = node; };
  return (
    <section className="preferences-page" aria-labelledby="preferences-heading">
      <header className="preferences-heading">
        <Text type="code" color="secondary" className="preferences-kicker">Personal workspace</Text>
        <Heading level={1} id="preferences-heading" className="preferences-display">Settings</Heading>
      </header>
      <section className="preferences-layout" aria-label="Workspace settings">
        <nav className="preferences-nav" aria-label="Settings sections">
          {SETTINGS_NAV.map((group) => (
            <VStack gap={1} key={group.group}>
              <Text type="code" color="secondary" className="preferences-serial">{group.group}</Text>
              {group.items.map((item) => (
                <Link
                  className="preferences-nav-link"
                  key={item.id}
                  href={`#${item.id}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  color={section === item.id ? 'accent' : 'primary'}
                  weight={section === item.id ? 'semibold' : 'normal'}
                >
                  {item.label}
                </Link>
              ))}
            </VStack>
          ))}
        </nav>
        <section className="preferences-content">
          <label className="preferences-mobile-nav">
            <Text type="label">Settings section</Text>
            <select className="preferences-select" value={section} onChange={(event) => { location.hash = event.currentTarget.value; }}>
              {SETTINGS_NAV.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <SettingsPanel id="general" title="Appearance" intro="Choose how Artifacts looks and how its documents read." active={section === 'general'} headingRef={headingRef('general')}>
            <GeneralPanel />
          </SettingsPanel>
          <SettingsPanel id="connect" title="Connect an agent" intro="Give your client the Artifacts MCP address. Choose the instructions for your client." active={section === 'connect'} headingRef={headingRef('connect')}>
            <ConnectPanel origin={origin} />
          </SettingsPanel>
          <SettingsPanel id="apps" title="Connected apps" intro="Apps you have authorized can use your artifacts until you revoke access." active={section === 'apps'} headingRef={headingRef('apps')}>
            <AppsPanel initialApps={apps} />
          </SettingsPanel>
          <SettingsPanel id="tokens" title="API tokens" intro="Use a separate token for each client so you can remove its access to the MCP server and REST API later." active={section === 'tokens'} headingRef={headingRef('tokens')}>
            <TokensPanel initialTokens={tokens} active={section === 'tokens'} />
          </SettingsPanel>
        </section>
      </section>
    </section>
  );
}
