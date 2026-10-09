import { Hono } from 'hono';
import { ArtifactError, sweepExpired } from './artifacts';
import auth from './routes/auth';
import api from './routes/api';
import mcp from './routes/mcp';
import render from './routes/render';
import ui from './routes/ui';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.route('/', auth);
app.route('/', api);
app.route('/', mcp);
app.route('/', render);
app.route('/', ui);

app.onError((err, c) => {
  const isJson = c.req.path.startsWith('/api') || c.req.path.startsWith('/mcp');
  if (err instanceof ArtifactError) {
    return isJson ? c.json({ error: err.message }, err.status) : c.text(err.message, err.status);
  }
  console.error(err);
  return isJson ? c.json({ error: 'Internal Server Error' }, 500) : c.text('Internal Server Error', 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepExpired(env));
  },
} satisfies ExportedHandler<Env>;
