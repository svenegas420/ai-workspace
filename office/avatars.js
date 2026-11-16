/* Contact pictures for Messenger and Configuración: a preset gallery or the user's own image (resized to 96x96). */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PRESETS = [
    ['duck', 'Pato', '🦆', '#fff6c4', '#f4c542'], ['cat', 'Gato', '🐱', '#ffe3c9', '#f39b5b'], ['dog', 'Perro', '🐶', '#f3e2cf', '#c79a6b'],
    ['fox', 'Zorro', '🦊', '#ffe0cc', '#ec7b3c'], ['panda', 'Panda', '🐼', '#f1f5f9', '#a6b4c4'], ['frog', 'Rana', '🐸', '#e3f7c9', '#7cc24a'],
    ['owl', 'Búho', '🦉', '#efe2d2', '#a77b52'], ['octopus', 'Pulpo', '🐙', '#fde0ea', '#e66a92'], ['robot', 'Robot', '🤖', '#e2ecf6', '#7f9fbf'],
    ['alien', 'Marciano', '👾', '#ece2fb', '#9a6be0'], ['rocket', 'Cohete', '🚀', '#dbe9ff', '#4f7fd9'], ['guitar', 'Guitarra', '🎸', '#ffe9d6', '#d9783a'],
    ['soccer', 'Fútbol', '⚽', '#e2f6da', '#5aa543'], ['coffee', 'Café', '☕', '#f1e4d6', '#9b6a43'], ['flower', 'Flor', '🌻', '#fff7cc', '#e5b72b'],
    ['headphones', 'Música', '🎧', '#e2f1fb', '#4a9ad0'], ['butterfly', 'Mariposa', '🦋', '#dff3ff', '#3b9be0'], ['sparkles', 'Chispa', '✨', '#fff4d6', '#e8a83a'],
  ].map(([id, label, emoji, light, dark]) => ({ id, label, emoji, light, dark }));
  const person = color => `<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true"><path fill="${esc(color)}" d="M0 0h32v32H0z"/><path fill="#fff" opacity=".2" d="M0 0h32v12H0z"/><path fill="#28354b" d="M10 5h12v4h3v10H7V9h3z"/><path fill="#f3cfa7" d="M10 10h12v10H10z"/><path fill="#364557" d="M11 12h2v2h-2zm8 0h2v2h-2z"/><path fill="#d39578" d="M14 17h5v1h-5z"/><path fill="#f8fbff" d="M8 22h16v10H8z"/><path fill="#435b82" d="M14 22h4v10h-4z"/></svg>`;
  const tile = p => `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="av-${p.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.light}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient></defs><rect width="32" height="32" fill="url(#av-${p.id})"/><rect width="32" height="13" fill="#fff" opacity=".28"/><text x="16" y="17.5" text-anchor="middle" dominant-baseline="middle" font-size="20">${p.emoji}</text></svg>`;
  const isImage = value => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value || '');
  /** Inner markup of a contact picture: uploaded image, gallery preset or the default pixel figure. */
  function html(agent = {}, color) {
    const value = agent.avatar || '';
    if (isImage(value)) return `<img src="${esc(value)}" alt="">`;
    const preset = value.startsWith('preset:') && PRESETS.find(p => p.id === value.slice(7));
    return preset ? tile(preset) : person(color || agent.color || '#39c494');
  }
  /** Crop to a centred square and scale to 96x96 PNG, small enough to keep in the local configuration. */
  function fromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Elige una imagen PNG, JPG, WEBP o GIF.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('La imagen supera los 8 MB.'));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const size = 96, canvas = document.createElement('canvas'), side = Math.min(img.naturalWidth, img.naturalHeight);
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        let data = canvas.toDataURL('image/png'); if (data.length > 110000) data = canvas.toDataURL('image/jpeg', .85);
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
      img.src = url;
    });
  }
  /** Classic "Cambiar imagen para mostrar" dialog. Resolves with the chosen value ('' = default) or null if cancelled. */
  function pick(agent) {
    document.querySelector('.avatar-dialog-backdrop')?.remove();
    let value = agent.avatar || '';
    const backdrop = document.createElement('div'); backdrop.className = 'avatar-dialog-backdrop';
    backdrop.innerHTML = `<div class="avatar-dialog" role="dialog" aria-modal="true" aria-labelledby="avatarDialogTitle"><div class="win98-titlebar"><span class="win98-title-text" id="avatarDialogTitle">Imagen para mostrar de ${esc(agent.name)}</span><span class="win98-title-controls"><button type="button" data-avatar="cancel" aria-label="Cerrar"></button></span></div>
      <div class="avatar-dialog-body"><p>Elige cómo verán a <b>${esc(agent.name)}</b> en Messenger.</p><div class="avatar-dialog-main"><div class="avatar-grid" role="listbox" aria-label="Galería de imágenes">
      <button type="button" class="avatar-option" data-avatar-value="" role="option" title="Personaje de la oficina">${person(agent.color)}<span>Original</span></button>
      ${PRESETS.map(p => `<button type="button" class="avatar-option" data-avatar-value="preset:${p.id}" role="option" title="${esc(p.label)}">${tile(p)}<span>${esc(p.label)}</span></button>`).join('')}</div>
      <div class="avatar-preview"><div class="avatar-preview-frame"></div><label class="ws-button avatar-upload">Examinar…<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><small>Tu imagen se recorta en cuadrado y se guarda en la configuración local.</small><p class="avatar-error" role="alert"></p></div></div>
      <div class="avatar-dialog-actions"><button type="button" class="ws-button primary" data-avatar="ok">Aceptar</button><button type="button" class="ws-button" data-avatar="cancel">Cancelar</button></div></div></div>`;
    document.body.append(backdrop);
    const refresh = () => {
      backdrop.querySelector('.avatar-preview-frame').innerHTML = html({ ...agent, avatar: value });
      backdrop.querySelectorAll('.avatar-option').forEach(b => b.setAttribute('aria-selected', String(b.dataset.avatarValue === value)));
    };
    refresh();
    backdrop.querySelector('[aria-selected="true"], .avatar-option')?.focus();
    return new Promise(resolve => {
      const done = result => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); resolve(result); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', e => {
        const option = e.target.closest('[data-avatar-value]');
        if (option) { value = option.dataset.avatarValue; refresh(); return; }
        const action = e.target.closest('[data-avatar]')?.dataset.avatar;
        if (action === 'ok') done(value); else if (action === 'cancel' || e.target === backdrop) done(null);
      });
      backdrop.addEventListener('dblclick', e => { const option = e.target.closest('[data-avatar-value]'); if (option) done(option.dataset.avatarValue); });
      backdrop.querySelector('input[type="file"]').addEventListener('change', async e => {
        const error = backdrop.querySelector('.avatar-error'); error.textContent = '';
        try { value = await fromFile(e.target.files[0]); refresh(); } catch (err) { error.textContent = err.message; }
      });
    });
  }
  window.OfficeAvatars = { PRESETS, html, pick, fromFile, isImage };
})();
