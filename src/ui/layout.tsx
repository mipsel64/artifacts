import { html } from 'hono/html';
import type { Child } from 'hono/jsx';
import { Initial } from './components';
import { Icon, Logo } from './icons';

export interface Identity {
  email: string;
  avatarUrl: string | null;
}

export type NavItem = 'artifacts' | 'new' | 'settings';

interface LayoutProps {
  title: string;
  me: Identity | null;
  active?: NavItem;
  fill?: boolean;
  width?: 'medium' | 'narrow';
  children?: Child;
}

const NAV: { id: NavItem; href: string; label: string }[] = [
  { id: 'artifacts', href: '/', label: 'Artifacts' },
  { id: 'new', href: '/new', label: 'New' },
  { id: 'settings', href: '/settings', label: 'Settings' },
];

export function Layout({ title, me, active, fill, width, children }: LayoutProps) {
  let mainClass = width ? `main main-${width}` : 'main';
  if (fill) mainClass = 'main main-fill';
  return (
    <>
      {html`<!doctype html>`}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark light" />
          <title>{title} · Artifacts</title>
          <link rel="preload" href="/static/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
          <link rel="stylesheet" href="/static/app.css" />
          <script type="module" src="/static/app.js"></script>
        </head>
        <body class={fill ? 'is-fill' : undefined}>
          <a class="skip-link" href="#main">
            Skip to content
          </a>
          <header class="site-header">
            <a class="brand" href="/">
              <Logo />
              <span>Artifacts</span>
            </a>
            {me && (
              <>
                <nav class="site-nav" aria-label="Main">
                  {NAV.map((item) => (
                    <a href={item.href} aria-current={item.id === active ? 'page' : undefined}>
                      {item.label}
                    </a>
                  ))}
                </nav>
                <div class="account">
                  {me.avatarUrl ? <img class="avatar" src={me.avatarUrl} alt="" width="24" height="24" /> : <Initial name={me.email} />}
                  <span class="account-email">{me.email}</span>
                  <form method="post" action="/auth/logout">
                    <button type="submit" class="button button-quiet" aria-label="Sign out" title="Sign out">
                      <Icon name="log-out" />
                      <span class="btn-label">Sign out</span>
                    </button>
                  </form>
                </div>
              </>
            )}
          </header>
          <div id="error" class="callout callout-danger callout-global" role="alert" hidden>
            <Icon name="circle-alert" size={20} />
            <div class="callout-body" id="error-message"></div>
          </div>
          <main id="main" class={mainClass}>
            {children}
          </main>
        </body>
      </html>
    </>
  );
}
