import { html } from 'hono/html';
import type { Child } from 'hono/jsx';
import { Initial } from './components';
import { Icon, Logo } from './icons';

export interface Identity {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface LayoutProps {
  title: string;
  me: Identity | null;
  settingsActive?: boolean;
  signIn?: boolean;
  fill?: boolean;
  width?: 'medium' | 'narrow';
  children?: Child;
}

const THEME_CHOICES = [
  { id: 'system', label: 'System', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
] as const;

function displayName(me: Identity): string {
  return me.name?.trim() || me.email.split('@')[0] || me.email;
}

function Avatar({ me, size }: { me: Identity; size: number }) {
  return me.avatarUrl ? (
    <img class="avatar" src={me.avatarUrl} alt="" width={size} height={size} />
  ) : (
    <Initial name={displayName(me)} />
  );
}

// One button holds the signed-in user's Settings link, the theme choice and Sign out. It uses the
// same menu behaviour as the artifact menu (data-menu-button + .menu-panel in app.js).
function AccountMenu({ me, settingsActive }: { me: Identity; settingsActive?: boolean }) {
  const name = displayName(me);
  return (
    <div class="menu-anchor menu-anchor-end">
      <button
        type="button"
        class="account-button"
        data-menu-button
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="account-menu"
        title={name}
      >
        <Avatar me={me} size={28} />
        <span class="account-name">{name}</span>
        <Icon name="chevron-down" />
      </button>
      <div class="menu-panel menu-panel-account" id="account-menu" role="menu" aria-label="Account" hidden>
        <div class="menu-head" role="presentation">
          <Avatar me={me} size={36} />
          <span class="menu-head-text">
            <span class="menu-head-name">{name}</span>
            <span class="menu-head-email">{me.email}</span>
          </span>
        </div>
        <hr class="menu-sep" role="separator" />
        <a role="menuitem" class="menu-item" href="/settings" aria-current={settingsActive ? 'page' : undefined}>
          <Icon name="settings" />
          <span>Settings</span>
        </a>
        <div class="menu-row" role="group" aria-labelledby="appearance-label">
          <span class="menu-row-label" id="appearance-label">
            Appearance
          </span>
          <div class="segmented">
            {THEME_CHOICES.map((choice) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={choice.id === 'system' ? 'true' : 'false'}
                data-theme-choice={choice.id}
                aria-label={`${choice.label} theme`}
                title={choice.label}
              >
                <Icon name={choice.icon} />
              </button>
            ))}
          </div>
        </div>
        <hr class="menu-sep" role="separator" />
        <form method="post" action="/auth/logout" role="none">
          <button type="submit" role="menuitem" class="menu-item">
            <Icon name="log-out" />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </div>
  );
}

// Signed out there is no account menu, so the theme stays reachable through one cycling button.
// CSS shows the icon for the current mode; app.js keeps the label current.
function ThemeCycle() {
  return (
    <button type="button" class="icon-button" data-theme-cycle aria-label="Theme: System" title="Theme: System">
      {THEME_CHOICES.map((choice) => (
        <Icon name={choice.icon} class={`theme-icon theme-icon-${choice.id}`} />
      ))}
    </button>
  );
}

export function Layout({ title, me, settingsActive, signIn = true, fill, width, children }: LayoutProps) {
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
          <script src="/static/theme.js"></script>
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
            <div class="header-end">
              {me ? (
                <>
                  <a class="header-new" href="/new" aria-label="New artifact" title="New artifact">
                    <Icon name="plus" />
                    <span class="btn-label">New</span>
                  </a>
                  <AccountMenu me={me} settingsActive={settingsActive} />
                </>
              ) : (
                <>
                  <ThemeCycle />
                  {signIn && (
                    <a class="button button-compact" href="/auth/login">
                      Sign in
                    </a>
                  )}
                </>
              )}
            </div>
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
