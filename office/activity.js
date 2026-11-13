// Guesses what an agent is doing (coding, video, writing...) and which languages
// it is using, from its most recent tool calls plus marker files in the project.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Extension -> devicon key (https://devicon.dev). Used for the language logos.
const LANG_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'react', ts: 'typescript', tsx: 'react', mts: 'typescript',
  py: 'python', ipynb: 'jupyter', php: 'php', dart: 'dart', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  go: 'go', rs: 'rust', rb: 'ruby', cs: 'csharp', cpp: 'cplusplus', cc: 'cplusplus', hpp: 'cplusplus', c: 'c', h: 'c',
  html: 'html5', htm: 'html5', css: 'css3', scss: 'sass', sass: 'sass', less: 'less', vue: 'vuejs', svelte: 'svelte',
  sql: 'mysql', sh: 'bash', bash: 'bash', ps1: 'powershell', psm1: 'powershell', lua: 'lua', r: 'r', scala: 'scala',
  ex: 'elixir', exs: 'elixir', hs: 'haskell', zig: 'zig', gd: 'godot', blade: 'laravel', astro: 'astro',
};
const EXT_GROUP = {
  video: 'mp4 mov mkv webm avi m4v prproj drp aep srt vtt ass mp3 wav aac flac m4a fcpxml otio'.split(' '),
  write: 'md mdx txt docx doc odt rtf tex rst epub fountain org adoc'.split(' '),
  design: 'svg png jpg jpeg gif webp avif fig psd ai sketch xd ico'.split(' '),
  data: 'csv tsv xlsx xls parquet ipynb json5 ndjson sqlite db'.split(' '),
};
const SKILL_GROUP = [
  [/hyperframes|video|captions|motion|music|remotion|talking-head|slideshow|media/i, 'video'],
  [/docs?$|docx|pdf|pptx|writ|book|article|blog/i, 'write'],
  [/design|figma|canva|artifact|ui|brand/i, 'design'],
  [/dataviz|xlsx|sheet|data|chart/i, 'data'],
  [/review|security/i, 'test'],
];
const TOOL_GROUP = [
  [/webfetch|websearch|navigate|read_page|get_page_text|tabs_|browser|chrome|computer|fetch_url|search_web/i, 'browse'],
  [/claude_docs|google_docs|notion|docx|word|confluence/i, 'write'],
  [/figma|canva|excalidraw|miro|artifact|designsync|image_gen/i, 'design'],
  [/sheets|xlsx|dataviz|claude_data|bigquery|query/i, 'data'],
  [/heygen|hyperframes|video/i, 'video'],
];
const CMD_LANG = [
  [/\b(python3?|pip3?|pytest|uv|poetry)\b/, 'python'], [/\b(php|composer|artisan|phpunit)\b/, 'php'],
  [/\b(node|npm|npx|pnpm|yarn|bun|deno)\b/, 'nodejs'], [/\bflutter\b/, 'flutter'], [/\bdart\b/, 'dart'],
  [/\bcargo\b/, 'rust'], [/\bgo (run|build|test|mod)\b/, 'go'], [/\bdotnet\b/, 'csharp'], [/\bdocker\b/, 'docker'],
  [/\b(gradle|gradlew|mvn|javac)\b/, 'java'], [/\bruby\b|\bbundle (exec|install)\b|\brails\b/, 'ruby'], [/\btsc\b/, 'typescript'],
];
const MARKERS = [
  ['package.json', 'nodejs'], ['tsconfig.json', 'typescript'], ['pubspec.yaml', 'flutter'], ['composer.json', 'php'],
  ['requirements.txt', 'python'], ['pyproject.toml', 'python'], ['Cargo.toml', 'rust'], ['go.mod', 'go'],
  ['Gemfile', 'ruby'], ['pom.xml', 'java'], ['build.gradle', 'java'], ['Dockerfile', 'docker'], ['project.godot', 'godot'],
];

const markerCache = new Map(); // cwd -> { t, langs }
function projectLangs(cwd) {
  if (!cwd || path.resolve(cwd) === path.resolve(os.homedir())) return [];
  const c = markerCache.get(cwd);
  if (c && Date.now() - c.t < 60000) return c.langs;
  let names = [];
  try {
    const top = fs.readdirSync(cwd, { withFileTypes: true });
    names = top.map(e => e.name);
    // one level down too (api/, app/, web/...), skipping heavy or hidden folders
    for (const e of top.filter(e => e.isDirectory() && !/^(\.|node_modules$|vendor$|build$|dist$)/.test(e.name)).slice(0, 20)) {
      try { names.push(...fs.readdirSync(path.join(cwd, e.name))); } catch { /* no access */ }
    }
  } catch { /* gone */ }
  const set = new Set(names);
  const langs = MARKERS.filter(([f]) => set.has(f)).map(([, l]) => l);
  if (names.some(n => n.endsWith('.csproj') || n.endsWith('.sln'))) langs.push('csharp');
  markerCache.set(cwd, { t: Date.now(), langs });
  return langs;
}

function filesOf(input) {
  if (!input) return [];
  if (typeof input === 'string') return [...input.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map(m => m[1].trim());
  const out = [];
  for (const k of ['file_path', 'path', 'notebook_path', 'filePath']) if (typeof input[k] === 'string') out.push(input[k]);
  if (typeof input.input === 'string') out.push(...filesOf(input.input));
  return out;
}
const cmdOf = input => {
  if (!input || typeof input !== 'object') return '';
  const c = input.command || input.cmd || '';
  return Array.isArray(c) ? c.join(' ') : String(c);
};
const extOf = f => { const m = /\.([a-z0-9]+)$/i.exec(f); return m ? m[1].toLowerCase() : ''; };

/** acts: [{ name, input }] oldest -> newest. Returns { activity, langs }. */
function classify(acts, cwd) {
  const score = { code: 0, video: 0, write: 0, design: 0, browse: 0, test: 0, data: 0 };
  const lang = {};
  const addLang = (l, w) => { lang[l] = (lang[l] || 0) + w; };
  const recent = acts.slice(-30);
  for (let i = recent.length - 1, k = 0; i >= 0; i--, k++) {
    const w = 1 / (1 + k * 0.12);                       // newer actions weigh more
    const { name = '', input } = recent[i];
    for (const [re, g] of TOOL_GROUP) if (re.test(name)) score[g] += 2 * w;
    if (/^skill$/i.test(name) && input && input.skill) for (const [re, g] of SKILL_GROUP) if (re.test(input.skill)) { score[g] += 3 * w; break; }
    for (const f of filesOf(input)) {
      const e = extOf(f);
      if (LANG_EXT[e]) { score.code += w; addLang(LANG_EXT[e], w); if (e === 'css' || e === 'scss') score.design += 0.5 * w; }
      for (const g in EXT_GROUP) if (EXT_GROUP[g].includes(e)) score[g] += (e === 'md' ? 0.7 : 1.4) * w;
      if (/[._-](test|spec)\.|_test\.|tests?[\\/]/i.test(f)) score.test += w;
    }
    const cmd = cmdOf(input);
    if (cmd) {
      if (/\b(ffmpeg|ffprobe|hyperframes|remotion|melt|davinci|whisper|yt-dlp)\b/i.test(cmd)) score.video += 2 * w;
      else if (/\b(test|tests|jest|vitest|pytest|phpunit|mocha|playwright|cypress)\b/i.test(cmd)) score.test += 2 * w;
      else if (/\b(pandas|psql|sqlite3|duckdb|jupyter)\b/i.test(cmd)) score.data += w;
      else if (/\b(pandoc|latexmk|pdflatex)\b/i.test(cmd)) score.write += 2 * w;
      else score.code += 0.5 * w;
      for (const [re, l] of CMD_LANG) if (re.test(cmd)) addLang(l, 0.6 * w);
    }
  }
  for (const l of projectLangs(cwd)) addLang(l, 0.4);
  let activity = 'think', best = 0.6;
  for (const k in score) if (score[k] > best) { best = score[k]; activity = k; }
  const langs = Object.entries(lang).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l);
  return { activity, langs };
}

module.exports = { classify };
