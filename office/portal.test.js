const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createWorkspace } = require('./workspace');
const { createPortal, handlePortal } = require('./portal');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'htdocs'); fs.mkdirSync(root);
  for (const name of ['PersonalApp', 'WorkApp', 'form_respaldo', 'dashboard']) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'index.php'), '<?php'); }
  const workspace = createWorkspace({ home, baseConfig: () => ({ agents: [{ id: 'claude', logs: 'claude' }] }) });
  const portal = createPortal({ workspace, root, dataDir: path.join(home, 'data'), runner: () => ({ stop() {} }) });
  return { home, root, workspace, portal };
}

test('htdocs discovery never imports or changes source files and flags infrastructure/backups', t => {
  const { portal, workspace, root } = fixture(t);
  const result = portal.discover();
  assert.equal(result.projects.length, 4);
  assert.equal(workspace.get().projects.length, 0);
  assert.ok(result.projects.find(p => p.name === 'dashboard').infrastructure);
  assert.ok(result.projects.find(p => p.name === 'form_respaldo').backup);
  assert.equal(fs.readFileSync(path.join(root, 'WorkApp', 'index.php'), 'utf8'), '<?php');
});

test('import requires explicit category for every selection and rejects forged paths', t => {
  const { portal, workspace } = fixture(t);
  const candidates = portal.discover().projects;
  assert.throws(() => portal.importProjects({ projects: [{ key: candidates[0].key }] }), /Personal o Trabajo/);
  assert.throws(() => portal.importProjects({ projects: [{ key: 'C:\\Windows', category: 'work' }] }), /disponible/);
  assert.equal(workspace.get().projects.length, 0);
  const result = portal.importProjects({ projects: [
    { key: candidates.find(p => p.name === 'PersonalApp').key, category: 'personal' },
    { key: candidates.find(p => p.name === 'WorkApp').key, category: 'work' },
  ] });
  assert.equal(result.imported, 2);
  assert.equal(workspace.get().projects.find(p => p.name === 'WorkApp').category, 'work');
  assert.ok(portal.discover().projects.find(p => p.name === 'PersonalApp').imported);
  assert.throws(() => portal.importProjects({ projects: [{ key: candidates.find(p => p.name === 'WorkApp').key, category: 'personal' }] }), /ya fue/);
});

test('notes and graph resolve relative wiki links without confusing repeated Contexto titles', t => {
  const { portal, workspace } = fixture(t);
  portal.importProjects({ projects: portal.discover().projects.slice(0, 2).map(p => ({ key: p.key, category: 'personal' })) });
  const [a, b] = workspace.get().projects;
  workspace.updateContext(a.id, '# Specific context\n\n[[Tareas]]\n[[https://invalid.test]]');
  const graph = portal.notes();
  const aFolder = path.dirname(path.relative(graph.vaultPath, a.notePath)).split(path.sep).join('/');
  assert.ok(graph.links.some(e => e.source === aFolder + '/Proyecto.md' && e.target === aFolder + '/Contexto.md'));
  assert.ok(!graph.links.some(e => e.source === aFolder + '/Proyecto.md' && e.target.includes(b.id)));
  assert.ok(portal.notes(a.id).notes.every(n => n.projectId === a.id));
  const vault = workspace.get().vaultPath;
  fs.writeFileSync(path.join(vault, '.env'), 'secret');
  fs.writeFileSync(path.join(vault, 'ignored.json'), '{}');
  assert.ok(portal.notes().notes.every(n => n.id.endsWith('.md') && !n.id.startsWith('.')));
});

test('portal HTTP prevents cross-origin imports and preserves multibyte prompts', async t => {
  const { portal, workspace } = fixture(t);
  const server = http.createServer(async (req, res) => { if (!await handlePortal(req, res, portal, workspace.token)) res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/portal/`;
  assert.equal((await fetch(base + 'discover')).status, 200);
  assert.equal((await fetch(base + 'import', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(base + 'notes', { headers: { Origin: 'http://elsewhere.test' } })).status, 403);
  assert.equal((await fetch(base + 'import', { method: 'POST', headers: { 'X-Office-Token': workspace.token }, body: '{' })).status, 400);
});
