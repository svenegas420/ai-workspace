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
      else if (url.pathname === '/api/workspace/avatar') result = ws.setAvatar(input.agentId, input.avatar);
      else if (url.pathname === '/api/workspace/music') result = ws.setMusic(input.items);
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
  for (const file of ['window-manager.js', 'avatars.js', 'workspace-ui.js', 'portal-ui.js', 'winamp.js']) window.eval(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  await settle();
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
  await f.click('.win98-desktop [data-desktop-module="projects"]'); await f.click('[data-action="import-htdocs"]');
  assert.ok(f.document.querySelector('#importForm'));
  f.document.querySelector('[name="selected"]').checked = true;
  await f.submit('#importForm');
  assert.match(f.document.querySelector('.ws-alert').textContent, /Personal o Trabajo/);
  assert.equal(f.ws.get().projects.length, 0);
  f.document.querySelector('#importForm select').value = 'work'; await f.submit('#importForm');
  assert.equal(f.ws.get().projects[0].category, 'work');
  assert.ok(f.document.querySelector('[name="selected"]').disabled);
  await f.click('[data-portal="projects"]');
  assert.match(f.document.querySelector('#module-projects').textContent, /Example/);
});

test('documentation escapes HTML, filters notes, and pixel graph uses real note links', async t => {
  const f = await fixture(t, true), p = f.ws.get().projects[0];
  f.ws.updateContext(p.id, '# Safe note\n\n<img src=x onerror="alert(1)">\n\n[[Tareas]]\n\n[bad](javascript:alert(1))');
  await f.click('.win98-desktop [data-desktop-module="docs"]');
  const context = [...f.document.querySelectorAll('.portal-note')].find(el => el.textContent.includes('Safe note')); context.click(); await settle();
  assert.equal(f.document.querySelector('.portal-reader img'), null);
  assert.equal(f.document.querySelector('.portal-reader a[href^="javascript:"]'), null);
  assert.match(f.document.querySelector('.portal-reader').textContent, /<img/);
  assert.ok(f.document.querySelector('.portal-reader .portal-wiki'));
  await f.click('.win98-desktop [data-desktop-module="graph"]');
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
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]');
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
  await f.click('.win98-desktop [data-desktop-module="docs"]'); await f.click('.win98-desktop [data-desktop-module="chat"]');
  assert.equal(f.document.querySelector('#chatText').value, 'Borrador pendiente');
});

test('Retomar opens integrated chat with project and task defaults instead of launching a terminal', async t => {
  const f = await fixture(t, true), p = f.ws.get().projects[0];
  f.ws.upsertTask(p.id, { title: 'Investigate', type: 'research' });
  await f.click('.win98-desktop [data-desktop-module="projects"]'); await f.click('[data-action="open-project"]');
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
  assert.ok(f.document.querySelector('[data-wm-task="projects"]'), 'the projects window has its own taskbar button');
  await f.click('.win98-desktop [data-desktop-module="docs"]'); assert.ok(f.document.querySelector('.portal-layout'));
  await f.click('#win98Start'); f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.document.querySelector('#win98StartMenu').hidden, true);
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.ok(f.document.querySelector('.msn-window')); assert.ok(f.document.querySelector('.msn-format-bar'));
  assert.ok(f.document.querySelector('#win98Clock').textContent);
});

test('closing Configuración only asks for confirmation when there are unsaved changes', async t => {
  const f = await fixture(t, true); let asked = 0;
  f.window.confirm = () => { asked++; return false; };
  const W = f.window.Win98WM, settings = '.w98-app[data-window="settings"]';
  const waitForm = async () => { for (let i = 0; i < 20 && !f.document.querySelector('#settingsForm [data-key="name"]'); i++) await settle(); };
  await f.click('.win98-desktop [data-desktop-module="settings"]'); await waitForm();
  await f.click('.win98-desktop [data-desktop-module="projects"]');
  assert.equal(asked, 0, 'opening another window never asks'); assert.ok(W.isOpen('settings'));
  await f.click(`${settings} [data-wm="close"]`); assert.equal(asked, 0); assert.ok(!W.isOpen('settings'));
  await f.click('.win98-desktop [data-desktop-module="settings"]'); await waitForm();
  f.document.querySelector('#settingsForm [data-key="name"]').value += ' editado';
  await f.click(`${settings} [data-wm="close"]`); assert.equal(asked, 1); assert.ok(W.isOpen('settings'), 'cancelling keeps the window and the edit');
  assert.match(f.document.querySelector('#settingsForm [data-key="name"]').value, /editado/);
});

test('modules open as independent windows that can be used at the same time', async t => {
  const f = await fixture(t, true), W = f.window.Win98WM;
  await f.click('.win98-desktop [data-desktop-module="graph"]'); await f.click('.win98-desktop [data-desktop-module="projects"]');
  assert.ok(W.isOpen('graph') && W.isOpen('projects') && W.isOpen('office'));
  assert.ok(f.document.querySelector('#knowledgeGraph'), 'the graph stays rendered while projects is open');
  assert.match(f.document.querySelector('#module-projects').textContent, /Example/);
  const tasks = [...f.document.querySelectorAll('#win98Tasks [data-wm-task]')].map(b => b.dataset.wmTask);
  assert.deepEqual(tasks.sort(), ['graph', 'office', 'projects']);
  assert.equal(f.document.body.dataset.module, 'projects');
  assert.equal(f.document.querySelector('[data-wm-task="projects"]').getAttribute('aria-pressed'), 'true');
  // Clicking another window's taskbar button brings it to the front.
  await f.click('[data-wm-task="graph"]'); assert.equal(f.document.body.dataset.module, 'graph');
  const z = id => Number(f.document.querySelector(`.w98-app[data-window="${id}"]`).style.zIndex);
  assert.ok(z('graph') > z('projects'));
  // Opening an already open module focuses it instead of duplicating it.
  await f.click('.win98-desktop [data-desktop-module="projects"]');
  assert.equal(f.document.querySelectorAll('.w98-app[data-window="projects"]').length, 1);
});

test('windows minimize, maximize, restore from the taskbar and close', async t => {
  const f = await fixture(t, true), W = f.window.Win98WM, office = f.document.querySelector('.w98-app[data-window="office"]');
  await f.click('.w98-app[data-window="office"] [data-wm="maximize"]'); assert.ok(office.classList.contains('maximized'));
  await f.click('.w98-app[data-window="office"] [data-wm="maximize"]'); assert.ok(!office.classList.contains('maximized'));
  await f.click('.w98-app[data-window="office"] [data-wm="minimize"]'); assert.ok(office.hidden);
  assert.equal(f.document.querySelector('[data-wm-task="office"]').getAttribute('aria-pressed'), 'false');
  await f.click('[data-wm-task="office"]'); assert.ok(!office.hidden); assert.equal(f.document.body.dataset.module, 'office');
  await f.click('[data-wm-task="office"]'); assert.ok(office.hidden, 'clicking the active task minimizes it');
  await f.click('[data-wm-task="office"]');
  await f.click('.w98-app[data-window="office"] [data-wm="close"]'); assert.ok(!W.isOpen('office'));
  assert.equal(f.document.querySelector('[data-wm-task="office"]'), null);
  await f.click('.win98-desktop [data-desktop-module="office"]'); assert.ok(W.isOpen('office')); assert.ok(!office.hidden);
  await f.click('.win98-desktop [data-desktop-module="projects"]'); assert.equal(f.document.body.dataset.module, 'projects');
});

test('window geometry follows drag and resize gestures and is remembered', async t => {
  const f = await fixture(t, true), win = f.document.querySelector('.w98-app[data-window="office"]');
  const pointer = (type, target, x, y) => target.dispatchEvent(new f.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  const before = { left: parseInt(win.style.left), top: parseInt(win.style.top), width: parseInt(win.style.width) };
  pointer('pointerdown', win.querySelector('.win98-titlebar'), 300, 20); pointer('pointermove', f.document, 340, 60); pointer('pointerup', f.document, 340, 60);
  assert.equal(parseInt(win.style.left), before.left + 40); assert.equal(parseInt(win.style.top), before.top + 40);
  pointer('pointerdown', win.querySelector('[data-wm-resize="w"]'), 0, 0); pointer('pointermove', f.document, -30, 0); pointer('pointerup', f.document, -30, 0);
  assert.equal(parseInt(win.style.width), before.width + 30); assert.equal(parseInt(win.style.left), before.left + 10);
  const saved = JSON.parse(f.window.localStorage.getItem('office.windows.v1'));
  assert.equal(saved.geom.office.w, before.width + 30); assert.deepEqual(saved.open, ['office']);
});

test('Windows 98 stylesheet changes application chrome while Messenger keeps its blue skin', async t => {
  const f = await fixture(t, true);
  for (const file of ['workspace.css', 'portal.css', 'windows98.css']) { const style = f.document.createElement('style'); style.textContent = fs.readFileSync(path.join(__dirname, file), 'utf8'); f.document.head.append(style); }
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.equal(f.window.getComputedStyle(f.document.body).backgroundColor, 'rgb(0, 128, 128)');
  assert.equal(f.window.getComputedStyle(f.document.querySelector('.msn-window')).backgroundColor, 'rgb(199, 225, 244)');
  assert.equal(f.window.getComputedStyle(f.document.querySelector('.chat-messages')).backgroundColor, 'rgb(255, 255, 255)');
});

test('Messenger is its own window: it minimizes, restores and maximizes while preserving the message draft', async t => {
  const f = await fixture(t, true), W = f.window.Win98WM, chat = () => f.document.querySelector('.w98-app[data-window="chat"]');
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.ok(chat().classList.contains('w98-skin-msn'), 'the Messenger skin is the window frame');
  const editor = f.document.querySelector('#chatText'); editor.value = 'Este borrador sigue aquí'; editor.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  await f.click('.msn-window-controls [data-wm="maximize"]'); assert.ok(chat().classList.contains('maximized'));
  await f.click('.msn-window-controls [data-wm="minimize"]'); assert.ok(chat().hidden); assert.equal(f.document.body.dataset.module, 'office');
  await f.click('[data-wm-task="chat"]'); assert.equal(f.document.body.dataset.module, 'chat');
  assert.equal(f.document.querySelector('#chatText').value, 'Este borrador sigue aquí');
  await f.click('.msn-window-controls [data-wm="close"]'); assert.ok(!W.isOpen('chat')); assert.equal(f.document.body.dataset.module, 'office');
  await f.click('.win98-desktop [data-desktop-module="chat"]');
  assert.equal(f.document.querySelector('#chatText').value, 'Este borrador sigue aquí', 'the draft survives closing the window');
});

test('contact pictures can be chosen from the gallery or uploaded, and are saved', async t => {
  const f = await fixture(t, true);
  await f.click('.win98-desktop [data-desktop-module="chat"]');
  await f.click('[data-portal="change-avatar"][data-agent="claude"]');
  assert.ok(f.document.querySelector('.avatar-dialog'));
  await f.click('.avatar-option[data-avatar-value="preset:duck"]'); await f.click('[data-avatar="ok"]');
  assert.equal(f.ws.get().agents.find(a => a.id === 'claude').avatar, 'preset:duck');
  assert.match(f.document.querySelector('[data-portal="change-avatar"][data-agent="claude"]').innerHTML, /🦆/);
  // Cancelling keeps the current picture.
  await f.click('[data-portal="change-avatar"][data-agent="claude"]'); await f.click('.avatar-option[data-avatar-value=""]'); await f.click('[data-avatar="cancel"]');
  assert.equal(f.ws.get().agents.find(a => a.id === 'claude').avatar, 'preset:duck');
  // Only raster data images or gallery presets are accepted by the workspace.
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  f.ws.setAvatar('codex', png); assert.equal(f.ws.get().agents.find(a => a.id === 'codex').avatar, png);
  assert.throws(() => f.ws.setAvatar('codex', 'data:image/svg+xml;base64,PHN2Zz4='), /inválida/);
  assert.throws(() => f.ws.setAvatar('codex', 'javascript:alert(1)'), /inválida/);
  // Configuración shows the same picture and keeps it when saving other settings.
  await f.click('.win98-desktop [data-desktop-module="settings"]');
  for (let i = 0; i < 20 && !f.document.querySelector('#settingsForm'); i++) await settle();
  assert.match(f.document.querySelector('[data-action="avatar"][data-index="0"]').innerHTML, /🦆/);
  await f.submit('#settingsForm');
  assert.equal(f.ws.get().agents.find(a => a.id === 'claude').avatar, 'preset:duck');
});

test('Winamp parses YouTube Music links and keeps a saved list', async t => {
  const f = await fixture(t, true), W = f.window.OfficeWinamp;
  assert.deepEqual({ ...W.parseLink('https://music.youtube.com/playlist?list=PLabcdef123456') }, { videoId: '', listId: 'PLabcdef123456' });
  assert.deepEqual({ ...W.parseLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ') }, { videoId: 'dQw4w9WgXcQ', listId: '' }, 'automatic mixes fall back to the song');
  assert.deepEqual({ ...W.parseLink('https://youtu.be/dQw4w9WgXcQ') }, { videoId: 'dQw4w9WgXcQ', listId: '' });
  assert.throws(() => W.parseLink('https://music.youtube.com/browse/MPREb_abc123'), /Compartir/);
  assert.throws(() => W.parseLink('https://example.com/watch?v=dQw4w9WgXcQ'), /YouTube/);
  await f.click('.win98-desktop [data-desktop-module="winamp"]'); await settle();
  assert.ok(f.document.querySelector('.w98-app[data-window="winamp"] .winamp'));
  f.document.querySelector('#wampUrl').value = 'https://music.youtube.com/playlist?list=OLAK5uy_abcdefghij';
  f.document.querySelector('#wampName').value = 'Mi álbum';
  await f.submit('#wampAdd');
  assert.deepEqual(f.ws.get().music.map(m => [m.title, m.listId]), [['Mi álbum', 'OLAK5uy_abcdefghij']]);
  assert.match(f.document.querySelector('#wampList').textContent, /Mi álbum/);
  f.document.querySelector('#wampUrl').value = 'https://music.youtube.com/browse/MPREb_x'; await f.submit('#wampAdd');
  assert.match(f.document.querySelector('#wampStatus').textContent, /Compartir/);
  await f.click('[data-wamp-remove="0"]'); assert.deepEqual(f.ws.get().music, []);
  assert.throws(() => f.ws.setMusic([{ id: 'x1', title: 'Bad', videoId: '<script>' }]), /inválido/);
});

test('Messenger project list, contact search and composer tools are functional', async t => {
  const f = await fixture(t, true);
  await f.click('.win98-desktop [data-desktop-module="chat"]'); await f.click('[data-portal="new-chat"]'); await f.submit('#newChatForm');
  assert.ok(f.document.querySelector('.msn-project[data-id="' + f.ws.get().projects[0].id + '"]'));
  const search = f.document.querySelector('#messengerSearch'); search.value = 'does not exist'; search.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.ok([...f.document.querySelectorAll('.msn-contact-row, .msn-project, .chat-thread')].every(el => el.hidden));
  await f.click('[data-portal="emoticons"]'); assert.equal(f.document.querySelector('.msn-emoticon-picker').hidden, false);
  await f.click('[data-portal="insert-emoji"]'); assert.match(f.document.querySelector('#chatText').value, /🙂/);
  await f.click('[data-portal="format-bold"]'); assert.match(f.document.querySelector('#chatText').value, /\*\*texto\*\*/);
  assert.equal(f.document.querySelector('.chat-bubble'), null);
  await f.click('[data-portal="show-project"]'); assert.ok(f.document.querySelector('.msn-project-details'));
});
