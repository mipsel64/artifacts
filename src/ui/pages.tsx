import type { Child } from 'hono/jsx';
import { ARTIFACT_TYPES, type ArtifactSummary, type ArtifactType, type ArtifactView } from '../types';
import { Initial } from './components';
import { formatDate, retentionLabel } from './format';
import { GoogleMark, Icon, Logo, TypeIcon, type IconName } from './icons';

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
      <p class="lead">Create, version and share the HTML, React, SVG, Mermaid, Markdown and code your agents write.</p>
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

function TypeTile({ type }: { type: ArtifactType }) {
  return (
    <span class="type-tile" title={type}>
      <TypeIcon type={type} size={20} />
      <span class="sr-only">{type}</span>
    </span>
  );
}

function TypeChip({ type, language }: { type: ArtifactType; language?: string | null }) {
  return (
    <span class="chip chip-type">
      <TypeIcon type={type} size={14} />
      <span>{type}</span>
      {language && <span class="chip-detail">{language}</span>}
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
        <a class="button button-primary" href="/new">
          <Icon name="plus" />
          <span>New artifact</span>
        </a>
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
                  <span class="row-title">{item.title}</span>
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

function Tabs({ tabs, label }: { tabs: { id: string; label: string; icon?: IconName }[]; label: string }) {
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
          {tab.icon && <Icon name={tab.icon} />}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

interface CopyButtonProps {
  target: string;
  label?: string;
  compact?: boolean;
  class?: string;
}

// With `compact` the label is hidden on narrow screens, so the button carries an aria-label and a title.
function CopyButton({ target, label = 'Copy', compact, class: className = 'button' }: CopyButtonProps) {
  return (
    <button
      type="button"
      class={className}
      data-copy={target}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      <Icon name="copy" class="icon-copy" />
      <Icon name="check" class="icon-check" />
      <span class={compact ? 'btn-label' : undefined}>{label}</span>
    </button>
  );
}

function ToolLink({ href, label, icon, external }: { href: string; label: string; icon: IconName; external?: boolean }) {
  return (
    <a class="button" href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} aria-label={label} title={label}>
      <Icon name={icon} />
      <span class="btn-label">{label}</span>
    </a>
  );
}

function ViewerPanel({ previewSrc, content, tools }: { previewSrc: string; content: string; tools?: Child }) {
  return (
    <section class="panel stage" aria-label="Artifact">
      <div class="panel-bar">
        <Tabs
          label="Artifact view"
          tabs={[
            { id: 'preview', label: 'Preview', icon: 'eye' },
            { id: 'code', label: 'Code', icon: 'code-xml' },
          ]}
        />
        {tools && <div class="tools">{tools}</div>}
      </div>
      <div role="tabpanel" id="panel-preview" aria-labelledby="tab-preview" class="panel-body panel-preview">
        <iframe src={previewSrc} sandbox={SANDBOX} title="Artifact preview" class="preview"></iframe>
      </div>
      <div role="tabpanel" id="panel-code" aria-labelledby="tab-code" class="panel-body panel-code" hidden>
        <pre class="code" tabindex={0}>
          <code id="code">{content}</code>
        </pre>
      </div>
    </section>
  );
}

function ViewerTitle({ meta, children }: { meta: ArtifactView; children?: Child }) {
  return (
    <div class="viewer-title">
      <h1>{meta.title}</h1>
      <div class="chips">
        <TypeChip type={meta.type} language={meta.language} />
        {children}
      </div>
    </div>
  );
}

function Versions({ meta, version }: { meta: ArtifactView; version: number }) {
  const href = (n: number) => `/a/${meta.id}?v=${n}`;
  return (
    <nav class="versions" aria-label="Versions">
      {version > 1 ? (
        <a class="button button-icon" href={href(version - 1)} rel="prev" aria-label="Previous version" title="Previous version">
          <Icon name="chevron-left" />
        </a>
      ) : (
        <button type="button" class="button button-icon" disabled aria-label="Previous version" title="Previous version">
          <Icon name="chevron-left" />
        </button>
      )}
      <details class="version-menu">
        <summary class="button">
          <span>
            v{version} of {meta.version}
          </span>
          <Icon name="chevron-down" />
        </summary>
        <ul class="menu">
          {[...meta.versions].reverse().map((info) => (
            <li>
              <a href={href(info.version)} aria-current={info.version === version ? 'page' : undefined}>
                <span>
                  v{info.version} · {formatDate(info.createdAt)}
                </span>
                <Icon name="check" />
              </a>
            </li>
          ))}
        </ul>
      </details>
      {version < meta.version ? (
        <a class="button button-icon" href={href(version + 1)} rel="next" aria-label="Next version" title="Next version">
          <Icon name="chevron-right" />
        </a>
      ) : (
        <button type="button" class="button button-icon" disabled aria-label="Next version" title="Next version">
          <Icon name="chevron-right" />
        </button>
      )}
    </nav>
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

function SideSection({ id, title, children }: { id: string; title: string; children?: Child }) {
  return (
    <section class="side-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function TitleMenu({ meta, version }: { meta: ArtifactView; version: number }) {
  const render = `/render/${meta.id}?v=${version}`;
  const api = `/api/artifacts/${meta.id}`;
  const permanent = meta.expiresAt === null;
  const item = 'menu-item';
  return (
    <div class="menu-anchor">
      <h1>
        <button type="button" class="title-button" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="artifact-menu">
          <span class="title-text">{meta.title}</span>
          <Icon name="chevron-down" />
        </button>
      </h1>
      <div class="menu-panel" id="artifact-menu" role="menu" aria-label="Artifact actions" hidden>
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
        <button type="button" role="menuitem" class={item} data-print={`/render/${meta.id}?v=${version}&print=1`}>
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
  return (
    <div class="menu-anchor menu-anchor-end">
      <button
        type="button"
        class={shared ? 'button button-shared' : 'button'}
        data-menu-button
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls="share-popover"
        data-shared={shared ? 'true' : undefined}
      >
        <Icon name="share-2" />
        <span class="btn-label">Share</span>
      </button>
      <div class="menu-panel popover" id="share-popover" hidden>
        <Tabs label="Share" tabs={[{ id: 'share-link', label: 'Link' }, { id: 'share-export', label: 'Export' }]} />
        <div role="tabpanel" id="panel-share-link" aria-labelledby="tab-share-link" class="popover-body">
          <div class="actions actions-stack" data-share-new hidden={shared}>
            <p class="popover-text">Share a read-only public link.</p>
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
              <CopyButton target="#share-url" class="button button-sm" compact />
            </div>
            <button type="button" class="button button-danger button-quiet" data-action="unshare" data-url={`${api}/share`}>
              Stop sharing
            </button>
            <p class="popover-note">Anyone with the link can view the latest version.</p>
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
            <button type="button" class="export-row" data-print={`/render/${meta.id}?v=${version}&print=1`}>
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
  const render = `/render/${meta.id}?v=${version}`;
  return (
    <>
      <div class="viewer-head">
        <div class="viewer-title">
          <TitleMenu meta={meta} version={version} />
          <div class="chips">
            <TypeChip type={meta.type} language={meta.language} />
            <Versions meta={meta} version={version} />
          </div>
        </div>
        <div class="viewer-actions">
          <SharePopover meta={meta} version={version} />
        </div>
      </div>
      <div class="viewer-body">
        <ViewerPanel previewSrc={render} content={content} />
        <aside class="side" aria-label="Artifact details">
          <SideSection id="versions-heading" title="Versions">
            <ol class="version-history">
              {[...meta.versions].reverse().map((info) => (
                <li>
                  <a href={`/a/${meta.id}?v=${info.version}`} aria-current={info.version === version ? 'page' : undefined}>
                    <span class="mono">v{info.version}</span>
                    <span class="muted">{formatDate(info.createdAt)}</span>
                    {info.version === version && <span class="chip chip-accent">Viewing</span>}
                  </a>
                </li>
              ))}
            </ol>
          </SideSection>
          <SideSection id="retention-heading" title="Retention">
            <p class="side-text">
              <Icon name={meta.expiresAt === null ? 'infinity' : 'clock'} /> {retentionLabel(meta.expiresAt, now)}
            </p>
          </SideSection>
        </aside>
      </div>
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
    <>
      <div class="viewer-head">
        <ViewerTitle meta={meta}>
          <span class="chip">
            <Icon name="eye" size={14} />
            <span>Shared artifact · read-only</span>
          </span>
        </ViewerTitle>
      </div>
      <div class="viewer-body viewer-body-single">
        <ViewerPanel
          previewSrc={`/s/${shareId}/render`}
          content={content}
          tools={
            <>
              <CopyButton target="#code" compact />
              <ToolLink href={`/s/${shareId}/raw?download=1`} label="Download" icon="download" />
              {signedIn && (
                <button
                  type="button"
                  class="button button-primary"
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
            </>
          }
        />
      </div>
    </>
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

function SettingsCard({ id, title, intro, children }: { id: string; title: string; intro: string; children?: Child }) {
  return (
    <section class="card settings-card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p class="muted">{intro}</p>
      {children}
    </section>
  );
}

export function Settings({ tokens, apps, origin }: SettingsProps) {
  const command = `claude mcp add --transport http artifacts ${origin}/mcp --header "Authorization: Bearer <YOUR_TOKEN>"`;
  const json = `{ "mcpServers": { "artifacts": { "type": "http", "url": "${origin}/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }`;
  const oauthCommand = `claude mcp add --transport http artifacts ${origin}/mcp`;
  return (
    <>
      <h1 class="page-title">Settings</h1>
      <SettingsCard
        id="mcp-heading"
        title="Connect an agent"
        intro="Agents reach Artifacts over MCP. Sign in with Google, or send an API token in the Authorization header."
      >
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
          <p class="help">Replace &lt;YOUR_TOKEN&gt; with a token from API tokens below.</p>
        </div>
        <div role="tabpanel" id="panel-json" aria-labelledby="tab-json" class="tab-panel" hidden>
          <Snippet id="mcp-json" label="JSON">{json}</Snippet>
          <p class="help">Paste it into your MCP client configuration and replace &lt;YOUR_TOKEN&gt;.</p>
        </div>
      </SettingsCard>
      <SettingsCard id="apps-heading" title="Connected apps" intro="Apps you allowed to use your artifacts by signing in over MCP. Revoking stops them.">
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
      </SettingsCard>
      <SettingsCard id="tokens-heading" title="API tokens" intro="Tokens let agents call the MCP server and REST API as you.">
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
      </SettingsCard>
    </>
  );
}
