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

function closeVersionMenus(except) {
  for (const menu of document.querySelectorAll('details.version-menu[open]')) {
    if (menu !== except) menu.open = false;
  }
}

document.addEventListener('click', (event) => closeVersionMenus(event.target.closest('details.version-menu')));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('details.version-menu[open]');
  if (!menu) return;
  menu.open = false;
  menu.querySelector('summary').focus();
});
