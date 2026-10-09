import { html } from 'hono/html';
import type { Child } from 'hono/jsx';

export interface Identity {
  login: string;
  avatarUrl: string | null;
}

interface LayoutProps {
  title: string;
  me: Identity | null;
  fill?: boolean;
  children?: Child;
}

export function Layout({ title, me, fill, children }: LayoutProps) {
  return (
    <>
      {html`<!doctype html>`}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title} · Artifacts</title>
          <link rel="stylesheet" href="/static/app.css" />
          <script type="module" src="/static/app.js"></script>
        </head>
        <body>
          <header class="site-header">
            <a class="brand" href="/">
              Artifacts
            </a>
            {me && (
              <nav class="site-nav" aria-label="Main">
                <a href="/">Artifacts</a>
                <a href="/new">New</a>
                <a href="/settings">Settings</a>
                <span class="user">
                  {me.avatarUrl && <img class="avatar" src={me.avatarUrl} alt="" width="24" height="24" />}
                  <span>{me.login}</span>
                </span>
                <form method="post" action="/auth/logout">
                  <button type="submit" class="button button-quiet">
                    Sign out
                  </button>
                </form>
              </nav>
            )}
          </header>
          <div id="error" class="alert" role="alert" hidden></div>
          <main class={fill ? 'main main-fill' : 'main'}>{children}</main>
        </body>
      </html>
    </>
  );
}
