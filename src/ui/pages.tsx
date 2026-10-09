import { ARTIFACT_TYPES, type ArtifactSummary, type ArtifactView } from '../types';
import { formatDate, retentionLabel } from './format';

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

export function Landing() {
  return (
    <section class="hero">
      <h1>Artifacts</h1>
      <p class="lead">Create, version and share the HTML, React, SVG, Mermaid, Markdown and code your agents write.</p>
      <a class="button button-primary" href="/auth/login">
        Sign in with Google
      </a>
    </section>
  );
}

export function ArtifactList({ items, now }: { items: ArtifactSummary[]; now: Date }) {
  return (
    <>
      <div class="page-head">
        <h1>Artifacts</h1>
        <a class="button button-primary" href="/new">
          New artifact
        </a>
      </div>
      {items.length === 0 ? (
        <p class="empty">
          No artifacts yet. <a href="/new">Create one</a>, or connect an agent over MCP in <a href="/settings">Settings</a>.
        </p>
      ) : (
        <ul class="list">
          {items.map((item) => (
            <li class="row">
              <a class="row-title" href={`/a/${item.id}`}>
                {item.title}
              </a>
              <span class="badge">{item.type}</span>
              <span class="muted">v{item.version}</span>
              <time class="muted" datetime={item.updatedAt}>
                {formatDate(item.updatedAt)}
              </time>
              <span class="badge">{retentionLabel(item.expiresAt, now)}</span>
              {item.shared && <span class="badge badge-accent">Shared</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function NewArtifact() {
  return (
    <form class="form" method="post" data-form="new">
      <h1>New artifact</h1>
      <div class="field">
        <label for="title">Title</label>
        <input id="title" name="title" required maxlength={200} autocomplete="off" />
      </div>
      <div class="field">
        <label for="type">Type</label>
        <select id="type" name="type">
          {ARTIFACT_TYPES.map((type) => (
            <option value={type}>{type}</option>
          ))}
        </select>
      </div>
      <div class="field" id="language-field" hidden>
        <label for="language">Language</label>
        <input id="language" name="language" maxlength={32} placeholder="e.g. python" autocomplete="off" />
      </div>
      <div class="field">
        <label for="content">Content</label>
        <textarea id="content" name="content" class="editor" required rows={18} spellcheck={false}></textarea>
      </div>
      <button type="submit" class="button button-primary">
        Create
      </button>
    </form>
  );
}

export function EditArtifact({ meta, content }: { meta: ArtifactView; content: string }) {
  return (
    <form class="form" method="post" data-form="edit" data-id={meta.id}>
      <h1>Edit artifact</h1>
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
  );
}

function Tabs({ previewSrc, content }: { previewSrc: string; content: string }) {
  return (
    <>
      <div role="tablist" aria-label="Artifact view" class="tabs">
        <button type="button" role="tab" id="tab-preview" aria-controls="panel-preview" aria-selected="true" tabindex={0} class="tab">
          Preview
        </button>
        <button type="button" role="tab" id="tab-code" aria-controls="panel-code" aria-selected="false" tabindex={-1} class="tab">
          Code
        </button>
      </div>
      <div role="tabpanel" id="panel-preview" aria-labelledby="tab-preview" class="panel panel-preview">
        <iframe src={previewSrc} sandbox={SANDBOX} title="Artifact preview" class="preview"></iframe>
      </div>
      <div role="tabpanel" id="panel-code" aria-labelledby="tab-code" class="panel panel-code" hidden>
        <pre class="code" tabindex={0}>
          <code id="code">{content}</code>
        </pre>
      </div>
    </>
  );
}

function CopyButton({ target, label = 'Copy' }: { target: string; label?: string }) {
  return (
    <button type="button" class="button" data-copy={target}>
      {label}
    </button>
  );
}

function Title({ meta }: { meta: ArtifactView }) {
  return (
    <div class="viewer-title">
      <h1>{meta.title}</h1>
      <span class="badge">{meta.type}</span>
      {meta.language && <span class="badge">{meta.language}</span>}
    </div>
  );
}

function Versions({ meta, version }: { meta: ArtifactView; version: number }) {
  const href = (n: number) => `/a/${meta.id}?v=${n}`;
  return (
    <nav class="versions" aria-label="Versions">
      {version > 1 ? (
        <a class="button" href={href(version - 1)} rel="prev" aria-label="Previous version">
          ←
        </a>
      ) : (
        <span class="button button-disabled" aria-disabled="true" aria-label="Previous version">
          ←
        </span>
      )}
      <details class="version-list">
        <summary class="button">
          v{version} of {meta.version}
        </summary>
        <ul>
          {[...meta.versions].reverse().map((info) => (
            <li>
              <a href={href(info.version)} aria-current={info.version === version ? 'page' : undefined}>
                v{info.version} · {formatDate(info.createdAt)}
              </a>
            </li>
          ))}
        </ul>
      </details>
      {version < meta.version ? (
        <a class="button" href={href(version + 1)} rel="next" aria-label="Next version">
          →
        </a>
      ) : (
        <span class="button button-disabled" aria-disabled="true" aria-label="Next version">
          →
        </span>
      )}
    </nav>
  );
}

function ApiButton(props: {
  method: string;
  url: string;
  label: string;
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
      {props.label}
    </button>
  );
}

export function Viewer({ meta, version, content, now }: { meta: ArtifactView; version: number; content: string; now: Date }) {
  const render = `/render/${meta.id}?v=${version}`;
  const api = `/api/artifacts/${meta.id}`;
  const permanent = meta.expiresAt === null;
  return (
    <>
      <div class="viewer-head">
        <Title meta={meta} />
        <Versions meta={meta} version={version} />
      </div>
      <div class="actions">
        <CopyButton target="#code" />
        <a class="button" href={`${api}/content?version=${version}&download=1`}>
          Download
        </a>
        <a class="button" href={render} target="_blank" rel="noopener noreferrer">
          Open in new tab
        </a>
        <a class="button" href={`/a/${meta.id}/edit`}>
          Edit
        </a>
        <span class="badge">{retentionLabel(meta.expiresAt, now)}</span>
        <ApiButton
          method="PUT"
          url={`${api}/retention`}
          body={JSON.stringify({ permanent: !permanent })}
          label={permanent ? 'Set to expire' : 'Make permanent'}
        />
        {meta.shareUrl ? (
          <>
            <label class="sr-only" for="share-url">
              Share link
            </label>
            <input id="share-url" class="share-url" readonly value={meta.shareUrl} />
            <CopyButton target="#share-url" label="Copy link" />
            <ApiButton method="DELETE" url={`${api}/share`} label="Stop sharing" />
          </>
        ) : (
          <ApiButton method="POST" url={`${api}/share`} label="Share" />
        )}
        <ApiButton method="DELETE" url={api} label="Delete" confirm="Delete this artifact and all its versions?" done="/" danger />
      </div>
      <div class="stage">
        <Tabs previewSrc={render} content={content} />
      </div>
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
        <Title meta={meta} />
      </div>
      <div class="actions">
        <CopyButton target="#code" />
        <a class="button" href={`/s/${shareId}/raw?download=1`}>
          Download
        </a>
        {signedIn && (
          <button
            type="button"
            class="button button-primary"
            data-remix={shareId}
            data-title={meta.title}
            data-type={meta.type}
            data-language={meta.language ?? undefined}
          >
            Remix
          </button>
        )}
      </div>
      <div class="stage">
        <Tabs previewSrc={`/s/${shareId}/render`} content={content} />
      </div>
    </>
  );
}

interface SettingsProps {
  tokens: { id: string; name: string; createdAt: string }[];
  origin: string;
}

export function Settings({ tokens, origin }: SettingsProps) {
  const command = `claude mcp add --transport http artifacts ${origin}/mcp --header "Authorization: Bearer <YOUR_TOKEN>"`;
  const json = `{ "mcpServers": { "artifacts": { "type": "http", "url": "${origin}/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }`;
  return (
    <>
      <h1>Settings</h1>
      <section class="section" aria-labelledby="tokens-heading">
        <h2 id="tokens-heading">API tokens</h2>
        <p class="muted">Tokens let agents call the MCP server and REST API as you.</p>
        <ul class="list" id="token-list">
          {tokens.map((token) => (
            <li class="row">
              <span class="row-title">{token.name}</span>
              <time class="muted" datetime={token.createdAt}>
                Created {formatDate(token.createdAt)}
              </time>
              <ApiButton method="DELETE" url={`/api/tokens/${token.id}`} label="Revoke" confirm={`Revoke token "${token.name}"?`} danger />
            </li>
          ))}
        </ul>
        <p class="empty" id="no-tokens" hidden={tokens.length > 0}>
          No tokens yet.
        </p>
        <form class="form form-inline" method="post" data-form="token">
          <div class="field">
            <label for="token-name">Token name</label>
            <input id="token-name" name="name" required maxlength={100} autocomplete="off" />
          </div>
          <button type="submit" class="button button-primary">
            Create token
          </button>
        </form>
        <div id="new-token" class="notice" hidden>
          <label for="new-token-value">New token</label>
          <div class="actions">
            <input id="new-token-value" class="share-url" readonly />
            <CopyButton target="#new-token-value" />
          </div>
          <p>Copy it now: you will not see it again.</p>
        </div>
      </section>
      <section class="section" aria-labelledby="mcp-heading">
        <h2 id="mcp-heading">Connect an agent (MCP)</h2>
        <p class="muted">Replace &lt;YOUR_TOKEN&gt; with a token from above.</p>
        <h3>Claude Code</h3>
        <pre class="code" tabindex={0}>
          <code id="mcp-command">{command}</code>
        </pre>
        <CopyButton target="#mcp-command" />
        <h3>JSON config</h3>
        <pre class="code" tabindex={0}>
          <code id="mcp-json">{json}</code>
        </pre>
        <CopyButton target="#mcp-json" />
      </section>
    </>
  );
}
