const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { JSDOM } = require('jsdom');
const { createWorkspace } = require('./workspace');
const { createPortal } = require('./portal');

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t, addProject = false, renderOffice = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-ui-'));
  const root = path.join(home, 'htdocs'); fs.mkdirSync(root); fs.mkdirSync(path.join(root, 'Example'));
  const ws = createWorkspace({ home, baseConfig: () => ({ agents: [{ id: 'claude', logs: 'claude', name: 'Claude', color: '#e2805a' }, { id: 'codex', logs: 'codex', name: 'Codex', color: '#39c494' }] }) });
  const runs = [];
  const portal = createPortal({ workspace: ws, root, dataDir: path.join(home, 'data'), runner: (payload, update, close) => { runs.push({ payload, update, close }); return { stop() { close(1); } }; } });
  if (addProject) portal.importProjects({ projects: [{ key: portal.discover().projects[0].key, category: 'personal' }] });
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), { url: 'http://localhost:4777', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom; let lineCount = 0;
  // Fake 2D context: counts filled shapes and records label text; every other canvas call is a no-op.
  const labels = [];
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key === 'fillRect' ? () => { lineCount++; } : key === 'fillText' ? text => labels.push(text) : key === 'measureText' ? text => ({ width: String(text).length * 7 }) : () => {}, set: () => true });
  window.confirm = () => true; window.structuredClone ??= structuredClone;
  window.EventSource = class {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.handlers = {}; this.unsubscribe = portal.chat.subscribe(chat => this.handlers.chat?.({ data: JSON.stringify(chat) })); queueMicrotask(() => this.onopen?.()); }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    close() { this.unsubscribe(); }
  };
  window.fetch = async (route, options = {}) => {
    let result; const input = options.body ? JSON.parse(options.body) : null;
    try {
      const url = new URL(route, window.location.href);
      if (url.pathname === '/api/workspace') result = ws.get();
      else if (url.pathname === '/api/config') result = { agents: ws.get().agents.filter(a => a.enabled).map(a => ({ ...a, logs: a.provider })) };
      else if (url.pathname === '/api/agents') result = { now: Date.now(), agents: [], plans: {} };
      else if (url.pathname === '/api/usage') result = { agents: [] };
      else if (url.pathname === '/api/workspace/settings') result = ws.settings(input);
      else if (url.pathname === '/api/workspace/project') result = ws.upsertProject(input);
      else if (url.pathname === '/api/workspace/task') result = ws.upsertTask(input.projectId, input);
      else if (url.pathname === '/api/workspace/context') result = ws.updateContext(input.projectId, input.context);
      else if (url.pathname === '/api/portal/discover') result = portal.discover();
      else if (url.pathname === '/api/portal/import') result = portal.importProjects(input);
      else if (url.pathname === '/api/portal/notes') result = portal.notes();
      else if (url.pathname === '/api/portal/chats') result = { chats: portal.chat.list() };
      else if (url.pathname === '/api/portal/chat') result = portal.chat.get(url.searchParams.get('id'));
      else if (url.pathname === '/api/portal/chat/create') result = portal.chat.create(input);
      else if (url.pathname === '/api/portal/chat/send') result = portal.chat.send(input.id, input.text);
      else if (url.pathname === '/api/portal/chat/stop') result = portal.chat.stop(input.id);
      else throw new Error('Unexpected route: ' + route);
      return { ok: true, json: async () => JSON.parse(JSON.stringify(result)) };
    } catch (e) { return { ok: false, json: async () => ({ error: e.message }) }; }
  };
  window.eval(fs.readFileSync(path.join(__dirname, 'workspace-ui.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, 'portal-ui.js'), 'utf8'));
  if (renderOffice) {
    window.matchMedia = () => ({ matches: false });
    window.requestAnimationFrame = () => 0;
    window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 20 }) : () => {} });
    window.eval(window.document.querySelector('script:not([src])').textContent);
    await settle();
  }
  t.after(() => { dom.window.close(); portal.chat.close(); fs.rmSync(home, { recursive: true, force: true }); });
  const click = async selector => { const el = window.document.querySelector(selector); assert.ok(el, `Missing ${selector}`); el.click(); await settle(); };
  const submit = async selector => { const form = window.document.querySelector(selector); assert.ok(form); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
  return { window, document: window.document, ws, portal, click, submit, runs, lineCount: () => lineCount, labels: () => labels };
}

test('navbar importer requires a category and imports only chosen projects without losing its form', async t => {
  const f = await fixture(t);
  await f.click('[data-module="projects"]'); await f.click('[data-action="import-htdocs"]');
  assert.ok(f.document.querySelector('#importForm'));
  f.document.querySelector('[name="selected"]').checked = true;
  await f.submit('#importForm');
  assert.match(f.document.querySelector('.ws-alert').textContent, /Personal o Trabajo/);
  assert.equal(f.ws.get().projects.length, 0);
  f.document.querySelector('#importForm select').value = 'work'; await f.submit('#importForm');
  assert.equal(f.ws.get().projects[0].category, 'work');
  assert.ok(f.document.querySelector('[name="selected"]').disabled);
  await f.click('[data-portal="projects"]');
  assert.match(f.document.querySelector('#workspacePanel').textContent, /Example/);
});

test('documentation escapes HTML, filters notes, and pixel graph uses real note links', async t => {
  const f = await fixture(t, true), p = f.ws.get().projects[0];
  f.ws.updateContext(p.id, '# Safe note\n\n<img src=x onerror="alert(1)">\n\n[[Tareas]]\n\n[bad](javascript:alert(1))');
  await f.click('[data-module="docs"]');
  const context = [...f.document.querySelectorAll('.portal-note')].find(el => el.textContent.includes('Safe note')); context.click(); await settle();
  assert.equal(f.document.querySelector('.portal-reader img'), null);
  assert.equal(f.document.querySelector('.portal-reader a[href^="javascript:"]'), null);
  assert.match(f.document.querySelector('.portal-reader').textContent, /<img/);
  assert.ok(f.document.querySelector('.portal-reader .portal-wiki'));
  await f.click('[data-module="graph"]');
  assert.ok(f.document.querySelector('#knowledgeGraph'));
  assert.ok(f.lineCount() > 20);
  assert.match(f.document.querySelector('.graph-toolbar').textContent, /conexiones/);
  assert.match(f.document.querySelector('#graphDetail h3').textContent, /Safe note/, 'the note open in Documentación stays selected');
  // Selecting a note from the picker shows its real links without rebuilding the view.
  const canvas = f.document.querySelector('#knowledgeGraph'), select = f.document.querySelector('#graphNode');
  const linked = [...select.options].find(o => /Safe note/.test(o.textContent));
  select.value = linked.value; select.dispatchEvent(new f.window.Event('change', { bubbles: true })); await settle();
  assert.equal(f.document.querySelector('#knowledgeGraph'), canvas);
  assert.match(f.document.querySelector('#graphDetail h3').textContent, /Safe note/);
  assert.ok(f.document.querySelector('#graphDetail .graph-link'), 'the [[Tareas]] link is listed as a connection');
  assert.ok(f.labels().includes('Safe note'));
  await f.click('[data-portal="graph-zoom-in"]'); await f.click('[data-portal="graph-fit"]');
  await f.click('[data-portal="graph-clear"]'); assert.match(f.document.querySelector('#graphDetail').textContent, /Explora tu red/);
});

test('Messenger sends a real service request, streams text, retains drafts and disables sending while busy', async t => {
  const f = await fixture(t, true);
  await f.click('[data-module="chat"]'); await f.click('[data-portal="new-chat"]');
  await f.submit('#newChatForm');
  assert.ok(f.document.querySelector('#messageForm'));
  f.document.querySelector('#chatText').value = 'Investiga este proyecto';
  await f.submit('#messageForm');
  assert.equal(f.runs.length, 1);
  assert.match(f.document.querySelector('#chatMessages').textContent, /Investiga/);
  assert.ok(f.document.querySelector('#sendMessage').disabled);
  f.runs[0].update({ type: 'delta', text: 'Respuesta dentro del portal' }); f.runs[0].close(0);
  assert.match(f.document.querySelector('#chatMessages').textContent, /Respuesta dentro del portal/);
  assert.equal(f.document.querySelector('#sendMessage').disabled, true);
  f.runs[1].update({ type: 'block', text: 'Revisión del segundo agente' }); f.runs[1].close(0);
  assert.match(f.document.querySelector('#chatMessages').textContent, /revisión cruzada/);
  assert.equal(f.document.querySelector('#sendMessage').disabled, false);
  const editor = f.document.querySelector('#chatText'); editor.value = 'Borrador pendiente'; editor.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  await f.click('[data-module="docs"]'); await f.click('[data-module="chat"]');
  assert.equal(f.document.querySelector('#chatText').value, 'Borrador pendiente');
});

test('Retomar opens integrated chat with project and task defaults instead of launching a terminal', async t => {
  const f = await fixture(t, true), p = f.ws.get().projects[0];
  f.ws.upsertTask(p.id, { title: 'Investigate', type: 'research' });
  await f.click('[data-module="projects"]'); await f.click('[data-action="open-project"]');
  await f.click('[data-action="launch"][data-task]');
  assert.equal(f.document.body.dataset.module, 'chat');
  assert.equal(f.document.querySelector('#chatAgent').value, 'claude');
  assert.equal(f.document.querySelector('#chatModel').value, 'haiku');
  await f.submit('#newChatForm');
  assert.match(f.document.querySelector('#chatText').value, /Retoma esta tarea/);
});

test('characters remain visible without CLI sessions and open chat with their project and agent', async t => {
  const f = await fixture(t, true, true);
  assert.equal(f.document.querySelectorAll('#team .card').length, 2);
  assert.ok(f.document.querySelector('button.pill.vend[data-office-agent="claude"]'));
  const card = f.document.querySelector('[data-office-agent="claude"]').closest('.card');
  assert.match(card.textContent, /Proyectos disponibles/);
  assert.match(card.querySelector('.character-projects').textContent, /Example/);
  await f.click('.character-projects [data-office-agent="claude"][data-project-id]');
  assert.equal(f.document.body.dataset.module, 'chat');
  assert.equal(f.document.querySelector('#chatAgent').value, 'claude');
  assert.equal(f.document.querySelector('#chatProject').value, f.ws.get().projects[0].id);
  await f.submit('#newChatForm');
  assert.match(f.document.querySelector('.msn-titlebar').textContent, /Claude \+ Codex — Windows Live Messenger/);
});

test('both characters open the same combined project conversation', async t => {
  const f = await fixture(t, true, true), p = f.ws.get().projects[0];
  f.portal.chat.create({ projectId: p.id, agentId: 'codex' });
  await f.click('.character-projects [data-office-agent="claude"][data-project-id]');
  assert.equal(f.document.querySelector('#newChatForm'), null);
  assert.equal(f.portal.chat.list().length, 1);
  await f.click('[data-portal="contact"][data-id="codex"]');
  assert.match(f.document.querySelector('.msn-conversation-heading').textContent, /Codex/);
  assert.equal(f.document.querySelector('#newChatForm'), null);
});

test('Windows 98 Start menu and desktop shortcuts navigate without changing Messenger skin', async t => {
  const f = await fixture(t, true);
  await f.click('#win98Start'); assert.equal(f.document.querySelector('#win98StartMenu').hidden, false);
  await f.click('#win98StartMenu [data-desktop-module="projects"]');
  assert.equal(f.document.body.dataset.module, 'projects'); assert.equal(f.document.querySelector('#win98StartMenu').hidden, true);
  assert.equal(f.document.querySelector('#win98CurrentTask').textContent, 'Mis proyectos');
  await f.click('.win98-desktop [data-desktop-module="docs"]'); assert.ok(f.document.querySelector('.portal-layout'));
  await f.click('#win98Start'); f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.document.querySelector('#win98StartMenu').hidden, true);
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.ok(f.document.querySelector('.msn-window')); assert.ok(f.document.querySelector('.msn-format-bar'));
  assert.ok(f.document.querySelector('#win98Clock').textContent);
});

test('leaving Configuración only asks for confirmation when there are unsaved changes', async t => {
  const f = await fixture(t, true); let asked = 0;
  f.window.confirm = () => { asked++; return true; };
  await f.click('[data-module="settings"]'); await f.click('[data-module="projects"]');
  assert.equal(asked, 0); assert.equal(f.document.body.dataset.module, 'projects');
  await f.click('[data-module="settings"]');
  for (let i = 0; i < 20 && !f.document.querySelector('#settingsForm [data-key="name"]'); i++) await settle();
  const field = f.document.querySelector('#settingsForm [data-key="name"]'); field.value += ' editado';
  await f.click('[data-module="office"]'); assert.equal(asked, 1);
});

test('Windows 98 title bar minimizes, maximizes and restores the window from the taskbar', async t => {
  const f = await fixture(t, true), body = f.document.body;
  await f.click('[data-win98-action="maximize"]'); assert.ok(body.classList.contains('win98-maximized'));
  await f.click('[data-win98-action="maximize"]'); assert.ok(!body.classList.contains('win98-maximized'));
  await f.click('[data-win98-action="minimize"]'); assert.ok(body.classList.contains('win98-minimized'));
  assert.equal(f.document.querySelector('#win98CurrentTask').getAttribute('aria-pressed'), 'false');
  await f.click('#win98CurrentTask'); assert.ok(!body.classList.contains('win98-minimized'));
  await f.click('[data-win98-action="close"]'); assert.ok(body.classList.contains('win98-minimized'));
  await f.click('.win98-desktop [data-desktop-module="projects"]');
  assert.ok(!body.classList.contains('win98-minimized')); assert.equal(body.dataset.module, 'projects');
});

test('Windows 98 stylesheet changes application chrome while Messenger keeps its blue skin', async t => {
  const f = await fixture(t, true);
  for (const file of ['workspace.css', 'portal.css', 'windows98.css']) { const style = f.document.createElement('style'); style.textContent = fs.readFileSync(path.join(__dirname, file), 'utf8'); f.document.head.append(style); }
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.equal(f.window.getComputedStyle(f.document.body).backgroundColor, 'rgb(0, 128, 128)');
  assert.equal(f.window.getComputedStyle(f.document.querySelector('.msn-window')).backgroundColor, 'rgb(199, 225, 244)');
  assert.equal(f.window.getComputedStyle(f.document.querySelector('.chat-messages')).backgroundColor, 'rgb(255, 255, 255)');
});

test('Messenger minimizes, restores and maximizes while preserving the message draft', async t => {
  const f = await fixture(t, true);
  await f.click('[data-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  const editor = f.document.querySelector('#chatText'); editor.value = 'Este borrador sigue aquí'; editor.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  await f.click('[data-portal="maximize-chat"]'); assert.ok(f.document.querySelector('.msn-window').classList.contains('maximized'));
  await f.click('[data-portal="minimize-chat"]'); assert.equal(f.document.body.dataset.module, 'office');
  assert.ok(f.document.querySelector('#messengerDock'));
  await f.click('#messengerDock'); assert.equal(f.document.body.dataset.module, 'chat');
  assert.equal(f.document.querySelector('#chatText').value, 'Este borrador sigue aquí');
  await f.click('[data-portal="close-chat"]'); assert.equal(f.document.body.dataset.module, 'office');
  assert.equal(f.document.querySelector('#messengerDock'), null);
});

test('Messenger project list, contact search and composer tools are functional', async t => {
  const f = await fixture(t, true);
  await f.click('[data-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.ok(f.document.querySelector('.msn-project[data-id="' + f.ws.get().projects[0].id + '"]'));
  const search = f.document.querySelector('#messengerSearch'); search.value = 'does not exist'; search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.ok([...f.document.querySelectorAll('.msn-contact, .msn-project, .chat-thread')].every(el => el.hidden));
  await f.click('[data-portal="emoticons"]'); assert.equal(f.document.querySelector('.msn-emoticon-picker').hidden, false);
  await f.click('[data-portal="insert-emoji"]'); assert.match(f.document.querySelector('#chatText').value, /🙂/);
  await f.click('[data-portal="format-bold"]'); assert.match(f.document.querySelector('#chatText').value, /\*\*texto\*\*/);
  assert.equal(f.document.querySelector('.chat-bubble'), null);
  await f.click('[data-portal="show-project"]'); assert.ok(f.document.querySelector('.msn-project-details'));
});
