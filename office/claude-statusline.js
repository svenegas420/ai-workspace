// Claude Code status line: prints a short usage line and saves Claude's plan
// rate limits to ~/.ai-workspace/claude-usage.json so the office can show them.
// Only rate limits, model and timestamp are written - nothing else.
const fs = require('fs');
const path = require('path');
const os = require('os');

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { /* ignore */ }
  const rl = input.rate_limits || null;
  const dir = path.join(os.homedir(), '.ai-workspace');
  if (process.env.AI_OFFICE_DEBUG) {
    try { fs.writeFileSync(path.join(dir, 'statusline-keys.json'), JSON.stringify({ keys: Object.keys(input), rate_limits: rl }, null, 2)); } catch {}
  }
  if (rl) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'claude-usage.json'),
        JSON.stringify({ updated: Date.now(), model: input.model?.display_name || '', rate_limits: rl }));
    } catch { /* never break the status line */ }
  }
  const pct = w => (w && w.used_percentage != null ? `${Math.round(w.used_percentage)}%` : '–');
  const parts = [input.model?.display_name || 'Claude'];
  if (rl) parts.push(`5h ${pct(rl.five_hour)}`, `7d ${pct(rl.seven_day)}`);
  const ctx = input.context_window?.used_percentage;
  if (ctx != null) parts.push(`ctx ${Math.round(ctx)}%`);
  process.stdout.write(parts.join(' · '));
});
