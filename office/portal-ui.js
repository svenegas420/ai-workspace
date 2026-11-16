(() => {
  // Each portal module (docs, graph, import, chat) renders into its own window.
  const WM = window.Win98WM, PORTAL_WINDOWS = ['docs', 'graph', 'chat', 'import'];
  const host = id => WM.host(id);
  const windowOf = el => el?.closest?.('.w98-app')?.dataset.window || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ws, discovery, library, noteId = '', docFilter = '', graphFilter = '', noteSearch = '', conversations = [], currentChat = null, newChat = false, preferredProject = '', preferredTask = '', stream = null, pendingText = '', sending = false, poll = null;
  const drafts = new Map();
  let preferredAgent = '', contactAgent = '', contactSearch = '';
  const btn = (action, text, extra = '', primary = false) => `<button type="button" class="ws-button${primary ? ' primary' : ''}" data-portal="${action}" ${extra}>${text}</button>`;
  const opts = (values, chosen, blank = '') => (blank ? `<option value="">${esc(blank)}</option>` : '') + values.map(([id, label]) => `<option value="${esc(id)}" ${id === chosen ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const header = (title, text, actions = '') => `<div class="ws-heading"><div><h2>${title}</h2><p>${text}</p></div><div class="ws-actions">${actions}</div></div>`;
  function toast(text, failed = false) {
    document.querySelector('.ws-alert')?.remove(); const el = document.createElement('div'); el.className = 'ws-alert' + (failed ? ' error' : ''); el.setAttribute('role', failed ? 'alert' : 'status'); el.textContent = text; document.body.append(el); setTimeout(() => el.remove(), failed ? 12000 : 5000);
  }
  async function request(route, input) {
    const r = await fetch('/api/portal/' + route, input !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': ws.token }, body: JSON.stringify(input) } : { cache: 'no-store' });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || 'No se pudo completar la operación.'); return data;
  }
  function resolveNote(target, from = '') {
    const clean = target.split('#')[0].replace(/\.md$/i, '').replace(/\\/g, '/');
    const parts = from.split('/'); parts.pop();
    for (const part of clean.split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part); }
    const local = parts.join('/') + '.md';
    const exact = library?.notes.find(n => n.id === local) || library?.notes.find(n => n.id === clean + '.md');
    const matches = library?.notes.filter(n => n.id.split('/').at(-1) === clean + '.md') || [];
    return exact || (matches.length === 1 ? matches[0] : null);
  }
  function inline(text, from) {
    let html = esc(text);
    html = html.replace(/\[\[([^\]]+)\]\]/g, (_, value) => {
      const [target, label] = value.split('|'), note = resolveNote(target, from);
      return note ? `<button type="button" class="portal-wiki" data-portal="note" data-id="${esc(note.id)}">${label || target}</button>` : `<span>${label || target}</span>`;
    });
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>');
    return html.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function markdown(text, from = '') {
    // Escape before formatting; source HTML and executable URLs never enter the DOM.
    return String(text || '').split(/(```[\s\S]*?```)/g).map(section => {
      if (section.startsWith('```')) return `<pre><code>${esc(section.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`;
      return section.split(/\n\s*\n/).filter(Boolean).map(block => {
        const lines = block.split('\n');
        if (lines.every(line => /^\s*[-*]\s/.test(line))) return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''), from)}</li>`).join('') + '</ul>';
        return lines.map(line => { const m = line.match(/^(#{1,4})\s+(.+)$/); return m ? `<h${m[1].length}>${inline(m[2], from)}</h${m[1].length}>` : `<p>${inline(line, from)}</p>`; }).join('');
      }).join('');
    }).join('');
  }
  function importView() {
    host('import').innerHTML = header('Importar proyectos de htdocs', `${discovery.projects.length} carpetas encontradas en ${esc(discovery.root)}. Selecciona las que quieras guardar y asígnales una categoría.`, btn('projects', '← Proyectos') + btn('refresh-import', 'Actualizar lista')) +
      '<p>Los respaldos y las carpetas de XAMPP están señalados para que puedas distinguirlos.</p>' +
      `<form id="importForm"><div class="portal-import-list">${discovery.projects.map(p => `<div class="portal-import-row" data-imported="${p.imported}" data-candidate="${p.key}"><input type="checkbox" name="selected" value="${p.key}" aria-label="Seleccionar ${esc(p.name)}" ${p.imported ? 'disabled' : ''}><div><b>${esc(p.name)}</b><span class="ws-meta">${p.imported ? 'Ya está en la oficina' : p.infrastructure ? 'Carpeta de XAMPP' : p.backup ? 'Posible respaldo' : p.markers.length ? esc(p.markers.filter(x => x !== '.git').join(' · ')) || 'Repositorio Git' : 'Carpeta sin identificación de stack'}</span></div><label>Categoría<select name="category-${p.key}" ${p.imported ? 'disabled' : ''}>${opts([['personal', 'Personal'], ['work', 'Trabajo']], '', 'Seleccionar…')}</select></label></div>`).join('')}</div><div class="portal-import-bar"><button class="ws-button primary">Agregar seleccionados a la oficina</button><span class="ws-meta">La clasificación la eliges tú. No se modifica ningún archivo de htdocs.</span></div></form>`;
  }
  function filteredNotes(filter = docFilter, search = noteSearch) { return library.notes.filter(n => (!filter || n.projectId === filter || n.category === filter) && (!search || (n.title + ' ' + n.id + ' ' + n.content).toLowerCase().includes(search.toLowerCase()))); }
  function noteList() {
    return filteredNotes().map(n => `<button type="button" class="portal-note" data-portal="note" data-id="${esc(n.id)}" aria-current="${n.id === noteId}"><b>${esc(n.title).slice(0, 90)}</b><small>${esc(n.id)}</small></button>`).join('') || '<p>No hay notas con este filtro.</p>';
  }
  function docsView() {
    if (!library.notes.some(n => n.id === noteId)) noteId = filteredNotes()[0]?.id || '';
    const note = library.notes.find(n => n.id === noteId);
    host('docs').innerHTML = header('Documentación de Obsidian', 'Lee tus notas y sigue sus enlaces sin salir de la oficina.', btn('refresh-notes', 'Actualizar desde la bóveda') + btn('graph-view', 'Ver red neuronal')) +
      `<div class="portal-layout"><aside class="portal-sidebar"><h3>Notas de la bóveda</h3><label>Proyecto<select id="docFilter">${opts([['office', 'Oficina'], ...ws.projects.map(p => [p.id, p.name])], docFilter, 'Toda la bóveda')}</select></label><label class="ws-section">Buscar<input id="noteSearch" type="search" value="${esc(noteSearch)}" placeholder="Título o contenido"></label><div id="noteList">${noteList()}</div></aside><article class="portal-reader"><div class="ws-meta">${esc(note?.id || '')}</div><div class="portal-markdown">${note ? markdown(note.content, note.id) : '<p>No hay notas todavía.</p>'}</div>${note ? `<a class="ws-link ws-section" href="obsidian://open?path=${encodeURIComponent(library.vaultPath + '/' + note.id)}">Abrir esta nota en Obsidian ↗</a>` : ''}</article></div>`;
  }
  // ---------- Knowledge graph ("Red neuronal") ----------
  const GRAPH_COLORS = { personal: '#00a050', work: '#7b3fc4', office: '#d99a00' };
  const GRAPH_NAMES = { personal: 'Personal', work: 'Trabajo', office: 'Oficina' };
  const GRAPH_FONT = '"Microsoft Sans Serif", "MS Sans Serif", Tahoma, sans-serif';
  let graph = null, graphObserver = null;
  function graphView() {
    const visible = filteredNotes(graphFilter, ''), ids = new Set(visible.map(n => n.id));
    const links = library.links.filter(l => ids.has(l.source) && ids.has(l.target));
    if (!ids.has(noteId)) noteId = '';
    const counts = visible.reduce((acc, n) => { acc[n.category] = (acc[n.category] || 0) + 1; return acc; }, {});
    host('graph').innerHTML = header('Red neuronal de tu oficina', 'Cada punto es una nota de Obsidian y cada línea un enlace [[nota]] entre ellas.', btn('refresh-notes', 'Actualizar grafo') + btn('docs-view', 'Leer documentación')) +
      `<div class="graph-toolbar"><label>Mostrar<select id="graphFilter">${opts([['personal', 'Personales'], ['work', 'Trabajo'], ['office', 'Oficina'], ...ws.projects.map(p => [p.id, p.name])], graphFilter, 'Toda la bóveda')}</select></label><label>Buscar una nota<select id="graphNode">${opts(visible.map(n => [n.id, n.title]), noteId, 'Elige una nota…')}</select></label><span class="graph-count"><b>${visible.length}</b> notas · <b>${links.length}</b> conexiones</span></div>` +
      `<div class="graph-layout"><div class="graph-stage"><div class="graph-stage-bar"><button type="button" class="ws-button" data-portal="graph-zoom-in" aria-label="Acercar">+</button><button type="button" class="ws-button" data-portal="graph-zoom-out" aria-label="Alejar">−</button><button type="button" class="ws-button" data-portal="graph-fit">Ajustar a la ventana</button><span class="graph-hint">Arrastra para moverte · rueda para acercar · clic en un punto para abrirlo</span></div>` +
      `<div class="pixel-graph"><canvas id="knowledgeGraph" width="900" height="520" role="img" aria-label="Grafo de notas de Obsidian. También puedes elegir notas con el selector Buscar una nota."></canvas><div class="graph-tooltip" hidden></div></div>` +
      `<div class="pixel-legend">${Object.keys(GRAPH_NAMES).map(k => `<span style="--node:${GRAPH_COLORS[k]}">${GRAPH_NAMES[k]} <b>${counts[k] || 0}</b></span>`).join('')}<span class="graph-legend-size">El tamaño indica cuántos enlaces tiene la nota</span></div></div>` +
      `<aside id="graphDetail" class="graph-detail" aria-live="polite"></aside></div>`;
    buildGraph(visible, links);
    graphDetail(noteId);
  }
  const graphLinkButton = n => `<button type="button" class="graph-link" data-portal="graph-node" data-id="${esc(n.id)}"><span class="graph-swatch" style="--node:${GRAPH_COLORS[n.category] || '#808080'}"></span><span>${esc(n.label || n.title)}</span><small>${n.degree}</small></button>`;
  function graphDetail(id) {
    const detail = document.querySelector('#graphDetail'); if (!detail) return;
    const n = library.notes.find(n => n.id === id);
    if (!n) {
      const top = graph ? [...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, 8) : [];
      detail.innerHTML = `<h3>Explora tu red</h3><p class="graph-detail-lead">Haz clic en un punto del grafo para ver de qué trata la nota y con qué se conecta.</p>${top.length ? `<h4>Notas más conectadas</h4><div class="graph-links">${top.map(graphLinkButton).join('')}</div>` : '<p>No hay notas con este filtro.</p>'}`;
      return;
    }
    const neighbours = graph ? [...(graph.adjacent.get(n.id) || [])].map(nid => graph.map.get(nid)).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label)) : [];
    detail.innerHTML = `<div class="graph-detail-head"><span class="graph-swatch" style="--node:${GRAPH_COLORS[n.category] || '#808080'}"></span><div><h3>${esc(n.title)}</h3><span class="ws-meta">${esc(GRAPH_NAMES[n.category] || 'Nota')} · ${esc(n.id)}</span></div></div>` +
      `<div class="ws-actions">${btn('read-note', 'Leer nota completa', `data-id="${esc(n.id)}"`, true)}${btn('graph-clear', 'Quitar selección')}</div>` +
      `<h4>Conexiones (${neighbours.length})</h4><div class="graph-links">${neighbours.map(graphLinkButton).join('') || '<p>Esta nota no enlaza con otras.</p>'}</div>` +
      `<h4>Vista previa</h4><div class="portal-markdown graph-preview">${markdown(n.content.slice(0, 1500), n.id)}</div>`;
  }
  function selectGraphNode(id) {
    noteId = id || '';
    const select = document.querySelector('#graphNode'); if (select) select.value = noteId;
    graphDetail(noteId);
    const n = graph && noteId && graph.map.get(noteId); if (n) centerGraphOn(n);
    drawGraph();
  }
  function buildGraph(notes, links) {
    const hash = s => { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
    const shown = notes.slice(0, 350), ids = new Set(shown.map(n => n.id));
    const edges = links.filter(l => ids.has(l.source) && ids.has(l.target) && l.source !== l.target);
    const adjacent = new Map(shown.map(n => [n.id, new Set()]));
    for (const e of edges) { adjacent.get(e.source).add(e.target); adjacent.get(e.target).add(e.source); }
    // Deterministic start (notes grouped by category), then a force-directed relaxation.
    const groups = { office: 0, personal: 1, work: 2 };
    const nodes = shown.map(n => {
      const g = groups[n.category] ?? 3, angle = g * 2.1 + (hash(n.id) % 1000) / 1000 * 1.6, r = 120 + hash(n.id + 'r') % 160;
      return { ...n, degree: adjacent.get(n.id).size, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
    });
    // Notes that share a title (e.g. every project's "Tareas") get their project name appended.
    const titles = nodes.reduce((acc, n) => acc.set(n.title, (acc.get(n.title) || 0) + 1), new Map());
    for (const n of nodes) { const project = ws.projects.find(p => p.id === n.projectId)?.name; n.label = titles.get(n.title) > 1 && project ? `${n.title} · ${project}` : n.title; }
    const map = new Map(nodes.map(n => [n.id, n]));
    const k = 70, steps = nodes.length > 200 ? 90 : 220;
    for (let step = 0; step < steps; step++) {
      const cool = 1 - step / steps;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 25);
        if (d2 > 160000) continue;
        const f = k * k / d2; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const e of edges) {
        const a = map.get(e.source), b = map.get(e.target), dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - k) / d * .08;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx -= n.x * .012; n.vy -= n.y * .012; // gentle pull to the centre keeps isolated notes on screen
        const v = Math.hypot(n.vx, n.vy), max = 18 * cool + 1;
        if (v > max) { n.vx *= max / v; n.vy *= max / v; }
        n.x += n.vx; n.y += n.vy; n.vx *= .5; n.vy *= .5;
      }
    }
    graphObserver?.disconnect();
    graph = { nodes, edges, map, adjacent, scale: 1, ox: 0, oy: 0, hover: null, width: 0, height: 0 };
    const canvas = document.querySelector('#knowledgeGraph'); if (!canvas) return;
    bindGraph(canvas);
    fitGraph(); drawGraph();
    if (typeof ResizeObserver === 'function') { graphObserver = new ResizeObserver(() => drawGraph()); graphObserver.observe(canvas.parentElement); }
  }
  function graphSize() {
    const rect = document.querySelector('#knowledgeGraph')?.getBoundingClientRect();
    return { w: Math.round(rect?.width) || 900, h: Math.round(rect?.height) || 520 };
  }
  function fitGraph() {
    if (!graph) return;
    const { w, h } = graphSize(); graph.width = w; graph.height = h;
    if (!graph.nodes.length) { graph.scale = 1; graph.ox = w / 2; graph.oy = h / 2; return; }
    const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    graph.scale = Math.max(.2, Math.min(3.5, (w - 260) / Math.max(maxX - minX, 1), (h - 90) / Math.max(maxY - minY, 1)));
    graph.ox = w / 2 - (minX + maxX) / 2 * graph.scale; graph.oy = h / 2 - (minY + maxY) / 2 * graph.scale;
  }
  function centerGraphOn(n) {
    const { w, h } = graphSize(), sx = n.x * graph.scale + graph.ox, sy = n.y * graph.scale + graph.oy;
    if (sx < 140 || sx > w - 140 || sy < 60 || sy > h - 60) { graph.ox = w / 2 - n.x * graph.scale; graph.oy = h / 2 - n.y * graph.scale; }
  }
  function zoomGraph(factor, cx, cy) {
    if (!graph) return;
    const { w, h } = graphSize(); cx ??= w / 2; cy ??= h / 2;
    const next = Math.max(.2, Math.min(5, graph.scale * factor)), f = next / graph.scale;
    graph.ox = cx - (cx - graph.ox) * f; graph.oy = cy - (cy - graph.oy) * f; graph.scale = next; drawGraph();
  }
  const nodeSize = n => 10 + Math.min(12, n.degree * 1.6);
  function graphHit(canvas, e) {
    const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bestD = Infinity;
    for (const n of graph.nodes) { const d = Math.hypot(n.x * graph.scale + graph.ox - x, n.y * graph.scale + graph.oy - y); if (d < bestD) { best = n; bestD = d; } }
    return best && bestD <= nodeSize(best) / 2 + 8 ? best : null;
  }
  function bindGraph(canvas) {
    const tip = document.querySelector('.graph-tooltip');
    let drag = null;
    canvas.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, ox: graph.ox, oy: graph.oy, moved: false }; canvas.setPointerCapture?.(e.pointerId); };
    canvas.onpointermove = e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) { graph.ox = drag.ox + dx; graph.oy = drag.oy + dy; canvas.style.cursor = 'grabbing'; if (tip) tip.hidden = true; drawGraph(); return; }
      }
      const n = graphHit(canvas, e);
      if (n !== graph.hover) { graph.hover = n; drawGraph(); }
      canvas.style.cursor = n ? 'pointer' : 'grab';
      if (!tip) return;
      tip.hidden = !n;
      if (n) {
        const rect = canvas.getBoundingClientRect();
        tip.innerHTML = `<b>${esc(n.label)}</b><span>${esc(GRAPH_NAMES[n.category] || 'Nota')} · ${n.degree} ${n.degree === 1 ? 'conexión' : 'conexiones'}</span>`;
        tip.style.left = Math.max(4, Math.min(e.clientX - rect.left + 16, rect.width - 250)) + 'px'; tip.style.top = (e.clientY - rect.top + 18) + 'px';
      }
    };
    canvas.onpointerup = e => { const wasDrag = drag?.moved; drag = null; canvas.style.cursor = 'grab'; if (!wasDrag) { const n = graphHit(canvas, e); selectGraphNode(n ? n.id : ''); } };
    canvas.onpointerleave = () => { if (!drag && graph.hover) { graph.hover = null; drawGraph(); } if (tip) tip.hidden = true; };
    canvas.onwheel = e => { e.preventDefault(); const rect = canvas.getBoundingClientRect(); zoomGraph(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top); };
  }
  function drawGraph() {
    const canvas = document.querySelector('#knowledgeGraph'); if (!canvas || !graph) return;
    const { w, h } = graphSize(), dpr = window.devicePixelRatio || 1;
    // Keep the drawing centred when the window (and the canvas) changes size.
    if (graph.width !== w || graph.height !== h) { graph.ox += (w - graph.width) / 2; graph.oy += (h - graph.height) / 2; graph.width = w; graph.height = h; }
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    // Light dotted grid, like a classic diagram tool.
    const grid = 24 * Math.max(.5, Math.min(2, graph.scale)), gx = ((graph.ox % grid) + grid) % grid, gy = ((graph.oy % grid) + grid) % grid;
    ctx.fillStyle = '#d0d0d0';
    for (let x = gx; x < w; x += grid) for (let y = gy; y < h; y += grid) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    const { nodes, edges, map, adjacent } = graph;
    const focus = graph.hover?.id || noteId, near = focus ? adjacent.get(focus) || new Set() : null;
    const P = n => [n.x * graph.scale + graph.ox, n.y * graph.scale + graph.oy];
    const drawEdges = active => {
      ctx.beginPath();
      for (const e of edges) {
        if (Boolean(focus && (e.source === focus || e.target === focus)) !== active) continue;
        const [ax, ay] = P(map.get(e.source)), [bx, by] = P(map.get(e.target)); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      }
      ctx.strokeStyle = active ? '#000080' : focus ? '#e4e4e4' : '#a0a0a0'; ctx.lineWidth = active ? 2 : 1; ctx.stroke();
    };
    drawEdges(false); if (focus) drawEdges(true);
    // Nodes: the focused neighbourhood is drawn last so it stays on top.
    const rank = n => n.id === focus ? 3 : near?.has(n.id) ? 2 : 1;
    for (const n of [...nodes].sort((a, b) => rank(a) - rank(b))) {
      const [x, y] = P(n), s = Math.round(nodeSize(n) * (n.id === noteId ? 1.3 : 1));
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
      const L = Math.round(x - s / 2), T = Math.round(y - s / 2);
      ctx.globalAlpha = focus && rank(n) === 1 ? .3 : 1;
      ctx.fillStyle = '#000'; ctx.fillRect(L + 2, T + 2, s, s);
      ctx.fillStyle = GRAPH_COLORS[n.category] || '#808080'; ctx.fillRect(L, T, s, s);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(L, T, s, 2); ctx.fillRect(L, T, 2, s);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(L, T + s - 2, s, 2); ctx.fillRect(L + s - 2, T, 2, s);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(L - .5, T - .5, s + 1, s + 1);
      if (n.id === noteId) { ctx.setLineDash([2, 2]); ctx.strokeStyle = '#000080'; ctx.strokeRect(L - 5.5, T - 5.5, s + 11, s + 11); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
    }
    // Labels: focus first, then neighbours, then the most connected notes; any label that would overlap is skipped.
    ctx.font = `13px ${GRAPH_FONT}`; ctx.textBaseline = 'middle';
    const placed = [], limit = graph.scale > 1.4 || nodes.length <= 40 ? 400 : 30;
    let count = 0;
    for (const n of [...nodes].sort((a, b) => rank(b) - rank(a) || b.degree - a.degree)) {
      const r = rank(n); if (r === 1 && count >= (focus ? 12 : limit)) continue;
      const [x, y] = P(n), s = nodeSize(n), text = n.label.length > 34 ? n.label.slice(0, 33) + '…' : n.label;
      const tw = (ctx.measureText(text)?.width || text.length * 7) + 10, box = { x: x + s / 2 + 6, y: y - 10, w: tw, h: 20 };
      if (box.x + box.w > w - 4) box.x = x - s / 2 - 6 - tw;
      if (box.x + box.w < 0 || box.x > w || box.y < -20 || box.y > h) continue;
      if (r < 3 && placed.some(p => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
      placed.push(box); count++;
      const selected = n.id === focus, X = Math.round(box.x), Y = Math.round(box.y), W = Math.round(box.w);
      ctx.globalAlpha = focus && r === 1 ? .45 : 1;
      ctx.fillStyle = selected ? '#000080' : 'rgba(255,255,255,.94)'; ctx.fillRect(X, Y, W, box.h);
      if (!selected) { ctx.strokeStyle = '#b0b0b0'; ctx.strokeRect(X + .5, Y + .5, W - 1, box.h - 1); }
      ctx.fillStyle = selected ? '#fff' : '#000'; ctx.fillText(text, X + 5, Math.round(y));
      ctx.globalAlpha = 1;
    }
    if (!nodes.length) { ctx.fillStyle = '#404040'; ctx.font = `15px ${GRAPH_FONT}`; ctx.textAlign = 'center'; ctx.fillText('No hay notas con este filtro.', w / 2, h / 2); ctx.textAlign = 'start'; }
  }
  const buddy = '<svg class="msn-buddy" viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="10" cy="11" rx="5" ry="6" fill="#a9d944"/><path d="M1 28v-5c0-6 18-6 18 0v5" fill="#79ae2c"/><ellipse cx="23" cy="10" rx="5" ry="6" fill="#70bfea"/><path d="M14 29v-6c0-7 18-7 18 0v6" fill="#3193cf"/><path d="M3 23c2-3 6-4 10-2M17 22c2-3 6-4 11-2" fill="none" stroke="#fff" opacity=".55" stroke-width="2"/></svg>';
  function avatar(chat, self = false) {
    const agent = ws.agents.find(a => a.id === chat.agentId), name = self ? 'Tú' : chat.agentName;
    const picture = window.OfficeAvatars ? window.OfficeAvatars.html(self ? { color: '#5a9bd6' } : agent || { color: '#39c494' }) : '';
    return `<div class="chat-avatar ${self ? 'msn-self-avatar' : ''}" title="${esc(name)}">${picture}<span class="msn-presence ${chat.status === 'running' ? 'busy' : ''}"></span></div>`;
  }
  const contactPicture = a => `<span class="msn-contact-pic">${window.OfficeAvatars ? window.OfficeAvatars.html(a) : ''}</span>`;
  function contactProjects(id) {
    return ws.projects;
  }
  const hasMember = (chat, id) => !id || chat.agentId === id || chat.participants?.some(p => p.id === id);
  const teamLabel = chat => chat.participants?.map(p => p.name).join(' + ') || chat.agentName;
  function chatSidebar() {
    const agentId = contactAgent || currentChat?.agentId || '';
    const agents = ws.agents.filter(a => a.enabled && ['claude', 'codex'].includes(a.provider));
    const chats = conversations.filter(c => hasMember(c, agentId));
    const projects = agentId ? contactProjects(agentId) : ws.projects;
    return `<div class="msn-identity">${buddy}<div><strong>Mi oficina</strong><small><span class="msn-status-dot"></span> Disponible <span>⌄</span></small><span class="msn-personal-message">Un proyecto a la vez ♫</span></div></div>
      <div class="msn-contact-actions">${btn('new-chat', '✉ Nueva conversación')}${btn('projects', '▰ Proyectos')}</div><label class="msn-search-label"><span class="sr-only">Buscar contactos y proyectos</span><input type="search" id="messengerSearch" value="${esc(contactSearch)}" placeholder="Buscar un contacto o proyecto…"></label>
      <div class="msn-group-title">▾ Contactos (${agents.length})</div><div class="msn-contacts">${agents.map(a => `<div class="msn-contact-row" data-search="${esc(a.name.toLowerCase())}"><button type="button" class="msn-contact-picture" data-portal="change-avatar" data-agent="${esc(a.id)}" title="Cambiar imagen de ${esc(a.name)}" aria-label="Cambiar imagen de ${esc(a.name)}">${contactPicture(a)}</button><button type="button" class="msn-contact" data-portal="contact" data-id="${esc(a.id)}" aria-current="${agentId === a.id}"><span class="msn-status-dot ${conversations.some(c => c.agentId === a.id && c.status === 'running') ? 'busy' : ''}"></span><b>${esc(a.name)}</b><small>${conversations.some(c => c.agentId === a.id && c.status === 'running') ? 'Ocupado' : 'Disponible'}</small></button></div>`).join('')}</div>
      <div class="msn-group-title">▾ Proyectos (${projects.length})</div><div class="msn-project-list">${projects.length ? projects.map(p => `<button type="button" data-portal="contact-project" data-id="${esc(p.id)}" data-agent="${esc(agentId)}" data-search="${esc(p.name.toLowerCase())}" class="msn-project" aria-current="${currentChat?.projectId === p.id}"><span aria-hidden="true">▰</span><span>${esc(p.name)}<small>${p.category === 'work' ? 'Trabajo' : 'Personal'} · ${p.tasks.filter(t => t.status !== 'done').length} pendientes</small></span></button>`).join('') : '<p class="msn-empty-list">Aún no hay proyectos. Impórtalos desde Proyectos.</p>'}</div>
      <div class="msn-group-title">▾ Conversaciones (${chats.length})</div>${chats.map(c => `<button type="button" class="chat-thread" data-portal="open-chat" data-id="${c.id}" aria-current="${c.id === currentChat?.id}" data-search="${esc((c.title + ' ' + c.projectName).toLowerCase())}">${avatar(c)}<div><b>${esc(c.title)}</b><small>${esc(c.projectName)}</small><small>${c.status === 'running' ? 'Escribiendo un mensaje…' : esc(c.preview || 'Sin mensajes')}</small></div></button>`).join('')}<div class="msn-sidebar-footer">${buddy}<span>Oficina de Agentes<br><small>Tu espacio de trabajo conectado</small></span></div>`;
  }
  function chatDefaults() {
    const p = ws.projects.find(p => p.id === preferredProject) || contactProjects(preferredAgent || contactAgent)[0] || ws.projects[0];
    const task = p?.tasks.find(t => t.id === preferredTask), rule = ws.rules.find(r => r.type === (task?.type || 'implementation'));
    const routeAgent = task?.agentId || rule?.agentId;
    const agent = ws.agents.find(a => a.id === (preferredAgent || contactAgent || routeAgent));
    const model = agent?.id === routeAgent ? task?.model || rule?.model || agent?.model || '' : agent?.model || '';
    return { p, task, agent, model };
  }
  function createChatForm() {
    const { p, task, agent, model } = chatDefaults();
    if (p) preferredProject = p.id;
    return `<form id="newChatForm" class="ws-card msn-new-chat"><h3>${agent ? 'Conversar con ' + esc(agent.name) : 'Nueva conversación'}</h3><p>Elige el proyecto en el que van a trabajar.</p><div class="ws-form-grid"><label>Proyecto<select name="projectId" id="chatProject" required>${opts(ws.projects.map(p => [p.id, p.name]), p?.id)}</select></label><label>Tarea<select name="taskId" id="chatTask">${opts((p?.tasks || []).filter(t => !['done', 'blocked'].includes(t.status)).map(t => [t.id, t.title]), task?.id, 'Conversación general del proyecto')}</select></label><label>Agente<select name="agentId" id="chatAgent">${opts(ws.agents.filter(a => a.enabled && ['claude', 'codex'].includes(a.provider)).map(a => [a.id, a.name]), agent?.id)}</select></label><label>Modelo<input name="model" id="chatModel" value="${esc(model)}" placeholder="Predeterminado del agente" list="portalModels"></label><label class="ws-wide">Título<input name="title" placeholder="${esc(p?.name || 'Conversación')}"></label><label class="ws-wide"><span><input type="checkbox" name="allowChanges"> Permitir que el agente edite archivos de este proyecto</span><small>Desactivado: consulta e investigación. Activado: cambios sujetos a los permisos del agente.</small></label></div><div class="ws-actions"><button class="ws-button primary" ${!p ? 'disabled' : ''}>Abrir conversación</button>${btn('cancel-new-chat', 'Cancelar')}${!p ? btn('projects', 'Primero guarda un proyecto') : ''}</div></form><datalist id="portalModels"><option value="haiku"><option value="sonnet"><option value="opus"></datalist>`;
  }
  function messagesHtml(chat) {
    return chat.messages.map(m => `<div class="msn-message ${m.role}" data-status="${esc(m.status)}"><div class="msn-sender">${m.role === 'user' ? 'Tú' : esc(m.agentName || chat.agentName)}${m.phase === 'review' ? ' (revisión cruzada)' : ''} dice:<time>${new Date(m.created).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</time>${m.status === 'error' ? '<span> · Error</span>' : ['stopped', 'interrupted'].includes(m.status) ? '<span> · Interrumpida</span>' : ''}</div><div class="msn-message-content ${m.role === 'assistant' ? 'portal-markdown' : ''}">${m.role === 'assistant' ? m.text ? markdown(m.text) : '<span class="chat-typing" aria-label="El agente está escribiendo"><i></i><i></i><i></i></span>' : esc(m.text)}</div></div>`).join('') || '<div class="msn-conversation-notice">Claude y Codex trabajarán juntos: primero la respuesta del responsable y después la revisión del compañero.</div>';
  }
  function chatView() {
    const chat = currentChat;
    const selectedAgent = ws.agents.find(a => a.id === (contactAgent || preferredAgent)), contactName = !newChat && chat ? teamLabel(chat) : selectedAgent?.name ? selectedAgent.name + ' + equipo' : 'Claude + Codex';
    const portrait = chat && !newChat ? chat : { agentId: selectedAgent?.id || ws.agents.find(a => a.enabled)?.id, agentName: contactName, status: 'idle' };
    WM.setTitle('chat', contactName + ' — Messenger');
    host('chat').innerHTML = `<div class="msn-window" aria-label="Windows Live Messenger de la oficina"><div class="msn-titlebar"><div>${buddy}<span>${esc(contactName)} — Windows Live Messenger</span></div><div class="msn-window-controls"><button type="button" data-wm="minimize" aria-label="Minimizar conversación">―</button><button type="button" data-wm="maximize" aria-label="Maximizar conversación">□</button><button type="button" data-wm="close" aria-label="Cerrar ventana de conversación">×</button></div></div>
      <div class="chat-shell"><aside class="chat-sidebar" id="chatSidebar">${chatSidebar()}</aside><section class="chat-main"><div class="msn-conversation-heading">${avatar(portrait)}<div><h2>${esc(contactName)} <span>${chat && !newChat && chat.status === 'running' ? '(Ocupado)' : '(Disponible)'}</span></h2><p>${chat && !newChat ? esc(chat.projectName) + ' · ' + esc(chat.model || 'Modelo predeterminado') : 'Selecciona un proyecto y empieza a conversar'}</p></div>${buddy}</div>
      ${newChat ? `<div class="portal-reader msn-setup">${createChatForm()}</div>` : chat ? `<div class="msn-toolbar">${btn('chat-docs', '<span aria-hidden="true">▤</span> Documentación', `data-project="${chat.projectId}"`)}${btn('show-project', '<span aria-hidden="true">▰</span> Proyecto')}${btn('new-chat', '<span aria-hidden="true">✉</span> Nueva conversación')}<span class="msn-toolbar-mode">${chat.allowChanges ? 'Edición habilitada' : 'Solo consulta'}</span></div>
      <div class="msn-chat-workspace"><div class="msn-transcript-column"><div class="chat-messages" id="chatMessages" role="log" aria-label="Conversación">${messagesHtml(chat)}</div><div class="chat-composer"><div class="msn-format-bar">${btn('emoticons', '<span aria-hidden="true">☺</span><span class="sr-only">Insertar emoticono</span>', 'aria-expanded="false"')}${btn('format-bold', '<b>A</b><span class="sr-only">Insertar texto destacado</span>')}${btn('insert-context', '<span aria-hidden="true">▤</span> Pedir contexto')}<span>Enter para enviar</span></div><div class="msn-emoticon-picker" hidden>${['🙂', '😄', '😉', '😎', '👍', '❤️', '☕', '💡'].map(emoji => btn('insert-emoji', emoji, `data-emoji="${emoji}" aria-label="Insertar ${emoji}"`)).join('')}</div><form id="messageForm"><label><span class="sr-only">Escribe un mensaje</span><textarea name="text" id="chatText" rows="3" maxlength="32000" placeholder="Escribe un mensaje…" required>${esc(drafts.get(chat.id) || pendingText)}</textarea></label><div class="msn-send-buttons"><button class="ws-button" id="sendMessage" aria-label="Enviar mensaje" ${chat.status === 'running' ? 'disabled' : ''}>Enviar</button>${btn('stop-chat', 'Detener', `id="stopChat" ${chat.status !== 'running' ? 'hidden' : ''}`)}</div></form><div class="chat-activity" id="chatActivity" role="status">${esc(chat.activity || 'Últimos mensajes guardados en tu proyecto.')}</div></div></div>
      <aside class="msn-avatar-rail"><button type="button" class="msn-display-picture msn-change-picture" data-portal="change-avatar" data-agent="${esc(chat.agentId)}" title="Cambiar imagen para mostrar">${avatar(chat)}<span>${esc(chat.agentName)}</span><small>Cambiar imagen…</small></button><div class="msn-project-card"><strong>▰ ${esc(chat.projectName)}</strong><small>${esc(ws.projects.find(p => p.id === chat.projectId)?.category === 'work' ? 'Trabajo' : 'Personal')}</small>${btn('chat-docs', 'Ver documentación', `data-project="${chat.projectId}"`)}</div><div class="msn-display-picture msn-own-picture">${avatar(chat, true)}<span>Tú</span></div></aside></div>` : `<div class="chat-welcome">${buddy}<h3>¡Hola! ¿Con quién quieres conversar?</h3><p>Selecciona un personaje y uno de sus proyectos en tu lista de contactos.</p>${btn('new-chat', 'Iniciar una conversación')}</div>`}
      <div class="msn-statusbar"><span id="chatConnection">Conectando…</span><span>Los mensajes se guardan en Obsidian</span></div></section></div></div>`;
    filterContacts(); updateConnection(); const messages = document.querySelector('#chatMessages'); if (messages) messages.scrollTop = messages.scrollHeight;
    if (chat && !newChat) updateTeamDisplay(chat);
    const form = document.querySelector('#newChatForm');
    if (form) {
      const { agent } = chatDefaults(), other = ws.agents.find(a => a.enabled && ['claude', 'codex'].includes(a.provider) && a.provider !== agent?.provider);
      form.querySelector('h3').textContent = 'Trabajo combinado: Claude + Codex';
      form.querySelector('p').textContent = `${agent?.name || 'Responsable'} resuelve la solicitud y ${other?.name || 'el otro agente'} revisa el resultado. Ambos participan en cada mensaje.`;
      document.querySelector('#chatAgent').closest('label').firstChild.textContent = 'Responsable (ambos participan)';
      document.querySelector('#chatModel').closest('label').firstChild.textContent = 'Modelo del responsable';
    }
  }
  function updateTeamDisplay(chat) {
    const el = host('chat'); if (!el) return;
    const title = el.querySelector('.msn-titlebar > div:first-child > span');
    if (title) title.textContent = teamLabel(chat) + ' — Windows Live Messenger';
    WM.setTitle('chat', teamLabel(chat) + ' — Messenger');
    const heading = el.querySelector('.msn-conversation-heading h2');
    if (heading) { heading.firstChild.nodeValue = teamLabel(chat) + ' '; heading.querySelector('span').textContent = chat.status === 'running' ? '(Trabajando)' : '(Disponible)'; }
    const models = chat.participants?.map(p => `${p.name}: ${p.model || 'predeterminado'}`).join(' · ') || chat.model || 'Modelo predeterminado';
    const subtitle = el.querySelector('.msn-conversation-heading p'); if (subtitle) subtitle.textContent = chat.projectName + ' · ' + models;
  }
  function filterContacts() { host('chat')?.querySelectorAll('[data-search]').forEach(el => { el.hidden = !el.dataset.search.includes(contactSearch.toLowerCase()); }); }
  function rememberDraft() { const editor = document.querySelector('#chatText'); if (currentChat && editor) drafts.set(currentChat.id, editor.value); }
  function insertText(text, selectText = false) {
    const editor = document.querySelector('#chatText'); if (!editor) return;
    const start = editor.selectionStart, end = editor.selectionEnd;
    editor.setRangeText(text, start, end, selectText ? 'select' : 'end'); editor.focus(); rememberDraft();
  }
  function updateConnection() { const el = document.querySelector('#chatConnection'); if (el) el.textContent = stream?.readyState === EventSource.OPEN ? '● Conectado' : 'Reconectando…'; }
  function updateChat(chat) {
    if (currentChat?.id === chat.id && currentChat.updated > chat.updated) return;
    const summary = { ...chat, preview: chat.messages.at(-1)?.text.slice(0, 140) || '' }; delete summary.messages;
    conversations = [summary, ...conversations.filter(c => c.id !== chat.id)].sort((a, b) => b.updated.localeCompare(a.updated));
    if (currentChat?.id === chat.id) {
      currentChat = chat;
      if (WM.isOpen('chat') && !newChat) {
        updateTeamDisplay(chat);
        const messages = document.querySelector('#chatMessages');
        if (messages) { const nearEnd = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100; messages.innerHTML = messagesHtml(chat); if (nearEnd) messages.scrollTop = messages.scrollHeight; }
        const activity = document.querySelector('#chatActivity'); if (activity) activity.textContent = chat.activity;
        const stop = document.querySelector('#stopChat'); if (stop) stop.hidden = chat.status !== 'running';
        const send = document.querySelector('#sendMessage'); if (send) send.disabled = chat.status === 'running' || sending;
      }
    }
    if (WM.isOpen('chat')) { const sidebar = document.querySelector('#chatSidebar'); if (sidebar) { sidebar.innerHTML = chatSidebar(); filterContacts(); } }
    // A minimized Messenger flashes its taskbar button when the conversation changes.
    const task = document.querySelector('[data-wm-task="chat"]');
    if (task && currentChat?.id === chat.id && WM.active !== 'chat') task.classList.toggle('has-update', chat.status === 'idle');
  }
  function connect() {
    if (stream) return;
    stream = new EventSource('/api/portal/events');
    stream.addEventListener('chat', e => { try { updateChat(JSON.parse(e.data)); } catch { /* reconnect snapshot recovers */ } });
    stream.onopen = async () => {
      updateConnection();
      try {
        const response = await fetch('/api/workspace', { cache: 'no-store' });
        if (response.ok) ws = await response.json();
        if (currentChat) updateChat(await request('chat?id=' + currentChat.id));
      } catch (e) { toast(e.message, true); }
    };
    stream.onerror = updateConnection;
    // Snapshots also recover simultaneous conversation updates and server restarts.
    poll = setInterval(async () => { if (!WM.isOpen('chat')) return; try { conversations = (await request('chats')).chats; if (currentChat) updateChat(await request('chat?id=' + currentChat.id)); } catch { updateConnection(); } }, 6000);
  }
  async function show(next, state) {
    rememberDraft(); ws = state;
    if (next === 'import') { discovery = await request('discover'); if (WM.isOpen(next)) importView(); }
    else if (next === 'docs' || next === 'graph') { library = await request('notes'); if (WM.isOpen(next)) (next === 'docs' ? docsView : graphView)(); }
    else if (next === 'chat') {
      conversations = (await request('chats')).chats;
      if (preferredProject || preferredAgent) {
        const existing = conversations.find(c => (!preferredProject || c.projectId === preferredProject) && c.taskId === preferredTask && hasMember(c, preferredAgent));
        if (existing) { currentChat = await request('chat?id=' + existing.id); newChat = false; }
        else { currentChat = null; newChat = true; }
      } else if (currentChat) currentChat = await request('chat?id=' + currentChat.id);
      else if (conversations.length) currentChat = await request('chat?id=' + conversations[0].id);
      if (currentChat && !newChat) { contactAgent = currentChat.agentId; preferredProject = ''; preferredAgent = ''; }
      if (WM.isOpen(next)) { chatView(); connect(); }
    }
  }
  // Delegated listeners: only events coming from a portal window are handled here.
  const portalEvent = e => PORTAL_WINDOWS.includes(windowOf(e.target));
  WM.onBeforeClose('chat', () => { rememberDraft(); return true; });
  async function saveAvatar(agentId, avatar) {
    const r = await fetch('/api/workspace/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': ws.token }, body: JSON.stringify({ agentId, avatar }) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || 'No se pudo guardar la imagen.');
    return data;
  }
  document.addEventListener('office:workspace', e => { ws = e.detail; if (WM.isOpen('chat')) { rememberDraft(); chatView(); } });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-portal]'); if (!b || !portalEvent(e)) return;
    const win = windowOf(b);
    try {
      const action = b.dataset.portal;
      if (action === 'projects') document.dispatchEvent(new CustomEvent('office:module', { detail: 'projects' }));
      else if (action === 'refresh-import') { discovery = await request('discover'); importView(); }
      else if (action === 'refresh-notes') { library = await request('notes'); if (WM.isOpen('graph')) graphView(); if (WM.isOpen('docs')) docsView(); }
      else if (action === 'docs-view' || action === 'graph-view') document.dispatchEvent(new CustomEvent('office:module', { detail: action === 'docs-view' ? 'docs' : 'graph' }));
      else if (action === 'graph-node') selectGraphNode(b.dataset.id);
      else if (action === 'graph-clear') selectGraphNode('');
      else if (action === 'graph-zoom-in' || action === 'graph-zoom-out') zoomGraph(action === 'graph-zoom-in' ? 1.25 : 1 / 1.25);
      else if (action === 'graph-fit') { fitGraph(); drawGraph(); }
      else if (action === 'note' || action === 'read-note') { noteId = b.dataset.id; if (win === 'graph' && action === 'note') selectGraphNode(noteId); else { docFilter = ''; document.dispatchEvent(new CustomEvent('office:module', { detail: 'docs' })); } }
      else if (action === 'new-chat') { rememberDraft(); newChat = true; preferredProject = ''; preferredTask = ''; preferredAgent = contactAgent || currentChat?.agentId || ''; chatView(); }
      else if (action === 'cancel-new-chat') { newChat = false; chatView(); }
      else if (action === 'open-chat') { rememberDraft(); currentChat = await request('chat?id=' + b.dataset.id); contactAgent = currentChat.agentId; preferredProject = ''; preferredTask = ''; preferredAgent = ''; newChat = false; pendingText = ''; chatView(); }
      else if (action === 'contact' || action === 'contact-project') {
        rememberDraft(); preferredAgent = action === 'contact' ? b.dataset.id : b.dataset.agent || contactAgent; contactAgent = preferredAgent;
        preferredProject = action === 'contact-project' ? b.dataset.id : ''; preferredTask = ''; pendingText = '';
        const existing = conversations.find(c => hasMember(c, preferredAgent) && (!preferredProject || c.projectId === preferredProject) && !c.taskId);
        currentChat = existing ? await request('chat?id=' + existing.id) : null; newChat = !existing;
        if (existing) { contactAgent = currentChat.agentId; preferredProject = ''; preferredAgent = ''; }
        chatView();
      }
      else if (action === 'change-avatar') {
        const agent = ws.agents.find(a => a.id === b.dataset.agent); if (!agent) return;
        const value = await window.OfficeAvatars.pick(agent); if (value === null) return;
        ws = await saveAvatar(agent.id, value); document.dispatchEvent(new CustomEvent('office:workspace', { detail: ws })); toast(`Imagen de ${agent.name} actualizada.`);
      }
      else if (action === 'emoticons') { const picker = document.querySelector('.msn-emoticon-picker'); picker.hidden = !picker.hidden; b.setAttribute('aria-expanded', String(!picker.hidden)); }
      else if (action === 'insert-emoji') { insertText(b.dataset.emoji); document.querySelector('.msn-emoticon-picker').hidden = true; host('chat').querySelector('[data-portal="emoticons"]').setAttribute('aria-expanded', 'false'); }
      else if (action === 'format-bold') { const editor = document.querySelector('#chatText'); insertText('**' + (editor.value.slice(editor.selectionStart, editor.selectionEnd) || 'texto') + '**', true); }
      else if (action === 'insert-context') insertText('Resume el estado actual de este proyecto, las decisiones tomadas y los próximos pasos.');
      else if (action === 'show-project') {
        document.querySelector('.msn-avatar-rail').classList.add('project-visible');
        const card = document.querySelector('.msn-project-card'), p = ws.projects.find(p => p.id === currentChat.projectId);
        let details = card.querySelector('.msn-project-details');
        if (!details) { details = document.createElement('div'); details.className = 'msn-project-details'; details.innerHTML = `<p>${esc(p?.description || 'Sin descripción todavía.')}</p><ul>${(p?.tasks || []).map(t => `<li>${esc(t.title)} · ${({ todo: 'Pendiente', doing: 'En curso', done: 'Terminada', blocked: 'Bloqueada' })[t.status] || esc(t.status)}</li>`).join('') || '<li>Sin tareas guardadas</li>'}</ul>`; card.append(details); }
        else details.hidden = !details.hidden;
        b.setAttribute('aria-expanded', String(!details.hidden));
        if (details.hidden) document.querySelector('.msn-avatar-rail').classList.remove('project-visible');
      }
      else if (action === 'stop-chat') { b.disabled = true; updateChat(await request('chat/stop', { id: currentChat.id })); b.disabled = false; }
      else if (action === 'chat-docs') { docFilter = b.dataset.project; noteId = ''; document.dispatchEvent(new CustomEvent('office:module', { detail: 'docs' })); }
    } catch (err) { toast(err.message, true); b.disabled = false; }
  });
  document.addEventListener('change', e => {
    if (!portalEvent(e)) return;
    if (e.target.id === 'docFilter') { docFilter = e.target.value; noteId = filteredNotes()[0]?.id || ''; docsView(); }
    else if (e.target.id === 'graphFilter') { graphFilter = e.target.value; noteId = ''; graphView(); }
    else if (e.target.id === 'graphNode') selectGraphNode(e.target.value);
    else if (e.target.id === 'chatProject') { preferredProject = e.target.value; preferredTask = ''; chatView(); }
    else if (e.target.id === 'chatTask') {
      preferredTask = e.target.value;
      const { agent, model } = chatDefaults();
      document.querySelector('#chatAgent').value = agent?.id || '';
      document.querySelector('#chatModel').value = model;
    } else if (e.target.id === 'chatAgent') { preferredAgent = e.target.value; document.querySelector('#chatModel').value = ws.agents.find(a => a.id === e.target.value)?.model || ''; }
  });
  document.addEventListener('input', e => { if (!portalEvent(e)) return; if (e.target.id === 'noteSearch') { noteSearch = e.target.value; document.querySelector('#noteList').innerHTML = noteList(); } else if (e.target.id === 'chatText' && currentChat) drafts.set(currentChat.id, e.target.value); else if (e.target.id === 'messengerSearch') { contactSearch = e.target.value; filterContacts(); } });
  document.addEventListener('keydown', e => { if (!portalEvent(e)) return; if (e.target.id === 'chatText' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (currentChat?.status !== 'running' && !sending) document.querySelector('#messageForm').requestSubmit(); } });
  document.addEventListener('submit', async e => {
    if (!portalEvent(e)) return;
    const form = e.target; if (!['importForm', 'newChatForm', 'messageForm'].includes(form.id)) return;
    e.preventDefault(); const submit = form.querySelector('button:not([type="button"])'); if (submit) submit.disabled = true;
    try {
      if (form.id === 'importForm') {
        const data = new FormData(form); const projects = data.getAll('selected').map(key => ({ key, category: data.get('category-' + key) }));
        if (!projects.length || projects.some(p => !p.category)) throw new Error('Selecciona proyectos y elige Personal o Trabajo para cada uno.');
        const result = await request('import', { projects }); ws = result.workspace; discovery = result.discovery; importView(); toast(`${result.imported} proyectos agregados a la oficina.`);
      } else if (form.id === 'newChatForm') {
        const input = Object.fromEntries(new FormData(form)); input.allowChanges = form.elements.allowChanges.checked;
        currentChat = await request('chat/create', input); contactAgent = currentChat.agentId; conversations = (await request('chats')).chats; newChat = false; preferredProject = ''; preferredTask = ''; preferredAgent = ''; chatView(); document.querySelector('#chatText')?.focus();
      } else {
        if (sending || currentChat.status === 'running') return;
        sending = true; const text = form.elements.text.value; const id = currentChat.id;
        const result = await request('chat/send', { id, text }); drafts.delete(id); pendingText = '';
        if (currentChat?.id === id) { const editor = document.querySelector('#chatText'); if (editor) editor.value = ''; updateChat(result); }
      }
    } catch (err) { toast(err.message, true); }
    finally { sending = false; if (submit?.isConnected) submit.disabled = form.id === 'messageForm' && currentChat?.status === 'running'; }
  });
  window.OfficePortal = {
    show,
    selectProject(id, taskId = '') { preferredAgent = ''; contactAgent = ''; preferredProject = id; preferredTask = taskId; pendingText = taskId ? 'Retoma esta tarea según el contexto y los pendientes documentados.' : 'Revisa el contexto del proyecto y ayúdame a continuar desde donde quedamos.'; docFilter = ''; },
    selectAgent(id, projectId = '') { rememberDraft(); preferredAgent = id; contactAgent = id; preferredProject = projectId; preferredTask = ''; contactSearch = ''; pendingText = ''; },
  };
})();
