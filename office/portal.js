const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createChatService } = require('./chat');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const inside = (root, file) => { const rel = path.relative(root, file); return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };

function createPortal({ workspace, root = 'C:\\xampp\\htdocs', dataDir = path.join(os.homedir(), '.ai-workspace'), runner, baseConfig }) {
  const chat = createChatService({ workspace, dataDir, runner, baseConfig });
  function discover() {
    const existing = workspace.get().projects;
    if (!fs.existsSync(root)) return { root, projects: [], warning: 'No se encontró la carpeta htdocs.' };
    const projects = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => {
      const dir = path.join(root, e.name);
      if (!inside(fs.realpathSync(root), fs.realpathSync(dir))) return null;
      const markers = ['package.json', 'composer.json', 'index.php', 'index.html', 'README.md', 'AGENTS.md', '.git'].filter(file => fs.existsSync(path.join(dir, file)));
      return { key: crypto.createHash('sha256').update(dir).digest('hex').slice(0, 20), name: e.name, path: dir, markers, infrastructure: ['dashboard', 'img', 'webalizer', 'xampp'].includes(e.name.toLowerCase()), backup: /respaldo|backup|\d{8}/i.test(e.name), imported: existing.some(p => p.path.toLowerCase() === dir.toLowerCase()) };
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    return { root, projects };
  }
  function importProjects(input) {
    if (!Array.isArray(input.projects) || !input.projects.length || input.projects.length > 100) fail('Selecciona al menos un proyecto y su categoría.');
    const candidates = discover().projects;
    const seen = new Set();
    const selections = input.projects.map(item => {
      const p = candidates.find(p => p.key === item.key);
      if (!p || p.imported || seen.has(p.key)) fail('Un proyecto ya fue importado o ya no está disponible. Actualiza la lista.');
      if (!['personal', 'work'].includes(item.category)) fail('Elige Personal o Trabajo para cada proyecto seleccionado.');
      seen.add(p.key); return { name: p.name, path: p.path, category: item.category, description: '' };
    });
    for (const selection of selections) workspace.upsertProject(selection);
    return { imported: selections.length, workspace: workspace.get(), discovery: discover() };
  }
  function notes(projectId = '') {
    const ws = workspace.get();
    if (projectId && !ws.projects.some(p => p.id === projectId)) fail('Proyecto no encontrado.');
    const vault = fs.realpathSync(ws.vaultPath), files = [];
    function walk(dir, depth = 0) {
      if (depth > 10 || files.length >= 1500) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.md') && fs.statSync(file).size <= 512 * 1024) {
          const id = path.relative(vault, file).split(path.sep).join('/');
          const p = ws.projects.find(p => inside(path.dirname(p.notePath), file));
          if (projectId && p?.id !== projectId) continue;
          const content = fs.readFileSync(file, 'utf8');
          files.push({ id, title: content.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, '.md'), content, projectId: p?.id || '', category: p?.category || 'office', updated: fs.statSync(file).mtimeMs });
        }
      }
    }
    walk(vault);
    const links = [], linkKeys = new Set();
    for (const file of files) {
      for (const match of file.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
        let target = match[1].trim().replace(/\\/g, '/').replace(/\.md$/i, '');
        const local = path.posix.normalize(path.posix.join(path.posix.dirname(file.id), target)) + '.md';
        const exact = files.find(f => f.id === local) || files.find(f => f.id === target + '.md');
        const byName = files.filter(f => path.posix.basename(f.id, '.md') === target);
        const found = exact || (byName.length === 1 ? byName[0] : null);
        if (found && found.id !== file.id) {
          const key = [file.id, found.id].sort().join('|');
          if (!linkKeys.has(key)) { links.push({ source: file.id, target: found.id }); linkKeys.add(key); }
        }
      }
    }
    return { vaultPath: ws.vaultPath, notes: files, links, limited: files.length >= 1500 };
  }
  return { discover, importProjects, notes, chat };
}

async function handlePortal(req, res, portal, token) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/portal/')) return false;
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  try {
    const host = req.headers.host;
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host || '') || (req.headers.origin && req.headers.origin !== `http://${host}`)) { send(403, { error: 'Origen no permitido.' }); return true; }
    const route = url.pathname.slice('/api/portal/'.length);
    if (req.method === 'GET') {
      if (route === 'discover') send(200, portal.discover());
      else if (route === 'notes') send(200, portal.notes(url.searchParams.get('projectId') || ''));
      else if (route === 'chats') send(200, { chats: portal.chat.list() });
      else if (route === 'chat') send(200, portal.chat.get(url.searchParams.get('id')));
      else if (route === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        const latest = new Map();
        const flush = () => { for (const data of latest.values()) { if (!res.writableEnded && res.writableLength < 1024 * 1024) res.write(`event: chat\ndata: ${JSON.stringify(data)}\n\n`); } latest.clear(); };
        const unsubscribe = portal.chat.subscribe(data => { latest.set(data.id, data); if (data.status !== 'running') flush(); });
        const pulse = setInterval(flush, 100), heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
        res.on('close', () => { clearInterval(pulse); clearInterval(heartbeat); unsubscribe(); });
      } else send(404, { error: 'Ruta no encontrada.' });
      return true;
    }
    if (req.method !== 'POST') { send(405, { error: 'Método no permitido.' }); return true; }
    if (req.headers['x-office-token'] !== token) { send(403, { error: 'Recarga la oficina para autorizar la operación.' }); return true; }
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 256 * 1024) fail('Solicitud demasiado grande.'); chunks.push(chunk); }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('JSON inválido.'); }
    if (!input || typeof input !== 'object') fail('Solicitud inválida.');
    if (route === 'import') send(200, portal.importProjects(input));
    else if (route === 'chat/create') send(200, portal.chat.create(input));
    else if (route === 'chat/send') send(200, portal.chat.send(input.id, input.text));
    else if (route === 'chat/stop') send(200, portal.chat.stop(input.id));
    else send(404, { error: 'Ruta no encontrada.' });
  } catch (e) { console.error('portal:', e.message); if (!res.headersSent) send(e.status || 500, { error: e.message }); }
  return true;
}
module.exports = { createPortal, handlePortal };
