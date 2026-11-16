/* Windows 98 window manager: every module lives in its own window that can be moved, resized,
   minimized, maximized and closed. Each open window gets a taskbar button; geometry is remembered. */
(() => {
  const MODULES = {
    office: { title: 'Mi oficina', w: 1180, h: 760, persistent: true },
    projects: { title: 'Mis proyectos', w: 980, h: 680 },
    import: { title: 'Importar proyectos', w: 920, h: 660 },
    docs: { title: 'Documentación', w: 1060, h: 700 },
    graph: { title: 'Red neuronal', w: 1180, h: 760 },
    chat: { title: 'Windows Live Messenger', w: 1080, h: 740, skin: 'msn', minW: 640, minH: 480 },
    settings: { title: 'Panel de control', w: 1100, h: 720 },
    winamp: { title: 'Winamp', w: 440, h: 600, skin: 'winamp', minW: 380, minH: 360 },
  };
  const TASKBAR = 40, STORE = 'office.windows.v1', DIRS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
  const tasks = document.querySelector('#win98Tasks');
  const wins = new Map();
  const beforeClose = new Map();
  let z = 20, active = '';
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
  const saved = load(); saved.geom ||= {};
  function persist() {
    for (const [id, w] of wins) if (!w.closed) saved.geom[id] = { ...w.rect, max: w.max };
    saved.open = [...wins].filter(([, w]) => !w.closed).sort((a, b) => a[1].z - b[1].z).map(([id]) => id);
    saved.active = active;
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* storage is a convenience only */ }
  }
  const def = id => MODULES[id] || { title: id, w: 900, h: 640 };
  const area = () => ({ w: Math.max(320, window.innerWidth || 1280), h: Math.max(240, (window.innerHeight || 800) - TASKBAR) });
  function clamp(rect, id) {
    const { w: vw, h: vh } = area(), d = def(id);
    const w = Math.min(Math.max(rect.w, d.minW || 360), vw), h = Math.min(Math.max(rect.h, d.minH || 240), vh);
    return { w, h, x: Math.min(Math.max(rect.x, 80 - w), vw - 80), y: Math.min(Math.max(rect.y, 0), vh - 32) };
  }
  function place(id) {
    const d = def(id), { w: vw, h: vh } = area(), n = [...wins.values()].filter(w => !w.closed).length % 8;
    // Scale with large screens so windows are comfortable to read; small screens get the space available.
    const w = Math.min(d.skin === 'winamp' ? d.w : Math.max(d.w, Math.round(vw * .55)), vw - 130), h = Math.min(d.skin === 'winamp' ? d.h : Math.max(d.h, Math.round(vh * .82)), vh - 20);
    return { w, h, x: Math.max(0, Math.min(110 + n * 30, vw - w)), y: Math.max(0, Math.min(10 + n * 30, vh - h)) };
  }
  function apply(id) {
    const w = wins.get(id); if (!w) return;
    w.rect = clamp(w.rect, id);
    Object.assign(w.el.style, { left: w.rect.x + 'px', top: w.rect.y + 'px', width: w.rect.w + 'px', height: w.rect.h + 'px' });
    w.el.classList.toggle('maximized', w.max);
    w.el.querySelector('[data-wm="maximize"]')?.setAttribute('aria-label', w.max ? 'Restaurar' : 'Maximizar');
  }
  const controls = '<span class="win98-title-controls"><button type="button" data-wm="minimize" aria-label="Minimizar"></button><button type="button" data-wm="maximize" aria-label="Maximizar"></button><button type="button" data-wm="close" aria-label="Cerrar"></button></span>';
  function frame(id) {
    const d = def(id), el = document.createElement('section');
    el.className = 'w98-app' + (d.skin ? ' w98-skin-' + d.skin : '');
    el.dataset.window = id; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', d.title); el.tabIndex = -1;
    el.innerHTML = (d.skin ? '' : `<div class="win98-titlebar" data-wm-drag><span class="win98-title-text"></span>${controls}</div>`) +
      `<div class="w98-app-body"><div class="ws-module" id="module-${id}"></div></div>`;
    if (!d.skin) el.querySelector('.win98-title-text').textContent = d.title;
    return el;
  }
  function addChrome(id, el) {
    el.insertAdjacentHTML('beforeend', DIRS.map(dir => `<div class="w98-resize w98-resize-${dir}" data-wm-resize="${dir}" aria-hidden="true"></div>`).join(''));
    const task = document.createElement('button');
    task.type = 'button'; task.className = 'win98-task'; task.dataset.wmTask = id; task.textContent = def(id).title;
    tasks?.append(task);
    return task;
  }
  function register(id, el) {
    const g = saved.geom[id];
    const w = { el, host: el.querySelector('.ws-module') || el.querySelector('.w98-app-body'), rect: g ? { x: g.x, y: g.y, w: g.w, h: g.h } : place(id), max: !!g?.max, min: false, closed: false, z: 0 };
    wins.set(id, w); w.task = addChrome(id, el); apply(id);
    return w;
  }
  function open(id) {
    let w = wins.get(id), created = false;
    if (!w) { const el = frame(id); document.body.append(el); w = register(id, el); created = true; }
    else if (w.closed) { w.closed = false; w.el.hidden = false; w.rect = saved.geom[id] ? clamp(saved.geom[id], id) : place(id); tasks?.append(w.task); apply(id); }
    w.min = false; w.el.hidden = false; w.task.hidden = false;
    focus(id);
    return { el: w.el, host: w.host, created };
  }
  function topmost(except) {
    return [...wins].filter(([id, w]) => id !== except && !w.closed && !w.min).sort((a, b) => b[1].z - a[1].z)[0]?.[0] || '';
  }
  function focus(id) {
    const w = wins.get(id); if (!w || w.closed) return;
    if (w.min) { w.min = false; w.el.hidden = false; }
    if (active !== id || !w.z) w.z = ++z;
    w.el.style.zIndex = w.z; active = id;
    for (const [wid, other] of wins) {
      other.el.classList.toggle('inactive', wid !== id);
      other.task.setAttribute('aria-pressed', String(wid === id && !other.min));
    }
    document.body.dataset.module = id;
    persist();
  }
  function setActive(id) {
    active = id;
    for (const [wid, w] of wins) { w.el.classList.toggle('inactive', wid !== id); w.task.setAttribute('aria-pressed', String(wid === id)); }
    if (id) focus(id); else { delete document.body.dataset.module; persist(); }
  }
  function minimize(id) {
    const w = wins.get(id); if (!w || w.closed) return;
    w.min = true; w.el.hidden = true; w.task.setAttribute('aria-pressed', 'false');
    setActive(topmost(id));
  }
  function toggleMaximize(id) { const w = wins.get(id); if (!w || w.closed) return; w.max = !w.max; apply(id); focus(id); w.el.dispatchEvent(new CustomEvent('wm:resize', { bubbles: true })); }
  function close(id) {
    const w = wins.get(id); if (!w || w.closed) return true;
    if (beforeClose.get(id)?.() === false) return false;
    saved.geom[id] = { ...w.rect, max: w.max };
    w.closed = true; w.min = false; w.task.remove();
    if (def(id).persistent) w.el.hidden = true; else { w.el.remove(); wins.delete(id); }
    document.dispatchEvent(new CustomEvent('wm:close', { detail: id }));
    setActive(topmost(id));
    return true;
  }
  const isOpen = id => !!wins.get(id) && !wins.get(id).closed;
  const host = id => isOpen(id) ? wins.get(id).host : null;
  const setTitle = (id, title) => { const w = wins.get(id); if (!w) return; const t = w.el.querySelector('.win98-title-text'); if (t) t.textContent = title; w.task.textContent = title; w.el.setAttribute('aria-label', title); };

  // ---------- pointer interaction ----------
  let gesture = null;
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest?.('.w98-app'); if (!el) return;
    const id = el.dataset.window, w = wins.get(id); if (!w) return;
    if (active !== id) focus(id);
    const resize = e.target.closest('[data-wm-resize]');
    const drag = !resize && e.target.closest('[data-wm-drag], .msn-titlebar, .winamp-titlebar');
    if ((!resize && !drag) || e.button !== 0 || w.max || e.target.closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    gesture = { id, dir: resize?.dataset.wmResize || '', x: e.clientX, y: e.clientY, start: { ...w.rect } };
    document.body.classList.add('wm-dragging');
  }, true);
  document.addEventListener('pointermove', e => {
    if (!gesture) return;
    const w = wins.get(gesture.id); if (!w) { gesture = null; return; }
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y, s = gesture.start, d = def(gesture.id);
    const minW = d.minW || 360, minH = d.minH || 240;
    if (!gesture.dir) w.rect = { ...s, x: s.x + dx, y: s.y + dy };
    else {
      let { x, y, w: width, h } = s;
      if (gesture.dir.includes('e')) width = Math.max(minW, s.w + dx);
      if (gesture.dir.includes('s')) h = Math.max(minH, s.h + dy);
      if (gesture.dir.includes('w')) { width = Math.max(minW, s.w - dx); x = s.x + s.w - width; }
      if (gesture.dir.includes('n')) { h = Math.max(minH, s.h - dy); y = s.y + s.h - h; }
      w.rect = { x, y, w: width, h };
    }
    apply(gesture.id);
  });
  const endGesture = () => {
    if (!gesture) return;
    const w = wins.get(gesture.id), resized = !!gesture.dir; gesture = null;
    document.body.classList.remove('wm-dragging'); persist();
    if (resized) w?.el.dispatchEvent(new CustomEvent('wm:resize', { bubbles: true }));
  };
  document.addEventListener('pointerup', endGesture);
  document.addEventListener('pointercancel', endGesture);
  document.addEventListener('dblclick', e => {
    const bar = e.target.closest?.('[data-wm-drag], .msn-titlebar, .winamp-titlebar'); if (!bar || e.target.closest('button')) return;
    toggleMaximize(bar.closest('.w98-app').dataset.window);
  });
  document.addEventListener('click', e => {
    const control = e.target.closest?.('[data-wm]');
    if (control) {
      const id = control.closest('.w98-app')?.dataset.window, action = control.dataset.wm;
      if (id) { if (action === 'minimize') minimize(id); else if (action === 'maximize') toggleMaximize(id); else if (action === 'close') close(id); }
      return;
    }
    const task = e.target.closest?.('[data-wm-task]');
    if (task) { const id = task.dataset.wmTask, w = wins.get(id); if (active === id && !w.min) minimize(id); else focus(id); }
  });
  window.addEventListener('resize', () => { for (const id of wins.keys()) if (isOpen(id)) apply(id); });

  window.Win98WM = {
    modules: MODULES, open, close, minimize, toggleMaximize, focus, isOpen, host, setTitle, register,
    onBeforeClose(id, fn) { beforeClose.set(id, fn); },
    get active() { return active; },
    savedOpen: () => (saved.open || []).filter(id => MODULES[id]),
    savedActive: () => saved.active || '',
  };
  const office = document.querySelector('.w98-app[data-window="office"]');
  if (office) register('office', office);
})();
