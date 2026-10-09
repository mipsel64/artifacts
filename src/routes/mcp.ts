import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  ArtifactError,
  createArtifact,
  deleteArtifact,
  getArtifact,
  getContent,
  listArtifacts,
  setRetention,
  shareArtifact,
  toView,
  unshareArtifact,
  updateArtifact,
} from '../artifacts';
import { isAllowed, verifyApiToken } from '../auth';
import { ARTIFACT_TYPES, type AppEnv } from '../types';

const INSTRUCTIONS =
  'Store and share rendered artifacts (HTML pages, React components, SVG, Mermaid diagrams, Markdown, code). ' +
  'Create an artifact to get a URL the user can open; share_artifact makes a public link. ' +
  'Artifacts expire 30 days after their last change unless made permanent with set_artifact_retention. ' +
  'Every content update creates a new version; use update_artifact to revise an artifact instead of creating a new one.';

const TYPE_DESCRIPTION =
  'How the content is rendered. ' +
  'html: a full standalone HTML document (scripts allowed; runs in a sandbox with no access to the app). ' +
  'react: one self-contained React component file (JSX/TSX) with a default export; Tailwind CSS classes are available and npm packages can be imported by name (loaded from esm.sh). ' +
  'svg: SVG markup. ' +
  'mermaid: Mermaid diagram source. ' +
  'markdown: a Markdown document. ' +
  'code: source code shown with syntax highlighting; set language.';

const id = z.string().describe('Artifact id, as returned by list_artifacts or create_artifact.');

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: true };

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

async function run(operation: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return json(await operation());
  } catch (err) {
    if (err instanceof ArtifactError) return { isError: true, content: [{ type: 'text', text: err.message }] };
    throw err;
  }
}

function buildServer(env: Env, ownerId: string, origin: string): McpServer {
  const server = new McpServer({ name: 'artifacts', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'list_artifacts',
    {
      title: 'List artifacts',
      description:
        'List your artifacts that have not expired, newest first. Returns summaries (id, title, type, version, updatedAt, expiresAt, shared) with the viewer url. Use get_artifact to read the content.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => ({
        items: (await listArtifacts(env, ownerId)).map((item) => ({ ...item, url: `${origin}/a/${item.id}` })),
      })),
  );

  server.registerTool(
    'get_artifact',
    {
      title: 'Get artifact',
      description:
        'Read an artifact: its metadata, viewer url, share url (if shared) and the full content of the latest version, or of a specific older version.',
      inputSchema: {
        id,
        version: z.number().int().positive().optional().describe('Version number to read. Defaults to the latest version.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ id, version }) =>
      run(async () => {
        const meta = await getArtifact(env, ownerId, id);
        return { ...toView(meta, origin), content: await getContent(env, meta, version) };
      }),
  );

  server.registerTool(
    'create_artifact',
    {
      title: 'Create artifact',
      description:
        'Create a new artifact (version 1) and return it with its viewer url, which you can give to the user. It expires after 30 days unless made permanent with set_artifact_retention.',
      inputSchema: {
        title: z.string().describe('Short title, 1 to 200 characters.'),
        type: z.enum(ARTIFACT_TYPES).describe(TYPE_DESCRIPTION),
        content: z.string().describe('The full artifact source, non-empty, at most 1 MiB.'),
        language: z
          .string()
          .optional()
          .describe('Programming language for syntax highlighting, e.g. "python". Only used when type is "code".'),
      },
    },
    (args) => run(async () => toView(await createArtifact(env, ownerId, args), origin)),
  );

  server.registerTool(
    'update_artifact',
    {
      title: 'Update artifact',
      description:
        'Change an artifact. For small edits pass old_str and new_str: old_str must match the latest content exactly once (include enough surrounding text to be unique) and is replaced by new_str. To rewrite everything pass content instead. Do not combine content with old_str/new_str. Each content change creates a new version and resets the 30-day retention unless the artifact is permanent. Passing only title renames without creating a version.',
      inputSchema: {
        id,
        title: z.string().optional().describe('New title, 1 to 200 characters.'),
        content: z.string().optional().describe('Complete new content that replaces the latest version.'),
        old_str: z.string().optional().describe('Exact text to replace; must occur exactly once in the latest content.'),
        new_str: z.string().optional().describe('Replacement for old_str. May be empty to delete the matched text.'),
      },
    },
    ({ id, title, content, old_str, new_str }) =>
      run(async () => toView(await updateArtifact(env, ownerId, id, { title, content, oldStr: old_str, newStr: new_str }), origin)),
  );

  server.registerTool(
    'delete_artifact',
    {
      title: 'Delete artifact',
      description: 'Permanently delete an artifact, all its versions and its share link. This cannot be undone.',
      inputSchema: { id },
      annotations: { destructiveHint: true },
    },
    ({ id }) =>
      run(async () => {
        await deleteArtifact(env, ownerId, id);
        return { deleted: id };
      }),
  );

  server.registerTool(
    'set_artifact_retention',
    {
      title: 'Set artifact retention',
      description:
        'Make an artifact permanent (permanent: true, never expires) or let it expire again (permanent: false, expires 30 days from now).',
      inputSchema: { id, permanent: z.boolean().describe('true keeps the artifact forever; false restores the 30-day expiry.') },
    },
    ({ id, permanent }) => run(async () => toView(await setRetention(env, ownerId, id, permanent), origin)),
  );

  server.registerTool(
    'share_artifact',
    {
      title: 'Share artifact',
      description:
        'Create a public read-only link (shareUrl) that anyone can open without signing in. Idempotent: an already shared artifact keeps its link.',
      inputSchema: { id },
    },
    ({ id }) => run(async () => toView(await shareArtifact(env, ownerId, id), origin)),
  );

  server.registerTool(
    'unshare_artifact',
    {
      title: 'Unshare artifact',
      description: 'Revoke the public share link of an artifact. The old link stops working immediately.',
      inputSchema: { id },
    },
    ({ id }) => run(async () => toView(await unshareArtifact(env, ownerId, id), origin)),
  );

  return server;
}

const unauthorized = () =>
  Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });

const routes = new Hono<AppEnv>();

routes.post('/mcp', async (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
  const user = match && (await verifyApiToken(c.env, match[1]));
  if (!user || !isAllowed(c.env, user.email)) return unauthorized();

  const server = buildServer(c.env, user.id, new URL(c.req.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

routes.on(['GET', 'DELETE'], '/mcp', (c) => c.body(null, 405, { Allow: 'POST' }));

export default routes;
