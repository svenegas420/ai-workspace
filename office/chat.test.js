const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspace } = require('./workspace');
const { createChatService, normalizeEvent } = require('./chat');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const projectPath = path.join(home, 'source'); fs.mkdirSync(projectPath);
  const ws = createWorkspace({ home, baseConfig: () => ({ agents: [{ id: 'claude', logs: 'claude' }, { id: 'codex', logs: 'codex' }] }) });
  ws.upsertProject({ name: 'Test', path: projectPath, category: 'personal' }); const p = ws.get().projects[0];
  ws.updateContext(p.id, '# Decisions\nPrefer small changes.');
  const runs = [];
  const runner = (payload, update, close) => { const run = { payload, update, close, stopped: false }; runs.push(run); return { stop() { run.stopped = true; } }; };
  const opts = { workspace: ws, dataDir: path.join(home, 'data'), runner };
  const service = createChatService(opts);
  return { ws, p, service, runs, opts, home };
}

test('task route selects research Haiku and includes current context in every message', t => {
  const { ws, p, service, runs } = fixture(t);
  ws.upsertTask(p.id, { title: 'Investigate graph', type: 'research' });
  const c = service.create({ projectId: p.id, taskId: ws.get().projects[0].tasks[0].id });
  assert.equal(c.model, 'haiku'); assert.equal(c.agentId, 'claude');
  service.send(c.id, '¿Qué recomiendas?');
  assert.match(runs[0].payload.prompt, /Prefer small changes/);
  assert.match(runs[0].payload.prompt, /¿Qué recomiendas/);
  assert.equal(runs[0].payload.allowChanges, false);
  runs[0].update({ type: 'delta', text: 'Hola ' }); runs[0].update({ type: 'delta', text: 'Sebastián' }); runs[0].update({ type: 'result', text: 'Hola Sebastián' }); runs[0].close(0);
  assert.equal(ws.get().projects[0].tasks[0].status, 'doing');
  assert.ok(ws.get().projects[0].lastOpened);
  assert.equal(service.get(c.id).messages.at(-2).text, 'Hola Sebastián');
  assert.equal(service.get(c.id).status, 'running');
  assert.equal(runs[1].payload.provider, 'codex');
  assert.match(runs[1].payload.prompt, /Hola Sebastián/);
  runs[1].update({ type: 'block', text: 'Revisión de Codex' }); runs[1].close(0);
  ws.updateContext(p.id, 'Updated decisions'); service.send(c.id, 'Continúa');
  assert.match(runs[2].payload.prompt, /Updated decisions/);
  assert.match(runs[2].payload.prompt, /Revisión de Codex/);
  runs[2].close(1);
});

test('general conversation stays unassigned; explicit provider overrides do not inherit Haiku', t => {
  const { ws, p, service } = fixture(t);
  ws.upsertTask(p.id, { title: 'Research', type: 'research' });
  const general = service.create({ projectId: p.id }); assert.equal(general.taskId, '');
  const c = service.create({ projectId: p.id, taskId: ws.get().projects[0].tasks[0].id, agentId: 'codex', allowChanges: true });
  assert.equal(c.model, ''); assert.equal(c.allowChanges, true);
  assert.throws(() => service.create({ projectId: p.id, model: 'bad;command' }), /Modelo/);
});

test('same-project concurrent runs are rejected and stop holds lock until process exits', t => {
  const { p, service, runs } = fixture(t);
  const a = service.create({ projectId: p.id }), b = service.create({ projectId: p.id });
  service.send(a.id, 'First');
  assert.throws(() => service.send(b.id, 'Second'), /trabajando/);
  service.stop(a.id); assert.equal(runs[0].stopped, true);
  assert.throws(() => service.send(b.id, 'Second'), /trabajando/);
  runs[0].close(1); assert.equal(service.get(a.id).status, 'stopped');
  service.send(b.id, 'Second'); runs[1].close(0);
});

test('conversation persists and exports into Obsidian; restart recovers interrupted response', t => {
  const { service, opts, p } = fixture(t);
  const c = service.create({ projectId: p.id }); service.send(c.id, 'Keep this request');
  const reloaded = createChatService(opts); const chat = reloaded.get(c.id);
  assert.equal(chat.status, 'interrupted'); assert.equal(chat.messages[0].text, 'Keep this request');
  const note = path.join(path.dirname(p.notePath), 'Conversaciones', c.id + '.md');
  assert.match(fs.readFileSync(note, 'utf8'), /Keep this request/);
});

test('CLI errors remain visible and do not leave project permanently busy', t => {
  const { p, service, runs } = fixture(t);
  const c = service.create({ projectId: p.id }); service.send(c.id, 'Hello');
  runs[0].update({ type: 'error', text: 'Authentication required' }); runs[0].close(1);
  assert.equal(service.get(c.id).status, 'error'); assert.match(service.get(c.id).messages.at(-1).text, /Authentication/);
  service.send(c.id, 'Try again'); runs[1].close(1, 'Model unavailable');
  assert.match(service.get(c.id).messages.at(-1).text, /Model unavailable/);
});

test('normalizers omit tool inputs and thinking, expose text and denied permissions', () => {
  assert.deepEqual(normalizeEvent('claude', { type: 'stream_event', event: { delta: { type: 'thinking_delta', thinking: 'private' } } }), []);
  assert.deepEqual(normalizeEvent('claude', { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Hello' } } }), [{ type: 'delta', text: 'Hello' }]);
  assert.deepEqual(normalizeEvent('codex', { type: 'item.completed', item: { type: 'agent_message', text: 'Answer' } }), [{ type: 'block', text: 'Answer' }]);
  assert.equal(normalizeEvent('claude', { type: 'result', permission_denials: [{ tool_name: 'Bash', tool_input: 'secret' }] }).at(-1).type, 'denied');
  assert.ok(!JSON.stringify(normalizeEvent('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'secret' } }] } })).includes('secret'));
});

test('every turn runs both providers sequentially; only the responsible agent may write', t => {
  const { p, service, runs } = fixture(t);
  const c = service.create({ projectId: p.id, agentId: 'codex', allowChanges: true });
  assert.equal(c.collaboration, true); assert.deepEqual(c.participants.map(p => p.provider), ['codex', 'claude']);
  service.send(c.id, 'Fix the issue');
  assert.equal(runs.length, 1); assert.equal(runs[0].payload.allowChanges, true);
  runs[0].update({ type: 'block', text: 'Implemented the change' }); runs[0].close(0);
  assert.equal(runs.length, 2); assert.equal(runs[1].payload.allowChanges, false);
  assert.match(runs[1].payload.prompt, /Implemented the change/); assert.match(runs[1].payload.prompt, /SOLO LECTURA/);
  assert.equal(service.get(c.id).phase, 'review');
  const another = service.create({ projectId: p.id });
  assert.throws(() => service.send(another.id, 'Concurrent change'), /trabajando/);
  runs[1].update({ type: 'block', text: 'Verified the proposal' }); runs[1].close(0);
  const result = service.get(c.id); assert.equal(result.status, 'idle'); assert.equal(result.phase, 'done');
  assert.deepEqual(result.messages.slice(1).map(m => m.agentId), ['codex', 'claude']);
  const note = fs.readFileSync(path.join(path.dirname(p.notePath), 'Conversaciones', c.id + '.md'), 'utf8');
  assert.match(note, /Revisión cruzada/); assert.match(note, /Verified the proposal/);
});

test('review failure keeps responsible output and cancellation never starts a third process', t => {
  const { p, service, runs } = fixture(t);
  const c = service.create({ projectId: p.id }); service.send(c.id, 'Work');
  runs[0].update({ type: 'block', text: 'Primary result' }); runs[0].close(0);
  runs[1].close(1, 'Review unavailable');
  assert.equal(service.get(c.id).status, 'error'); assert.equal(service.get(c.id).messages.at(-2).text, 'Primary result');
  assert.match(service.get(c.id).messages.at(-1).text, /Review unavailable/);
  service.send(c.id, 'Retry'); runs[2].update({ type: 'block', text: 'New result' }); runs[2].close(0);
  service.stop(c.id); assert.ok(runs[3].stopped); runs[3].close(1);
  assert.equal(service.get(c.id).status, 'stopped'); assert.equal(runs.length, 4);
});

test('missing or disabled partner blocks combined work without silently using one agent', t => {
  const { ws, p, service } = fixture(t);
  const c = service.create({ projectId: p.id, agentId: 'claude' });
  const config = ws.get(); config.agents.find(a => a.id === 'codex').enabled = false;
  config.rules.forEach(r => { r.agentId = 'claude'; r.model = ''; }); ws.settings(config);
  assert.throws(() => service.send(c.id, 'Hello'), /Claude y Codex activos/);
  assert.throws(() => service.create({ projectId: p.id }), /Claude y Codex activos/);
  assert.equal(service.get(c.id).messages.length, 0);
});

test('existing single-agent conversation upgrades on its next message and retains all history', t => {
  const { p, service, opts, runs } = fixture(t);
  const c = service.create({ projectId: p.id, agentId: 'claude' });
  const file = path.join(opts.dataDir, 'chats', c.id + '.json');
  const legacy = JSON.parse(fs.readFileSync(file)); delete legacy.participants; delete legacy.collaboration;
  legacy.messages.push({ role: 'user', text: 'Previous request', created: c.created, status: 'sent' }); fs.writeFileSync(file, JSON.stringify(legacy));
  const upgraded = createChatService(opts); upgraded.send(c.id, 'Continue');
  assert.equal(upgraded.get(c.id).participants.length, 2); assert.match(runs[0].payload.prompt, /Previous request/);
  runs[0].close(1);
});

test('disabling the reviewer during the first stage prevents its CLI from starting', t => {
  const { ws, p, service, runs } = fixture(t);
  const c = service.create({ projectId: p.id, agentId: 'codex' }); service.send(c.id, 'Work');
  const config = ws.get(); config.agents.find(a => a.id === 'claude').enabled = false;
  config.rules.forEach(r => { r.agentId = 'codex'; r.model = ''; }); ws.settings(config);
  runs[0].update({ type: 'block', text: 'Result' }); runs[0].close(0);
  assert.equal(runs.length, 1); assert.equal(service.get(c.id).status, 'error');
  assert.match(service.get(c.id).messages.at(-1).text, /desactivó/);
});

test('atomic note replacement retries a transient Windows sharing lock without losing the previous file', t => {
  const { home } = fixture(t), { atomic } = require('./storage');
  const file = path.join(home, 'note.md'); fs.writeFileSync(file, 'previous');
  const rename = fs.renameSync; let attempts = 0;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === file && attempts++ === 0) throw Object.assign(new Error('Sharing lock'), { code: 'EPERM' });
    return rename(source, target);
  });
  atomic(file, 'updated'); assert.equal(fs.readFileSync(file, 'utf8'), 'updated');
  assert.equal(attempts, 2); assert.equal(fs.readdirSync(home).filter(n => n.endsWith('.tmp')).length, 0);
});
