const $ = (selector, root = document) => root.querySelector(selector);

function showError(message) {
  $('#error-message').textContent = message;
  $('#error').hidden = false;
}

async function api(method, url, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

async function guarded(button, task) {
  $('#error').hidden = true;
  button.disabled = true;
  try {
    await task();
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

const copyTimers = new WeakMap();

async function copy(button) {
  const source = $(button.dataset.copy);
  try {
    await navigator.clipboard.writeText('value' in source ? source.value : source.textContent);
  } catch {
    showError('Could not copy to the clipboard');
    return;
  }
  const label = $('span', button);
  const original = button.dataset.label || label.textContent;
  button.dataset.label = original;
  clearTimeout(copyTimers.get(button));
  label.textContent = 'Copied';
  button.dataset.copied = '';
  if (button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Copied');
  copyTimers.set(
    button,
    setTimeout(() => {
      label.textContent = original;
      delete button.dataset.copied;
      if (button.hasAttribute('aria-label')) button.setAttribute('aria-label', original);
    }, 1500),
  );
}

function request(button) {
  const { method, url, body, confirm: question, done } = button.dataset;
  if (question && !confirm(question)) return;
  guarded(button, async () => {
    await api(method, url, body ? JSON.parse(body) : undefined);
    if (done) location.assign(done);
    else location.reload();
  });
}

function remix(button) {
  const { remix: shareId, title, type, language } = button.dataset;
  guarded(button, async () => {
    const res = await fetch(`/s/${shareId}/raw`);
    if (!res.ok) throw new Error(`Could not read the shared artifact (${res.status})`);
    const input = { title, type, content: await res.text() };
    if (language) input.language = language;
    const created = await api('POST', '/api/artifacts', input);
    location.assign(created.url);
  });
}

function addTokenRow(token) {
  const row = document.createElement('li');
  row.className = 'item';
  const name = document.createElement('span');
  name.className = 'item-title';
  name.textContent = token.name;
  const created = document.createElement('time');
  created.className = 'item-meta';
  created.dateTime = token.createdAt;
  created.textContent = `Created ${token.createdAt.slice(0, 10)}`;
  const main = document.createElement('div');
  main.className = 'item-main';
  main.append(name, created);
  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'button button-danger';
  const revokeLabel = document.createElement('span');
  revokeLabel.textContent = 'Revoke';
  revoke.append(revokeLabel);
  revoke.dataset.method = 'DELETE';
  revoke.dataset.url = `/api/tokens/${token.id}`;
  revoke.dataset.confirm = `Revoke token "${token.name}"?`;
  row.append(main, revoke);
  $('#token-list').append(row);
  $('#no-tokens').hidden = true;
}

const forms = {
  async new(form) {
    const data = new FormData(form);
    const input = { title: data.get('title'), type: data.get('type'), content: data.get('content') };
    const language = data.get('language').trim();
    if (input.type === 'code' && language) input.language = language;
    location.assign((await api('POST', '/api/artifacts', input)).url);
  },
  async edit(form) {
    const { title, content } = form.elements;
    const body = {};
    if (title.value !== title.defaultValue) body.title = title.value;
    if (content.value !== content.defaultValue) body.content = content.value;
    if (Object.keys(body).length) await api('PATCH', `/api/artifacts/${form.dataset.id}`, body);
    location.assign(`/a/${form.dataset.id}`);
  },
  async token(form) {
    const created = await api('POST', '/api/tokens', { name: form.elements.name.value });
    const field = $('#new-token-value');
    field.value = created.token;
    $('#new-token').hidden = false;
    field.focus();
    field.select();
    addTokenRow(created);
    form.reset();
  },
  async rename(form) {
    // The global #error box is inert under showModal(), so failures surface inside the dialog.
    try {
      const view = await api('PATCH', `/api/artifacts/${form.dataset.id}`, { title: form.elements.title.value });
      const text = document.querySelector('.title-text');
      if (text) {
        text.textContent = view.title;
        text.closest('.title-button')?.setAttribute('title', view.title);
      }
      document.title = `${view.title} · Artifacts`;
      document.getElementById('rename-dialog').close();
    } catch (err) {
      $('#rename-error-message').textContent = err.message;
      $('#rename-error').hidden = false;
    }
  },
};

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  guarded(form.querySelector('[type=submit]'), () => forms[form.dataset.form](form));
});

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[role=tab]');
  if (tab) return selectTab(tab);
  const button = event.target.closest('button[data-copy], button[data-method], button[data-remix]');
  if (!button) return;
  if (button.dataset.copy) copy(button);
  else if (button.dataset.method) request(button);
  else remix(button);
});

function selectTab(selected) {
  const tabs = [...selected.closest('[role=tablist]').querySelectorAll('[role=tab]')];
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
}

document.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role=tab]');
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  const edge = { Home: 0, End: -1 }[event.key];
  if (!tab || (step === undefined && edge === undefined)) return;
  const tabs = [...tab.closest('[role=tablist]').querySelectorAll('[role=tab]')];
  const next = step === undefined ? tabs.at(edge) : tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
  event.preventDefault();
  next.focus();
  selectTab(next);
});

const typeSelect = $('#type');
if (typeSelect) {
  const toggle = () => {
    $('#language-field').hidden = typeSelect.value !== 'code';
  };
  typeSelect.addEventListener('change', toggle);
  toggle();
}

/* Theme switcher ---------------------------------------------------------- */

const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_NAMES = { system: 'System', light: 'Light', dark: 'Dark' };

function currentTheme() {
  return document.documentElement.dataset.theme || 'system';
}

function syncThemeButtons() {
  const current = currentTheme();
  for (const button of document.querySelectorAll('[data-theme-choice]')) {
    button.setAttribute('aria-checked', String(button.dataset.themeChoice === current));
  }
  for (const button of document.querySelectorAll('[data-theme-cycle]')) {
    const label = `Theme: ${THEME_NAMES[current]}`;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
}

function setTheme(choice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    localStorage.setItem('theme', choice);
  } catch {}
  syncThemeButtons();
}

document.addEventListener('click', (event) => {
  const choice = event.target.closest('[data-theme-choice]');
  if (choice) return setTheme(choice.dataset.themeChoice);
  if (event.target.closest('[data-theme-cycle]')) setTheme(THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length]);
});

syncThemeButtons();

/* Account, artifact and version menus, and the share popover ---------------- */

let openMenu = null;

function closeMenu(returnFocus) {
  if (!openMenu) return;
  openMenu.panel.hidden = true;
  openMenu.button.setAttribute('aria-expanded', 'false');
  if (returnFocus) openMenu.button.focus();
  openMenu = null;
}

function toggleMenu(button, edge = 'first') {
  if (openMenu && openMenu.button === button) return closeMenu(true);
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (!panel) return;
  closeMenu(false);
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  placeMenuBelowTrigger(panel, button);
  openMenu = { button, panel };
  const items = panel.querySelectorAll('[role^=menuitem]');
  const target = (edge === 'last' ? items[items.length - 1] : items[0]) || panel.querySelector('[role=tab]');
  if (target) target.focus();
}

function placeMenuBelowTrigger(panel, button) {
  // On small screens menus are fixed and span the viewport, so they sit just under their row.
  if (!window.matchMedia('(max-width: 720px)').matches) {
    panel.style.removeProperty('top');
    return;
  }
  const row = button.closest('.viewer-bar, .site-header') || button;
  panel.style.top = `${Math.ceil(row.getBoundingClientRect().bottom) + 4}px`;
}

window.addEventListener('resize', () => {
  if (openMenu) placeMenuBelowTrigger(openMenu.panel, openMenu.button);
});

document.addEventListener('click', (event) => {
  const opener = event.target.closest('[data-menu-button]');
  if (opener) return toggleMenu(opener);
  if (openMenu && !event.target.closest('.menu-panel')) closeMenu(false);
  if (openMenu && event.target.closest('[role=menuitem]')) closeMenu(true); // radios keep the menu open
  const item = event.target.closest('[data-action]');
  if (item && item.dataset.action === 'rename') return openRenameDialog();
  if (item && (item.dataset.action === 'share' || item.dataset.action === 'unshare')) {
    const verb = item.dataset.action === 'share' ? 'POST' : 'DELETE';
    return guarded(item, async () => applyShareState(await api(verb, item.dataset.url)));
  }
  const printLink = event.target.closest('[data-print]');
  if (printLink) window.open(printLink.dataset.print, '_blank', 'noopener');
  const closer = event.target.closest('[data-close-dialog]');
  if (closer) closer.closest('dialog').close();
});

document.addEventListener('keydown', (event) => {
  if (!openMenu) return openClosedMenuButton(event);
  // Only the open menu and its trigger own the arrow keys; other widgets keep native behaviour.
  const owns = openMenu.panel.contains(event.target) || openMenu.button.contains(event.target) || event.target === openMenu.button;
  if (!owns) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
    return;
  }
  const radio = event.target.closest('[role=menuitemradio]');
  const sideways = radio && (event.key === 'ArrowRight' || event.key === 'ArrowLeft');
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && !sideways) return;
  // Left/Right move within the radio group; Up/Down walk every item of the menu.
  const items = [...(sideways ? radio.parentElement : openMenu.panel).querySelectorAll('[role^=menuitem]')];
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
  const next = forward ? items[(current + 1) % items.length] : items[(current - 1 + items.length) % items.length];
  event.preventDefault();
  next.focus();
});

// WAI-ARIA menu button: ArrowDown/ArrowUp on a closed trigger opens its menu on the first/last item.
// The share trigger is a dialog popover, so only ArrowDown opens it (with its usual initial focus).
function openClosedMenuButton(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const button = event.target.closest('[data-menu-button]');
  if (!button || event.target !== button) return;
  const isMenu = button.getAttribute('aria-haspopup') === 'menu';
  if (event.key === 'ArrowUp' && !isMenu) return;
  event.preventDefault();
  toggleMenu(button, event.key === 'ArrowUp' ? 'last' : 'first');
}

document.addEventListener('focusout', (event) => {
  if (!openMenu) return;
  const fromMenu = openMenu.panel.contains(event.target) || event.target === openMenu.button;
  if (!fromMenu) return;
  // Close only when focus moved somewhere specific outside; relatedTarget is null when the
  // focused element itself was hidden or removed (e.g. the share state swap), which keeps the menu open.
  const to = event.relatedTarget;
  if (to && !openMenu.panel.contains(to) && to !== openMenu.button) closeMenu(false);
});

// A click inside the sandboxed preview never reaches this document, but it moves focus into the iframe.
window.addEventListener('blur', () => {
  if (openMenu && document.activeElement instanceof HTMLIFrameElement) closeMenu(false);
});

/* Sharing without a reload: swap the Link tab in place. --------------------- */

function applyShareState(view) {
  const popover = document.getElementById('share-popover');
  if (!popover) return;
  const shared = view.shareUrl !== null;
  popover.querySelector('[data-share-new]').hidden = shared;
  popover.querySelector('[data-share-active]').hidden = !shared;
  const input = popover.querySelector('#share-url');
  if (input) input.value = view.shareUrl ?? '';
  const opener = document.querySelector('[data-menu-button][aria-controls="share-popover"]');
  if (opener) {
    opener.classList.toggle('button-shared', shared);
    if (shared) opener.setAttribute('data-shared', 'true');
    else opener.removeAttribute('data-shared');
    opener.setAttribute('aria-label', shared ? 'Share, shared' : 'Share');
    opener.setAttribute('title', shared ? 'Shared' : 'Share');
  }
}

/* Rename dialog ------------------------------------------------------------ */

function openRenameDialog() {
  const dialog = document.getElementById('rename-dialog');
  if (!dialog) return;
  const input = dialog.querySelector('input[name=title]');
  const title = document.querySelector('.title-text');
  if (input && title) input.value = title.textContent;
  $('#rename-error').hidden = true;
  dialog.showModal();
  if (input) {
    input.focus();
    input.select();
  }
}
