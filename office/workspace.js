// Persistent office workspace. No shell interpolation or external dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { atomic } = require('./storage');

const TYPES = ['research', 'implementation', 'review', 'tests', 'documentation'];
const PROVIDERS = ['claude', 'codex', 'gemini'];
const LABELS = { research: 'Investigación', implementation: 'Implementación', review: 'Revisión', tests: 'Pruebas', documentation: 'Documentación' };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function string(value, max = 200, required = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) fail('Texto inválido o demasiado largo.');
  return value.trim();
}
function choice(value, values) { if (!values.includes(value)) fail('Opción inválida.'); return value; }
// Contact pictures: a preset from the gallery or a small raster image (never SVG, so no script can ride along).
const AVATAR_PRESET = /^preset:[a-z0-9-]{1,40}$/;
const AVATAR_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
function avatarValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 120000 || !(AVATAR_PRESET.test(value) || AVATAR_IMAGE.test(value))) fail('Imagen de contacto inválida.');
  return value;
}
// Saved YouTube Music links: only video/playlist IDs are stored, never arbitrary URLs.
const YT_ID = /^[A-Za-z0-9_-]{6,80}$/;
function musicItems(items) {
  if (!Array.isArray(items) || items.length > 200) fail('La lista de música admite hasta 200 elementos.');
  const seen = new Set();
  return items.map(item => {
    const id = string(item?.id, 40, true), title = string(item?.title || '', 200);
    const videoId = item?.videoId ? string(item.videoId, 80) : '', listId = item?.listId ? string(item.listId, 80) : '';
    if (!/^[a-z0-9-]+$/.test(id) || seen.has(id)) fail('Identificador de canción inválido.');
    if ((!videoId && !listId) || (videoId && !YT_ID.test(videoId)) || (listId && !YT_ID.test(listId))) fail('Enlace de YouTube Music inválido.');
    seen.add(id);
    return { id, title: title || (listId ? 'Playlist' : 'Canción'), videoId, listId };
  });
}
const jsonText = data => JSON.stringify(data, null, 2) + '\n';
const md = value => String(value || '').replace(/[\r\n]/g, ' ').replace(/[[\]<>|]/g, '');

function createWorkspace(options = {}) {
  const home = options.home || os.homedir();
  const dataDir = options.dataDir || path.join(home, '.ai-workspace');
  const file = path.join(dataDir, 'workspace.json');
  const baseConfig = options.baseConfig || (() => ({}));
  const token = crypto.randomBytes(32).toString('hex');
  let state;
  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.projects)) throw new Error('Formato de workspace no compatible.');
  } else {
    const agents = (baseConfig().agents || []).filter(a => a && a.id).map(a => ({
      id: a.id, name: a.name || a.id, role: a.role || 'executor', color: a.color || '#9295a6',
      provider: PROVIDERS.includes(a.logs) ? a.logs : a.command === 'gemini' ? 'gemini' : 'claude',
      enabled: a.enabled !== false, model: '', instructions: '',
    }));
    const claude = agents.find(a => a.provider === 'claude' && a.enabled);
    const coder = agents.find(a => a.provider === 'codex' && a.enabled) || claude;
    state = { version: 1, vaultPath: path.join(home, 'Documents', 'Oficina'), agents,
      rules: TYPES.map(type => ({ type, agentId: (type === 'research' ? claude : coder)?.id || agents[0]?.id || '', model: type === 'research' && claude ? 'haiku' : '' })), projects: [] };
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const project = id => state.projects.find(p => p.id === id) || fail('Proyecto no encontrado.');
  const folder = p => path.join(state.vaultPath, p.category === 'work' ? 'Trabajo' : 'Personales', p.id);
  const context = p => {
    const f = path.join(folder(p), 'Contexto.md');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, 64000) : '';
  };
  function effective(task) {
    const rule = state.rules.find(r => r.type === task.type);
    const agentId = task.agentId || rule?.agentId;
    const agent = state.agents.find(a => a.id === agentId);
    return { agent, model: task.model || (task.agentId && task.agentId !== rule?.agentId ? '' : rule?.model) || agent?.model || '' };
  }
  function sync() {
    fs.mkdirSync(path.join(state.vaultPath, '.obsidian'), { recursive: true });
    atomic(path.join(state.vaultPath, 'Configuracion.md'), '# Configuración de la oficina\n\nEste archivo se genera desde la oficina. Edita las reglas en Configuración.\n\n' + state.agents.map(a => `- **${md(a.name)}** · ${a.provider} · ${a.role} · ${a.enabled ? 'activo' : 'desactivado'} · modelo: ${md(a.model) || 'predeterminado'}\n  ${md(a.instructions)}`).join('\n') + '\n\n## Reglas por tarea\n\n' + state.rules.map(r => `- ${LABELS[r.type]} → ${md(r.agentId)} / ${md(r.model) || 'modelo del agente'}`).join('\n') + '\n');
    atomic(path.join(state.vaultPath, 'Oficina.json'), jsonText(state));
    for (const [category, title] of [['personal', 'Personales'], ['work', 'Trabajo']]) {
      atomic(path.join(state.vaultPath, title + '.md'), `# ${title}\n\n` + state.projects.filter(p => p.category === category).map(p => `- [[${title}/${p.id}/Proyecto|${md(p.name)}]] · ${p.status}`).join('\n') + '\n');
    }
    atomic(path.join(state.vaultPath, 'Inicio.md'), '# Oficina de Agentes\n\n[[Personales]] · [[Trabajo]] · [[Configuracion]]\n\nAbre http://localhost:4777 para configurar y retomar proyectos.\n\nCada proyecto tiene un Contexto.md editable: guarda allí decisiones, resultados, enlaces y próximos pasos. La oficina lo lee al retomar una tarea. Proyecto.md y Tareas.md se regeneran desde la oficina. Los archivos de código permanecen en su carpeta original.\n');
    for (const p of state.projects) {
      const dir = folder(p);
      fs.mkdirSync(dir, { recursive: true });
      atomic(path.join(dir, 'Proyecto.md'), `# ${md(p.name)}\n\n- Carpeta: ${md(p.path)}\n- Categoría: ${p.category === 'work' ? 'Trabajo' : 'Personal'}\n- Estado: ${p.status}\n- Última apertura: ${p.lastOpened || 'Nunca'}\n\n${p.description}\n\n[[Contexto]] · [[Tareas]]\n`);
      atomic(path.join(dir, 'Tareas.md'), '# Tareas\n\n' + p.tasks.map(t => {
        const route = effective(t);
        return `- [${t.status === 'done' ? 'x' : ' '}] ${md(t.title)} · ${t.status} · ${LABELS[t.type]} · ${md(route.agent?.name || 'Sin agente')} / ${md(route.model) || 'predeterminado'}\n  ${md(t.details)}`;
      }).join('\n') + '\n');
      const cf = path.join(dir, 'Contexto.md');
      if (!fs.existsSync(cf)) fs.writeFileSync(cf, '# Contexto\n\n## Objetivo\n\n## Decisiones y resultados\n\n## Próximos pasos\n', { encoding: 'utf8', flag: 'wx' });
    }
  }
  function save() { sync(); atomic(file, jsonText(state)); }
  function validateRoute(agentId, model) {
    if (agentId && !state.agents.some(a => a.id === agentId)) fail('Agente desconocido.');
    string(model, 120);
    if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) fail('Identificador de modelo inválido.');
  }
  function get() {
    return { ...clone(state), token, taskTypes: LABELS, projects: state.projects.map(p => ({ ...clone(p), context: context(p), notePath: path.join(folder(p), 'Proyecto.md'), tasks: p.tasks.map(t => { const e = effective(t); return { ...clone(t), effectiveAgent: e.agent?.name || '', effectiveModel: e.model }; }) })) };
  }
  function settings(input) {
    if (!Array.isArray(input.agents) || input.agents.length < 1 || input.agents.length > 20) fail('Configura entre 1 y 20 agentes.');
    const agents = input.agents.map(a => {
      const id = string(a.id, 60, true);
      if (!/^[a-z][a-z0-9-]*$/.test(id)) fail('ID de agente inválido.');
      const model = string(a.model || '', 120);
      if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) fail('Modelo inválido.');
      if (!/^#[0-9a-f]{6}$/i.test(a.color)) fail('Color inválido.');
      return { id, name: string(a.name, 100, true), provider: choice(a.provider, PROVIDERS), role: choice(a.role, ['lead', 'executor', 'reviewer']), color: a.color, enabled: !!a.enabled, model, instructions: string(a.instructions || '', 8000), avatar: avatarValue(a.avatar) };
    });
    if (new Set(agents.map(a => a.id)).size !== agents.length) fail('Los IDs de agentes deben ser únicos.');
    if (!agents.some(a => a.enabled)) fail('Activa al menos un agente.');
    if (state.projects.some(p => p.tasks.some(t => t.agentId && !agents.some(a => a.id === t.agentId)))) fail('Hay tareas asignadas a un agente eliminado.');
    const rules = TYPES.map(type => {
      const r = input.rules?.find(r => r.type === type);
      if (!r || !agents.some(a => a.id === r.agentId && a.enabled)) fail('Cada tipo de tarea necesita un agente activo.');
      const model = string(r.model || '', 120);
      if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) fail('Modelo inválido.');
      return { type, agentId: r.agentId, model };
    });
    const vaultPath = path.resolve(string(input.vaultPath, 1000, true).replace(/^~(?=$|[\\/])/, home));
    if (path.basename(vaultPath).startsWith('.') || vaultPath === path.parse(vaultPath).root || vaultPath === home) fail('Elige una carpeta dedicada a la bóveda.');
    if (vaultPath !== state.vaultPath && state.projects.length) {
      // Move is deliberately avoided: preserve the old vault and every user note.
      for (const p of state.projects) {
        const source = folder(p);
        const dest = path.join(vaultPath, p.category === 'work' ? 'Trabajo' : 'Personales', p.id);
        if (fs.existsSync(dest)) fail('La bóveda de destino ya contiene uno de estos proyectos.');
        if (fs.existsSync(source)) fs.cpSync(source, dest, { recursive: true, errorOnExist: true, force: false });
      }
    }
    state = { ...state, agents, rules, vaultPath }; save(); return get();
  }
  function setAvatar(agentId, avatar) {
    const agent = state.agents.find(a => a.id === agentId) || fail('Agente desconocido.');
    agent.avatar = avatarValue(avatar); atomic(file, jsonText(state)); return get();
  }
  function setMusic(items) { state.music = musicItems(items); atomic(file, jsonText(state)); return get(); }
  function upsertProject(input) {
    const previous = input.id ? project(input.id) : null;
    const dir = path.resolve(string(input.path, 1000, true).replace(/^~(?=$|[\\/])/, home));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('La carpeta del proyecto no existe.');
    if (state.projects.some(p => p.id !== previous?.id && p.path.toLowerCase() === dir.toLowerCase())) fail('Esta carpeta ya está guardada.');
    const p = { id: previous?.id || crypto.randomUUID(), name: string(input.name, 100, true), path: dir,
      category: choice(input.category, ['personal', 'work']), status: choice(input.status || 'active', ['active', 'paused', 'archived']), description: string(input.description || '', 12000), tasks: previous?.tasks || [], created: previous?.created || new Date().toISOString(), lastOpened: previous?.lastOpened || null };
    if (previous && previous.category !== p.category && fs.existsSync(folder(previous))) {
      fs.mkdirSync(path.dirname(folder(p)), { recursive: true }); fs.renameSync(folder(previous), folder(p));
    }
    if (previous) state.projects[state.projects.indexOf(previous)] = p; else state.projects.push(p);
    save(); return get();
  }
  function upsertTask(projectId, input) {
    const p = project(projectId);
    const previous = input.id ? p.tasks.find(t => t.id === input.id) : null;
    if (input.id && !previous) fail('Tarea no encontrada.');
    const agentId = string(input.agentId || '', 60), model = string(input.model || '', 120);
    validateRoute(agentId, model);
    const t = { id: previous?.id || crypto.randomUUID(), title: string(input.title, 180, true), details: string(input.details || '', 16000), type: choice(input.type, TYPES), status: choice(input.status || 'todo', ['todo', 'doing', 'done', 'blocked']), agentId, model };
    if (previous) p.tasks[p.tasks.indexOf(previous)] = t; else p.tasks.push(t);
    save(); return get();
  }
  function updateContext(projectId, text) {
    const p = project(projectId); string(text, 64000);
    atomic(path.join(folder(p), 'Contexto.md'), text); return get();
  }
  function prepareLaunch(projectId, taskId, autoTask = true) {
    const p = project(projectId);
    if (!fs.existsSync(p.path)) fail('La carpeta del proyecto ya no existe.');
    const task = taskId ? p.tasks.find(t => t.id === taskId) : autoTask ? p.tasks.find(t => t.status === 'doing') || p.tasks.find(t => t.status === 'todo') : null;
    if (taskId && !task) fail('Tarea no encontrada.');
    if (task && ['done', 'blocked'].includes(task.status)) fail('Selecciona una tarea pendiente o en curso.');
    const { agent, model } = effective(task || { type: 'implementation' });
    if (!agent?.enabled) fail('El agente asignado está desactivado. Revisa la configuración.');
    const prompt = `Retoma el proyecto ${p.name}.\nCarpeta: ${p.path}\n${p.description}\n\nRol: ${agent.role}\n${agent.instructions}\n\n${task ? `Tarea: ${task.title}\nTipo: ${LABELS[task.type]}\n${task.details}` : 'Revisa el contexto y los pendientes antes de continuar.'}\n\nContexto documentado:\n${context(p)}\n\nDocumentación del proyecto: ${folder(p)}\nLee también PLAN.md y AGENTS.md del repositorio si existen. Al terminar, actualiza Contexto.md con resultados, decisiones y próximos pasos. No sobrescribas notas existentes ni hagas commit o push sin autorización.`;
    return { projectId: p.id, taskId: task?.id || '', cwd: p.path, documentationPath: folder(p), agentId: agent.id, provider: agent.provider, model, prompt };
  }
  function markStarted(projectId, taskId) {
    const p = project(projectId);
    p.lastOpened = new Date().toISOString(); p.status = 'active';
    const task = p.tasks.find(t => t.id === taskId);
    if (task && task.status === 'todo') task.status = 'doing';
    save();
  }
  async function launch(projectId, taskId) {
    const payload = prepareLaunch(projectId, taskId);
    if (options.launch) await options.launch(payload);
    else {
      if (process.platform !== 'win32') fail('El lanzador requiere Windows.');
      const runFile = path.join(dataDir, 'runs', crypto.randomUUID() + '.json');
      atomic(runFile, jsonText(payload));
      await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'launch-task.ps1'), '-PayloadFile', runFile], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let error = ''; child.stderr.on('data', b => { error += b.toString(); });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Object.assign(new Error(error.slice(0, 1000) || 'No se pudo abrir la terminal.'), { status: 400 })));
      });
    }
    const p = project(projectId); p.lastOpened = new Date().toISOString(); p.status = 'active';
    const task = p.tasks.find(t => t.id === payload.taskId); if (task) task.status = 'doing';
    save(); return { ok: true, agent: payload.agentId, model: payload.model, ...get() };
  }
  save();
  return { get, settings, setAvatar, setMusic, upsertProject, upsertTask, updateContext, prepareLaunch, markStarted, launch, sync, token, overrides: () => clone(state.agents) };
}

async function handleWorkspace(req, res, workspace) {
  const pathname = req.url.split('?')[0];
  if (!pathname.startsWith('/api/workspace')) return false;
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  try {
    const host = req.headers.host;
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host || '')) { send(403, { error: 'Host no permitido.' }); return true; }
    if (req.method === 'GET' && pathname === '/api/workspace') { send(200, workspace.get()); return true; }
    if (req.method !== 'POST') { send(405, { error: 'Método no permitido.' }); return true; }
    if (req.headers['x-office-token'] !== workspace.token || (req.headers.origin && req.headers.origin !== `http://${host}`)) { send(403, { error: 'Recarga la oficina para autorizar esta operación.' }); return true; }
    let body = '', bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 256 * 1024) fail('Solicitud demasiado grande.'); body += chunk; }
    let input; try { input = JSON.parse(body); } catch { fail('JSON inválido.'); }
    let result;
    if (pathname === '/api/workspace/settings') result = workspace.settings(input);
    else if (pathname === '/api/workspace/project') result = workspace.upsertProject(input);
    else if (pathname === '/api/workspace/task') result = workspace.upsertTask(input.projectId, input);
    else if (pathname === '/api/workspace/context') result = workspace.updateContext(input.projectId, input.context);
    else if (pathname === '/api/workspace/launch') result = await workspace.launch(input.projectId, input.taskId);
    else if (pathname === '/api/workspace/sync') { workspace.sync(); result = workspace.get(); }
    else if (pathname === '/api/workspace/avatar') result = workspace.setAvatar(input.agentId, input.avatar);
    else if (pathname === '/api/workspace/music') result = workspace.setMusic(input.items);
    else { send(404, { error: 'Ruta no encontrada.' }); return true; }
    send(200, result);
  } catch (e) { console.error('workspace:', e.message); send(e.status || 500, { error: e.message }); }
  return true;
}
module.exports = { createWorkspace, handleWorkspace };
