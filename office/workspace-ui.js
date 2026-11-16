/* Navbar workspace modules, deliberately isolated from the live pixel office. */
(() => {
  const panel = document.querySelector('#workspacePanel');
  const nav = document.querySelector('#workspaceNav');
  let state, module = 'office', category = 'all', selected = '', editingProject = false, editingTask = null, draft = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statuses = { todo: 'Pendiente', doing: 'En curso', done: 'Terminada', blocked: 'Bloqueada', active: 'Activo', paused: 'En pausa', archived: 'Archivado' };
  const roles = { lead: 'Líder', executor: 'Ejecutor', reviewer: 'Revisor' };
  const button = (action, label, extra = '', primary = false) => `<button type="button" class="ws-button${primary ? ' primary' : ''}" data-action="${action}" ${extra}>${label}</button>`;
  function options(values, value, blank = '') {
    return (blank ? `<option value="">${blank}</option>` : '') + Object.entries(values).map(([id, label]) => `<option value="${escape(id)}" ${id === value ? 'selected' : ''}>${escape(label)}</option>`).join('');
  }
  const agentOptions = id => options(Object.fromEntries(state.agents.filter(a => a.enabled).map(a => [a.id, a.name])), id, 'Usar regla del tipo de tarea');
  const obsidian = file => 'obsidian://open?path=' + encodeURIComponent(file);
  const field = (label, name, value = '', extra = '') => `<label>${label}<input name="${name}" value="${escape(value)}" ${extra}></label>`;
  const area = (label, name, value = '', extra = '') => `<label class="ws-wide">${label}<textarea name="${name}" ${extra}>${escape(value)}</textarea></label>`;
  function notify(text, error = false) {
    document.querySelector('.ws-alert')?.remove(); const div = document.createElement('div');
    div.className = 'ws-alert' + (error ? ' error' : ''); div.setAttribute('role', error ? 'alert' : 'status'); div.textContent = text;
    document.body.append(div); setTimeout(() => div.remove(), error ? 10000 : 5000);
  }
  async function api(route = '', input) {
    const response = await fetch('/api/workspace' + route, input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': state.token }, body: JSON.stringify(input) } : { cache: 'no-store' });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
    state = result; return result;
  }
  function heading(title, text, actions = '') { return `<div class="ws-heading"><div><h2>${title}</h2><p>${text}</p></div><div class="ws-actions">${actions}</div></div>`; }
  function projectForm(p = {}) {
    return `<form id="projectForm" class="ws-card"><h3>${p.id ? 'Editar proyecto' : 'Guardar proyecto en la oficina'}</h3><p>El código permanece en su carpeta. Las tareas y el contexto quedan en la bóveda.</p><div class="ws-form-grid">
      <input type="hidden" name="id" value="${escape(p.id || '')}">
      ${field('Nombre', 'name', p.name, 'required maxlength="100"')}
      <label>Categoría<select name="category">${options({ personal: 'Personal', work: 'Trabajo' }, p.category || 'personal')}</select></label>
      <label class="ws-wide">Carpeta del proyecto<input name="path" value="${escape(p.path || '')}" placeholder="C:\\Users\\sebas\\dev\\mi-proyecto" required></label>
      <label>Estado<select name="status">${options({ active: 'Activo', paused: 'En pausa', archived: 'Archivado' }, p.status || 'active')}</select></label>
      ${area('Descripción y objetivo', 'description', p.description, 'maxlength="12000"')}
      </div><div class="ws-actions"><button class="ws-button primary">Guardar proyecto</button>${button('cancel-project', 'Cancelar')}</div></form>`;
  }
  function taskForm(p, t = {}) {
    return `<form id="taskForm" class="ws-card"><h3>${t.id ? 'Editar tarea' : 'Nueva tarea'}</h3><p>Puedes heredar la regla del tipo de tarea o elegir un agente y modelo específicos.</p><div class="ws-form-grid">
      <input type="hidden" name="id" value="${escape(t.id || '')}">
      ${field('Título', 'title', t.title, 'required maxlength="180"')}
      <label>Tipo<select name="type">${options(state.taskTypes, t.type || 'implementation')}</select></label>
      <label>Agente<select name="agentId">${agentOptions(t.agentId || '')}</select></label>
      ${field('Modelo (vacío = heredar)', 'model', t.model, 'list="wsModels" placeholder="haiku, sonnet, opus o ID de modelo"')}
      <label>Estado<select name="status">${options({ todo: 'Pendiente', doing: 'En curso', done: 'Terminada', blocked: 'Bloqueada' }, t.status || 'todo')}</select></label>
      ${area('Instrucciones y criterio de finalización', 'details', t.details, 'maxlength="16000"')}
      </div><div class="ws-actions"><button class="ws-button primary">Guardar tarea</button>${button('cancel-task', 'Cancelar')}</div></form>`;
  }
  function projectsView() {
    const p = state.projects.find(p => p.id === selected);
    if (p) {
      panel.innerHTML = heading(escape(p.name), `${p.category === 'work' ? 'Trabajo' : 'Personal'} · ${escape(p.path)}`, button('back', '← Proyectos') + button('edit-project', 'Editar proyecto') + `<a class="ws-link" href="${obsidian(p.notePath)}">Abrir en Obsidian ↗</a>` + button('launch', 'Retomar proyecto', `data-project="${p.id}"`, true)) +
        (editingProject ? projectForm(p) : '') +
        `<div class="ws-card"><h3>Objetivo</h3><p>${escape(p.description || 'Añade un objetivo al editar el proyecto.').replace(/\n/g, '<br>')}</p><span class="ws-badge">${statuses[p.status]}</span></div>
        <section class="ws-section"><div class="ws-heading"><div><h3>Tareas del proyecto</h3><p>Retomar abre el chat con el agente, el modelo y el contexto de la tarea.</p></div>${button('new-task', '+ Nueva tarea', '', true)}</div>
        ${editingTask !== null ? taskForm(p, p.tasks.find(t => t.id === editingTask) || {}) : ''}
        <div class="ws-card">${p.tasks.length ? p.tasks.map(t => `<div class="ws-task"><div><b>${escape(t.title)}</b><div class="ws-meta">${escape(state.taskTypes[t.type])} · ${statuses[t.status]} · ${escape(t.effectiveAgent)} / ${escape(t.effectiveModel || 'modelo predeterminado')}</div></div><div class="ws-actions">${button('edit-task', 'Editar', `data-id="${t.id}"`)}${!['done', 'blocked'].includes(t.status) ? button('launch', 'Retomar tarea', `data-project="${p.id}" data-task="${t.id}"`, true) : ''}</div></div>`).join('') : '<p>Este proyecto aún no tiene tareas. Crea la primera para elegir agente y modelo.</p>'}</div></section>
        <form id="contextForm" class="ws-card"><h3>Contexto y decisiones</h3><p>Este texto es el mismo Contexto.md de Obsidian y se incorpora a la siguiente sesión.</p><label>Documentación Markdown<textarea name="context" class="ws-context" maxlength="64000">${escape(p.context)}</textarea></label><div class="ws-actions"><button class="ws-button primary">Guardar contexto</button>${button('refresh-context', 'Recargar desde Obsidian')}</div></form>`;
      return;
    }
    const list = state.projects.filter(p => category === 'all' || p.category === category);
    panel.innerHTML = heading('Tus proyectos', 'Un lugar para guardar el trabajo, documentarlo y retomarlo cuando quieras.', button('import-htdocs', 'Importar desde htdocs') + button('sync', 'Sincronizar bóveda') + button('new-project', '+ Guardar proyecto', '', true)) +
      (editingProject ? projectForm() : '') +
      `<div class="ws-tabs">${[['all', 'Todos'], ['personal', 'Personales'], ['work', 'Trabajo']].map(([id, label]) => `<button type="button" class="ws-button" data-action="category" data-category="${id}" aria-pressed="${category === id}">${label} <span class="ws-badge">${state.projects.filter(p => id === 'all' || p.category === id).length}</span></button>`).join('')}</div>` +
      (list.length ? `<div class="ws-grid">${list.map(p => `<article class="ws-card"><div class="ws-heading"><h3>${escape(p.name)}</h3><span class="ws-badge">${p.category === 'work' ? 'Trabajo' : 'Personal'}</span></div><p>${escape(p.description || 'Sin descripción').slice(0, 240)}</p><div class="ws-meta">${escape(p.path)}<br>${statuses[p.status]} · ${p.tasks.filter(t => t.status === 'done').length}/${p.tasks.length} tareas completadas<br>${p.lastOpened ? 'Última apertura: ' + new Date(p.lastOpened).toLocaleString('es-CL') : 'Listo para comenzar'}</div><div class="ws-actions">${button('open-project', 'Ver tareas y contexto', `data-id="${p.id}"`)}${button('launch', 'Retomar', `data-project="${p.id}"`, true)}</div></article>`).join('')}</div>` : '<div class="ws-empty">Aún no hay proyectos en esta categoría. Guarda una carpeta para conservar sus tareas y documentación.</div>');
  }
  function settingsView() {
    if (!draft) draft = structuredClone(state);
    panel.innerHTML = heading('Configuración', 'Define quién hace cada tarea y con qué modelo trabaja.', button('discard-settings', 'Descartar cambios')) +
      `<form id="settingsForm"><section class="ws-card"><h3>Agentes</h3><p>El modelo predeterminado se utiliza cuando la tarea y su regla no especifican otro.</p><div class="ws-grid">${draft.agents.map((a, i) => `<article class="ws-card" data-agent="${i}"><div class="ws-agent-head"><h3>${escape(a.name)}</h3><label><input type="checkbox" data-key="enabled" ${a.enabled ? 'checked' : ''}>Activo</label></div><div class="ws-form-grid">
        <label>Identificador<input data-key="id" value="${escape(a.id)}" required pattern="[a-z][a-z0-9-]*" ${state.agents.some(b => b.id === a.id) ? 'readonly' : ''}></label>
        <label>Nombre<input data-key="name" value="${escape(a.name)}" required maxlength="100"></label>
        <label>Proveedor<select data-key="provider">${options({ claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI' }, a.provider)}</select></label>
        <label>Rol<select data-key="role">${options(roles, a.role)}</select></label>
        <label>Modelo predeterminado<input data-key="model" value="${escape(a.model)}" list="wsModels" placeholder="Predeterminado del proveedor"></label>
        <label>Color<input type="color" data-key="color" value="${escape(a.color)}"></label>
        <label class="ws-wide">Instrucciones del agente<textarea data-key="instructions" maxlength="8000">${escape(a.instructions)}</textarea></label></div></article>`).join('')}</div><div class="ws-actions">${button('add-agent', '+ Añadir agente')}</div></section>
        <section class="ws-card"><h3>Modelo y agente por tipo de tarea</h3><p>Por ejemplo: investigación → Claude / haiku. En cada tarea puedes elegir una excepción.</p>${draft.rules.map(r => `<div class="ws-rule" data-rule="${r.type}"><b>${escape(state.taskTypes[r.type])}</b><label>Agente<select data-key="agentId">${options(Object.fromEntries(draft.agents.map(a => [a.id, a.name + (a.enabled ? '' : ' (desactivado)')])), r.agentId)}</select></label><label>Modelo<input data-key="model" value="${escape(r.model)}" list="wsModels" placeholder="Heredar del agente"></label></div>`).join('')}</section>
        <section class="ws-card"><h3>Obsidian y documentación</h3><p>La bóveda guarda proyectos personales y laborales, tareas, contexto y una copia de la configuración. Las notas de contexto se conservan al sincronizar.</p>${field('Carpeta de la bóveda', 'vaultPath', draft.vaultPath, 'required')}
        <div class="ws-actions"><a class="ws-link" href="${obsidian(state.vaultPath + '/Inicio.md')}">Abrir bóveda en Obsidian ↗</a></div></section><div class="ws-actions ws-section"><button class="ws-button primary">Guardar configuración</button><span class="ws-meta">Los cambios se aplican a nuevas sesiones. Los modelos disponibles dependen de tu cuenta.</span></div></form>`;
  }
  function render() {
    if (!state) return;
    if (['docs', 'graph', 'chat', 'import'].includes(module)) { window.OfficePortal.show(module, state).catch(e => notify(e.message, true)); return; }
    if (module === 'settings') settingsView(); else if (module === 'projects') projectsView();
    panel.insertAdjacentHTML('beforeend', '<datalist id="wsModels"><option value="haiku"><option value="sonnet"><option value="opus"></datalist>');
  }
  async function switchModule(next) {
    if (module === 'settings' && draft && next !== module) {
      captureDraft(); // ask only when something actually changed
      if (JSON.stringify(draft) !== JSON.stringify(state) && !confirm('¿Salir de Configuración? Los cambios sin guardar se descartarán.')) return;
      draft = null;
    }
    module = next; document.body.dataset.module = next; panel.hidden = next === 'office';
    const label = ({ office: 'Mi oficina', projects: 'Mis proyectos', docs: 'Documentación', graph: 'Red neuronal', chat: 'Windows Live Messenger', settings: 'Panel de control', import: 'Importar proyectos' })[next] || 'Mi oficina';
    document.querySelector('#win98ModuleCaption').textContent = label;
    const taskButton = document.querySelector('#win98CurrentTask'); taskButton.textContent = label; taskButton.dataset.desktopModule = next;
    if (next === 'office') document.dispatchEvent(new CustomEvent('office:refresh'));
    nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.module === (next === 'import' ? 'projects' : next)));
    if (next !== 'office') {
      panel.innerHTML = '<p role="status">Cargando oficina…</p>';
      try { await api(); render(); } catch (e) { panel.innerHTML = '<p>No se pudo cargar la oficina. Vuelve a seleccionar el módulo para reintentar.</p>'; notify(e.message, true); }
    }
  }
  nav.addEventListener('click', e => { const b = e.target.closest('[data-module]'); if (b) switchModule(b.dataset.module); });
  const startButton = document.querySelector('#win98Start'), startMenu = document.querySelector('#win98StartMenu');
  function closeStart() { startMenu.hidden = true; startButton.setAttribute('aria-expanded', 'false'); }
  // Classic window states: minimized/closed hide the window until a taskbar, Start or desktop entry restores it.
  const setWindowState = (minimized, maximized = document.body.classList.contains('win98-maximized')) => {
    document.body.classList.toggle('win98-minimized', minimized);
    document.body.classList.toggle('win98-maximized', maximized);
    document.querySelector('#win98CurrentTask').setAttribute('aria-pressed', String(!minimized));
  };
  document.addEventListener('click', e => {
    if (e.target.closest('#win98Start')) { startMenu.hidden = !startMenu.hidden; startButton.setAttribute('aria-expanded', String(!startMenu.hidden)); return; }
    const action = e.target.closest('[data-win98-action]')?.dataset.win98Action;
    if (action) { closeStart(); if (action === 'maximize') setWindowState(false, !document.body.classList.contains('win98-maximized')); else setWindowState(true); return; }
    if (e.target.closest('#win98CurrentTask') && module === e.target.closest('#win98CurrentTask').dataset.desktopModule) {
      closeStart(); setWindowState(!document.body.classList.contains('win98-minimized')); return;
    }
    const shortcut = e.target.closest('[data-desktop-module]');
    if (shortcut) { closeStart(); setWindowState(false); switchModule(shortcut.dataset.desktopModule); }
    else if (!e.target.closest('#win98StartMenu')) closeStart();
  });
  document.querySelector('.win98-titlebar')?.addEventListener('dblclick', e => { if (!e.target.closest('button')) setWindowState(false, !document.body.classList.contains('win98-maximized')); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStart(); });
  const tickClock = () => { const clock = document.querySelector('#win98Clock'); clock.textContent = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }); clock.dateTime = new Date().toISOString(); };
  tickClock(); setInterval(tickClock, 30000);
  function captureDraft() {
    if (!draft || !document.querySelector('#settingsForm')) return;
    panel.querySelectorAll('[data-agent]').forEach(row => {
      const a = draft.agents[Number(row.dataset.agent)]; row.querySelectorAll('[data-key]').forEach(el => { a[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value; });
    });
    panel.querySelectorAll('[data-rule]').forEach(row => { const r = draft.rules.find(r => r.type === row.dataset.rule); row.querySelectorAll('[data-key]').forEach(el => { r[el.dataset.key] = el.value; }); });
    draft.vaultPath = document.querySelector('[name="vaultPath"]').value;
  }
  panel.addEventListener('click', async e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const action = b.dataset.action;
    try {
      if (action === 'new-project') { selected = ''; editingProject = true; }
      else if (action === 'cancel-project') editingProject = false;
      else if (action === 'edit-project') editingProject = true;
      else if (action === 'open-project') { await api(); selected = b.dataset.id; editingTask = null; editingProject = false; }
      else if (action === 'back') { selected = ''; editingTask = null; editingProject = false; }
      else if (action === 'category') category = b.dataset.category;
      else if (action === 'new-task') editingTask = '';
      else if (action === 'edit-task') editingTask = b.dataset.id;
      else if (action === 'cancel-task') editingTask = null;
      else if (action === 'refresh-context') { if (!confirm('¿Recargar Contexto.md? Los cambios del editor sin guardar se descartarán.')) return; await api(); notify('Contexto recargado desde la bóveda.'); }
      else if (action === 'sync') { await api('/sync', {}); notify('Bóveda actualizada.'); }
      else if (action === 'discard-settings') { draft = structuredClone(state); }
      else if (action === 'add-agent') { captureDraft(); let n = draft.agents.length + 1; while (draft.agents.some(a => a.id === `agent-${n}`)) n++; draft.agents.push({ id: `agent-${n}`, name: `Agente ${n}`, provider: 'claude', role: 'executor', model: '', color: '#7ea6f6', enabled: true, instructions: '' }); }
      else if (action === 'import-htdocs') { await switchModule('import'); return; }
      else if (action === 'launch') {
        window.OfficePortal.selectProject(b.dataset.project, b.dataset.task || '');
        await switchModule('chat'); return;
      }
      render();
    } catch (err) { notify(err.message, true); }
  });
  panel.addEventListener('submit', async e => {
    if (!['projectForm', 'taskForm', 'contextForm', 'settingsForm'].includes(e.target.id)) return;
    e.preventDefault(); const form = e.target, b = form.querySelector('button[type="submit"], button:not([type])');
    const input = Object.fromEntries(new FormData(form));
    if (b) b.disabled = true;
    try {
      if (form.id === 'projectForm') { const old = new Set(state.projects.map(p => p.id)); await api('/project', input); selected = input.id || state.projects.find(p => !old.has(p.id))?.id || ''; editingProject = false; notify('Proyecto guardado.'); }
      else if (form.id === 'taskForm') { await api('/task', { ...input, projectId: selected }); editingTask = null; notify('Tarea guardada con su agente y modelo.'); }
      else if (form.id === 'contextForm') { await api('/context', { projectId: selected, context: input.context }); notify('Contexto guardado en Obsidian.'); }
      else if (form.id === 'settingsForm') { captureDraft(); await api('/settings', draft); draft = structuredClone(state); notify('Configuración guardada. Se aplicará al retomar tareas.'); }
      render();
    } catch (err) { notify(err.message, true); }
    finally { if (b) b.disabled = false; }
  });
  // Keep unsaved form values when adding an agent; no polling replaces these editors.
  document.addEventListener('office:module', e => switchModule(e.detail));
  document.addEventListener('office:agent', e => {
    window.OfficePortal.selectAgent(e.detail.agentId, e.detail.projectId || '');
    switchModule('chat');
  });
})();
