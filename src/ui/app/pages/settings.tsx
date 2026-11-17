import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector, SelectorOption } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Heading, Text } from '@astryxdesign/core/Text';
import { DEFAULT_READING_SIZE, READING_FONTS, READING_SIZES, type ReadingFont } from '../../../types';
import { formatDate } from '../../format';
import { api } from '../api';
import { CopyButton, useFeedback } from '../Shell';
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
type ConnectionTab = 'claude-ai' | 'claude-code' | 'token' | 'json';

const SETTINGS_NAV: { group: string; items: { id: SettingsSection; label: string }[] }[] = [
  { group: 'Preferences', items: [{ id: 'general', label: 'General' }] },
  {
    group: 'Agents',
    items: [
      { id: 'connect', label: 'Connect an agent' },
      { id: 'apps', label: 'Connected apps' },
      { id: 'tokens', label: 'API tokens' },
    ],
  },
];

const READING_FONT_LABELS: Record<ReadingFont, string> = { serif: 'Serif', sans: 'Sans', mono: 'Mono' };
const READING_FONT_VALUES = Object.keys(READING_FONTS) as ReadingFont[];
const READING_FONT_OPTIONS = READING_FONT_VALUES.map((value) => ({ value, label: READING_FONT_LABELS[value] }));
const READING_SIZE_OPTIONS = READING_SIZES.map((size) => ({
  value: String(size),
  label: size === DEFAULT_READING_SIZE ? `Default · ${size} px` : `${size} px`,
}));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function sectionFromHash(hash: string): SettingsSection {
  const value = hash.slice(1);
  return SETTINGS_NAV.some((group) => group.items.some((item) => item.id === value)) ? value as SettingsSection : 'general';
}

function notifyArtifactFrames(mode: 'system' | 'light' | 'dark') {
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
    <section className="settings-panel" data-settings-panel={id} aria-labelledby={`settings-${id}-heading`} hidden={!active}>
      <Heading level={2} id={`settings-${id}-heading`} tabIndex={-1} ref={headingRef}>{title}</Heading>
      <Text as="p" color="secondary" type="supporting">{intro}</Text>
      <VStack gap={4}>{children}</VStack>
    </section>
  );
}

function SettingsRow({ label, control, hint, hintId }: { label: ReactNode; control: ReactNode; hint?: string; hintId?: string }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">{label}</div>
      {hint && <Text as="p" id={hintId} className="settings-row-hint" color="secondary" type="supporting">{hint}</Text>}
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

function GeneralPanel() {
  const { mode, setMode } = useThemeMode();
  const [readingFont, setReadingFont] = useState<ReadingFont>('serif');
  const [readingSize, setReadingSize] = useState(String(DEFAULT_READING_SIZE));

  useEffect(() => {
    try {
      const font = localStorage.getItem('reading-font');
      const size = localStorage.getItem('reading-size');
      if (font !== null && READING_FONT_VALUES.includes(font as ReadingFont)) setReadingFont(font as ReadingFont);
      if (size !== null && READING_SIZES.some((option) => String(option) === size)) setReadingSize(size);
    } catch {}
  }, []);

  const changeFont = (font: ReadingFont) => {
    setReadingFont(font);
    try { localStorage.setItem('reading-font', font); } catch {}
    notifyArtifactFrames(mode);
  };
  const changeSize = (size: string) => {
    setReadingSize(size);
    try { localStorage.setItem('reading-size', size); } catch {}
    notifyArtifactFrames(mode);
  };

  return (
    <VStack gap={0} className="settings-rows">
      <SettingsRow
        label={<Text as="span">Theme</Text>}
        control={
          <SegmentedControl label="Theme" value={mode} onChange={(value) => setMode(value as typeof mode)} size="sm">
            <SegmentedControlItem value="system" label="System" />
            <SegmentedControlItem value="light" label="Light" />
            <SegmentedControlItem value="dark" label="Dark" />
          </SegmentedControl>
        }
      />
      <SettingsRow
        label={<Text as="span">Reading font</Text>}
        hintId="reading-font-hint"
        hint="Markdown, slides, react, and html that uses the theme font."
        control={
          <Selector
            label="Reading font"
            isLabelHidden
            htmlName="reading-font"
            variant="ghost"
            size="sm"
            options={READING_FONT_OPTIONS}
            value={readingFont}
            onChange={(value) => changeFont(value as ReadingFont)}
            renderOption={(option) => {
              const font = option.value as ReadingFont;
              return <SelectorOption label={<Text style={{ fontFamily: READING_FONTS[font] }}>{READING_FONT_LABELS[font]}</Text>} />;
            }}
            renderValue={(option) => {
              const font = option.value as ReadingFont;
              return <Text style={{ fontFamily: READING_FONTS[font] }}>{READING_FONT_LABELS[font]}</Text>;
            }}
          />
        }
      />
      <SettingsRow
        label={<Text as="span">Text size</Text>}
        hintId="reading-size-hint"
        hint="Markdown, react, and html that uses the theme size. Slides keep their size."
        control={
          <Selector
            label="Text size"
            isLabelHidden
            htmlName="reading-size"
            variant="ghost"
            size="sm"
            options={READING_SIZE_OPTIONS}
            value={readingSize}
            onChange={changeSize}
          />
        }
      />
    </VStack>
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
  const [tab, setTab] = useState<ConnectionTab>('claude-ai');
  const url = `${origin}/mcp`;
  const oauthCommand = `claude mcp add --transport http artifacts ${url}`;
  const tokenCommand = `${oauthCommand} --header "Authorization: Bearer <YOUR_TOKEN>"`;
  const json = `{ "mcpServers": { "artifacts": { "type": "http", "url": "${url}", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }`;
  return (
    <>
      <TabList role="tablist" aria-label="Connection method" value={tab} onChange={(value) => setTab(value as ConnectionTab)} hasDivider>
        <Tab value="claude-ai" label="Claude.ai & Desktop" panelId="settings-connect-panel-claude-ai" />
        <Tab value="claude-code" label="Claude Code" panelId="settings-connect-panel-claude-code" />
        <Tab value="token" label="API token" panelId="settings-connect-panel-token" />
        <Tab value="json" label="JSON" panelId="settings-connect-panel-json" />
      </TabList>
      <div role="tabpanel" id="settings-connect-panel-claude-ai" hidden={tab !== 'claude-ai'}>
        <VStack gap={3}>
          <Snippet label="Connector URL">{url}</Snippet>
          <Text as="p" color="secondary" type="supporting">Add it as a custom connector and sign in with Google when asked.</Text>
        </VStack>
      </div>
      <div role="tabpanel" id="settings-connect-panel-claude-code" hidden={tab !== 'claude-code'}>
        <VStack gap={3}>
          <Snippet label="Shell">{oauthCommand}</Snippet>
          <Text as="p" color="secondary" type="supporting">Run it, then type <code>/mcp</code> in Claude Code and choose artifacts to sign in.</Text>
        </VStack>
      </div>
      <div role="tabpanel" id="settings-connect-panel-token" hidden={tab !== 'token'}>
        <VStack gap={3}>
          <Snippet label="Shell">{tokenCommand}</Snippet>
          <Text as="p" color="secondary" type="supporting">Replace &lt;YOUR_TOKEN&gt; with a token from <Link href="#tokens">API tokens</Link>.</Text>
        </VStack>
      </div>
      <div role="tabpanel" id="settings-connect-panel-json" hidden={tab !== 'json'}>
        <VStack gap={3}>
          <Snippet label="JSON">{json}</Snippet>
          <Text as="p" color="secondary" type="supporting">Paste it into your MCP client configuration and replace &lt;YOUR_TOKEN&gt;.</Text>
        </VStack>
      </div>
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

  if (apps.length === 0) return <Text as="p" color="secondary" type="supporting">No connected apps.</Text>;
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

function TokensPanel({ initialTokens }: { initialTokens: SettingsItem[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
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
    if (newToken !== null) {
      const field = newTokenRef.current?.querySelector<HTMLInputElement>('input');
      field?.focus();
      field?.select();
    }
  }, [newToken]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    clearError();
    setCreating(true);
    try {
      const created = await api<CreatedToken>('POST', '/api/tokens', { name });
      if (created === null) throw new Error('Token creation returned no token');
      setNewToken(created.token);
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
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <form className="settings-token-form" method="post" data-form="token" onSubmit={create}>
        <StackItem size="fill" ref={tokenNameRef}>
          <TextInput label="Token name" htmlName="name" isRequired autoComplete="off" value={name} onChange={setName} />
        </StackItem>
        <Button label="Create token" type="submit" variant="primary" isLoading={creating} />
      </form>
      <div id="new-token" className="settings-new-token" hidden={newToken === null}>
        <Banner status="success" title="New token" description="Copy it now: you will not see it again." collapsible={false}>
          <HStack gap={2} vAlign="center" className="settings-secret-row" ref={newTokenRef}>
            <StackItem size="fill">
              <TextInput label="New token" isLabelHidden isReadOnly value={newToken ?? ''} width="100%" controlClassName="settings-secret-input" />
            </StackItem>
            <CopyButton text={newToken ?? ''} />
          </HStack>
        </Banner>
      </div>
      {tokens.length > 0 && (
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
      )}
      <div hidden={tokens.length > 0}><Text as="p" color="secondary" type="supporting">No tokens yet.</Text></div>
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
    <div className="settings-frame">
      <div className="settings-head"><Heading level={1}>Settings</Heading></div>
      <nav className="settings-nav" aria-label="Settings sections">
        {SETTINGS_NAV.map((group) => (
          <div key={group.group} className="settings-nav-section">
            <div className="settings-nav-group"><Text type="supporting" color="secondary">{group.group}</Text></div>
            <List edge="outset">
              {group.items.map((item) => (
                <ListItem
                  key={item.id}
                  label={item.label}
                  href={`#${item.id}`}
                  isSelected={section === item.id}
                />
              ))}
            </List>
          </div>
        ))}
      </nav>
      <div className="settings-content">
        <SettingsPanel id="general" title="Appearance" intro="Saved in this browser." active={section === 'general'} headingRef={headingRef('general')}>
          <GeneralPanel />
        </SettingsPanel>
        <SettingsPanel id="connect" title="Connect an agent" intro="Agents reach Artifacts over MCP. Sign in with Google, or send an API token in the Authorization header." active={section === 'connect'} headingRef={headingRef('connect')}>
          <ConnectPanel origin={origin} />
        </SettingsPanel>
        <SettingsPanel id="apps" title="Connected apps" intro="Apps you allowed to use your artifacts by signing in over MCP. Revoking stops them." active={section === 'apps'} headingRef={headingRef('apps')}>
          <AppsPanel initialApps={apps} />
        </SettingsPanel>
        <SettingsPanel id="tokens" title="API tokens" intro="Tokens let agents call the MCP server and REST API as you." active={section === 'tokens'} headingRef={headingRef('tokens')}>
          <TokensPanel initialTokens={tokens} />
        </SettingsPanel>
      </div>
    </div>
  );
}
