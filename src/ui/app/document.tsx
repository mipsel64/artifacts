import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { renderToString } from 'react-dom/server';
import type { AppEnv } from '../../types';
import { setPageHeaders } from '../headers';
import { App } from './App';
import type { PageName, PageProps } from './pages';
import type { ShellProps } from './Shell';
import type { ThemeMode } from './mode';

export type { ShellProps } from './Shell';

interface RenderOptions {
  title: string;
  shell: ShellProps;
  status?: ContentfulStatusCode;
  formAction?: string;
}

function escapeTitle(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderPage<N extends PageName>(
  c: Context<AppEnv>,
  page: N,
  props: PageProps<N>,
  opts: RenderOptions,
): Response {
  setPageHeaders(c, opts.formAction);
  const cookie = getCookie(c, 'theme');
  const mode: ThemeMode = cookie === 'light' || cookie === 'dark' ? cookie : 'system';
  const data = { page, props, shell: opts.shell, mode };
  const root = renderToString(<App {...data} />);
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeTitle(opts.title)} · Artifacts</title><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/static/build/app.css"><script type="module" src="/static/build/client.js"></script></head><body><div id="root">${root}</div><script type="application/json" id="page-data">${json}</script></body></html>`, opts.status);
}
