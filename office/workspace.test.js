const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createWorkspace, handleWorkspace } = require('./workspace');

function fixture(t, launch = async () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'source'); fs.mkdirSync(projectPath);
  const opts = { home: root, dataDir: path.join(root, 'data'), baseConfig: () => ({ agents: [
    { id: 'claude', name: 'Claude', logs: 'claude', enabled: true },
    { id: 'codex', name: 'Codex', logs: 'codex', enabled: true },
  ] }), launch };
  const ws = createWorkspace(opts);
  ws.upsertProject({ name: 'Example', path: projectPath, category: 'personal' });
  return { ws, opts, root, projectPath, id: ws.get().projects[0].id };
}

test('projects persist across restart and Obsidian notes survive synchronization', t => {
  const { ws, opts, id } = fixture(t);
  const note = path.join(path.dirname(ws.get().projects[0].notePath), 'Contexto.md');
  fs.writeFileSync(note, '# Decisions\nInvestigate option B.');
  ws.sync();
  const reloaded = createWorkspace(opts);
  assert.equal(reloaded.get().projects[0].id, id);
  assert.match(reloaded.prepareLaunch(id).prompt, /Investigate option B/);
  assert.equal(fs.readFileSync(note, 'utf8'), '# Decisions\nInvestigate option B.');
});

test('research inherits Haiku, explicit assignment and model override rules', t => {
  const { ws, id } = fixture(t);
  ws.upsertTask(id, { title: 'Investigate', type: 'research' });
  const task = ws.get().projects[0].tasks[0];
  assert.equal(ws.prepareLaunch(id, task.id).model, 'haiku');
  ws.upsertTask(id, { ...task, agentId: 'codex', model: '' });
  assert.equal(ws.prepareLaunch(id, task.id).agentId, 'codex');
  assert.equal(ws.prepareLaunch(id, task.id).model, '');
  ws.upsertTask(id, { ...task, agentId: 'claude', model: 'sonnet' });
  assert.equal(ws.prepareLaunch(id, task.id).model, 'sonnet');
});

test('launch success marks task doing; launch failure leaves project untouched', async t => {
  const payloads = [];
  const { ws, id } = fixture(t, async p => payloads.push(p));
  ws.upsertTask(id, { title: 'Research', type: 'research' });
  await ws.launch(id);
  assert.equal(payloads[0].model, 'haiku');
  assert.equal(ws.get().projects[0].tasks[0].status, 'doing');
  assert.ok(ws.get().projects[0].lastOpened);
  const other = fixture(t, async () => { throw new Error('CLI missing'); });
  await assert.rejects(other.ws.launch(other.id), /CLI missing/);
  assert.equal(other.ws.get().projects[0].lastOpened, null);
});

test('category changes and vault changes preserve user documentation', t => {
  const { ws, id, root, projectPath } = fixture(t);
  ws.updateContext(id, 'Custom notes');
  ws.upsertProject({ id, name: 'Work', path: projectPath, category: 'work' });
  assert.equal(ws.get().projects[0].context, 'Custom notes');
  const s = ws.get(); s.vaultPath = path.join(root, 'OtherVault'); ws.settings(s);
  assert.equal(ws.get().projects[0].context, 'Custom notes');
  assert.ok(fs.existsSync(path.join(s.vaultPath, 'Trabajo', id, 'Tareas.md')));
});

test('invalid models, duplicate folders and missing folders are rejected', t => {
  const { ws, id, projectPath } = fixture(t);
  assert.throws(() => ws.upsertTask(id, { title: 'Bad', type: 'research', model: 'haiku; Start-Process calc' }), /modelo/);
  assert.throws(() => ws.upsertProject({ name: 'Duplicate', path: projectPath, category: 'work' }), /ya está/);
  assert.throws(() => ws.upsertProject({ name: 'Missing', path: projectPath + '-missing', category: 'work' }), /no existe/);
  const config = ws.get(); config.rules[0].agentId = 'unknown';
  assert.throws(() => ws.settings(config), /agente activo/);
  assert.equal(ws.get().rules[0].agentId, 'claude');
});

test('disabled agents and blocked tasks cannot launch', t => {
  const { ws, id } = fixture(t);
  ws.upsertTask(id, { title: 'Blocked', type: 'research', status: 'blocked' });
  assert.throws(() => ws.prepareLaunch(id, ws.get().projects[0].tasks[0].id), /pendiente/);
  const config = ws.get(); config.agents[0].enabled = false;
  config.rules.forEach(r => { r.agentId = 'codex'; r.model = ''; }); ws.settings(config);
  ws.upsertTask(id, { title: 'Disabled', type: 'research', agentId: 'claude' });
  assert.throws(() => ws.prepareLaunch(id), /desactivado/);
});

test('HTTP rejects cross-origin writes, wrong tokens and malformed JSON', async t => {
  const { ws } = fixture(t);
  const server = http.createServer(async (req, res) => { if (!await handleWorkspace(req, res, ws)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/workspace')).status, 200);
  assert.equal((await fetch(base + '/api/workspace/sync', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/workspace/sync', { method: 'POST', headers: { 'X-Office-Token': ws.token, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/workspace/sync', { method: 'POST', headers: { 'X-Office-Token': ws.token }, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/workspace/sync', { method: 'POST', headers: { 'X-Office-Token': ws.token }, body: '{}' })).status, 200);
});
