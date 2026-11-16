const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pause = new Int32Array(new SharedArrayBuffer(4));

// Windows indexers/Obsidian can briefly hold a sharing lock on a Markdown file.
// Keep atomic replacement and retry only sharing/permission errors for < 300 ms.
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, file); return; }
      catch (e) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 6) throw e;
        Atomics.wait(pause, 0, 0, 10 * (attempt + 1));
      }
    }
  } finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* preserve original error */ } } }
}
module.exports = { atomic };
