/* Winamp-style player for YouTube Music links. Playback uses the official YouTube IFrame player (kept visible,
   as its terms require); only video/playlist IDs are stored in the local workspace configuration. */
(() => {
  const WM = window.Win98WM;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ID = /^[A-Za-z0-9_-]{6,80}$/;
  let items = [], token = '', player = null, apiPromise = null, current = -1, timer = null, playing = false, shuffle = false, repeat = false, volume = 70;

  /** Accepts music.youtube.com, youtube.com and youtu.be links; returns { videoId, listId } or throws a readable error. */
  function parseLink(text) {
    let url;
    try { url = new URL(String(text).trim()); } catch { throw new Error('Pega un enlace completo, por ejemplo https://music.youtube.com/playlist?list=…'); }
    if (!['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw new Error('El enlace debe ser de YouTube Music o YouTube.');
    if (url.pathname.startsWith('/browse/') || url.pathname.startsWith('/channel/')) throw new Error('Ese enlace es una página, no una lista. En YouTube Music usa Compartir → Copiar enlace en el álbum o la playlist.');
    let videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || '';
    const path = url.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/); if (path) videoId = path[2];
    let listId = url.searchParams.get('list') || '';
    if (listId.startsWith('RD')) listId = ''; // automatic radios/mixes cannot be embedded
    if (videoId && !ID.test(videoId)) videoId = '';
    if (listId && !ID.test(listId)) listId = '';
    if (!videoId && !listId) throw new Error('No encontré una canción ni una playlist en ese enlace.');
    return { videoId, listId };
  }
  async function save() {
    const r = await fetch('/api/workspace/music', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': token }, body: JSON.stringify({ items }) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || 'No se pudo guardar la lista.');
    items = data.music || [];
  }
  function loadApi() {
    if (window.YT?.Player) return Promise.resolve();
    apiPromise ||= new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
      script.onerror = () => { apiPromise = null; reject(new Error('No se pudo cargar el reproductor de YouTube. Revisa tu conexión a internet.')); };
      document.head.append(script);
    });
    return apiPromise;
  }
  const $ = sel => WM.host('winamp')?.querySelector(sel);
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  function status(text, error = false) { const el = $('#wampStatus'); if (el) { el.textContent = text; el.classList.toggle('error', error); } }
  function setTitle(text) { const el = $('#wampTitle'); if (el) { el.textContent = text; el.parentElement.classList.toggle('scrolling', text.length > 34); } }
  function renderList() {
    const list = $('#wampList'); if (!list) return;
    list.innerHTML = items.map((item, i) => `<li class="${i === current ? 'current' : ''}"><button type="button" class="winamp-item" data-wamp-play="${i}" title="Reproducir"><span class="winamp-num">${i + 1}.</span><span class="winamp-name">${esc(item.title)}</span><span class="winamp-kind">${item.listId ? 'LISTA' : 'TEMA'}</span></button><button type="button" class="winamp-remove" data-wamp-remove="${i}" aria-label="Quitar ${esc(item.title)}">×</button></li>`).join('')
      || '<li class="winamp-empty">La lista está vacía. Pega arriba un enlace de YouTube Music.</li>';
  }
  function view() {
    const el = WM.host('winamp');
    el.innerHTML = `<div class="winamp"><div class="winamp-titlebar"><span class="winamp-logo" aria-hidden="true"></span><span class="winamp-brand">WINAMP</span><span class="winamp-title-controls"><button type="button" data-wm="minimize" aria-label="Minimizar Winamp"></button><button type="button" data-wm="maximize" aria-label="Maximizar Winamp"></button><button type="button" data-wm="close" aria-label="Cerrar Winamp"></button></span></div>
      <div class="winamp-main"><div class="winamp-display"><div class="winamp-led"><span class="winamp-state" id="wampState" aria-hidden="true">■</span><span class="winamp-time" id="wampTime">00:00</span></div><div class="winamp-viz" aria-hidden="true">${'<i></i>'.repeat(18)}</div>
        <div class="winamp-marquee"><span id="wampTitle">*** WINAMP · YouTube Music ***</span></div><div class="winamp-meta"><span id="wampDuration">--:--</span><span>YT</span><span id="wampMode">ESTÉREO</span></div></div>
        <input type="range" class="winamp-seek" id="wampSeek" min="0" max="1000" value="0" aria-label="Posición de la canción" disabled>
        <div class="winamp-controls"><button type="button" data-wamp="prev" aria-label="Anterior">⏮</button><button type="button" data-wamp="play" aria-label="Reproducir">▶</button><button type="button" data-wamp="pause" aria-label="Pausa">⏸</button><button type="button" data-wamp="stop" aria-label="Detener">⏹</button><button type="button" data-wamp="next" aria-label="Siguiente">⏭</button>
          <button type="button" class="winamp-toggle" data-wamp="shuffle" aria-pressed="${shuffle}">ALEAT</button><button type="button" class="winamp-toggle" data-wamp="repeat" aria-pressed="${repeat}">REPETIR</button>
          <label class="winamp-volume"><span>VOL</span><input type="range" id="wampVolume" min="0" max="100" value="${volume}" aria-label="Volumen"></label></div></div>
      <div class="winamp-video"><div id="wampPlayer"></div><p class="winamp-video-empty">El video aparece aquí al reproducir.</p></div>
      <div class="winamp-playlist"><div class="winamp-pl-title">EDITOR DE LISTA</div>
        <form id="wampAdd" class="winamp-add"><input id="wampUrl" type="url" required placeholder="Pega un enlace de YouTube Music…" aria-label="Enlace de YouTube Music"><input id="wampName" maxlength="200" placeholder="Nombre (opcional)" aria-label="Nombre para mostrar"><button type="submit">Agregar</button></form>
        <p class="winamp-status" id="wampStatus" role="status">Playlists, álbumes y canciones públicas o no listadas.</p>
        <ol class="winamp-list" id="wampList"></ol></div></div>`;
    renderList();
  }
  function tick() {
    if (!player?.getCurrentTime) return;
    const t = player.getCurrentTime() || 0, d = player.getDuration() || 0;
    $('#wampTime') && ($('#wampTime').textContent = fmt(t));
    $('#wampDuration') && ($('#wampDuration').textContent = d ? fmt(d) : '--:--');
    const seek = $('#wampSeek'); if (seek && !seek.matches(':active')) { seek.disabled = !d; seek.value = d ? Math.round(t / d * 1000) : 0; }
  }
  function setPlaying(value) {
    playing = value; const host = WM.host('winamp');
    host?.querySelector('.winamp')?.classList.toggle('playing', value);
    const state = $('#wampState'); if (state) state.textContent = value ? '▶' : '■';
  }
  async function ensurePlayer() {
    await loadApi();
    if (player && $('#wampPlayer')?.tagName === 'IFRAME') return;
    await new Promise(resolve => {
      player = new window.YT.Player('wampPlayer', {
        width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { player.setVolume(volume); resolve(); },
          onStateChange: e => {
            const S = window.YT.PlayerState;
            if (e.data === S.PLAYING) { setPlaying(true); const data = player.getVideoData?.(); if (data?.title) { setTitle(`${current + 1}. ${data.title}`); learnTitle(data.title); } }
            else if (e.data === S.PAUSED || e.data === S.CUED) setPlaying(false);
            else if (e.data === S.ENDED) { setPlaying(false); const item = items[current]; if (!item?.listId) advance(1, true); }
          },
          onError: e => { status([101, 150].includes(e.data) ? 'Su propietario no permite reproducir este tema fuera de YouTube. Paso al siguiente.' : 'YouTube no pudo reproducir este elemento.', true); setTimeout(() => advance(1, true), 1500); },
        },
      });
    });
    WM.host('winamp')?.querySelector('.winamp-video')?.classList.add('ready');
    clearInterval(timer); timer = setInterval(tick, 500);
  }
  async function learnTitle(title) {
    const item = items[current];
    if (item && !item.listId && ['Canción', ''].includes(item.title)) { item.title = title.slice(0, 200); renderList(); try { await save(); } catch { /* the title is cosmetic */ } }
  }
  async function play(index) {
    if (!items.length) { status('Agrega primero un enlace a la lista.'); return; }
    current = (index + items.length) % items.length; renderList();
    const item = items[current]; setTitle(`${current + 1}. ${item.title}`); status('Cargando…');
    try {
      await ensurePlayer();
      if (item.listId) { player.loadPlaylist({ list: item.listId, listType: 'playlist' }); player.setShuffle?.(shuffle); player.setLoop?.(repeat); }
      else player.loadVideoById(item.videoId);
      status(item.listId ? 'Reproduciendo la playlist completa.' : 'Reproduciendo.');
    } catch (err) { status(err.message, true); }
  }
  function advance(step, auto = false) {
    const item = items[current];
    if (item?.listId && player && !auto) { step > 0 ? player.nextVideo() : player.previousVideo(); return; }
    if (!items.length) return;
    if (auto && !repeat && !shuffle && current + step >= items.length) { setPlaying(false); return; }
    play(shuffle && items.length > 1 ? (current + 1 + Math.floor(Math.random() * (items.length - 1))) % items.length : current + step);
  }
  async function open() {
    const { created } = WM.open('winamp');
    if (!created) return;
    view();
    try {
      const r = await fetch('/api/workspace', { cache: 'no-store' }); const ws = await r.json();
      token = ws.token; items = ws.music || []; renderList();
    } catch { status('No se pudo leer la lista guardada.', true); }
  }
  document.addEventListener('click', async e => {
    if (!e.target.closest?.('.w98-app[data-window="winamp"]')) return;
    const control = e.target.closest('[data-wamp]')?.dataset.wamp;
    try {
      if (control === 'play') { if (player?.getPlayerState && current >= 0 && player.getPlayerState() === window.YT.PlayerState.PAUSED) player.playVideo(); else await play(current < 0 ? 0 : current); }
      else if (control === 'pause') player?.pauseVideo?.();
      else if (control === 'stop') { player?.stopVideo?.(); setPlaying(false); tick(); }
      else if (control === 'prev') advance(-1);
      else if (control === 'next') advance(1);
      else if (control === 'shuffle' || control === 'repeat') {
        if (control === 'shuffle') { shuffle = !shuffle; player?.setShuffle?.(shuffle); } else { repeat = !repeat; player?.setLoop?.(repeat); }
        e.target.closest('[data-wamp]').setAttribute('aria-pressed', String(control === 'shuffle' ? shuffle : repeat));
      }
      const playIndex = e.target.closest('[data-wamp-play]')?.dataset.wampPlay;
      if (playIndex !== undefined) await play(Number(playIndex));
      const removeIndex = e.target.closest('[data-wamp-remove]')?.dataset.wampRemove;
      if (removeIndex !== undefined) {
        const i = Number(removeIndex); items.splice(i, 1); if (i === current) current = -1; else if (i < current) current--;
        await save(); renderList(); status('Elemento quitado de la lista.');
      }
    } catch (err) { status(err.message, true); }
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'wampAdd') return;
    e.preventDefault();
    try {
      const { videoId, listId } = parseLink($('#wampUrl').value), name = $('#wampName').value.trim();
      items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: name || (listId ? 'Playlist de YouTube Music' : 'Canción'), videoId, listId });
      await save(); renderList(); e.target.reset(); status('Agregado. Haz clic en él para reproducirlo.');
    } catch (err) { status(err.message, true); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'wampVolume') { volume = Number(e.target.value); player?.setVolume?.(volume); }
    else if (e.target.id === 'wampSeek' && player?.getDuration) player.seekTo(player.getDuration() * e.target.value / 1000, true);
  });
  document.addEventListener('wm:close', e => { if (e.detail === 'winamp') { clearInterval(timer); player = null; current = -1; playing = false; } });
  window.OfficeWinamp = { open, parseLink };
})();
