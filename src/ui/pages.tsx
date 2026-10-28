import type { Child } from 'hono/jsx';
import { ARTIFACT_TYPES, DEFAULT_READING_SIZE, READING_FONTS, READING_SIZES, type ArtifactSummary, type ArtifactType, type ArtifactView, type ReadingFont } from '../types';
import { Initial } from './components';
import { formatDate, formatDateTime, retentionLabel } from './format';
import { GoogleMark, Icon, Logo, TypeIcon, type IconName } from './icons';
import { THEME_CHOICES } from './layout';

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'bot', title: 'MCP for agents', text: 'Agents create and update artifacts over MCP or the REST API.' },
  { icon: 'shield-check', title: 'Sandboxed preview', text: 'Every artifact renders in an isolated iframe on its own origin.' },
  { icon: 'link', title: 'Share links', text: 'Publish a read-only link and stop sharing whenever you like.' },
];

export function Landing() {
  return (
    <section class="hero">
      <Logo size={48} />
      <h1>A home for what your agents make</h1>
      <p class="lead">Create, version and share the HTML, React, slides, designs, motion, SVG, Mermaid, Archify, Markdown and code your agents write.</p>
      <a class="button button-primary button-lg" href="/auth/login">
        <GoogleMark />
        <span>Sign in with Google</span>
      </a>
      <ul class="features">
        {FEATURES.map((feature) => (
          <li>
            <span class="feature-icon">
              <Icon name={feature.icon} size={20} />
            </span>
            <h2>{feature.title}</h2>
            <p>{feature.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RestrictedShare({ shareId, viewerEmail }: { shareId: string; viewerEmail: string | null }) {
  const signInUrl = `/auth/login?next=${encodeURIComponent(`/s/${shareId}`)}`;
  return (
    <div class="card auth-card error-card">
      <span class="auth-icon">
        <Icon name="shield-check" size={24} />
      </span>
      <h1>{viewerEmail === null ? 'Sign in to view' : 'You do not have access'}</h1>
      <p class="muted">
        {viewerEmail === null
          ? 'This link is shared with specific people. Sign in with Google to check your access.'
          : `You are signed in as ${viewerEmail}. Ask the owner for access, or sign in with an account that has access.`}
      </p>
      <div class="actions actions-center">
        <a class="button button-primary" href={signInUrl}>
          <GoogleMark />
          <span>{viewerEmail === null ? 'Sign in with Google' : 'Switch account'}</span>
        </a>
      </div>
      {viewerEmail !== null && <p class="muted">Access for a whole domain needs a Google Workspace account on that domain.</p>}
    </div>
  );
}

function TypeTile({ type }: { type: ArtifactType }) {
  return (
    <span class="type-tile" title={type}>
      <TypeIcon type={type} size={20} />
      <span class="sr-only">{type}</span>
    </span>
  );
}

function TypeTag({ type, language }: { type: ArtifactType; language?: string | null }) {
  return (
    <span class="type-tag">
      <span>{type}</span>
      {language && <span class="type-tag-detail">{language}</span>}
    </span>
  );
}

export function ArtifactList({ items, now }: { items: ArtifactSummary[]; now: Date }) {
  return (
    <>
      <div class="page-head">
        <h1>
          Artifacts <span class="count">{items.length}</span>
        </h1>
      </div>
      {items.length === 0 ? (
        <div class="empty card">
          <span class="empty-icon">
            <Icon name="layers" size={24} />
          </span>
          <h2>No artifacts yet</h2>
          <p>Create one here, or let an agent create them over MCP.</p>
          <div class="actions actions-center">
            <a class="button button-primary" href="/new">
              <Icon name="plus" />
              <span>New artifact</span>
            </a>
            <a class="button" href="/settings">
              <Icon name="plug" />
              <span>Connect an agent</span>
            </a>
          </div>
        </div>
      ) : (
        <ul class="artifact-list">
          {items.map((item) => (
            <li>
              <a class="row" href={`/a/${item.id}`}>
                <TypeTile type={item.type} />
                <span class="row-main">
                  <span class="row-title" title={item.title}>{item.title}</span>
                  <span class="meta">
                    <span>v{item.version}</span>
                    <span>
                      Updated{' '}
                      <time datetime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
                    </span>
                    {item.expiresAt !== null && <span>{retentionLabel(item.expiresAt, now)}</span>}
                  </span>
                </span>
                <span class="row-flags">
                  {item.expiresAt === null && (
                    <span class="chip">
                      <Icon name="infinity" size={14} />
                      <span>{retentionLabel(item.expiresAt, now)}</span>
                    </span>
                  )}
                  {item.shared && (
                    <span class="chip chip-accent">
                      <Icon name="link" size={14} />
                      <span>Shared</span>
                    </span>
                  )}
                </span>
                <Icon name="chevron-right" class="row-chevron" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FormPage({ title, children }: { title: string; children?: Child }) {
  return (
    <>
      <h1 class="page-title">{title}</h1>
      <div class="card form-card">{children}</div>
    </>
  );
}

export function NewArtifact() {
  return (
    <FormPage title="New artifact">
      <form class="form" method="post" data-form="new">
        <div class="field">
          <label for="title">Title</label>
          <input id="title" name="title" required maxlength={200} autocomplete="off" />
        </div>
        <div class="field">
          <label for="type">Type</label>
          <div class="select">
            <select id="type" name="type">
              {ARTIFACT_TYPES.map((type) => (
                <option value={type}>{type}</option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </div>
        </div>
        <div class="field" id="language-field" hidden>
          <label for="language">Language</label>
          <input id="language" name="language" maxlength={32} placeholder="e.g. python" autocomplete="off" />
        </div>
        <div class="field">
          <label for="content">Content</label>
          <textarea id="content" name="content" class="editor" required rows={18} spellcheck={false}></textarea>
        </div>
        <div class="actions">
          <button type="submit" class="button button-primary">
            Create
          </button>
          <a class="button" href="/">
            Cancel
          </a>
        </div>
      </form>
    </FormPage>
  );
}

export function EditArtifact({ meta, content }: { meta: ArtifactView; content: string }) {
  return (
    <FormPage title="Edit artifact">
      <form class="form" method="post" data-form="edit" data-id={meta.id}>
        <div class="field">
          <label for="title">Title</label>
          <input id="title" name="title" value={meta.title} required maxlength={200} autocomplete="off" />
        </div>
        <div class="field">
          <label for="content">Content</label>
          <textarea id="content" name="content" class="editor" required rows={22} spellcheck={false}>
            {'\n' + content}
          </textarea>
        </div>
        <div class="actions">
          <button type="submit" class="button button-primary">
            Save
          </button>
          <a class="button" href={`/a/${meta.id}`}>
            Cancel
          </a>
        </div>
      </form>
    </FormPage>
  );
}

interface TabSpec {
  id: string;
  label: string;
  icon?: IconName;
}

function Tabs({ tabs, label }: { tabs: TabSpec[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} class="tabs">
      {tabs.map((tab, index) => (
        <button
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={index === 0 ? 'true' : 'false'}
          tabindex={index === 0 ? 0 : -1}
          class="tab"
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

// The Preview/Code switch is icon-only: each tab keeps its name in aria-label and title.
function ViewToggle() {
  const tabs: Required<TabSpec>[] = [
    { id: 'preview', label: 'Preview', icon: 'eye' },
    { id: 'code', label: 'Code', icon: 'code-xml' },
  ];
  return (
    <div role="tablist" aria-label="Artifact view" class="view-toggle">
      {tabs.map((tab, index) => (
        <button
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={index === 0 ? 'true' : 'false'}
          tabindex={index === 0 ? 0 : -1}
          class="view-tab"
          aria-label={tab.label}
          title={tab.label}
        >
          <Icon name={tab.icon} />
        </button>
      ))}
    </div>
  );
}

interface CopyButtonProps {
  target: string;
  label?: string;
  class?: string;
  iconOnly?: boolean;
}

// An icon-only button hides its label visually but keeps it as aria-label and title.
function CopyButton({ target, label = 'Copy', class: className = 'button', iconOnly }: CopyButtonProps) {
  return (
    <button type="button" class={className} data-copy={target} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
      <Icon name="copy" class="icon-copy" />
      <Icon name="check" class="icon-check" />
      <span class={iconOnly ? 'btn-label' : undefined}>{label}</span>
    </button>
  );
}

// The viewer is one bordered block: a slim header row (`bar`) on top of the preview/code area.
function ViewerFrame({ bar, previewSrc, content }: { bar: Child; previewSrc: string; content: string }) {
  return (
    <section class="viewer" aria-label="Artifact">
      <div class="viewer-bar">{bar}</div>
      <div role="tabpanel" id="panel-preview" aria-labelledby="tab-preview" class="viewer-pane viewer-preview">
        <iframe src={previewSrc} sandbox={SANDBOX} allow="fullscreen" title="Artifact preview" class="preview"></iframe>
      </div>
      <div role="tabpanel" id="panel-code" aria-labelledby="tab-code" class="viewer-pane viewer-code" hidden>
        <pre class="code" tabindex={0}>
          <code id="code">{content}</code>
        </pre>
      </div>
    </section>
  );
}

function VersionMenu({ meta, version }: { meta: ArtifactView; version: number }) {
  if (meta.version === 1) return <span class="version-static">v1</span>;
  return (
    <div class="menu-anchor menu-anchor-end">
      <button
        type="button"
        class="quiet-button"
        data-menu-button
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="version-menu"
        aria-label={`v${version} of ${meta.version}, switch version`}
        title="Versions"
      >
        <span>v{version}</span>
        <Icon name="chevron-down" />
      </button>
      <div class="menu-panel" id="version-menu" role="menu" aria-label="Versions" hidden>
        {[...meta.versions].reverse().map((info) => (
          <a
            role="menuitem"
            class="menu-item version-item"
            href={`/a/${meta.id}?v=${info.version}`}
            aria-current={info.version === version ? 'page' : undefined}
          >
            <span class="version-number">v{info.version}</span>
            <time class="version-date" datetime={info.createdAt}>
              {formatDateTime(info.createdAt)}
            </time>
            {info.version === meta.version && <span class="version-latest">Latest</span>}
            <Icon name="check" class="version-check" />
          </a>
        ))}
      </div>
    </div>
  );
}

function ApiButton(props: {
  method: string;
  url: string;
  label: string;
  icon?: IconName;
  body?: string;
  confirm?: string;
  done?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      class={props.danger ? 'button button-danger' : 'button'}
      data-method={props.method}
      data-url={props.url}
      data-body={props.body}
      data-confirm={props.confirm}
      data-done={props.done}
    >
      {props.icon && <Icon name={props.icon} />}
      <span>{props.label}</span>
    </button>
  );
}

function TitleMenu({ meta, version, now }: { meta: ArtifactView; version: number; now: Date }) {
  const render = `/r/${meta.id}?v=${version}`;
  const api = `/api/artifacts/${meta.id}`;
  const permanent = meta.expiresAt === null;
  const item = 'menu-item';
  return (
    <div class="menu-anchor">
      <h1 class="viewer-title">
        <button
          type="button"
          class="title-button"
          data-menu-button
          aria-haspopup="menu"
          aria-expanded="false"
          aria-controls="artifact-menu"
          title={meta.title}
        >
          <span class="title-text">{meta.title}</span>
          <TypeTag type={meta.type} language={meta.language} />
          <Icon name="chevron-down" />
        </button>
      </h1>
      <div class="menu-panel" id="artifact-menu" role="menu" aria-label="Artifact actions" hidden>
        <div class="menu-note" role="presentation">
          <Icon name={permanent ? 'infinity' : 'clock'} />
          <span>{retentionLabel(meta.expiresAt, now)}</span>
          <span class="menu-note-type">{meta.language ? `${meta.type} · ${meta.language}` : meta.type}</span>
        </div>
        <hr class="menu-sep" role="separator" />
        <button type="button" role="menuitem" class={item} data-copy="#code">
          <Icon name="copy" class="icon-copy" />
          <Icon name="check" class="icon-check" />
          <span>Copy</span>
        </button>
        <a role="menuitem" class={item} href={`${api}/content?version=${version}&download=1`}>
          <Icon name="download" />
          <span>Download</span>
        </a>
        <a role="menuitem" class={item} href={render} target="_blank" rel="noopener noreferrer">
          <Icon name="external-link" />
          <span>Open in new tab</span>
        </a>
        <hr class="menu-sep" role="separator" />
        <button type="button" role="menuitem" class={item} data-action="rename">
          <Icon name="pencil" />
          <span>Rename…</span>
        </button>
        <a role="menuitem" class={item} href={`/a/${meta.id}/edit`}>
          <Icon name="square-pen" />
          <span>Edit</span>
        </a>
        <hr class="menu-sep" role="separator" />
        <a role="menuitem" class={item} href={`${api}/export?format=md&version=${version}`}>
          <Icon name="file-text" />
          <span>Export as Markdown…</span>
        </a>
        <a role="menuitem" class={item} href={`${api}/export?format=html&version=${version}`}>
          <Icon name="code-xml" />
          <span>Export as HTML…</span>
        </a>
        <button type="button" role="menuitem" class={item} data-print={`/r/${meta.id}?v=${version}&print=1`}>
          <Icon name="printer" />
          <span>Export as PDF…</span>
        </button>
        <hr class="menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          class={item}
          data-method="PUT"
          data-url={`${api}/retention`}
          data-body={JSON.stringify({ permanent: !permanent })}
        >
          <Icon name={permanent ? 'clock' : 'infinity'} />
          <span>{permanent ? 'Set to expire' : 'Make permanent'}</span>
        </button>
        <hr class="menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          class={`${item} menu-item-danger`}
          data-method="DELETE"
          data-url={api}
          data-confirm="Delete this artifact and all its versions?"
          data-done="/"
        >
          <Icon name="trash-2" />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}

function SharePopover({ meta, version }: { meta: ArtifactView; version: number }) {
  const api = `/api/artifacts/${meta.id}`;
  const shared = meta.shareUrl !== null;
  const restricted = meta.shareAudience !== null;
  return (
    <div class="menu-anchor menu-anchor-end">
      <button
        type="button"
        class={shared ? 'button button-compact button-shared' : 'button button-compact'}
        data-menu-button
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="share-popover"
        data-shared={shared ? 'true' : undefined}
        aria-label={shared ? 'Share, shared' : 'Share'}
        title={shared ? 'Shared' : 'Share'}
      >
        <Icon name="share-2" />
        <span class="btn-label">Share</span>
        <span class="share-dot" aria-hidden="true"></span>
      </button>
      <div class="menu-panel popover" id="share-popover" hidden>
        <Tabs label="Share" tabs={[{ id: 'share-link', label: 'Link' }, { id: 'share-export', label: 'Export' }]} />
        <div role="tabpanel" id="panel-share-link" aria-labelledby="tab-share-link" class="popover-body">
          <fieldset class="share-access">
            <legend>Who can view</legend>
            <label class="share-access-option">
              <input type="radio" name="share-access" value="anyone" checked={!restricted} />
              <span>Anyone with the link</span>
            </label>
            <label class="share-access-option">
              <input type="radio" name="share-access" value="restricted" checked={restricted} />
              <span>Only people you list</span>
            </label>
            <div class="share-audience" data-share-audience hidden={!restricted}>
              <label for="share-audience">Emails or @domains</label>
              <textarea id="share-audience" rows={4} placeholder="alice@example.com, @example.com">
                {meta.shareAudience?.join('\n') ?? ''}
              </textarea>
              <p class="popover-note">One per line or comma separated.</p>
            </div>
          </fieldset>
          <div class="actions actions-stack" data-share-new hidden={shared}>
            <p class="popover-text">Share a read-only link.</p>
            <button type="button" class="button button-primary" data-action="share" data-url={`${api}/share`}>
              Create link
            </button>
          </div>
          <div class="actions actions-stack" data-share-active hidden={!shared}>
            <label class="sr-only" for="share-url">
              Share link
            </label>
            <div class="share-link-box">
              <input id="share-url" readonly value={meta.shareUrl ?? ''} />
              <CopyButton target="#share-url" class="button button-sm" iconOnly />
            </div>
            <button type="button" class="button button-primary" data-action="share" data-url={`${api}/share`}>
              Save access
            </button>
            <button type="button" class="button button-danger button-quiet" data-action="unshare" data-url={`${api}/share`}>
              Stop sharing
            </button>
            <p class="popover-note" data-share-note>
              {restricted
                ? 'Only listed people can view, after Google sign-in. A @domain entry needs a Google Workspace account on that domain.'
                : 'Anyone with the link can view the latest version.'}
            </p>
          </div>
        </div>
        <div role="tabpanel" id="panel-share-export" aria-labelledby="tab-share-export" class="popover-body" hidden>
          <div class="export-list">
            <a class="export-row" href={`${api}/export?format=md&version=${version}`}>
              <Icon name="file-text" />
              <span>Markdown</span>
              <span class="export-ext">.md</span>
            </a>
            <a class="export-row" href={`${api}/export?format=html&version=${version}`}>
              <Icon name="code-xml" />
              <span>HTML</span>
              <span class="export-ext">.html</span>
            </a>
            <button type="button" class="export-row" data-print={`/r/${meta.id}?v=${version}&print=1`}>
              <Icon name="printer" />
              <span>PDF</span>
              <span class="export-ext">opens the print dialog</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Viewer({ meta, version, content, now }: { meta: ArtifactView; version: number; content: string; now: Date }) {
  return (
    <>
      <ViewerFrame
        previewSrc={`/r/${meta.id}?v=${version}`}
        content={content}
        bar={
          <>
            <ViewToggle />
            <TitleMenu meta={meta} version={version} now={now} />
            <div class="viewer-bar-end">
              <VersionMenu meta={meta} version={version} />
              <SharePopover meta={meta} version={version} />
            </div>
          </>
        }
      />
      <dialog id="rename-dialog" class="dialog" aria-labelledby="rename-heading">
        <div id="rename-error" class="callout callout-danger" role="alert" aria-live="assertive" hidden>
          <Icon name="circle-alert" size={20} />
          <div class="callout-body" id="rename-error-message"></div>
        </div>
        <form class="form" data-form="rename" data-id={meta.id}>
          <h2 id="rename-heading">Rename artifact</h2>
          <div class="field">
            <label for="rename-title">Title</label>
            <input id="rename-title" name="title" required maxlength={200} autocomplete="off" value={meta.title} />
          </div>
          <div class="actions">
            <button type="submit" class="button button-primary">
              Save
            </button>
            <button type="button" class="button" data-close-dialog>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

interface SharedProps {
  shareId: string;
  meta: ArtifactView;
  content: string;
  signedIn: boolean;
}

export function SharedViewer({ shareId, meta, content, signedIn }: SharedProps) {
  return (
    <ViewerFrame
      previewSrc={`/s/${shareId}/render`}
      content={content}
      bar={
        <>
          <ViewToggle />
          <h1 class="viewer-title viewer-title-plain" title={meta.title}>
            <span class="title-text">{meta.title}</span>
            <TypeTag type={meta.type} language={meta.language} />
          </h1>
          <div class="viewer-bar-end">
            <span class="bar-note" title="Read-only">
              <Icon name="lock" />
              <span>Read-only</span>
            </span>
            <CopyButton target="#code" class="button button-compact button-quiet icon-button-compact" iconOnly />
            <a class="button button-compact button-quiet icon-button-compact" href={`/s/${shareId}/raw?download=1`} aria-label="Download" title="Download">
              <Icon name="download" />
              <span class="btn-label">Download</span>
            </a>
            {signedIn && (
              <button
                type="button"
                class="button button-compact button-primary"
                data-remix={shareId}
                data-title={meta.title}
                data-type={meta.type}
                data-language={meta.language ?? undefined}
                aria-label="Remix"
                title="Remix"
              >
                <Icon name="git-fork" />
                <span class="btn-label">Remix</span>
              </button>
            )}
          </div>
        </>
      }
    />
  );
}

interface SettingsProps {
  tokens: { id: string; name: string; createdAt: string }[];
  apps: { id: string; name: string; createdAt: string }[];
  origin: string;
}

function Snippet({ id, label, children }: { id: string; label: string; children: string }) {
  return (
    <div class="snippet">
      <div class="snippet-bar">
        <span class="snippet-label">{label}</span>
        <CopyButton target={`#${id}`} class="button button-sm" />
      </div>
      <pre class="code" tabindex={0}>
        <code id={id}>{children}</code>
      </pre>
    </div>
  );
}

type SettingsSection = 'general' | 'connect' | 'apps' | 'tokens';

const SETTINGS_NAV: { group: string; items: { id: SettingsSection; label: string; icon: IconName }[] }[] = [
  { group: 'Preferences', items: [{ id: 'general', label: 'General', icon: 'settings' }] },
  {
    group: 'Agents',
    items: [
      { id: 'connect', label: 'Connect an agent', icon: 'plug' },
      { id: 'apps', label: 'Connected apps', icon: 'link' },
      { id: 'tokens', label: 'API tokens', icon: 'key-round' },
    ],
  },
];

// The first section shows without a fragment; app.js switches sections on #general, #connect, … without reloading.
function SettingsNav() {
  return (
    <nav class="settings-nav" aria-label="Settings sections">
      {SETTINGS_NAV.map(({ group, items }) => (
        <>
          <p class="settings-nav-group">{group}</p>
          <ul class="settings-nav-list">
            {items.map((item) => (
              <li>
                <a class="settings-nav-link" href={`#${item.id}`} aria-current={item.id === 'general' ? 'true' : undefined}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ))}
    </nav>
  );
}

function SettingsPanel({ id, title, intro, children }: { id: SettingsSection; title: string; intro?: Child; children?: Child }) {
  return (
    <section class="settings-panel" data-settings-panel={id} aria-labelledby={`${id}-heading`} hidden={id !== 'general'}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {intro && <p class="settings-intro">{intro}</p>}
      {children}
    </section>
  );
}

// A grid so the control stays beside its label on narrow screens while the hint moves under both.
function SettingsRow({ label, hint, children }: { label: Child; hint?: { id: string; text: string }; children: Child }) {
  return (
    <div class="settings-row">
      <div class="settings-row-label">{label}</div>
      {hint && (
        <p class="settings-row-hint" id={hint.id}>
          {hint.text}
        </p>
      )}
      <div class="settings-row-control">{children}</div>
    </div>
  );
}

function QuietSelect({ id, hint, children }: { id: string; hint: string; children: Child }) {
  return (
    <span class="select-quiet">
      <select id={id} name={id} aria-describedby={hint}>
        {children}
      </select>
      <Icon name="chevron-down" />
    </span>
  );
}

const READING_FONT_LABELS: Record<ReadingFont, string> = { serif: 'Serif', sans: 'Sans', mono: 'Mono' };

// Theme and reading choices are stored in this browser; app.js sends them to every artifact frame.
function GeneralPanel() {
  return (
    <SettingsPanel id="general" title="Appearance" intro="Saved in this browser.">
      <div class="settings-rows">
        <SettingsRow label={<span id="theme-label">Theme</span>}>
          <div class="segmented segmented-radios" role="radiogroup" aria-labelledby="theme-label">
            {THEME_CHOICES.map((choice) => (
              <label class="segmented-option" title={choice.label}>
                <input class="sr-only" type="radio" name="theme" value={choice.id} checked={choice.id === 'system'} />
                <Icon name={choice.icon} />
                <span class="sr-only">{choice.label}</span>
              </label>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          label={<label for="reading-font">Reading font</label>}
          hint={{ id: 'reading-font-hint', text: 'Markdown, slides, react, and html that uses the theme font.' }}
        >
          <QuietSelect id="reading-font" hint="reading-font-hint">
            {(Object.keys(READING_FONTS) as ReadingFont[]).map((font) => (
              <option value={font} selected={font === 'serif'} data-stack={READING_FONTS[font]}>
                {READING_FONT_LABELS[font]}
              </option>
            ))}
          </QuietSelect>
        </SettingsRow>
        <SettingsRow
          label={<label for="reading-size">Text size</label>}
          hint={{ id: 'reading-size-hint', text: 'Markdown, react, and html that uses the theme size. Slides keep their size.' }}
        >
          <QuietSelect id="reading-size" hint="reading-size-hint">
            {READING_SIZES.map((size) => (
              <option value={String(size)} selected={size === DEFAULT_READING_SIZE}>
                {size === DEFAULT_READING_SIZE ? `Default · ${size} px` : `${size} px`}
              </option>
            ))}
          </QuietSelect>
        </SettingsRow>
      </div>
    </SettingsPanel>
  );
}

export function Settings({ tokens, apps, origin }: SettingsProps) {
  const command = `claude mcp add --transport http artifacts ${origin}/mcp --header "Authorization: Bearer <YOUR_TOKEN>"`;
  const json = `{ "mcpServers": { "artifacts": { "type": "http", "url": "${origin}/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }`;
  const oauthCommand = `claude mcp add --transport http artifacts ${origin}/mcp`;
  return (
    <div class="settings">
      <div class="settings-head">
        <h1>Settings</h1>
      </div>
      <SettingsNav />
      <div class="settings-content">
        <GeneralPanel />
        <SettingsPanel id="connect" title="Connect an agent" intro="Agents reach Artifacts over MCP. Sign in with Google, or send an API token in the Authorization header.">
          <Tabs
            label="Connection method"
            tabs={[
              { id: 'claude-ai', label: 'Claude.ai & Desktop' },
              { id: 'claude-code', label: 'Claude Code' },
              { id: 'token', label: 'API token' },
              { id: 'json', label: 'JSON' },
            ]}
          />
          <div role="tabpanel" id="panel-claude-ai" aria-labelledby="tab-claude-ai" class="tab-panel">
            <Snippet id="mcp-url" label="Connector URL">{`${origin}/mcp`}</Snippet>
            <p class="help">Add it as a custom connector and sign in with Google when asked.</p>
          </div>
          <div role="tabpanel" id="panel-claude-code" aria-labelledby="tab-claude-code" class="tab-panel" hidden>
            <Snippet id="mcp-oauth-command" label="Shell">{oauthCommand}</Snippet>
            <p class="help">
              Run it, then type <code>/mcp</code> in Claude Code and choose artifacts to sign in.
            </p>
          </div>
          <div role="tabpanel" id="panel-token" aria-labelledby="tab-token" class="tab-panel" hidden>
            <Snippet id="mcp-command" label="Shell">{command}</Snippet>
            <p class="help">
              Replace &lt;YOUR_TOKEN&gt; with a token from <a href="#tokens">API tokens</a>.
            </p>
          </div>
          <div role="tabpanel" id="panel-json" aria-labelledby="tab-json" class="tab-panel" hidden>
            <Snippet id="mcp-json" label="JSON">{json}</Snippet>
            <p class="help">Paste it into your MCP client configuration and replace &lt;YOUR_TOKEN&gt;.</p>
          </div>
        </SettingsPanel>
        <SettingsPanel id="apps" title="Connected apps" intro="Apps you allowed to use your artifacts by signing in over MCP. Revoking stops them.">
          <ul class="items" id="app-list">
            {apps.map((app) => (
              <li class="item">
                <Initial name={app.name} />
                <div class="item-main">
                  <span class="item-title">{app.name}</span>
                  <span class="item-meta">
                    Connected <time datetime={app.createdAt}>{formatDate(app.createdAt)}</time>
                  </span>
                </div>
                <ApiButton method="DELETE" url={`/api/grants/${app.id}`} label="Revoke" confirm={`Revoke access for "${app.name}"?`} danger />
              </li>
            ))}
          </ul>
          {apps.length === 0 && <p class="empty-text">No connected apps.</p>}
        </SettingsPanel>
        <SettingsPanel id="tokens" title="API tokens" intro="Tokens let agents call the MCP server and REST API as you.">
          <form class="form form-inline" method="post" data-form="token">
            <div class="field">
              <label for="token-name">Token name</label>
              <input id="token-name" name="name" required maxlength={100} autocomplete="off" />
            </div>
            <button type="submit" class="button button-primary">
              Create token
            </button>
          </form>
          <div id="new-token" class="callout callout-success" hidden>
            <Icon name="shield-check" size={20} />
            <div class="callout-body">
              <label for="new-token-value">New token</label>
              <div class="inline-field">
                <input id="new-token-value" class="mono-input" readonly />
                <CopyButton target="#new-token-value" />
              </div>
              <p>Copy it now: you will not see it again.</p>
            </div>
          </div>
          <ul class="items" id="token-list">
            {tokens.map((token) => (
              <li class="item">
                <div class="item-main">
                  <span class="item-title">{token.name}</span>
                  <span class="item-meta">
                    Created <time datetime={token.createdAt}>{formatDate(token.createdAt)}</time>
                  </span>
                </div>
                <ApiButton method="DELETE" url={`/api/tokens/${token.id}`} label="Revoke" confirm={`Revoke token "${token.name}"?`} danger />
              </li>
            ))}
          </ul>
          <p class="empty-text" id="no-tokens" hidden={tokens.length > 0}>
            No tokens yet.
          </p>
        </SettingsPanel>
      </div>
    </div>
  );
}
