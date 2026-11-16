// AI Office - read-only dashboard of your coding agents (Claude Code, Codex...).
// No dependencies. Run: node server.js  ->  http://localhost:4777
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { classify } = require('./activity');
const { createWorkspace, handleWorkspace } = require('./workspace');
const { createPortal, handlePortal } = require('./portal');

const HOME = os.homedir();
const expand = p => (p ? path.resolve(String(p).replace(/^~(?=$|[\\/])/, HOME)) : p);

// ---------- team config: ~/.ai-workspace/agents.json overrides the repo default ----------
const DEFAULT_DIRS = { claude: path.join(HOME, '.claude', 'projects'), codex: path.join(HOME, '.codex', 'sessions') };
const USER_CONFIG = path.join(HOME, '.ai-workspace', 'agents.json');
const REPO_CONFIG = path.join(__dirname, '..', 'agents.json');
let config = null, configStamp = '';
let workspace = null;
function loadConfig() {
  const file = fs.existsSync(USER_CONFIG) ? USER_CONFIG : REPO_CONFIG;
  let stamp = file;
  try { stamp += fs.statSync(file).mtimeMs; } catch { /* missing */ }
  stamp += workspace ? JSON.stringify(workspace.overrides()) : '';
  if (config && stamp === configStamp) return config;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { console.error('config', file, e.message); }
  const configured = workspace ? workspace.overrides().map(a => ({ ...(raw.agents || []).find(b => b.id === a.id), ...a, logs: a.provider === 'gemini' ? null : a.provider })) : raw.agents;
  const agents = (configured || [{ id: 'claude', logs: 'claude' }, { id: 'codex', logs: 'codex' }])
    .filter(a => a && a.id && a.enabled !== false)
    .map(a => ({
      id: String(a.id), name: a.name || a.id, role: a.role || 'executor', color: a.color || '#9295a6',
      logs: a.logs || null, dir: a.logs ? expand(a.dir) || DEFAULT_DIRS[a.logs] : null,
    }));
  config = { file, port: Number(process.env.AI_OFFICE_PORT || raw.port || 4777), hours: Number(process.env.AI_OFFICE_HOURS || raw.hours || 8), agents };
  configStamp = stamp;
  return config;
}
const readers = () => loadConfig().agents.filter(a => a.logs === 'claude' || a.logs === 'codex');

const WORKING_MS = 25 * 1000;       // file touched recently -> working
const IDLE_MS = 15 * 60 * 1000;     // after this -> sleeping
const TAIL_BYTES = 256 * 1024;
const parsedCache = new Map(); // file -> { key, value }
function cached(file, st, fn) {
  const key = st.mtimeMs + ':' + st.size, c = parsedCache.get(file);
  if (c && c.key === key) return c.value;
  const value = fn();
  parsedCache.set(file, { key, value });
  return value;
}

// ---------- file helpers ----------
function readTail(file, bytes = TAIL_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line is probably partial
    return lines;
  } finally { fs.closeSync(fd); }
}

function readFirstLine(file, max = 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let acc = '';
    let pos = 0;
    while (pos < max) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (!n) break;
      const s = chunk.toString('utf8', 0, n);
      const i = s.indexOf('\n');
      if (i >= 0) return acc + s.slice(0, i);
      acc += s; pos += n;
    }
    return acc;
  } finally { fs.closeSync(fd); }
}

function parse(lines) {
  const out = [];
  for (const l of lines) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* partial */ } }
  return out;
}

function walk(dir, depth, filter, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) walk(p, depth - 1, filter, acc);
    else if (e.isFile() && filter(p)) acc.push(p);
  }
  return acc;
}

const clip = (s, n = 140) => {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function describeTool(name, input) {
  if (!input || typeof input !== 'object') return clip(`${name} ${input || ''}`);
  const v = input.description || input.file_path || input.path || input.command ||
    input.pattern || input.url || input.query || input.prompt || input.skill || '';
  const short = typeof v === 'string' ? v.replace(HOME, '~') : JSON.stringify(v);
  return clip(`${name}: ${short}`);
}

function statusFor(mtime, busyHint) {
  const age = Date.now() - mtime;
  if (age < WORKING_MS) return 'working';
  if (busyHint && age < 3 * 60 * 1000) return 'waiting'; // tool pending, maybe asking permission
  if (age < IDLE_MS) return 'idle';
  return 'sleeping';
}

// ---------- Claude Code ----------
function claudeAgents(team, since) {
  const files = walk(team.dir, 3, p => p.endsWith('.jsonl'));
  const agents = [];
  for (const f of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.mtimeMs < since) continue;
    const isSub = f.includes(`${path.sep}subagents${path.sep}`);
    const r = cached(f, st, () => {
      const rows = parse(readTail(f));
      let cwd = '', title = '', action = '', said = '', pendingTool = false, model = '';
      const acts = [];
      for (const o of rows) {
        if (o.cwd) cwd = o.cwd;
        if (o.type === 'ai-title' && o.aiTitle) title = o.aiTitle;
        const m = o.message;
        if (o.type === 'assistant' && m && Array.isArray(m.content)) {
          if (m.model) model = m.model;
          for (const c of m.content) {
            if (c.type === 'tool_use') { action = describeTool(c.name, c.input); pendingTool = true; acts.push({ name: c.name, input: c.input }); }
            if (c.type === 'text' && c.text) { said = clip(c.text, 220); pendingTool = false; }
          }
        }
        if (o.type === 'user' && m && Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result')) pendingTool = false;
        if (o.type === 'user' && m && typeof m.content === 'string' && !isSub) { said = ''; }
      }
      if (cwd && isSub && !title) title = subagentTask(f);
      return { cwd, title, action, said, pendingTool, model, ...(cwd ? classify(acts, cwd) : {}) };
    });
    const { cwd, title, action, said, pendingTool, model, activity, langs } = r;
    if (!cwd) continue;
    agents.push({
      id: team.id + ':' + f,
      agent: team.id,
      vendor: 'claude',
      kind: isSub ? 'subagent' : 'main',
      parent: isSub ? path.basename(path.dirname(path.dirname(f))) : null,
      session: path.basename(f, '.jsonl'),
      started: st.birthtimeMs || st.ctimeMs,
      project: path.basename(cwd),
      cwd: cwd.replace(HOME, '~'), cwdRaw: cwd,
      title, action, said, model, activity, langs,
      updated: st.mtimeMs,
      status: statusFor(st.mtimeMs, pendingTool),
    });
  }
  return agents;
}

// ---------- Codex ----------
const codexMetaCache = new Map();
function codexAgents(team, since) {
  const files = walk(team.dir, 3, p => p.endsWith('.jsonl'));
  const agents = [];
  for (const f of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.mtimeMs < since) continue;
    let meta = codexMetaCache.get(f);
    if (!meta) {
      try {
        const o = JSON.parse(readFirstLine(f));
        const p = o.payload || {};
        meta = { cwd: p.cwd || '', originator: p.originator || 'codex', id: p.id || '' };
      } catch { meta = { cwd: '', originator: 'codex', id: '' }; }
      codexMetaCache.set(f, meta);
    }
    const r = cached(f, st, () => {
      const rows = parse(readTail(f));
      let action = '', said = '', running = false, title = '', model = '';
      const acts = [];
      for (const o of rows) {
        const p = o.payload || {};
        if (o.type === 'turn_context' && p.cwd) meta.cwd = p.cwd;
        if (o.type === 'turn_context' && p.model) model = p.model;
        if (o.type === 'response_item') {
          if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
            let input = p.arguments || p.input || p.action;
            if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* keep string (apply_patch) */ } }
            if (input && Array.isArray(input.command)) input = { ...input, command: input.command.join(' ') };
            action = describeTool(p.name || p.type, input);
            acts.push({ name: p.name || p.type, input });
          }
          if (p.type === 'message' && p.role === 'assistant' && Array.isArray(p.content)) {
            const t = p.content.map(c => c.text || '').join(' ');
            if (t) said = clip(t, 220);
          }
          if (p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
            const t = p.content.map(c => c.text || '').join(' ');
            if (t && !t.startsWith('#') && !t.startsWith('<')) title = clip(t, 60);
          }
        }
        if (o.type === 'event_msg' && p.type === 'task_started') running = true;
        if (o.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) running = false;
      }
      return { action, said, running, title, model, ...(meta.cwd ? classify(acts, meta.cwd) : {}) };
    });
    const { action, said, running, title, model, activity, langs } = r;
    if (!meta.cwd) continue;
    let status = statusFor(st.mtimeMs, running);
    if (running && status === 'idle') status = 'waiting';
    agents.push({
      id: team.id + ':' + f,
      agent: team.id,
      vendor: 'codex',
      kind: 'main',
      parent: null,
      session: meta.id || path.basename(f, '.jsonl'),
      started: st.birthtimeMs || st.ctimeMs,
      project: path.basename(meta.cwd),
      cwd: meta.cwd.replace(HOME, '~'), cwdRaw: meta.cwd,
      title, action, said, model, activity, langs,
      origin: meta.originator,
      updated: st.mtimeMs,
      status,
    });
  }
  return agents;
}

// ---------- usage (today's tokens + active time, plan limits) ----------
const CLAUDE_USAGE_FILE = path.join(HOME, '.ai-workspace', 'claude-usage.json');
const ACTIVE_GAP_MS = 2 * 60 * 1000; // gaps longer than this don't count as active time
const scanState = new Map();          // file -> { offset, ids:Set, lastTs }
let usageDay = '';
let today = {};
const codexLimits = new Map();        // team id -> newest rate_limits seen in its logs

function readNewLines(file, st) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= st.offset) return [];
    const buf = Buffer.alloc(size - st.offset);
    fs.readSync(fd, buf, 0, buf.length, st.offset);
    const text = buf.toString('utf8');
    const end = text.lastIndexOf('\n');
    if (end < 0) return [];
    st.offset += Buffer.byteLength(text.slice(0, end + 1));
    return text.slice(0, end).split('\n');
  } finally { fs.closeSync(fd); }
}

function addActive(bucket, st, ts) {
  if (st.lastTs && ts > st.lastTs && ts - st.lastTs < ACTIVE_GAP_MS) bucket.activeMs += ts - st.lastTs;
  if (ts > st.lastTs) st.lastTs = ts;
}

function scanUsage() {
  const d = new Date();
  const day = d.toDateString();
  if (day !== usageDay) { usageDay = day; scanState.clear(); today = {}; }
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  for (const team of readers()) {
    const b = today[team.id] || (today[team.id] = { tokens: 0, output: 0, activeMs: 0 });
    for (const f of walk(team.dir, 3, p => p.endsWith('.jsonl'))) {
      let mt; try { mt = fs.statSync(f).mtimeMs; } catch { continue; }
      if (mt < dayStart) continue;
      const key = team.id + '|' + f;
      let st = scanState.get(key);
      if (!st) { st = { offset: 0, ids: new Set(), lastTs: 0 }; scanState.set(key, st); }
      let lines; try { lines = readNewLines(f, st); } catch { continue; }
      for (const o of parse(lines)) {
        const ts = Date.parse(o.timestamp);
        if (!ts || ts < dayStart) continue;
        if (team.logs === 'claude') {
          if (o.type !== 'assistant' && o.type !== 'user') continue;
          addActive(b, st, ts);
          const m = o.message;
          if (o.type !== 'assistant' || !m || !m.usage || !m.id || st.ids.has(m.id)) continue;
          st.ids.add(m.id);
          const u = m.usage;
          b.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          b.output += u.output_tokens || 0;
        } else {
          if (o.type === 'response_item' || o.type === 'event_msg') addActive(b, st, ts);
          const p = o.payload || {};
          if (o.type !== 'event_msg' || p.type !== 'token_count') continue;
          const u = p.info && p.info.last_token_usage;
          if (u) { b.tokens += u.total_tokens || 0; b.output += u.output_tokens || 0; }
          const prev = codexLimits.get(team.id);
          if (p.rate_limits && (!prev || ts >= prev.updated)) codexLimits.set(team.id, { updated: ts, ...p.rate_limits });
        }
      }
    }
  }
}

// Newest rate_limits from the most recent Codex sessions (any day).
function latestCodexLimits(dir) {
  const files = walk(dir, 3, p => p.endsWith('.jsonl'))
    .map(f => { try { return { f, t: fs.statSync(f).mtimeMs }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 5);
  for (const { f } of files) {
    const rows = parse(readTail(f, 256 * 1024));
    for (let i = rows.length - 1; i >= 0; i--) {
      const p = rows[i].payload || {};
      if (rows[i].type === 'event_msg' && p.type === 'token_count' && p.rate_limits)
        return { updated: Date.parse(rows[i].timestamp) || 0, ...p.rate_limits };
    }
  }
  return null;
}

function limitWindow(w, label, pctKey) {
  if (!w || w[pctKey] == null) return null;
  return { label, usedPercent: Number(w[pctKey]), resetsAt: w.resets_at ? Number(w.resets_at) * (w.resets_at < 1e12 ? 1000 : 1) : null };
}
const windowLabel = min => (min >= 1440 ? `${Math.round(min / 1440)} días` : `${Math.round(min / 60)} h`);

function usage() {
  try { scanUsage(); } catch (e) { console.error('usage', e.message); }
  const out = [];
  for (const team of readers()) {
    let limits = null;
    if (team.logs === 'claude' && team.dir === DEFAULT_DIRS.claude) {
      try {
        const c = JSON.parse(fs.readFileSync(CLAUDE_USAGE_FILE, 'utf8'));
        const rl = c.rate_limits || {};
        limits = { updated: c.updated, windows: [limitWindow(rl.five_hour, '5 h', 'used_percentage'), limitWindow(rl.seven_day, '7 días', 'used_percentage')].filter(Boolean) };
      } catch { limits = { setup: true, windows: [] }; } // status line not configured yet
    }
    if (team.logs === 'codex') {
      if (!codexLimits.has(team.id)) codexLimits.set(team.id, latestCodexLimits(team.dir));
      const cl = codexLimits.get(team.id);
      if (cl) limits = { updated: cl.updated, plan: cl.plan_type || '', windows: [cl.primary, cl.secondary].filter(Boolean).map(x => limitWindow(x, windowLabel(x.window_minutes || 0), 'used_percent')).filter(Boolean) };
    }
    out.push({ id: team.id, logs: team.logs, limits, today: today[team.id] || { tokens: 0, output: 0, activeMs: 0 } });
  }
  return { now: Date.now(), agents: out };
}

// First prompt of a subagent = its task.
const subTaskCache = new Map();
function subagentTask(f) {
  if (subTaskCache.has(f)) return subTaskCache.get(f);
  let t = '';
  try {
    const o = JSON.parse(readFirstLine(f, 256 * 1024));
    const c = o.message && o.message.content;
    t = clip(typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join(' ') : '', 70);
  } catch { /* ignore */ }
  subTaskCache.set(f, t);
  return t;
}

// ---------- PLAN.md task board ----------
// Lines like: "- [ ] 3. [codex] Write tests for parser"   ([ ] todo, [~] doing, [x] done, [!] blocked)
const TASK_RE = /^\s*[-*]\s*\[( |x|X|~|!)\]\s*(?:(\d+)[.)]\s*)?(?:\[([a-z][\w-]*)\]\s*)?(.+)$/i;
function readPlan(cwd) {
  const file = path.join(cwd, 'PLAN.md');
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size > 256 * 1024) return null;
  const tasks = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(TASK_RE);
    if (!m) continue;
    const state = m[1] === ' ' ? 'todo' : m[1] === '~' ? 'doing' : m[1] === '!' ? 'blocked' : 'done';
    tasks.push({ n: m[2] || '', owner: (m[3] || '').toLowerCase(), text: clip(m[4], 120), state });
  }
  return tasks.length ? { updated: st.mtimeMs, tasks: tasks.slice(0, 60) } : null;
}

function snapshot() {
  const since = Date.now() - loadConfig().hours * 3600 * 1000;
  let agents = [];
  for (const team of readers()) {
    try { agents = agents.concat(team.logs === 'claude' ? claudeAgents(team, since) : codexAgents(team, since)); }
    catch (e) { console.error(team.id, e.message); }
  }
  agents.sort((a, b) => b.updated - a.updated);
  agents = agents.slice(0, 40);
  const plans = {};
  for (const a of agents) {
    if (a.kind !== 'main' || a.cwd in plans) continue;
    try { plans[a.cwd] = readPlan(a.cwdRaw); } catch { plans[a.cwd] = null; }
  }
  for (const a of agents) delete a.cwdRaw;
  return { now: Date.now(), agents, plans };
}

function publicConfig() {
  const c = loadConfig();
  return { agents: c.agents.map(({ id, name, role, color, logs }) => ({ id, name, role, color, logs })) };
}

// ---------- HTTP ----------
const INDEX = path.join(__dirname, 'index.html');
const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
workspace = createWorkspace({ baseConfig: () => JSON.parse(fs.readFileSync(fs.existsSync(USER_CONFIG) ? USER_CONFIG : REPO_CONFIG, 'utf8').replace(/^\uFEFF/, '')) });
const portal = createPortal({ workspace, baseConfig: () => JSON.parse(fs.readFileSync(fs.existsSync(USER_CONFIG) ? USER_CONFIG : REPO_CONFIG, 'utf8').replace(/^\uFEFF/, '')) });
http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  if (await handleWorkspace(req, res, workspace)) return;
  if (await handlePortal(req, res, portal, workspace.token)) return;
  if (req.method !== 'GET') { res.writeHead(405); return res.end('method not allowed'); }
  if (pathname === '/api/agents') return json(res, snapshot());
  if (pathname === '/api/usage') return json(res, usage());
  if (pathname === '/api/config') return json(res, publicConfig());
  if (['/workspace-ui.js', '/workspace.css', '/portal-ui.js', '/portal.css', '/windows98.css'].includes(pathname)) {
    res.writeHead(200, { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, pathname.slice(1))).pipe(res);
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX).pipe(res);
  }
  res.writeHead(404); res.end('not found');
}).listen(loadConfig().port, '127.0.0.1', () => console.log(`AI Office -> http://localhost:${config.port}  (config: ${config.file})`));
