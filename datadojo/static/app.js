// DataDojo front end: hash-routed pages over the JSON API in server.py. No build step.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (path, body) => fetch(path, body && { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
const LANGS = { sql: 'SQL', python: 'Python', pyspark: 'PySpark' };
const STAGES = [
  ['understand', 'Understand', "Let's start with the problem. In your own words, what is it asking for? What does one output row (or the return value) represent?"],
  ['approach', 'Approach', "What's your plan before writing code? Which pattern does this smell like, and why?"],
  ['build', 'Build', 'Go ahead and write it. Run the tests whenever you like, and ask me when something fails.'],
  ['edge-cases', 'Edge cases', 'Which inputs could break your solution? Think NULLs, ties, duplicates, empty input, boundaries.'],
  ['optimize', 'Optimize', 'It works. How does it scale? Where is the expensive step, and is there a cleaner idiom?'],
  ['review', 'Review', 'Nice work! Ask me for a quick review, or tell me what felt hard.'],
];
// The coaching cast: blobatar seeds (https://blobatar.dev) and display names.
const CAST = {
  sensei: { seed: 'sensei-sql', name: 'Sensei', role: 'your head coach' },
  sql: { seed: 'duck', name: 'Duck', role: 'your SQL coach' },
  python: { seed: 'pandas', name: 'Pip', role: 'your Python coach' },
  pyspark: { seed: 'spark', name: 'Sparky', role: 'your PySpark coach' },
};
const me = () => localStorage.getItem('displayName') || '';
let cleanups = [];

// ---------- blobatar ----------
let B = null;
const blobReady = Promise.all(['internal', 'expression', 'gaze'].map(f => import(`./vendor/blobatar/${f}.js`)))
  .then(([I, E, G]) => { B = { I, E, G }; }).catch(() => { B = null; });

// line icons, one style everywhere (24px grid, 2px stroke, currentColor), instead of emoji that differ per OS
const LINE = {
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2.5 4.5L16 13H5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  map: '<circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 6.5 16.5 11M7.5 17.5l9-5"/>',
  chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/><path d="M12 7.5v5M9.5 10h5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7M9 8h3"/>',
  format: '<path d="M4 6h16M8 10h12M8 14h12M4 18h16"/><path d="M4 10.5 6 12l-2 1.5"/>',
};
const ic = (name, size = 15) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LINE[name]}</svg>`;

// one segment per test, green when it passed, red when it didn't
const testBar = results => `<div class="test-bar" aria-hidden="true">${results.map((ok, i) => `<i class="${ok ? 'ok' : 'no'}" style="--d:${i * 60}ms"></i>`).join('')}</div>`;

function blob(seed, { mood = 'idle', size = 48, live = false, cls = '' } = {}) {
  if (!B) return `<span class="blob-fallback" style="width:${size}px;height:${size}px"></span>`;
  const p = B.I._parts(seed, { animate: live ? 'always' : 'hover', expression: B.E[mood], background: false });
  return `<svg class="blob ${cls}" data-seed="${esc(seed)}" data-mood="${mood}" data-live="${live ? 1 : ''}" xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" style="${B.I.serializeVars(p.vars)}"><g class="${p.cls}">${p.inner}</g></svg>`;
}
// Morph an existing blobatar to another expression in place (motion.css transitions the pose variables).
function setMood(svg, mood) {
  if (!B || !svg || svg.dataset.mood === mood) return;
  const p = B.I._parts(svg.dataset.seed, { animate: svg.dataset.live ? 'always' : 'hover', expression: B.E[mood], background: false });
  for (const k of [...svg.style]) if (k.startsWith('--mo-') && !(k in p.vars)) svg.style.removeProperty(k);
  for (const [k, v] of Object.entries(p.vars)) svg.style.setProperty(k, v);
  svg.querySelector('g').setAttribute('class', p.cls);
  svg.dataset.mood = mood;
}
function follow(svg, target = 'pointer') {
  if (!B || !svg) return null;
  const g = B.G.gaze(svg, { target });
  cleanups.push(() => g.stop());
  return g;
}

// ---------- small renderers ----------
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
function block(b) {
  let html = '', kind = null, buf = [];
  const flush = () => {
    if (buf.length) html += kind === 'ul' ? `<ul>${buf.map(l => `<li>${inline(l)}</li>`).join('')}</ul>` : `<p>${buf.map(inline).join(' ')}</p>`;
    buf = [];
  };
  for (const l of b.split('\n')) {
    if (kind === 'ul' && /^\s+\S/.test(l) && !/^\s*[-*] /.test(l)) { buf[buf.length - 1] += ' ' + l.trim(); continue; }  // wrapped bullet
    const m = l.match(/^\s*[-*] (.*)/), k = m ? 'ul' : 'p';
    if (k !== kind) { flush(); kind = k; }
    buf.push(m ? m[1] : l);
  }
  flush();
  return html;
}
const md = (src = '') => src.trim().split(/```\w*\n?/).map((chunk, i) => i % 2
  ? `<pre>${esc(chunk.replace(/\n$/, ''))}</pre>`
  : chunk.split(/\n\s*\n/).filter(b => b.trim()).map(b => block(b.trim())).join('')).join('');

function ring(done, total, size = 44, color = 'var(--acc)') {
  const h = size / 2, r = h - 4, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="var(--track)" stroke-width="3"/>
    <circle class="fill" cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"
      stroke-dasharray="${c * f} ${c}" transform="rotate(-90 ${h} ${h})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${total === 100 ? done : `${done}/${total}`}</text></svg>`;
}
const cell = v => v === null ? '<i>NULL</i>' : esc(typeof v === 'string' ? v : JSON.stringify(v));
const table = (cols, rows) => `<table class="data">${cols ? `<tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` : ''}${
  rows.map(r => `<tr>${(Array.isArray(r) ? r : [r]).map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</table>`;
const tables = ts => Object.entries(ts).map(([n, t]) =>
  `<div class="tblname">${esc(n)}</div>` + (t.rows.length ? table(t.columns.split(',').map(c => c.trim()), t.rows) : '<div class="faint">(empty table)</div>')).join('');
const value = (v, cols) => Array.isArray(v) && v.length && v.every(Array.isArray) ? table(cols?.length ? cols : null, v)
  : Array.isArray(v) && !v.length && cols?.length ? table(cols, []) + '<div class="faint">(no rows)</div>'
  : `<pre>${esc(JSON.stringify(v, null, 1))}</pre>`;
const langTag = l => `<span class="lang-tag ${l}">${LANGS[l]}</span>`;
const diffTag = d => `<span class="tag ${d}">${d}</span>`;
const count = ps => [ps.filter(p => p.solved).length, ps.length];

const ICONS = {
  github: '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/>',
  linkedin: '<path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C20.6 8.65 21 11.3 21 14.7V21h-4v-5.6c0-1.33-.02-3.05-1.86-3.05-1.86 0-2.14 1.45-2.14 2.95V21H9z"/>',
  leetcode: '<path d="M13.48 2.5a1.1 1.1 0 0 1 1.55 1.55L8.4 10.68a1.9 1.9 0 0 0 0 2.64l4.98 5.02a1.9 1.9 0 0 0 2.68 0l2.2-2.2a1.1 1.1 0 1 1 1.55 1.55l-2.2 2.2a4.1 4.1 0 0 1-5.78 0L6.85 14.87a4.1 4.1 0 0 1 0-5.74zM11 11.9h8.9a1.1 1.1 0 1 1 0 2.2H11a1.1 1.1 0 1 1 0-2.2z"/>',
  medium: '<path d="M13.5 12a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0zm7.4 0c0 3.54-1.51 6.4-3.38 6.4S14.15 15.54 14.15 12s1.5-6.4 3.37-6.4S20.9 8.46 20.9 12zM24 12c0 3.17-.53 5.75-1.19 5.75s-1.19-2.58-1.19-5.75.53-5.75 1.19-5.75S24 8.83 24 12z"/>',
  x: '<path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.17h1.7L7.4 4.73H5.58z"/>',
  instagram: '<path d="M12 2.2c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.2 12 2.2zm0 4.86a4.94 4.94 0 1 0 0 9.88 4.94 4.94 0 0 0 0-9.88zm0 8.15a3.21 3.21 0 1 1 0-6.42 3.21 3.21 0 0 1 0 6.42zm5.14-9.5a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z"/>',
  website: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.9 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82A13.8 13.8 0 0 1 12 4.04zM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4zm.84 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 0 1 5.1 16zm2.95-8H5.1a8 8 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.05 8zM12 19.96A13.8 13.8 0 0 1 10.09 16h3.82A13.8 13.8 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4z"/>',
  email: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.1L4.4 7H4v.6l8 5.3 8-5.3V7h-.4z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${ICONS[name] || ICONS.website}</svg>`;

// ---------- motion helpers ----------
function stagger(root = document) {
  root.querySelectorAll('.grid').forEach(g => [...g.children].forEach((el, i) => el.style.setProperty('--i', i)));
}
function countUp(root = document) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, suffix = el.dataset.suffix || '', t0 = performance.now();
    if (!to || matchMedia('(prefers-reduced-motion: reduce)').matches) return void (el.textContent = to + suffix);
    const step = t => { const k = Math.min(1, (t - t0) / 800); el.textContent = Math.round(to * (1 - (1 - k) ** 3)) + suffix; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function confetti(fromEl) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = fromEl.getBoundingClientRect(), css = getComputedStyle(document.documentElement);
  const colors = ['--acc', '--acc2', '--easy', '--hard', '--python'].map(v => css.getPropertyValue(v).trim());
  for (let i = 0; i < 36; i++) {
    const c = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 160;
    c.className = 'confetti';
    c.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + 10}px;background:${colors[i % colors.length]};` +
      `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 60}px;--r:${Math.random() * 720 - 360}deg`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1200);
  }
}
// Make the hover glow on cards follow the cursor.
let scrollIdle;  // see html.scrolling in app.css
addEventListener('scroll', () => {
  document.documentElement.classList.add('scrolling');
  clearTimeout(scrollIdle); scrollIdle = setTimeout(() => document.documentElement.classList.remove('scrolling'), 150);
}, { passive: true });
document.addEventListener('pointermove', e => {
  const c = e.target.closest?.('.tile, .list-tile, .pcard');
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`);
});

// ---------- theme ----------
function monacoTheme() {
  if (!window.monaco) return;
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  monaco.editor.defineTheme('dojo', { base: v('--scheme') === 'light' ? 'vs' : 'vs-dark', inherit: true, rules: [],
    colors: { 'editor.background': v('--pre'), 'editor.lineHighlightBackground': v('--card'), 'editorLineNumber.foreground': v('--faint'),
              'editorCursor.foreground': v('--acc'), 'editor.selectionBackground': v('--line2') } });
  monaco.editor.setTheme('dojo');
}
// Midnight in dark mode, Sakura in light mode. Follows the OS until you pick one with the toggle.
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>';
function setTheme(id, remember = true) {
  const apply = () => { document.documentElement.dataset.theme = id; if (remember) localStorage.setItem('theme', id); renderThemeToggle(); monacoTheme();
    if (location.hash.startsWith('#/design/')) route(); };  // diagrams are drawn with theme colours
  document.startViewTransition ? document.startViewTransition(apply) : apply();
}
function renderThemeToggle() {
  const dark = document.documentElement.dataset.theme !== 'sakura';
  $('#theme-btn').innerHTML = dark ? SUN : MOON;
  $('#theme-btn').title = dark ? 'Switch to light mode (Sakura)' : 'Switch to dark mode (Midnight)';
}
$('#theme-btn').onclick = () => setTheme(document.documentElement.dataset.theme === 'sakura' ? 'midnight' : 'sakura');

// ---------- you ----------
function renderMe(stats) {
  if (stats) renderMe.stats = stats;
  const s = renderMe.stats, first = me().split(' ')[0];
  $('#me').innerHTML = `${blob(me() || 'dojo-guest', { size: 28, mood: me() ? 'happy' : 'shy' })}
    <span class="me-txt"><b>${esc(first || 'Add your name')}</b>${s ? `<small>${s.solved} solved</small>` : ''}</span>`;
  $('#me').title = me() ? `Signed in as ${me()} · click to rename` : 'Tell your coaches what to call you';
}
function askName() {
  const cur = me();
  modal(`<div class="namecard">
    <div class="name-stage"><div class="name-glow"></div><div id="nm-blob">${blob(cur || 'dojo-guest', { size: 132, live: true, mood: cur ? 'happy' : 'shy' })}</div></div>
    <div class="kicker dot">${cur ? 'Your profile' : 'Nice to meet you'}</div>
    <h2>What should your coaches call you?</h2>
    <p class="dim">Your name shapes your blobatar, so every name gets its own little creature. It stays on this computer.</p>
    <input class="field big" id="nm-in" maxlength="40" placeholder="Type your name…" value="${esc(cur)}" autocomplete="off" spellcheck="false">
    <div class="nm-greet" id="nm-greet">${cur ? `Hi ${esc(cur.split(' ')[0])}! 👋` : '&nbsp;'}</div>
    <div class="name-cast">${['sql', 'python', 'pyspark'].map(l => `<span>${blob(CAST[l].seed, { size: 34, mood: 'idle' })}</span>`).join('')}
      <small>Duck, Pip and Sparky will greet you by name.</small></div>
    <a class="nm-coach" href="#/setup" id="nm-coach">⚙ Coach setup (API key or local model) →</a>
    <div class="row-end">${cur ? '<button class="ghost" id="nm-clear">Clear name</button>' : ''}<button class="primary" id="nm-save">${cur ? 'Save' : "Let's go"} →</button></div>
  </div>`);
  $('.modal-box').classList.add('narrow');
  const input = $('#nm-in'), cast = [...document.querySelectorAll('.name-cast svg')];
  let face = $('#nm-blob svg'), timer;
  follow(face);
  input.focus(); input.select();
  input.oninput = () => {
    const v = input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(() => {  // re-seed the creature from the name as you type
      $('#nm-blob').innerHTML = blob(v || 'dojo-guest', { size: 132, live: true, mood: v ? 'happy' : 'shy' });
      $('#nm-blob svg').classList.add('reseed');
      face = $('#nm-blob svg'); follow(face);
    }, 120);
    $('#nm-greet').innerHTML = v ? `Hi ${esc(v.split(' ')[0])}! 👋` : '&nbsp;';
    cast.forEach(s => setMood(s, v ? 'happy' : 'idle'));
  };
  const save = v => {
    localStorage.setItem('displayName', v.trim().slice(0, 40));
    setMood(face, 'love'); cast.forEach(s => setMood(s, 'love'));
    if (v.trim()) confetti($('#nm-save'));
    setTimeout(() => { closeModal(); $('.modal-box').classList.remove('narrow'); renderMe(); route(); }, v.trim() ? 900 : 0);
  };
  $('#nm-save').onclick = () => save(input.value);
  input.onkeydown = e => { if (e.key === 'Enter') save(input.value); if (e.key === 'Escape') closeModal(); };
  if ($('#nm-clear')) $('#nm-clear').onclick = () => save('');
  $('#nm-coach').onclick = () => { closeModal(); $('.modal-box').classList.remove('narrow'); };
}
$('#me').onclick = askName;

// ---------- data ----------
async function load() {
  const [cat, stats] = await Promise.all([api('/api/catalog'), api('/api/stats')]);
  renderStreak(stats); renderMe(stats);
  return { cat, stats };
}
const FLAME = `<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><defs>
  <linearGradient id="flame-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ea580c"/><stop offset=".6" stop-color="#f59e0b"/><stop offset="1" stop-color="#fde047"/></linearGradient></defs>
  <path class="outer" d="M12 2c1 3.6-1.6 5.3-1.6 7.7 0 1.3.9 2.2 2 2.2 1.4 0 2.3-1.2 2-3 2.4 1.6 3.9 4.3 3.9 6.9A6.3 6.3 0 0 1 12 22a6.3 6.3 0 0 1-6.3-6.3C5.7 10.6 10.4 7.8 12 2z"/>
  <path class="inner" d="M12 13.4c.7 1.6 2.5 2.5 2.5 4.4a2.5 2.5 0 0 1-5 0c0-1.7 1.4-2.5 2.5-4.4z"/></svg>`;
const dayKey = d => d.toLocaleDateString('en-CA');
function streakState(stats) { return stats.days[dayKey(new Date())] ? 'lit' : stats.streak ? 'risk' : 'off'; }

function renderStreak(stats) {
  const today = new Date(), state = streakState(stats);
  const week = [...Array(7)].map((_, i) => { const d = new Date(today); d.setDate(d.getDate() - 6 + i); return d; });
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(stats.days).sort()) {
    const d = new Date(k + 'T00:00');
    run = prev && (d - prev) / 864e5 === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d;
  }
  const label = { lit: 'Practiced today. Keep it going!', risk: 'Practice today to keep your streak alive.', off: 'Solve or run anything to start a streak.' }[state];
  $('#nav-streak').className = `streak ${state}`;
  $('#nav-streak').setAttribute('aria-label', `${stats.streak} day streak. ${label}`);
  $('#nav-streak').innerHTML = `${FLAME}<b>${stats.streak}</b><span class="streak-txt">${stats.streak ? `day${stats.streak === 1 ? '' : 's'}` : 'Start a streak'}</span>
    <div class="streak-pop" role="tooltip"><div class="streak-head">${FLAME}<div><b>${stats.streak} day streak</b><div class="dim">${label}</div></div></div>
      <div class="week">${week.map(d => `<div class="${stats.days[dayKey(d)] ? 'on' : ''} ${dayKey(d) === dayKey(today) ? 'today' : ''}"><i></i><span>${d.toLocaleString('en', { weekday: 'narrow' })}</span></div>`).join('')}</div>
      <div class="streak-foot"><span>Best: <b>${best}</b> day${best === 1 ? '' : 's'}</span><span>${stats.runs} total runs</span></div></div>`;
}

// ---------- pages ----------
function senseiSays(stats) {
  const name = me() ? `, ${me().split(' ')[0]}` : '';
  const h = new Date().getHours(), hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const state = streakState(stats);
  if (h < 4) {  // midnight to 4 am, local time: "good morning" feels off
    if (!stats.runs) return ['wink', `Up late${name}? I'm Sensei. One small problem before bed is a great way to start.`];
    if (state === 'lit') return ['sleepy', `Up late${name}! You already practiced today, so the streak is safe. Get some rest.`];
    if (state === 'risk') return ['surprised', `Up late${name}? Your ${stats.streak}-day streak is waiting. One quick problem before bed keeps it alive.`];
    return ['wink', `Up late${name}? Welcome back! One easy warm-up, then some sleep.`];
  }
  if (!stats.runs) return ['happy', `${hello}${name}! I'm Sensei. Pick any pattern below and one of my coaches will walk you through it.`];
  if (state === 'lit') return ['love', `${hello}${name}! You already practiced today. That's how habits are built.`];
  if (state === 'risk') return ['surprised', `${hello}${name}! Your ${stats.streak}-day streak is waiting. One quick problem keeps it alive.`];
  return ['sad', `${hello}${name}. I missed you! How about an easy warm-up to get back in rhythm?`];
}
const dailyQuote = quotes => {
  const day = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 864e5) + new Date().getFullYear() * 366;
  return quotes[day % quotes.length];
};

function heatmap(days) {
  const today = new Date(), cols = [];
  let labels = '', cells = '', col = 1;
  const pad = n => '<i class="pad"></i>'.repeat(n);
  for (let k = -11; k <= 0; k++) {
    const first = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const last = k ? new Date(today.getFullYear(), today.getMonth() + k + 1, 0) : today;
    const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
    labels += `<span style="grid-column:${col}">${first.toLocaleString('en', { month: 'short' })}</span>`;
    cells += pad(first.getDay());
    for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d), n = days[key] || 0;
      const lvl = n === 0 ? '' : n < 3 ? 'l1' : n < 6 ? 'l2' : n < 10 ? 'l3' : 'l4';
      cells += `<i class="${lvl}" style="--w:${col + Math.floor((first.getDay() + d.getDate() - 1) / 7)}" data-tip="${d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${n ? `${n} run${n === 1 ? '' : 's'}` : 'no activity'}"></i>`;
    }
    cells += pad(weeks * 7 - first.getDay() - last.getDate()) + (k ? pad(7) : '');  // fill the last week, then the gap column
    cols.push(`repeat(${weeks}, minmax(0, 1fr))`); col += weeks + 1;
  }
  const tpl = `grid-template-columns:${cols.join(' 4px ')}`;
  return `<div class="months" style="${tpl}">${labels}</div><div class="heat" style="${tpl}">${cells}</div>`;
}

function patternTiles(cat, lang) {
  const pats = cat.patterns.filter(p => p.lang === lang);
  const groups = [...new Set(pats.map(p => p.group))];
  return groups.map(g => `<div class="section-title">${esc(g)}</div><div class="grid">${pats.filter(p => p.group === g).map(p => {
    const [d, t] = count(cat.problems.filter(x => x.pattern === p.id));
    return `<a class="card tile" href="#/pattern/${p.id}"><div class="t"><h4>${esc(p.title)}</h4><p>${esc(p.desc)}</p></div>${ring(d, t, 44, `var(--${lang})`)}</a>`;
  }).join('')}</div>`).join('');
}

function listTiles(cat, only) {
  return `<div class="grid">${cat.lists.filter(l => !only || only(l)).map(l => {
    const [d, t] = count(cat.problems.filter(p => (p.lists || []).includes(l.id)));
    return `<a class="card list-tile" href="#/list/${l.id}"><h4>${esc(l.title)}</h4><p>${esc(l.desc)}</p>
      <div style="display:flex;align-items:center;gap:10px">${ring(d, t, 40)}<span class="dim">${d} / ${t} solved</span></div></a>`;
  }).join('')}</div>`;
}

function coachHead(lang, cat, extra = '') {
  const [d, t] = count(cat.problems.filter(p => p.lang === lang)), c = CAST[lang];
  return `<div class="lang-head"><a href="#/lang/${lang}" class="coach-chip">${blob(c.seed, { size: 44, mood: d ? 'happy' : 'idle' })}</a>
    <div><h3>${LANGS[lang]}</h3><div class="dim" style="font-size:12px">${c.name}, ${c.role} · ${d}/${t} solved</div></div>${extra}</div>`;
}

// practice queue: problems you struggled with come back on a 1-3-7 day schedule; weak spots show the lowest first-try rate
function practiceCard(pq, cat) {
  if (!pq || (!pq.due?.length && !pq.weak?.length && !pq.upcoming_count)) return '';
  const pat = Object.fromEntries(cat.patterns.map(p => [p.id, p.title]));
  const when = x => x.reason === 'Not solved yet' ? 'unfinished' : x.due < new Date().toLocaleDateString('en-CA') ? 'overdue' : 'due today';
  const row = x => `<a class="pq-row" href="#/p/${x.id}/review">${langTag(x.lang)}<div><b>${esc(x.title)}</b>
      <small>${esc(pat[x.pattern] || '')} · ${esc(x.reason)}${x.reason === 'Not solved yet' ? '' : ` · review ${x.stage + 1} of 3`}</small></div>
      <span class="pq-when ${when(x).replace(' ', '-')}">${when(x)}</span><span class="go">→</span></a>`;
  const next = pq.upcoming?.[0];
  const days = next ? Math.round((new Date(next.due) - new Date(new Date().toLocaleDateString('en-CA'))) / 864e5) : 0;
  return `<div class="section-title">Your practice</div><div class="pq">
    <div class="card pq-due"><div class="pq-h">${ic('reset', 15)}<b>Review today</b><span class="pq-count">${pq.due.length}</span></div>
      ${pq.due.length ? pq.due.slice(0, 6).map(row).join('') + (pq.due.length > 6 ? `<div class="faint pq-more">+ ${pq.due.length - 6} more</div>` : '')
        : `<p class="dim pq-empty">Nothing to review today${next ? `. Next: <b>${esc(next.title)}</b> in ${days} day${days === 1 ? '' : 's'}` : ''}.</p>`}
      ${pq.upcoming_count ? `<div class="faint pq-more">${pq.upcoming_count} more coming up over the next week</div>` : ''}</div>
    <div class="card pq-weak"><div class="pq-h">${ic('flag', 15)}<b>Weak spots</b></div>
      ${pq.weak.length ? pq.weak.map(w => `<div class="pq-w"><div class="pq-wt"><b>${esc(w.title)}</b><small>${LANGS[w.lang]} · ${w.rate}% first-try · ${w.attempted} tried</small></div>
        <div class="pq-bar"><i style="width:${Math.max(4, w.rate)}%"></i></div>
        ${w.next.length ? `<div class="pq-next">Try: ${w.next.map(n => `<a href="#/p/${n.id}">${esc(n.title)}</a>`).join(' · ')}</div>` : ''}</div>`).join('')
        : '<p class="dim pq-empty">No weak spots yet. Patterns show up here once you\'ve tried 2+ problems in them.</p>'}</div>
  </div>`;
}

async function home() {
  const [{ cat, stats }, profile, pq] = await Promise.all([load(), api('/api/profile'), api('/api/practice')]);
  const [mood, line] = senseiSays(stats);
  const q = dailyQuote(profile.quotes || [{ text: '', by: '' }]);
  const untouched = cat.patterns.find(p => {
    const ps = cat.problems.filter(x => x.pattern === p.id);
    return ps.length && !ps.some(x => x.solved);
  });
  const bd = stats.by_difficulty;
  const links = (profile.links || []).filter(l => l.url);
  $('#app').innerHTML = `<div class="page enter">
    <div class="hero"><h1>DATA<span>DOJO</span><i class="caret">_</i></h1><p>${esc(profile.tagline || '')}</p>
      <blockquote class="quote">“${esc(q.text)}”<cite>${esc(q.by)}</cite></blockquote>
      <div class="author">Built by ${esc(profile.name || '')}</div>
      ${links.length ? `<div class="socials">${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noreferrer" title="${esc(l.icon)}">${icon(l.icon)}</a>`).join('')}</div>` : ''}</div>
    <div class="welcome card"><div class="sensei-big" id="sensei">${blob(CAST.sensei.seed, { size: 104, mood, live: true, cls: 'live' })}</div>
      <div class="bubble"><div class="kicker dot">${stats.runs ? 'Welcome back' : 'Welcome'}</div><p>${esc(line)}</p>
        ${me() ? '' : '<button id="set-name" class="primary">Tell Sensei your name</button>'}</div>
      <span class="sp"></span><div class="streak-big ${streakState(stats)}">${FLAME}<b data-count="${stats.streak}">0</b><small>day streak</small></div></div>
    <div class="card progress">
      <div class="top">${ring(stats.solved, stats.total, 56)}<div><b>Overall progress</b><div class="dim">${stats.solved} of ${stats.total} problems solved</div></div>
        <div class="diffs">${['easy', 'medium', 'hard'].map(k => `<div class="diff ${k}">${ring(bd[k].solved, bd[k].total, 36, `var(--${k})`)}<div><b>${k}</b>${bd[k].solved}/${bd[k].total}</div></div>`).join('')}</div></div>
      <div class="heat-wrap"><div style="flex:1;min-width:0">${heatmap(stats.days)}</div>
        <div class="cast">${['sql', 'python', 'pyspark'].map(l => `<a href="#/lang/${l}" title="${CAST[l].name}, ${CAST[l].role}">${blob(CAST[l].seed, { size: 40 })}<small>${CAST[l].name}</small></a>`).join('')}</div></div>
    </div>
    ${untouched ? `<a class="card nudge" href="#/pattern/${untouched.id}">${blob(CAST[untouched.lang].seed, { size: 40, mood: 'wink' })}<div><div class="kicker">${CAST[untouched.lang].name} suggests</div>
      <b>${esc(untouched.title)}</b> (${LANGS[untouched.lang]}) is still untouched. Want to try one together today?</div><span class="sp"></span><span class="go">→</span></a>` : ''}
    <div class="card stats"><div><b data-count="${stats.solved}" data-suffix="/${stats.total}">0</b><small>problems solved</small></div><div><b data-count="${stats.streak}">0</b><small>day streak</small></div>
      <div><b data-count="${stats.runs}">0</b><small>total runs</small></div><div><b>${stats.main_language ? LANGS[stats.main_language] : '-'}</b><small>main language</small></div></div>
    ${practiceCard(pq, cat)}
    <div class="section-title">See it in action</div>${demoShell()}
    <div class="section-title">Curated lists</div>${listTiles(cat)}
    ${Object.keys(LANGS).map(l => coachHead(l, cat) + patternTiles(cat, l)).join('')}
    ${reviewCard()}
    <footer class="foot">Spotted a mistake in a problem? Use <b>${ic('flag', 12)} Report a mistake</b> in the workspace. · <a href="#/feedback">All reviews & reports →</a></footer>
  </div>`;
  startDemo($('#demo'));
  bindReview();
  const s = $('#sensei svg');
  follow(s);
  $('#sensei').onmouseenter = () => setMood(s, 'happy');
  $('#sensei').onmouseleave = () => setMood(s, mood);
  $('#sensei').onclick = () => { setMood(s, 'wink'); setTimeout(() => setMood(s, mood), 900); };
  if ($('#set-name')) $('#set-name').onclick = askName;
}

async function langPage(lang) {
  const { cat } = await load();
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/">← Home</a>
    ${coachHead(lang, cat)}
    ${patternTiles(cat, lang)}
    <div class="section-title">Lists with ${LANGS[lang]} problems</div>
    ${listTiles(cat, l => cat.problems.some(p => p.lang === lang && (p.lists || []).includes(l.id)))}</div>`;
}

async function problemList(kind, id) {
  const { cat } = await load();
  const meta = (kind === 'pattern' ? cat.patterns : cat.lists).find(x => x.id === id);
  if (!meta) return $('#app').innerHTML = '<div class="empty">Not found</div>';
  const all = byDifficulty(cat.problems.filter(p => kind === 'pattern' ? p.pattern === id : (p.lists || []).includes(id)));
  const [d, t] = count(all);
  const coach = CAST[kind === 'pattern' ? meta.lang : 'sensei'];
  let filter = 'all';
  const render = () => {
    const ps = all.filter(p => filter === 'all' || p.difficulty === filter || (filter === 'todo' && !p.solved));
    $('#cards').innerHTML = ps.map(p => `<div class="card pcard"><div class="row"><span class="check ${p.solved ? 'done' : ''}">${p.solved ? '✓' : ''}</span>
      <div><h4><span class="pnum">${all.indexOf(p) + 1}.</span>${esc(p.title)}</h4><div style="margin-top:6px;display:flex;gap:6px">${diffTag(p.difficulty)}${kind === 'list' ? langTag(p.lang) : ''}</div></div></div>
      <a class="start" href="#/p/${p.id}"><button class="primary">${p.solved ? 'Practice again' : 'Start session'}</button></a></div>`).join('')
      || `<div class="empty">${blob(coach.seed, { size: 64, mood: 'shy' })}<p>Nothing here yet.</p></div>`;
    document.querySelectorAll('.chips button').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    stagger($('#app'));
  };
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="${kind === 'pattern' ? `#/lang/${meta.lang}` : '#/'}">← ${kind === 'pattern' ? `All ${LANGS[meta.lang]} patterns` : 'Home'}</a>
    <div class="list-head">${blob(coach.seed, { size: 72, mood: d === t && t ? 'love' : d ? 'happy' : 'idle', live: true })}
      <div><div class="kicker" style="color:var(--acc2)">${esc(kind === 'pattern' ? `${LANGS[meta.lang]} · ${meta.group}` : 'Curated list')}</div>
      <h1 style="margin:4px 0">${esc(meta.title)}</h1><div class="dim">${esc(meta.desc)}</div></div></div>
    <div class="dim" style="display:flex;margin-top:22px;font-size:12px"><span>${d} of ${t} solved</span><span class="sp"></span><span>${t ? Math.round(100 * d / t) : 0}%</span></div>
    <div class="bar"><i style="width:${t ? 100 * d / t : 0}%"></i></div>
    <div class="chips">${['all', 'easy', 'medium', 'hard', 'todo'].map(f => `<button data-f="${f}">${f === 'todo' ? 'unsolved' : f}</button>`).join('')}</div>
    <div class="grid two" id="cards"></div></div>`;
  follow($('.list-head svg'));
  document.querySelectorAll('.chips button').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
  render();
}

// ---------- workspace ----------
// The editor comes from a CDN: load it in the background (a blocking <script> tag left the window blank on slow networks)
const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
const monacoReady = new Promise(res => {
  const s = Object.assign(document.createElement('script'), { src: `${MONACO}/loader.js`, async: true });
  s.onerror = () => res(null);  // offline: the plain text editor takes over
  s.onload = () => {
    require.config({ paths: { vs: MONACO } });
    require(['vs/editor/editor.main'], () => { monacoTheme(); res(window.monaco); }, () => res(null));
  };
  document.head.append(s);
});

// problems in a list are ordered easy -> hard; list pages and the problem title share this order for numbering
const byDifficulty = ps => [...ps].sort((a, b) => ['easy', 'medium', 'hard'].indexOf(a.difficulty) - ['easy', 'medium', 'hard'].indexOf(b.difficulty));

async function workspace(id, mode) {  // mode "review" (practice queue) or "round" (mock coding round): start from the blank starter
  const review = mode === 'review';
  let round = mode === 'round' ? JSON.parse(sessionStorage.getItem('round:' + id) || 'null') : null;
  const [p, { cat }] = await Promise.all([api('/api/problems/' + id), load()]);
  if (p.error) return $('#app').innerHTML = '<div class="empty">Problem not found</div>';
  const coach = CAST[p.lang], you = me() || 'you';
  const chatKey = (round ? 'roundchat:' : 'chat:') + id, stageKey = 'stage:' + id;
  let messages = JSON.parse(localStorage.getItem(chatKey) || '[]');
  let stage = +(localStorage.getItem(stageKey) || 0), last = null, hintsShown = 0, secs = 0, ticking = true;
  let fontSize = +(localStorage.getItem('fontSize') || 13), inst = null, resting = 'idle';
  const hints = p.hints || [];

  $('#app').innerHTML = `
    <div class="ws-top"><a class="back" href="#/pattern/${p.pattern}" title="Back">←</a>
      <span class="timer">${ic('timer', 14)}<span id="clock">00:00</span><button id="pause" title="Pause" aria-label="Pause">${ic('pause', 13)}</button><button id="rst" title="Reset timer" aria-label="Reset timer">${ic('reset', 13)}</button></span>
      <button id="subs">${ic('history')}Submissions</button>
      <button id="report" title="Wrong expected output, unclear statement, typo…">${ic('flag')}Report a mistake${p.open_reports ? ` <span class="badge">${p.open_reports}</span>` : ''}</button>
      <div class="stages" id="stages"></div></div>
    <div class="cols">
      <section class="col"><div class="col-h"># Problem</div><div class="scroll prob">
        <h2>${(n => n ? `<span class="pnum">${n}.</span>` : '')(byDifficulty(cat.problems.filter(x => x.pattern === p.pattern)).findIndex(x => x.id === id) + 1)}${esc(p.title)}</h2>
        <div class="tags">${langTag(p.lang)}${diffTag(p.difficulty)}<span class="tag">${p.tests} tests</span>${p.solved ? '<span class="tag easy">solved ✓</span>' : ''}</div>
        ${round ? `<div class="round-bar" id="round-bar">${ic('timer', 15)}<div><b>Coding round</b><span id="round-left"></span><small id="round-hints"></small></div>
          <span class="sp"></span><button class="primary" id="round-next" hidden>Continue to follow-up</button><button class="ghost" id="round-end">End round</button></div>` : ''}
        ${review ? `<div class="review-banner">${ic('reset', 14)}<div><b>Review</b> · solve it again from scratch. Pass on your first run to move it to the next review.</div></div>` : ''}
        ${md(p.statement)}
        <div class="col-h" style="padding:10px 0 2px">Example input</div>
        ${p.sample.tables ? tables(p.sample.tables) : `<pre>${esc(p.function)}(${p.sample.args.map(a => JSON.stringify(a)).join(', ')})</pre>`}
        ${hints.length ? `<div class="hints"><button class="hint-row" id="more-hint">${ic('bulb', 16)}<span id="hint-label">Stuck? <b>Reveal hint 1</b></span>
          <span class="hint-dots">${hints.map(() => '<i></i>').join('')}</span></button><div id="hint-list"></div></div>` : ''}
        ${p.source_url ? `<div class="faint">Inspired by: <a href="${esc(p.source_url)}" target="_blank" rel="noreferrer" style="text-decoration:underline">${esc(new URL(p.source_url).hostname)}</a></div>` : ''}
      </div></section>
      <div class="gutter" id="g1" title="Drag to resize · double-click to reset"></div>
      <section class="col"><div class="col-h"># Editor</div>
        <div class="toolbar"><select id="engine" title="Engine / version"></select><span class="sp"></span>
          <button class="ghost" id="fs-dn">A-</button><span class="faint" id="fs">${fontSize}</span><button class="ghost" id="fs-up">A+</button>
          <button id="fmt" title="Format code (Shift + Alt + F)" aria-label="Format code">${ic('format', 14)}</button><button id="reset">Reset</button><button id="sol">Solution</button><button class="primary" id="run" title="Run tests (⌘/Ctrl + Enter)">${ic('play', 13)}Run</button></div>
        <div id="editor-wrap"><div id="editor"></div><textarea id="fallback" spellcheck="false"></textarea></div>
        <div class="gutter h" id="g-out" title="Drag to resize · double-click to reset"></div>
        <div id="out-box"><div class="col-h out-h"># Results<button class="out-x" id="out-x" title="Close results (Run opens them again)" aria-label="Close results">${ic('x', 14)}</button></div>
          <div id="out"><div class="faint">Test results will appear here. Run with ⌘/Ctrl + Enter.</div></div></div>
      </section>
      <div class="gutter" id="g2" title="Drag to resize · double-click to reset"></div>
      <section class="col">
        <div class="coach-head"><div id="coach">${blob(coach.seed, { size: 58, live: true, cls: 'live' })}</div>
          <div><b>${coach.name}</b><div class="dim" style="font-size:11.5px">${round ? 'your interviewer' : coach.role}</div></div><span class="sp"></span>
          <button class="ghost new-chat" id="new-chat" title="Clear this chat and start fresh">↺ New chat</button>
          <span class="status" id="status"><i></i>listening</span></div>
        <div class="chat" id="chat"></div>
        <div class="chat-in"><textarea id="say" placeholder="Talk to ${coach.name}… (Enter to send, Shift+Enter for a new line)"></textarea>
          <div class="row"><button class="primary" id="send">Send</button><button id="nudge">I'm stuck</button><span class="sp"></span>
          <a class="faint" style="font-size:11px" href="#/setup">coach setup</a></div></div>
      </section>
    </div>`;

  // coach face: follows the pointer, looks at your message while you type, and reacts to what happens
  const face = $('#coach svg'), gz = follow(face, 'pointer');
  const status = (text, mood) => { $('#status').lastChild.textContent = text; $('#status').className = `status ${text.split(' ')[0]}`; if (mood) setMood(face, mood); };
  const react = (mood, ms = 1600) => { setMood(face, mood); clearTimeout(react.t); react.t = setTimeout(() => setMood(face, resting), ms); };
  let napTimer;
  const awake = () => {
    if (face.dataset.mood === 'sleepy') { setMood(face, resting); status('listening'); }
    clearTimeout(napTimer); napTimer = setTimeout(() => { setMood(face, 'sleepy'); status('napping'); }, 180000);
  };
  ['keydown', 'pointerdown'].forEach(ev => document.addEventListener(ev, awake));
  cleanups.push(() => { clearTimeout(napTimer); ['keydown', 'pointerdown'].forEach(ev => document.removeEventListener(ev, awake)); });
  awake();
  $('#say').onfocus = () => gz && gz.lookAt($('#say'));
  $('#say').onblur = () => gz && gz.lookAt('pointer');

  // resizable panes, remembered across problems
  const layout = JSON.parse(localStorage.getItem('layout') || '{}'), cols = $('.cols');
  const applyLayout = () => {
    ['w1', 'w3'].forEach(k => layout[k] ? cols.style.setProperty('--' + k, layout[k] + 'px') : cols.style.removeProperty('--' + k));
    $('#out-box').style.height = layout.out ? layout.out + 'px' : '';
    localStorage.setItem('layout', JSON.stringify(layout));
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const gutter = (el, key, size) => {
    el.onpointerdown = e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); document.body.classList.add('dragging');
      el.onpointermove = e => { layout[key] = size(e); applyLayout(); };
      el.onpointerup = () => { el.onpointermove = null; document.body.classList.remove('dragging'); };
    };
    el.ondblclick = () => { delete layout[key]; applyLayout(); };
  };
  const box = () => cols.getBoundingClientRect(), MID = 340;
  gutter($('#g1'), 'w1', e => clamp(e.clientX - box().left, 220, box().width - (layout.w3 || 260) - MID));
  gutter($('#g2'), 'w3', e => clamp(box().right - e.clientX, 240, box().width - (layout.w1 || 220) - MID));
  gutter($('#g-out'), 'out', e => { const c = $('#out-box').parentElement.getBoundingClientRect(); return clamp(c.bottom - e.clientY, 60, c.height - 160); });
  applyLayout();
  const showOut = on => { $('#out-box').hidden = $('#g-out').hidden = !on; };
  $('#out-x').onclick = () => showOut(false);

  // timer
  const tick = setInterval(() => {
    if (!ticking) return;
    secs++;
    $('#clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }, 1000);
  cleanups.push(() => clearInterval(tick));
  $('#pause').onclick = () => { ticking = !ticking; $('#pause').innerHTML = ic(ticking ? 'pause' : 'play', 13); $('#pause').title = ticking ? 'Pause' : 'Resume'; };
  $('#rst').onclick = () => { secs = -1; ticking = true; };

  // engine / dialect / version picker; remembered per language
  const engKey = 'engine:' + p.lang;
  api('/api/engines').then(all => {
    const opts = all[p.lang], saved = localStorage.getItem(engKey);
    if (!opts.length) return sparkSetup(all);
    const pick = opts.some(o => o.id === saved) ? saved : all.default[p.lang];
    $('#engine').innerHTML = opts.map(o => `<option value="${o.id}" ${o.id === pick ? 'selected' : ''}>${esc(o.label)}${o.id === all.default[p.lang] ? ' · default' : ''}</option>`).join('');
  });
  $('#engine').onchange = () => localStorage.setItem(engKey, $('#engine').value);
  function sparkSetup(all) {  // desktop app: PySpark is downloaded the first time it's needed
    $('#run').disabled = true; $('#engine').innerHTML = '<option>PySpark not installed</option>';
    const draw = st => {
      $('#out').innerHTML = `<div class="callout warn"><b>One-time download: PySpark</b>
        <p class="dim">PySpark problems need Spark (about 350 MB). It's installed into your DataDojo folder and only once.</p>
        ${all.java ? '' : '<p class="fail">Java isn\'t installed yet. Spark needs Java 17: get it free from <a href="https://adoptium.net" target="_blank" rel="noreferrer">adoptium.net</a>, then reopen DataDojo.</p>'}
        ${st.status === 'error' ? `<p class="fail">${esc(st.error)}</p>` : ''}
        ${['idle', 'error'].includes(st.status) ? '<button class="primary" id="spark-go">Download PySpark</button>'
          : st.status === 'done' ? '<p class="pass">✓ Installed! Loading…</p>' : `<p><span class="spinner"></span>${esc(st.status)}… this takes a minute or two.</p>`}</div>`;
      if ($('#spark-go')) $('#spark-go').onclick = async () => { draw(await api('/api/setup/pyspark', {})); poll(); };
    };
    const poll = () => { const t = setInterval(async () => { const a = await api('/api/engines');
      if (a.pyspark.length) { clearInterval(t); route(); } else if (JSON.stringify(a.spark_install) !== JSON.stringify(all.spark_install)) draw((all = a).spark_install); }, 2500); cleanups.push(() => clearInterval(t)); };
    draw(all.spark_install);
    if (!['idle', 'error', 'done'].includes(all.spark_install.status)) poll();
  }

  // editor
  const code = () => inst ? inst.getValue() : $('#fallback').value;
  const setCode = v => inst ? inst.setValue(v) : ($('#fallback').value = v);
  $('#fallback').value = (review || round ? p.starter : p.last_code || p.starter) || '';
  monacoReady.then(m => {
    if (!m || !document.body.contains($('#editor'))) {
      $('#editor').style.display = 'none'; $('#fallback').style.display = 'block'; return;
    }
    inst = m.editor.create($('#editor'), { value: $('#fallback').value, language: p.lang === 'sql' ? 'sql' : 'python', theme: 'dojo',
      fontSize, fontFamily: getComputedStyle(document.body).getPropertyValue('--body'), minimap: { enabled: false }, automaticLayout: true,
      scrollBeyondLastLine: false, tabSize: 4, padding: { top: 10 }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on',
      // slim scrollbars without the track box or the right-hand overview strip, matching the rest of the app
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false }, overviewRulerLanes: 0,
      overviewRulerBorder: false, hideCursorInOverviewRuler: true });
    inst.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, runTests);
    inst.addAction({ id: 'datadojo.format', label: 'Format code', keybindings: [m.KeyMod.Shift | m.KeyMod.Alt | m.KeyCode.KeyF], run: formatCode });
    inst.onDidFocusEditorText(() => gz && gz.lookAt($('#editor-wrap')));
    inst.onDidBlurEditorText(() => gz && gz.lookAt('pointer'));
    cleanups.push(() => inst.dispose());
  });
  $('#fallback').onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runTests(); };
  const setFont = n => { fontSize = Math.max(10, Math.min(22, n)); localStorage.setItem('fontSize', fontSize);
    $('#fs').textContent = fontSize; inst && inst.updateOptions({ fontSize }); };
  $('#fs-dn').onclick = () => setFont(fontSize - 1);
  $('#fs-up').onclick = () => setFont(fontSize + 1);
  $('#reset').onclick = async () => await ask('Replace your code with the starter?', { ok: 'Replace', seed: coach.seed, mood: 'unsure' }) && setCode(p.starter || '');
  let sawSolution = false;
  $('#sol').onclick = async () => {
    react('shy', 2500);
    if (!await ask(`Peek at the reference solution? ${coach.name} thinks a hint might be enough!`,
      { ok: 'Show solution', cancel: 'Keep trying', seed: coach.seed })) return;
    const sol = (await api(`/api/problems/${id}/solution`)).solution.trim();
    sawSolution = true; api('/api/event', { id, kind: 'solution' });
    modal(`<h3>Reference solution</h3>
      <div class="sol-code"><button class="copy" id="sol-copy">Copy</button><pre>${esc(sol)}</pre></div>
      <div class="lbl">Explanation</div>
      <div class="sol-exp" id="sol-exp"><span class="dim"><span class="spinner"></span>${coach.name} is writing a walkthrough…</span></div>
      <div class="sol-ask"><span class="dim">Still not clear?</span><button class="primary" id="sol-ask">Ask ${coach.name} about it</button></div>`);
    $('#sol-copy').onclick = () => navigator.clipboard.writeText(sol).then(() => { $('#sol-copy').textContent = 'Copied ✓'; });
    $('#sol-ask').onclick = () => { closeModal(); send("I've read the reference solution but don't fully understand it. Can you walk me through it?"); };
    const e = await api('/api/explain', { id });
    if ($('#sol-exp')) $('#sol-exp').innerHTML = e.error ? `<p class="fail">${esc(e.error)}</p>` : md(e.explanation);
  };

  // hints
  if (hints.length) $('#more-hint').onclick = () => {
    if (hintsShown >= hints.length) return;
    hintsShown++; api('/api/event', { id, kind: 'hint' }); if (round) { round.hints++; saveRound(); roundTick(); }
    $('#hint-list').insertAdjacentHTML('beforeend', `<div class="hint-card"><span class="hint-n">${hintsShown}</span><div>${inline(hints[hintsShown - 1])}</div></div>`);
    document.querySelectorAll('.hint-dots i').forEach((d, i) => d.classList.toggle('on', i < hintsShown));
    const done = hintsShown >= hints.length;
    $('#hint-label').innerHTML = done ? `All ${hints.length} hint${hints.length === 1 ? '' : 's'} shown` : `Stuck? <b>Reveal hint ${hintsShown + 1}</b>`;
    $('#more-hint').classList.toggle('done', done);
    react('wink');
  };

  // stages + chat
  const save = () => { localStorage.setItem(chatKey, JSON.stringify(messages.slice(-60))); localStorage.setItem(stageKey, stage); };
  const renderStages = () => $('#stages').innerHTML = STAGES.map(([, label], i) =>
    `<button class="stage ${i === stage ? 'on' : i < stage ? 'done' : ''}" data-i="${i}"><span>${i < stage ? '✓' : i + 1}</span>${label}</button>`)
    .join('<span class="arrow">→</span>');
  const bubble = m => m.role === 'sys' ? `<div class="msg sys">${esc(m.content)}</div>`
    : m.role === 'assistant'
      ? `<div class="line them">${blob(coach.seed, { size: 30, mood: m.mood || 'idle' })}<div class="msg assistant">${md(m.content)}</div></div>`
      : `<div class="line me"><div class="msg user">${esc(m.content)}</div>${blob(you, { size: 30, mood: 'happy' })}</div>`;
  const renderChat = () => { $('#chat').innerHTML = messages.map(bubble).join(''); $('#chat').scrollTop = 1e9; };
  const say = (content, mood = 'idle', replaceReaction = false) => {
    if (replaceReaction && messages.at(-1)?.reaction) messages.pop();
    messages.push({ role: 'assistant', content, mood, reaction: replaceReaction });
    save(); renderChat();
  };
  const goStage = i => {
    if (i === stage && messages.length) return;
    stage = i;
    messages.push({ role: 'sys', content: STAGES[i][1] });
    say(i === 0 && !messages.some(m => m.role === 'assistant')
      ? `Hi ${me() ? me().split(' ')[0] : 'there'}! I'm ${coach.name}. ${STAGES[i][2]}` : STAGES[i][2], i === STAGES.length - 1 ? 'love' : 'happy');
    renderStages(); react('happy');
  };
  $('#stages').onclick = e => { const b = e.target.closest('.stage'); if (b) goStage(+b.dataset.i); };
  if (round && !messages.length) messages.push({ role: 'assistant', mood: 'happy', content: `I'm ${coach.name}, your interviewer for this round. You have ${round.minutes} minutes. Talk me through your approach here as you go. I'll answer questions, but I won't give you the solution.` });
  if (!messages.length) goStage(stage); else { renderStages(); renderChat(); }
  $('#new-chat').onclick = async () => {  // only on request: wipe this problem's chat and greet again from stage 1
    if (!await ask(`Clear your chat with ${coach.name} on this problem and start fresh?`, { ok: 'Start new chat', seed: coach.seed })) return;
    messages = []; stage = 0; save(); goStage(0);
  };

  const send = async text => {
    if (!text.trim()) return;
    messages.push({ role: 'user', content: text });
    renderChat(); $('#say').value = '';
    $('#chat').insertAdjacentHTML('beforeend', `<div class="line them" id="typing">${blob(coach.seed, { size: 30, mood: 'thinking' })}<div class="msg assistant"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
    $('#chat').scrollTop = 1e9;
    status('thinking…', 'thinking');
    const r = await api('/api/coach', { id, code: code(), result: last, stage: round ? 'interviewer' : STAGES[stage][0], solution: sawSolution,
      messages: messages.filter(m => m.role !== 'sys').map(({ role, content }) => ({ role, content })) });
    status('listening', resting);
    say(r.reply || r.error, last?.passed ? 'happy' : 'idle');
  };
  $('#send').onclick = () => send($('#say').value);
  $('#nudge').onclick = () => send("I'm stuck. Can you give me a small hint without the answer?");
  $('#say').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#say').value); } };

  // run
  async function runTests() {
    showOut(true);
    $('#run').disabled = true; $('#run').innerHTML = '<span class="spinner"></span>Running';
    status('watching…', 'thinking');
    $('#out').innerHTML = `<div class="dim"><span class="spinner"></span>Running${p.lang === 'pyspark' ? ' (Spark needs ~10s to start)' : ''}…</div>`;
    last = await api('/api/run', { id, code: code(), engine: $('#engine').value });
    $('#run').disabled = false; $('#run').innerHTML = `${ic('play', 13)}Run`;
    status('listening');
    if (last.error) {
      $('#out').innerHTML = `<div class="verdict fail">Error</div><pre class="fail">${esc(last.error)}</pre>`;
      resting = 'unsure'; react('surprised', 1200);
      return say("Whoa, that didn't run. Check the error in the results panel; I can help you read it.", 'surprised', true);
    }
    const n = last.results.filter(t => t.passed).length, total = last.results.length;
    $('#out').innerHTML = `<div class="verdict ${last.passed ? 'pass' : 'fail'}">${last.passed ? `All ${n} tests passed` : `${n}/${total} tests passed`}</div>${testBar(last.results.map(t => t.passed))}`
      + `<div class="faint" style="margin:-4px 0 8px">ran on ${esc($('#engine').selectedOptions[0]?.textContent || last.engine)} · expected output from the default engine</div>`
      + (last.translated ? `<details ${last.translated_by === 'ai' ? 'open' : ''}><summary>SQL as executed (translated to DuckDB${last.translated_by === 'ai' ? ` by ${esc(coach.name)}, because the automatic translator couldn't` : ''})</summary><pre>${esc(last.translated)}</pre></details>` : '')
      + (last.stdout ? `<details open><summary>stdout</summary><pre>${esc(last.stdout)}</pre></details>` : '')
      + last.results.map(t => `<details ${t.passed ? '' : 'open'}><summary class="${t.passed ? 'pass' : 'fail'}">Test ${t.test} ${t.passed ? 'passed' : 'failed'}</summary>
          ${t.error ? `<pre class="fail">${esc(t.error)}</pre>` : ''}
          <div class="lbl">Input</div>${Array.isArray(t.input) ? `<pre>${esc(t.input.map(a => JSON.stringify(a)).join(', '))}</pre>` : tables(t.input)}
          <div class="lbl">Expected</div>${value(t.expected, t.expected_columns)}${'got' in t ? `<div class="lbl">Your output</div>${value(t.got, t.got_columns)}` : ''}</details>`).join('');
    if (round) { round.frac = total ? n / total : 0; saveRound(); }
    if (last.passed && round) return roundPassed();
    if (last.passed) {
      $('#out .test-bar').insertAdjacentHTML('afterend', `<button class="primary map-btn" id="map-btn">${ic('map', 16)}See execution map</button>`);
      $('#map-btn').onclick = () => showMap();
      prefetchMap();  // build the map while they read the result, so the button opens it at once
      resting = 'happy'; react('love', 2500); confetti($('#out .verdict'));
      say(`All ${n} tests pass! Nicely done${me() ? ', ' + me().split(' ')[0] : ''}. Want me to review it, or try the edge cases on another engine?`, 'love', true);
      if (stage < STAGES.length - 1) { stage = STAGES.length - 2; goStage(STAGES.length - 1); }
    } else {
      resting = n ? 'unsure' : 'sad'; react(n ? 'unsure' : 'sad', 2000);
      say(n ? `${n} of ${total} passing, so you're close! Compare "Expected" and "Your output" on the failing test.`
            : `None passing yet, and that's okay. Look at the first failing test and check the shape of your output.`, n ? 'unsure' : 'sad', true);
    }
  }
  $('#run').onclick = runTests;

  // ---- mock coding round: timer, efficiency check against the reference, graded follow-up, report ----
  function saveRound() { if (round) sessionStorage.setItem('round:' + id, JSON.stringify(round)); }
  function roundTick() {
    if (!round || !$('#round-left')) return;
    const left = round.minutes * 60 - Math.floor((Date.now() - round.started) / 1000), m = Math.floor(Math.abs(left) / 60), sec = Math.abs(left) % 60;
    $('#round-left').textContent = left >= 0 ? ` · ${m}:${String(sec).padStart(2, '0')} left` : ` · ${m}:${String(sec).padStart(2, '0')} over time`;
    $('#round-bar').classList.toggle('over', left < 0);
    $('#round-hints').textContent = round.hints ? ` · ${round.hints} hint${round.hints === 1 ? '' : 's'} (−${5 * round.hints})` : '';
  }
  async function roundPassed() {
    resting = 'happy'; react('happy', 1500);
    say('Tests pass. Give me a second to look at how it runs…', 'thinking', true);
    const r = await api('/api/round/check', { id, code: code(), engine: $('#engine').value });
    if (r.ok === false) {
      round.improved = round.eff_ok === false ? round.improved : false;
      round.eff_ok = false; round.eff_say = r.say; saveRound();
      say(`It works. ${r.say} Can you make it more efficient? Run it again when you're ready, or continue to my follow-up question.`, 'unsure', true);
      $('#round-next').hidden = false;
      return;
    }
    round.improved = round.eff_ok === false && r.ok === true;
    round.eff_ok = r.ok; round.eff_say = r.ok === null ? '' : round.improved ? 'You improved it to match the best solution.' : 'As efficient as the best solution.';
    saveRound();
    say(round.improved ? 'Much better, that matches the best solution. One follow-up question.' : 'Clean, and as efficient as it needs to be. One follow-up question.', 'love', true);
    followUp();
  }
  function followUp() {
    $('#round-next').hidden = true; round.phase = 'followup'; saveRound();
    modal(`<div class="kicker dot">Follow-up · ${esc(coach.name)} asks</div><h3 style="margin:8px 0 12px">${esc(round.followup.q)}</h3>
      <textarea id="fu-answer" class="field" rows="7" placeholder="Answer like you would out loud: what, why, and how you'd check it."></textarea>
      <div class="row-end"><span id="fu-msg" class="dim"></span><button class="primary" id="fu-send">Submit answer</button></div>`);
    onModalClose = () => { if (round && round.phase === 'followup') $('#round-next').hidden = false; };
    const t0 = Date.now(); $('#fu-answer').focus();
    $('#fu-send').onclick = async () => {
      const answer = $('#fu-answer').value.trim();
      if (answer.split(/\s+/).length < 3) return void ($('#fu-msg').textContent = 'Write a few sentences first.');
      $('#fu-send').disabled = true; $('#fu-send').innerHTML = '<span class="spinner"></span>Grading…';
      const g = await api('/api/round/grade', { followup: round.followup.id, answer, level: round.level, seconds: Math.round((Date.now() - t0) / 1000) });
      round.followup_score = g.error ? 0 : g.score; round.followup_feedback = g.error ? { error: g.error } : { score: g.score, improve: g.improve, strengths: g.strengths, answer: g.answer };
      round.phase = 'done'; saveRound(); onModalClose = null; finishRound();
    };
  }
  async function finishRound() {
    if (!round) return;
    const seconds = Math.round((Date.now() - round.started) / 1000);
    const rep = await api('/api/round/finish', { id, track: round.track, level: round.level, passed_fraction: round.frac || 0,
      eff_ok: round.eff_ok ?? null, improved: !!round.improved, eff_say: round.eff_say || '', seconds, minutes: round.minutes, hints: round.hints,
      followup_score: round.followup_score || 0, followup_q: round.followup.q, followup_feedback: round.followup_feedback || {} });
    sessionStorage.removeItem('round:' + id); localStorage.removeItem('roundchat:' + id);
    round = null; $('#round-bar')?.remove(); $('#sol').hidden = $('#stages').hidden = false;
    roundReport(rep);
  }
  $('#round-next') && ($('#round-next').onclick = followUp);
  $('#round-end') && ($('#round-end').onclick = async () => {
    if (!await ask('End the round now? It will be scored as it stands.', { ok: 'End round', seed: coach.seed, mood: 'unsure' })) return;
    finishRound();
  });
  if (round) {
    $('#sol').hidden = $('#stages').hidden = true;  // no peeking, no coaching steps during a round
    roundTick(); const t = setInterval(roundTick, 1000); cleanups.push(() => clearInterval(t));
    if (round.phase === 'followup') $('#round-next').hidden = false;
  }
  async function formatCode() {  // one undoable edit, so Ctrl/Cmd+Z brings the old layout back
    const r = await api('/api/format', { id, code: code(), engine: $('#engine').value });
    if (r.error === 'not found') return say("Formatting needs a restart of DataDojo: the running app is older than this page.", 'unsure', true);
    if (r.error) return say(r.error, 'unsure', true);
    if (r.code === code()) return;
    if (inst) { inst.pushUndoStop(); inst.executeEdits('format', [{ range: inst.getModel().getFullModelRange(), text: r.code }]); inst.pushUndoStop(); }
    else setCode(r.code);
  }
  $('#fmt').onclick = formatCode;

  // execution map: what the engine did with the passing code, next to the reference solution
  let mapAhead = null;  // { key, req }: the map for the code that just passed, requested in the background
  function prefetchMap() { const engine = $('#engine').value; mapAhead = { key: code() + '\n' + engine, req: api('/api/map', { id, code: code(), engine }) }; }
  async function showMap(engine = $('#engine').value) {  // engine: a one-off override, never saved as the learner's choice
    const graph = p.lang !== 'python', duck = p.lang === 'sql' && engine !== 'spark-sql', other = engine !== $('#engine').value;
    modal(`<div class="map-head"><h3>Execution map</h3>${other ? `<span class="dim">on Spark SQL · <a href="#" id="map-home">back to the ${esc($('#engine').selectedOptions[0]?.textContent || 'usual')} map</a></span>` : ''}</div>
      <div id="map-body"><div class="map-skel" aria-busy="true">
        <div class="sk sk-verdict"><span class="spinner"></span>Running your code once more to watch the engine${p.lang === 'pyspark' ? ' (Spark needs ~10s)' : ''}…</div>
        <div class="map-stats">${'<div class="sk sk-chip"></div>'.repeat(graph ? 4 : 3)}</div>
        <div class="sk sk-scale"></div>${graph ? '<div class="sk sk-bar"></div>' : ''}
        ${graph ? '<div class="map-main"><div class="sk map-stage"></div><div class="sk sk-side"></div></div>' : '<div class="map-py"><div class="sk sk-code"></div><div class="sk sk-code"></div></div>'}
      </div></div>`);  // a placeholder shaped like the map, so the window opens at its final size and nothing jumps
    $('.modal-box').classList.add('map');
    if ($('#map-home')) $('#map-home').onclick = e => { e.preventDefault(); showMap(); };
    const ahead = mapAhead && mapAhead.key === code() + '\n' + engine ? mapAhead.req : null;
    const m = await (ahead || api('/api/map', { id, code: code(), engine }));
    const box = $('#map-body'); if (!box) return;
    const y = m.yours || {}, r = m.reference || {};
    if (y.error) return box.innerHTML = (other ? `<p>Spark SQL can't run this query: it uses syntax or functions only ${esc($('#engine').selectedOptions[0]?.textContent || 'your engine')} supports.</p>` : '') + `<pre class="fail">${esc(y.error)}</pre>`;

    // the one-line verdict: what to take away before reading any box
    const GROW = ['O(1)', 'O(log n)', 'O(n)', 'O(n²)', 'O(n³) or worse'];
    const rank = v => typeof v === 'number' ? v : GROW.indexOf(v);
    let head, good = true;
    if (!graph) {
      const ratio = r.stats?.Steps ? y.stats.Steps / r.stats.Steps : 1;
      const tier = v => Math.max(0, rank(v) - 2);  // small tests make linear code look sublinear: only worse than O(n) counts
      if (r.stats && tier(y.stats['Grows like']) > tier(r.stats['Grows like'])) { good = false; head = `Your code grows like ${y.stats['Grows like']}; the reference grows like ${r.stats['Grows like']}`; }
      else if (ratio > 1.3) { good = false; head = `Your code does ${ratio.toFixed(1)}× the work of the reference`; }
      else head = ratio < .8 ? 'Leaner than the reference. Nice!' : 'As efficient as the reference';
    } else {
      const [key, noun] = duck ? ['Blocking steps', 'blocking step'] : ['Shuffles', 'shuffle'];
      const d = r.stats ? y.stats[key] - r.stats[key] : 0, pl = n => `${n} ${noun}${n === 1 ? '' : 's'}`;
      good = d <= 0;
      head = d > 0 ? `${pl(d)} more than the reference` : d < 0 ? `${pl(-d)} fewer than the reference. Nice!` : `Same shape as the reference: ${pl(y.stats[key])}`;
    }
    const notes = (y.notes || []).filter(n => !n.startsWith('Mapped on'));
    const tip = { pyspark: 'Each shuffle sends rows across the network and starts a new stage. Fewer shuffles, faster job.',
      sql: 'Blocking steps must read all their input before passing anything on. Fewer of them, on fewer rows, is faster.',
      python: 'Each bar shows how many times that line ran across all tests. Long bars are where the time goes.' }[p.lang];
    const f = v => v == null ? '–' : typeof v === 'number' ? v.toLocaleString() : esc(v);
    const cmp = (k, v) => k === 'Grows like' ? Math.max(0, rank(v) - 2) : rank(v);  // growth: only worse than O(n) counts, as in the verdict
    const chips = Object.keys(y.stats).map(k => { const a = y.stats[k], b = r.stats?.[k], w = b != null && cmp(k, a) > cmp(k, b), bt = b != null && cmp(k, a) < cmp(k, b);
      return `<div class="map-stat ${w ? 'worse' : bt ? 'better' : ''}"><span>${esc(k)}</span><b>${f(a)}</b><small>ref ${f(b)}</small></div>`; }).join('');
    const legend = graph ? `<div class="map-legend">${(duck ? [['source', 'read', 'Reads a table'], ['narrow', 'streaming', 'Rows flow straight through'], ['wide', 'blocking', 'Must read all input first'], ['warn', 'watch out', 'Slow at scale']]
      : [['source', 'read', 'Reads a table'], ['narrow', 'narrow', 'Works partition by partition, no data moves'], ['wide', 'wide', 'Needs rows with the same key together'], ['shuffle', 'shuffle', 'Moves rows across the network; ends a stage'], ['warn', 'watch out', 'Slow at scale']])
      .map(([c, l, t]) => `<span title="${t}"><i class="mk ${c}"></i>${l}</span>`).join('')}</div>` : '';
    const hmax = Math.max(1, ...Object.values(y.lines || {}), ...Object.values(r.lines || {}));  // one scale for both, so bars compare
    const heat = d => { const max = hmax;
      return `<div class="line-heat">${d.code.replace(/\n$/, '').split('\n').map((ln, i) => { const c = d.lines[i + 1] || 0;
        return `<div style="--h:${Math.round(100 * c / max)}%"><b>${c ? c.toLocaleString() + '×' : ''}</b><code>${esc(ln) || ' '}</code></div>`; }).join('')}</div>`; };
    const ask = `<button class="map-ask" id="map-ask" aria-label="Ask ${coach.name} to explain my map">${blob(coach.seed, { size: 38, mood: 'happy' })}<span class="map-tip">Ask ${coach.name} to explain my map</span></button>`;
    box.innerHTML = `<div class="map-verdict ${good ? 'good' : 'bad'}"><i>${good ? '✓' : '!'}</i><div><b>${esc(head)}</b><span>${esc(notes[0] || tip)}</span></div></div>
      <div class="map-stats">${chips}${graph ? '' : ask}</div>
      <details class="map-scale" id="map-scale" ${localStorage.getItem('scaleClosed') ? '' : 'open'}><summary class="ms-head"><i class="ms-caret">▸</i><div>${p.lang === 'python' ? `<b>At scale</b><span class="dim">Time both solutions on the biggest test grown to 256,000 items.</span>`
        : `<b>Will it hold up on real data?</b><span class="dim">Your tests have ${p.test_rows || 'a few'} row${p.test_rows === 1 ? '' : 's'}. Interviewers ask what happens with millions.</span>`}</div>
        <button id="ms-run">${ic('play', 12)}Run at scale</button></summary><div id="ms-body"></div></details>
      ${y.order?.length ? `<div class="map-order"><small>Runs in this order</small>${y.order.map(c => `<span>${c}</span>`).join('<i>→</i>')}</div>` : ''}
      ${graph ? `<div class="map-bar">
        <div class="seg" id="map-who"><button data-v="yours" class="on">Your code</button><button data-v="reference">Reference</button></div>
        <div class="seg" id="map-view"><button data-v="key" class="on" title="Only the steps that matter">Compact</button><button data-v="all" title="Every step the engine ran">Expanded</button></div>
        ${legend}
        ${ask}
      </div>` : ''}
      ${graph ? `<div class="map-main"><div class="map-stage" id="map-stage"><div class="map-pan" id="map-pan"></div>
          <div class="map-ctl"><button id="map-in" title="Zoom in">+</button><button id="map-out" title="Zoom out">−</button><button id="map-fit" title="Fit to screen">⛶</button></div>
          <div class="map-hint">${duck ? 'Data flows left to right · each pipeline has its own colour bar' : 'Data flows left to right · each stage has its own colour bar · dashed links are shuffles'} · drag to move, scroll to zoom</div></div>
        <aside class="map-side" id="map-side"></aside></div>`
        : `<div class="map-py"><div><div class="lbl">Your code</div>${heat(y)}</div><div><div class="lbl">Reference solution</div>${r.error ? `<p class="fail">${esc(r.error)}</p>` : heat(r)}</div></div>`}
      ${notes.length > 1 ? `<ul class="map-notes">${notes.slice(1).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
    $('#map-ask').onclick = () => { closeModal(); send(`Explain my execution map. Mine: ${JSON.stringify(y.stats)}; reference: ${JSON.stringify(r.stats || {})}. `
      + `Notes: ${(y.notes || []).join(' ')} What should I change to make my code as efficient as the reference?`); };
    $('#ms-run').onclick = e => { e.preventDefault(); $('#map-scale').open = true; atScale(engine); };  // a click on the button shouldn't fold the panel
    $('#map-scale').ontoggle = () => $('#map-scale').open ? localStorage.removeItem('scaleClosed') : localStorage.setItem('scaleClosed', '1');
    if (graph) mapViewer(y, r, duck);
  }

  // SQL and PySpark: what the timings mean, as a sentence you could say in an interview
  function takeaway(d) {
    const t = ms => ms < 1 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
    const nf = n => n >= 999.5e3 ? `${+(n / 1e6).toFixed(1)}M` : n >= 999.5 ? `${+(n / 1e3).toFixed(1)}k` : String(n);  // 999,999 → 1M, not 1000k
    const step = d.sizes.length > 1 ? Math.round(d.sizes[1] / d.sizes[0]) : 10;
    // growth over the last two finished sizes: exponent k, so each step of `step`× more data costs step^k× more time.
    // Under 20 ms is mostly fixed overhead, so it doesn't count as growth.
    const growth = ms => { const ix = ms.map((v, i) => v != null && v >= 20 ? i : -1).filter(i => i >= 0).slice(-2);
      return ix.length < 2 ? null : Math.log(ms[ix[1]] / ms[ix[0]]) / Math.log(d.sizes[ix[1]] / d.sizes[ix[0]]); };
    const kind = k => k == null || k < 0.5 ? 'stays flat' : k < 1.3 ? 'grows in step with the data (linear)' : k < 2.3 ? 'quadratic' : 'worse than quadratic';
    const Y = d.ms.yours, R = d.ms.reference, last = d.sizes.length - 1;
    const yi = Y.findLastIndex(v => v != null), ri = R.findLastIndex(v => v != null), ky = growth(Y), kr = growth(R);
    const per = k => Math.max(2, Math.round(step ** k));
    if (yi < ri) {
      const k = ky ?? (yi > 0 && Y[yi - 1] ? Math.log(Y[yi] / Y[yi - 1]) / Math.log(d.sizes[yi] / d.sizes[yi - 1]) : 2);
      return [`Your ${p.lang === 'sql' ? 'query' : 'job'} slows down about ${per(k)}× each time the data grows ${step}×, so it was stopped after ${nf(d.sizes[yi])} rows (${t(Y[yi])}). `
        + `The reference ${kind(kr)} and handles ${nf(d.sizes[ri])} rows in ${t(R[ri])}.`, false];
    }
    if (ri < yi || (ri < last && yi < last)) {  // the reference itself can't go all the way: the problem is heavy by nature
      return [`Both slow down sharply as the data grows: this problem is expensive by nature (often a range or cross join). `
        + `Yours: ${t(Y[Math.min(yi, ri)])} at ${nf(d.sizes[Math.min(yi, ri)])} rows, the reference ${t(R[Math.min(yi, ri)])}. In an interview, say how you'd cut the rows before the join.`, Y[Math.min(yi, ri)] <= 1.5 * R[Math.min(yi, ri)]];
    }
    if (ky != null && ky >= 1.3 && (kr == null || ky - kr >= 0.5)) {
      return [`Your ${p.lang === 'sql' ? 'query' : 'job'} slows down about ${per(ky)}× each time the data grows ${step}× (${kind(ky)}). The reference ${kind(kr)}.`, false];
    }
    if (Y[last] > 50 && Y[last] > 1.5 * R[last]) {
      return [`Same growth as the reference, but about ${(Y[last] / R[last]).toFixed(1)}× slower at ${nf(d.sizes[last])} rows (${t(Y[last])} vs ${t(R[last])}). Worth a look, not a rewrite.`, false];
    }
    return [`Fine at ${nf(d.sizes[last])} rows: ${t(Y[last])}, in line with the reference (${t(R[last])}). That's your answer when the interviewer asks about scale.`, true];
  }

  // "At scale": real timings for your code and the reference on the biggest test grown to big sizes
  async function atScale(engine) {
    const box = $('#ms-body');
    $('#ms-run').disabled = true; $('#ms-run').innerHTML = `<span class="spinner"></span>Running${p.lang === 'pyspark' ? ' (Spark: about a minute)' : ''}…`;
    const d = await api('/api/scale', { id, code: code(), engine });
    if (!$('#map-scale')) return;
    if (d.error) { $('#ms-run').disabled = false; $('#ms-run').textContent = 'Try again'; return void box.insertAdjacentHTML('beforeend', d.error === 'not found'
      ? '<p class="fail">DataDojo was updated while it was running. Quit it and start it again to use this.</p>' : `<pre class="fail">${esc(d.error)}</pre>`); }
    const t = ms => ms == null ? '' : ms < 1 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
    const nf = n => n >= 999.5e3 ? `${+(n / 1e6).toFixed(1)}M` : n >= 999.5 ? `${+(n / 1e3).toFixed(1)}k` : String(n);  // 999,999 → 1M, not 1000k
    const all = [...d.ms.yours, ...d.ms.reference].filter(v => v != null), lo = Math.log10(Math.max(.05, Math.min(...all))), hi = Math.log10(Math.max(...all) * 1.2);
    const w = ms => ms == null ? 0 : Math.max(2, 100 * (Math.log10(Math.max(ms, .05)) - lo) / (hi - lo || 1));
    const last = d.sizes.length - 1, Y = d.ms.yours, R = d.ms.reference;
    const yi = Y.findLastIndex(v => v != null), common = d.sizes.map((_, i) => i).filter(i => Y[i] != null && R[i] != null).pop();
    let verdict, good = true;
    if (p.lang !== 'python') [verdict, good] = takeaway(d);
    else if (yi < last && R[last] != null) { good = false; verdict = yi < 0 ? `Yours didn't finish even at ${nf(d.sizes[0])} ${d.unit}. The reference handles ${nf(d.sizes[last])} in ${t(R[last])}.`
      : `Yours took ${t(Y[yi])} at ${nf(d.sizes[yi])} ${d.unit}; bigger sizes would take too long. The reference handles ${nf(d.sizes[last])} in ${t(R[last])}.`; }
    else if (common != null && Y[common] > 20 && Y[common] > 1.5 * R[common]) { good = false; verdict = `At ${nf(d.sizes[common])} ${d.unit}, yours takes ${(Y[common] / R[common]).toFixed(1)}× as long as the reference (${t(Y[common])} vs ${t(R[common])}).`; }
    else verdict = common != null && Y[common] < 20 && R[common] < 20 ? `Both stay fast even at ${nf(d.sizes[common])} ${d.unit}.` : `Keeps pace with the reference at ${nf(d.sizes[common ?? last])} ${d.unit}.`;
    $('#map-scale .ms-head .dim').textContent = `${d.engine} on this computer · bars use a log scale`;
    $('#ms-run').disabled = false; $('#ms-run').innerHTML = `${ic('reset', 12)}Run again`;
    box.innerHTML = `
      <div class="ms-verdict ${good ? 'good' : 'bad'}">${esc(verdict)}</div>
      <div class="ms-grid">${d.sizes.map((n, i) => `<span class="ms-n">${nf(n)} ${d.unit}</span>
        <div class="ms-bars"><div class="ms-bar you" style="--w:${w(Y[i])}%"><i></i><span>${Y[i] == null ? 'stopped' : t(Y[i])}</span></div>
          <div class="ms-bar ref" style="--w:${w(R[i])}%"><i></i><span>${R[i] == null ? 'stopped' : t(R[i])}</span></div></div>`).join('')}</div>
      <div class="ms-key"><span><i class="you"></i>Your code</span><span><i class="ref"></i>Reference</span><span class="faint">${d.shifted ? 'Copies of the test data with shifted keys, so joins don\'t explode' : 'Repeated copies of the test data'}. Timings vary run to run.</span></div>`;
  }

  // plan cards: laid out as a tree (sources left, result right), pan / zoom, click to inspect, overview panel
  function mapViewer(y, r, duck) {
    const W = 210, H = 104, GX = 74, GY = 28, STAGE = ['#7dd3fc', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#2dd4bf', '#fb923c', '#94a3b8'];
    const stage = $('#map-stage'), pan = $('#map-pan'), side = $('#map-side'), unit = duck ? 'Pipeline' : 'Stage';
    const spark = [...$('#engine').options].some(o => o.value === 'spark-sql');
    let who = 'yours', view = 'key', d = y, L = null, t = { x: 0, y: 0, k: 1 }, sel = null, drag = null;
    const apply = () => pan.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.k})`;
    const nf = v => (v ?? 0).toLocaleString(), rowsTxt = v => v == null ? '' : `${nf(v)} row${v === 1 ? '' : 's'}`;

    function layout() {  // leaves get their own row; a parent sits level with the middle of its children
      const N = d.nodes, kids = {}, depth = {}, yv = {};
      const kept = c => view === 'all' || !N[c].minor ? [c] : N[c].inputs.flatMap(kept);
      const visit = i => { if (kids[i]) return; kids[i] = N[i].inputs.flatMap(c => kept(c).map(k => ({ k, c, rows: N[c].rows }))); kids[i].forEach(e => visit(e.k)); };
      const roots = kept(0); roots.forEach(visit);
      const deep = (i, n) => { if ((depth[i] ?? -1) >= n) return; depth[i] = n; kids[i].forEach(e => deep(e.k, n + 1)); };
      roots.forEach(i => deep(i, 0));
      let slot = 0;
      const place = i => i in yv ? yv[i] : (yv[i] = kids[i].length ? kids[i].map(e => place(e.k)).reduce((a, b) => a + b) / kids[i].length : slot++);
      roots.forEach(place);
      const ids = Object.keys(kids).map(Number), maxD = Math.max(...ids.map(i => depth[i]));
      const pos = Object.fromEntries(ids.map(i => [i, { x: (maxD - depth[i]) * (W + GX), y: yv[i] * (H + GY) }]));
      return { ids, kids, pos, w: (maxD + 1) * (W + GX) - GX, h: slot * (H + GY) - GY };
    }
    function card(i) {
      const n = d.nodes[i], p = L.pos[i], tot = L.ids.reduce((s, j) => s + (d.nodes[j].ms || 0), 0);
      const most = Math.max(...L.ids.map(j => d.nodes[j].rows || 0)), slow = Math.max(...L.ids.map(j => d.nodes[j].ms || 0));
      const pill = duck && tot ? `<span class="pc-pill ${n.ms === slow && slow ? 'hot' : ''}">${(100 * (n.ms || 0) / tot).toFixed(1)}% time</span>`
        : `<span class="pc-pill">${{ narrow: 'narrow', wide: 'wide', shuffle: 'shuffle', source: 'read', warn: 'slow' }[n.cls]}</span>`;
      const only = (v, m, f) => v && v === m && L.ids.filter(j => f(d.nodes[j]) === m).length === 1;  // badge a clear winner only, not a tie
      const big = only(n.rows, most, x => x.rows), slowest = duck && only(n.ms, slow, x => x.ms);  // one badge: two don't fit the card
      const badges = big && slowest ? ['Most rows, slowest'] : big ? ['Most rows'] : slowest ? ['Slowest'] : [];
      return `<div class="pc c-${n.cls} ${n.warn ? 'has-warn' : ''}" data-i="${i}" style="left:${p.x}px;top:${p.y}px;width:${W}px;height:${H}px">
        ${n.warn ? `<div class="pc-warn">⚠ ${esc(n.warn)}</div>` : ''}
        <div class="pc-top"><div><b>${esc(n.label)}</b><small>${esc(n.short || '')}</small></div>${pill}</div>
        <div class="pc-big">${n.rows != null ? `<b>${nf(n.rows)}</b> row${n.rows === 1 ? '' : 's'} out` : '<span class="faint">–</span>'}${badges.map(b => `<em>${b}</em>`).join('')}</div>
        <i class="pc-bar" style="background:${n.group ? STAGE[(n.group - 1) % STAGE.length] : 'transparent'}"></i></div>`;
    }
    function edges() {
      const max = Math.max(1, ...L.ids.flatMap(i => L.kids[i].map(e => e.rows || 0)));
      return L.ids.flatMap(i => L.kids[i].map(e => {
        const a = L.pos[e.k], b = L.pos[i], x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
        const w = 2 + 10 * Math.log10((e.rows || 0) + 1) / Math.log10(max + 1);  // band width grows with rows
        const cross = !duck && d.nodes[e.k].group !== d.nodes[i].group;  // a Spark stage change is a shuffle
        return { k: e.k, c: e.c, i, path: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, w, cross, rows: e.rows, lx: mx, ly: (y1 + y2) / 2 };
      }));
    }
    function draw() {
      d = who === 'yours' ? y : r; sel = null;
      if (d.error) { pan.innerHTML = `<p class="fail" style="padding:20px">${esc(d.error)}</p>`; return overview(); }
      L = layout();
      const E = edges();
      pan.innerHTML = `<svg class="pe" width="${L.w}" height="${L.h}">${E.map(e => `<path class="${e.cross ? 'x' : ''}" data-e="${e.k}-${e.i}" d="${e.path}" stroke-width="${e.w.toFixed(1)}"/>`).join('')}</svg>
        ${E.filter(e => e.rows != null).map(e => `<span class="pe-pill ${d.nodes[e.c].data ? 'has-data' : ''}" data-e="${e.k}-${e.i}" data-c="${e.c}" title="Click to see these rows" style="left:${e.lx}px;top:${e.ly}px">${rowsTxt(e.rows)}</span>`).join('')}
        ${L.ids.map(card).join('')}`;
      fit(); overview();
    }
    function fit() { if (!L) return; const cw = stage.clientWidth - 40, ch = stage.clientHeight - 60;
      t.k = Math.max(.72, Math.min(cw / L.w, ch / L.h, 1.1));  // never shrink cards past readable; wide plans pan instead
      t.x = L.w * t.k > cw ? 20 : (stage.clientWidth - L.w * t.k) / 2;  // too wide: start at the sources, on the left
      t.y = L.h * t.k > ch ? 20 : (stage.clientHeight - L.h * t.k) / 2 - 8; apply(); }
    const zoom = (f, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
      const k = Math.max(.2, Math.min(3, t.k * f)); t.x = cx - (cx - t.x) * k / t.k; t.y = cy - (cy - t.y) * k / t.k; t.k = k; apply(); };
    const centre = i => { const p = L.pos[i]; if (t.k < .8) t.k = .8; t.x = stage.clientWidth / 2 - (p.x + W / 2) * t.k; t.y = stage.clientHeight / 2 - (p.y + H / 2) * t.k; apply(); };

    function overview() {  // what to look at first, like Spanner's "prominent operators" and SQL Server's node-type table
      pan.classList.remove('picking'); pan.querySelectorAll('.lit').forEach(x => x.classList.remove('lit'));
      if (!L) return side.innerHTML = '';
      const N = d.nodes, ids = L.ids, by = f => ids.reduce((a, b) => (f(N[b]) > f(N[a]) ? b : a), ids[0]);
      const prom = [['Most rows', by(n => n.rows || 0), n => rowsTxt(n.rows)], ...(duck ? [['Slowest step', by(n => n.ms || 0), n => `${n.ms} ms`]] : []),
        ...ids.filter(i => N[i].cls === 'warn').map(i => ['Watch out', i, n => n.warn])];
      const types = {}; ids.forEach(i => { const k = N[i].label; types[k] = types[k] || { n: 0, rows: 0 }; types[k].n++; types[k].rows += N[i].rows || 0; });
      const maxR = Math.max(1, ...Object.values(types).map(v => v.rows));
      const groups = new Set(ids.map(i => N[i].group).filter(Boolean)).size;
      side.innerHTML = `<h4>${who === 'yours' ? 'Your code' : 'Reference'}</h4>
        <p class="dim">${ids.length} steps in ${groups} ${unit.toLowerCase()}${groups === 1 ? '' : 's'}. Click a card for details.</p>
        <div class="lbl">Look here first</div>${prom.map(([k, i, f]) => `<button class="map-jump" data-i="${i}"><span>${k}</span><b>${esc(N[i].label)}</b><small>${esc(f(N[i]) || '')}</small></button>`).join('')}
        <div class="lbl">Steps by type</div><table class="map-types">${Object.entries(types).sort((a, b) => b[1].rows - a[1].rows).map(([k, v]) =>
          `<tr><td>${esc(k)}</td><td>${v.n}</td><td><i style="width:${Math.round(60 * v.rows / maxR)}px"></i></td></tr>`).join('')}</table>
        <div class="faint" style="font-size:11px;margin-top:4px">count · rows produced</div>`;
      side.querySelectorAll('.map-jump').forEach(b => b.onclick = () => { select(+b.dataset.i); centre(+b.dataset.i); });
    }
    function select(i) {
      if (sel === i) return unselect();
      sel = i; const N = d.nodes, n = N[i], up = new Set([i]), walk = j => (L.kids[j] || []).forEach(e => { up.add(e.k); walk(e.k); });
      walk(i);
      pan.classList.add('picking'); pan.querySelectorAll('.lit').forEach(x => x.classList.remove('lit'));
      pan.querySelectorAll('.pc').forEach(x => up.has(+x.dataset.i) && x.classList.add('lit'));
      pan.querySelectorAll('[data-e]').forEach(x => { const [a, b] = x.dataset.e.split('-').map(Number); up.has(a) && up.has(b) && x.classList.add('lit'); });
      const el = pan.querySelector(`.pc[data-i="${i}"]`); el?.classList.add('sel');
      const cr = el?.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      if (cr && (cr.left < sr.left || cr.right > sr.right || cr.top < sr.top || cr.bottom > sr.bottom)) centre(i);  // bring a clipped card into view
      const ins = L.kids[i] || [], rowsIn = ins.reduce((s, e) => s + (e.rows || 0), 0);
      side.innerHTML = `<button class="map-back" id="map-back">← Overview</button>
        <div class="kicker"><i class="mk ${n.cls}"></i>${n.group ? `${unit} ${n.group}` : 'Between stages'}</div>
        <h4>${esc(n.label)}</h4>${n.short ? `<div class="dim">${esc(n.short)}</div>` : ''}
        ${n.warn ? `<div class="map-warn">⚠ ${esc(n.warn)}</div>` : ''}
        ${n.rows != null ? `<div class="map-io">${ins.length ? `<b>${nf(rowsIn)}</b> in <i>→</i> ` : ''}<b>${nf(n.rows)}</b> rows out</div>` : ''}
        ${n.ms != null ? `<div class="dim">${n.ms} ms</div>` : ''}
        ${n.data ? `<button class="primary map-see" id="map-see">See the ${nf(n.data.total)} row${n.data.total === 1 ? '' : 's'} out</button>` : ''}
        <p>${esc(n.why)}</p>
        ${ins.length ? `<div class="lbl">Fed by</div>${ins.map(e => `<button class="map-jump" data-i="${e.k}"><b>${esc(N[e.k].label)}</b><small>${rowsTxt(e.rows)}</small></button>`).join('')}` : ''}
        ${n.detail ? `<details><summary>Raw plan details</summary><pre>${esc(n.detail)}</pre></details>` : ''}`;
      $('#map-back').onclick = unselect;
      if ($('#map-see')) $('#map-see').onclick = () => showRows(i);
      side.querySelectorAll('.map-jump').forEach(b => b.onclick = () => { select(+b.dataset.i); centre(+b.dataset.i); });
    }
    function showRows(c) {  // the actual rows that left step c, as a small table over the map
      $('#map-rows')?.remove();
      const n = d.nodes[c], D = n.data, cell = v => v === null ? '<span class="faint">NULL</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : String(v));
      stage.insertAdjacentHTML('beforeend', `<div class="map-rows" id="map-rows"><div class="map-rows-h">
          <div><b>Rows out of ${esc(n.label)}</b><small>${esc(n.short || '')}</small></div><button class="x" id="map-rows-x" title="Close (Esc)" aria-label="Close">${ic('x', 14)}</button></div>
        ${D ? `<div class="map-rows-t"><table><tr>${D.cols.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
            ${D.rows.map(r => `<tr>${r.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</table></div>
          <div class="faint">${D.total > D.rows.length ? `First ${D.rows.length} of ${nf(D.total)} rows` : `${nf(D.total)} row${D.total === 1 ? '' : 's'}`}${n.cls === 'shuffle' ? ' · same rows as before the shuffle, now grouped by key across partitions' : ''}</div>`
          : duck ? `<p class="dim">DuckDB runs these steps fused together and never hands out the rows between them; it only shows rows for table reads and the final result.
              Spark SQL runs every step on its own, so its map shows the rows at every arrow.</p>
              ${spark ? '<button class="primary" id="map-spark">Open this map on Spark SQL</button>' : '<p class="faint">Install PySpark (open any PySpark problem) to get the Spark SQL engine.</p>'}`
          : `<p class="dim">Spark can't run this step on its own (it's a broadcast), so there are no rows to show.</p>`}</div>`);
      $('#map-rows-x').onclick = () => $('#map-rows').remove();
      if ($('#map-spark')) $('#map-spark').onclick = () => showMap('spark-sql');
    }
    function unselect() { sel = null; pan.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); overview(); }

    const seg = (el, set) => el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); set(b.dataset.v); draw(); };
    seg($('#map-who'), v => who = v); seg($('#map-view'), v => view = v);
    $('#map-in').onclick = () => zoom(1.25); $('#map-out').onclick = () => zoom(.8); $('#map-fit').onclick = fit;
    stage.onwheel = e => { e.preventDefault(); const b = stage.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : .9, e.clientX - b.left, e.clientY - b.top); };
    stage.onpointerdown = e => { if (e.target.closest('.map-ctl, .map-rows')) return; drag = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false }; };
    stage.onpointermove = e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; stage.classList.add('dragging'); }
      if (drag.moved) { t.x = drag.tx + dx; t.y = drag.ty + dy; apply(); } };
    stage.onpointerup = e => { const moved = drag?.moved; drag = null; stage.classList.remove('dragging');
      if (moved || e.target.closest('.map-ctl, .map-rows')) return;
      const pill = e.target.closest('.pe-pill'); if (pill) return showRows(+pill.dataset.c);
      const c = e.target.closest('.pc'); c ? select(+c.dataset.i) : unselect(); };  // empty space clears the selection
    const onKey = e => { if (e.key !== 'Escape') return;
      if ($('#map-rows')) { e.stopImmediatePropagation(); return $('#map-rows').remove(); }
      if (sel !== null) { e.stopImmediatePropagation(); unselect(); } };
    window.addEventListener('keydown', onKey, true);
    onModalClose = () => window.removeEventListener('keydown', onKey, true);
    draw();
  }

  $('#report').onclick = () => {
    react('shy', 4000);
    modal(`<div class="kicker dot">Report a mistake</div><h3 style="margin:6px 0 4px">What's wrong with "${esc(p.title)}"?</h3>
      <p class="dim" style="margin:0 0 12px">Reports are saved with this problem so it can be fixed. Thank you!</p>
      <div class="chips" id="rp-cat">${['Wrong expected output', 'Unclear statement', 'Tests too weak', 'Typo', 'Other'].map((c, i) =>
        `<button class="${i ? '' : 'on'}" data-c="${c}">${c}</button>`).join('')}</div>
      <textarea id="rp-text" class="field" rows="5" placeholder="What did you expect, and what happened instead?"></textarea>
      <label class="check-row"><input type="checkbox" id="rp-code" checked> Attach my current code</label>
      <div class="row-end"><span id="rp-msg" class="dim"></span><button class="primary" id="rp-send">Send report</button></div>`);
    $('#rp-cat').onclick = e => { const b = e.target.closest('button'); if (b) $('#rp-cat').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#rp-text').focus();
    $('#rp-send').onclick = async () => {
      const r = await api('/api/feedback', { kind: 'report', problem: id, category: $('#rp-cat .on').dataset.c, text: $('#rp-text').value,
        name: me(), code: $('#rp-code').checked ? code() : '' });
      if (r.error) return void ($('#rp-msg').textContent = r.error);
      const issue = ghLink(`Problem report: ${p.title} (${$('#rp-cat .on').dataset.c})`,
        `**Problem:** \`${id}\`\n**Category:** ${$('#rp-cat .on').dataset.c}\n\n${$('#rp-text').value}` + ($('#rp-code').checked ? `\n\n<details><summary>My code</summary>\n\n\`\`\`\n${code().slice(0, 3000)}\n\`\`\`\n</details>` : ''),
        'Send it to the DataDojo team on GitHub too →', 'problem-report');
      modal(`<div class="kicker dot">Saved</div><h3>Thanks for the report!</h3><p class="dim">It's saved on this computer and shown on the problem.</p>${issue ? `<p>${issue}</p>` : ''}`);
      react('love', 2500);
      say(`Thanks for flagging that${me() ? ', ' + me().split(' ')[0] : ''}! I've noted it on this problem. 🙏`, 'love', true);
    };
  };

  $('#subs').onclick = async () => {
    const subs = await api(`/api/problems/${id}/submissions`);
    modal(`<h3>Submissions</h3>${subs.map((s, i) => `<div class="sub"><span class="${s.passed ? 'pass' : 'fail'}">${s.passed ? '✓ passed' : '✗ failed'}</span>
      <span class="dim">${esc(s.ts)} UTC</span><span class="tag">${esc(s.engine || 'default')}</span><span class="sp"></span><button data-i="${i}">Load into editor</button></div>`).join('')
      || `<div class="empty">${blob(coach.seed, { size: 64, mood: 'shy' })}<p>No runs yet.</p></div>`}`);
    $('#modal-body').onclick = e => { const b = e.target.closest('button[data-i]'); if (b) { setCode(subs[+b.dataset.i].code); closeModal(); } };
  };
}

// ---------- reviews & reports ----------
// Feedback is stored locally; with a repo in profile.toml it can also be sent as a pre-filled GitHub issue
// (opens in the browser, the learner submits it; no tokens or servers involved).
let REPO = '';
api('/api/profile').then(p => { REPO = (p.repo || '').replace(/\/$/, ''); });
const ghLink = (title, body, label, tag) => REPO ? `<a class="gh-link" target="_blank" rel="noreferrer"
  href="${REPO}/issues/new?title=${encodeURIComponent(title)}&labels=${tag}&body=${encodeURIComponent(body + '\n\n— sent from DataDojo')}">${label}</a>` : '';
const RATE_MOOD = { 1: 'sad', 2: 'unsure', 3: 'idle', 4: 'happy', 5: 'love' };
function reviewCard() {
  return `<div class="card review"><div class="review-blob" id="rv-blob">${blob(CAST.sensei.seed, { size: 84, live: true, mood: 'idle' })}</div>
    <div class="kicker dot">Leave a review</div><h2>Tried DataDojo? Tell us how it went.</h2>
    <p class="dim">Something broken, confusing, or missing? Report it here. Liked using it? Say that here too.</p>
    <label>How would you rate it?</label><div class="rate" id="rv-rate">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div>
    <label for="rv-name">Name (optional)</label><input class="field" id="rv-name" placeholder="Anonymous" value="${esc(me())}">
    <label for="rv-email">Email (optional, only for a reply, never shown)</label><input class="field" id="rv-email" type="email" placeholder="you@example.com">
    <label for="rv-text">Your review</label><textarea class="field" id="rv-text" rows="4" placeholder="What worked, what didn't, what's missing..."></textarea>
    <button class="primary wide" id="rv-send">Send review</button><div id="rv-msg" class="dim" style="margin-top:8px"></div></div>`;
}
function bindReview() {
  let rating = 0;
  const face = $('#rv-blob svg');
  follow(face);
  $('#rv-rate').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    rating = +b.dataset.n;
    $('#rv-rate').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.n === rating));
    setMood(face, RATE_MOOD[rating]);
  };
  $('#rv-send').onclick = async () => {
    const r = await api('/api/feedback', { kind: 'review', rating, name: $('#rv-name').value, email: $('#rv-email').value, text: $('#rv-text').value });
    if (r.error) { $('#rv-msg').textContent = r.error; return setMood(face, 'unsure'); }
    setMood(face, 'love'); confetti($('#rv-send'));
    $('#rv-msg').innerHTML = `Thank you! Your review is saved on this computer. ${ghLink('Review: ' + '★'.repeat(rating) + ' ' + $('#rv-text').value.slice(0, 50),
      `**Rating:** ${rating}/5\n\n${$('#rv-text').value}`, 'Also send it to the DataDojo team on GitHub →', 'review')}`;
    $('#rv-text').value = ''; $('#rv-email').value = '';
  };
}
async function feedbackPage() {
  load();
  const [items, cat] = await Promise.all([api('/api/feedback'), api('/api/catalog')]);
  const title = Object.fromEntries(cat.problems.map(p => [p.id, p.title]));
  const reviews = items.filter(f => f.kind === 'review'), avg = reviews.length ? reviews.reduce((a, f) => a + f.rating, 0) / reviews.length : 0;
  const card = f => `<div class="card fb ${f.resolved ? 'done' : ''}">
    <div class="fb-head">${f.kind === 'review' ? `<span class="stars">${'★'.repeat(f.rating)}<i>${'★'.repeat(5 - f.rating)}</i></span>`
      : `<span class="tag hard">${ic('flag', 11)} ${esc(f.category || 'report')}</span><a href="#/p/${f.problem}"><b>${esc(title[f.problem] || f.problem)}</b></a>`}
      <span class="dim">${esc(f.name || 'Anonymous')} · ${esc(f.ts)} UTC</span><span class="sp"></span>
      <button data-fid="${f.id}">${f.resolved ? 'Reopen' : 'Mark resolved'}</button></div>
    <p>${esc(f.text)}</p>${f.code ? `<details><summary>Attached code</summary><pre>${esc(f.code)}</pre></details>` : ''}</div>`;
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/">← Home</a>
    <div class="list-head">${blob(CAST.sensei.seed, { size: 72, live: true, mood: avg >= 4 ? 'love' : items.length ? 'happy' : 'shy' })}
      <div><div class="kicker">Feedback</div><h1 style="margin:4px 0">Reviews & reports</h1>
      <div class="dim">${reviews.length} review${reviews.length === 1 ? '' : 's'}${reviews.length ? ` · ${avg.toFixed(1)} ★ average` : ''} · ${items.filter(f => f.kind === 'report' && !f.resolved).length} open problem reports</div></div></div>
    <div class="fb-list">${items.map(card).join('') || `<div class="empty">${blob(CAST.sensei.seed, { size: 64, mood: 'shy' })}<p>No feedback yet.</p></div>`}</div></div>`;
  follow($('.list-head svg'));
  $('.fb-list').onclick = async e => { const b = e.target.closest('[data-fid]'); if (b) { await api('/api/feedback/resolve', { fid: +b.dataset.fid }); feedbackPage(); } };
}

// ---------- live demo (Home) ----------
// Scripted, self-playing scenes of the real workflow. Purely presentational: nothing is sent to the server.
const hl = (code, lang) => lang === 'none' ? esc(code) : esc(code)
  .replace(lang === 'sql'
    ? /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|OVER|PARTITION BY|DENSE_RANK|AS|AND|WITH|LIMIT|TOP)\b/g
    : /\b(def|return|for|in|if|else|from|import|and|not)\b/g, '<b class="kw">$1</b>')
  .replace(/(&quot;[^&]*&quot;|'[^']*')/g, '<b class="str">$1</b>');
const DEMOS = [
  { tab: 'SQL', coach: 'sql', path: 'sql/window-ranking/top-earners-per-dept', lang: 'sql',
    code: "SELECT dept, name, salary\nFROM (\n  SELECT *, DENSE_RANK() OVER (\n    PARTITION BY dept ORDER BY salary DESC) AS rk\n  FROM employees)\nWHERE rk <= 2",
    tests: ['ties share a rank', 'two departments', 'empty table'], fail: [], said: 'All 3 pass! DENSE_RANK keeps ties together. Want to try it on PostgreSQL?' },
  { tab: 'Python', coach: 'python', path: 'python/sorting/merge-intervals', lang: 'python',
    code: "def merge(intervals):\n    out = []\n    for s, e in sorted(intervals):\n        if out and s <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], e)\n        else:\n            out.append([s, e])\n    return out",
    tests: ['overlapping', 'touching [1,3] [3,5]', 'contained', 'empty'], fail: [], said: 'Sorted sweep, O(n log n). Clean! Touching intervals merge because of <=.' },
  { tab: 'PySpark', coach: 'pyspark', path: 'pyspark/dedup-scd/dedupe-latest', lang: 'python',
    code: "w = Window.partitionBy(\"id\").orderBy(F.col(\"updated_at\").desc())\nreturn (events\n  .withColumn(\"rn\", F.row_number().over(w))\n  .filter((F.col(\"rn\") == 1) & (F.col(\"op\") != \"D\"))\n  .select(\"id\", \"amount\"))",
    tests: ['latest event wins', 'deletes dropped'], fail: [], spark: true, said: 'Spark agrees: latest state per id, deletes gone. That is CDC in one window!' },
  { tab: 'Coach, everywhere', coach: 'sql', path: 'sql/nulls/customers-without-orders', chat: [
    ['me', 'Why does my NOT IN return nothing?'],
    ['them', 'Look at orders.customer_id: one row is NULL. x NOT IN (…, NULL) is never true. What could you use instead?'],
    ['me', 'NOT EXISTS?'], ['them', 'Exactly! NOT EXISTS ignores that NULL. Run it and see.']] },
  { tab: 'Any engine', coach: 'sql', path: 'sql/basics · SQL Server (T-SQL) → DuckDB', engines: ['DuckDB 2.0', 'PostgreSQL 14', 'SQLite 3.53', 'SQL Server (emulated)'],
    code: 'SELECT TOP 5 name FROM customers ORDER BY spend DESC', translated: 'SELECT name FROM customers ORDER BY spend DESC LIMIT 5' },
];
function demoShell() {
  return `<div class="demo" id="demo"><div class="demo-tabs">${DEMOS.map((d, i) => `<button data-i="${i}">${d.tab}</button>`).join('')}</div>
    <div class="demo-win card"><div class="demo-bar"><i></i><i></i><i></i><span id="demo-path"></span></div><div class="demo-body" id="demo-body"></div></div></div>`;
}
function startDemo(root) {
  let token = {}, i = 0;
  const wait = (ms, t) => new Promise((res, rej) => setTimeout(() => t.stop ? rej(t) : res(), ms));
  const body = () => $('#demo-body', root);
  async function type(el, text, t, lang, speed = 18) {
    for (let k = 1; k <= text.length; k += 2) { el.innerHTML = hl(text.slice(0, k), lang) + '<span class="cur"></span>'; await wait(speed, t); }
    el.innerHTML = hl(text, lang);
  }
  async function scene(d, t) {
    $('#demo-path', root).textContent = d.path + ' · ' + CAST[d.coach].name;
    root.querySelectorAll('.demo-tabs button').forEach((b, k) => b.classList.toggle('on', DEMOS[k] === d));
    const coach = blob(CAST[d.coach].seed, { size: 40, live: true, mood: 'idle' });
    if (d.chat) {
      body().innerHTML = `<div class="demo-chat"></div><div class="demo-coach">${coach}</div>`;
      const face = $('.demo-coach svg', root), box = $('.demo-chat', root);
      for (const [who, text] of d.chat) {
        if (who === 'them') { setMood(face, 'thinking'); await wait(900, t); setMood(face, text.startsWith('Exactly') ? 'love' : 'happy'); }
        box.insertAdjacentHTML('beforeend', `<div class="demo-msg ${who}"></div>`);
        await type(box.lastChild, text, t, 'none', who === 'me' ? 28 : 14);
        await wait(700, t);
      }
      return wait(2200, t);
    }
    body().innerHTML = `<div class="demo-grid"><div><div class="demo-tool">${d.engines ? `<span class="demo-engine" id="demo-eng">${d.engines[0]}</span>` : `<span class="lang-tag ${d.coach}">${LANGS[d.coach]}</span>`}<span class="sp"></span><span class="demo-run">▶ Run</span></div>
      <pre class="demo-code"></pre><div class="demo-out"></div></div><div class="demo-side">${coach}<div class="demo-say"></div></div></div>`;
    const face = $('.demo-side svg', root), out = $('.demo-out', root);
    await type($('.demo-code', root), d.code, t, d.lang || 'sql');
    if (d.engines) {
      for (const e of d.engines.slice(1)) { await wait(650, t); $('#demo-eng', root).textContent = e; }
      setMood(face, 'thinking'); await wait(700, t);
      out.innerHTML = `<div class="dim">SQL as executed (translated to DuckDB)</div><pre class="demo-code small">${hl(d.translated, 'sql')}</pre><div class="pass">✓ 3/3 tests passed</div>`;
      setMood(face, 'happy'); $('.demo-say', root).textContent = 'Same answer key, any dialect. TOP 5 became LIMIT 5.';
      return wait(3000, t);
    }
    $('.demo-run', root).classList.add('go'); setMood(face, 'thinking');
    if (d.spark) { out.innerHTML = '<div class="dim"><span class="spinner"></span>Starting Spark…</div>'; await wait(1300, t); }
    out.innerHTML = '';
    for (const name of d.tests) { await wait(380, t); out.insertAdjacentHTML('beforeend', `<div class="pass demo-test">✓ ${esc(name)}</div>`); }
    $('.demo-run', root).classList.remove('go');
    out.insertAdjacentHTML('beforeend', `<div class="verdict pass">All ${d.tests.length} tests passed</div>${testBar(d.tests.map(() => true))}`);
    setMood(face, 'love'); await wait(400, t);
    await type($('.demo-say', root), d.said, t, 'none', 12);
    return wait(3200, t);
  }
  async function play(start) {
    token.stop = true; const t = token = {};
    for (i = start; ; i = (i + 1) % DEMOS.length) {
      try { await scene(DEMOS[i], t); } catch { return; }
    }
  }
  root.querySelector('.demo-tabs').onclick = e => { const b = e.target.closest('button'); if (b) play(+b.dataset.i); };
  cleanups.push(() => { token.stop = true; });
  play(0);
}

// ---------- data system design ----------
// Mermaid runs in its own hidden iframe: Monaco's global AMD loader on this page breaks Mermaid's bundled deps
// ("only one anonymous define call"), and an isolated document has no such global.
let mmFrame = null, mmSeq = 0;
const mmWait = new Map();
function mermaidFrame() {
  if (mmFrame) return mmFrame;
  mmFrame = new Promise(res => {
    const f = document.createElement('iframe');
    // off-screen but laid out: Mermaid measures text, which a display:none frame reports as zero size
    f.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden';
    f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.srcdoc = `<!doctype html><body><script type="module">
      let mm = null;
      try { mm = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default; } catch {}
      addEventListener('message', async e => {
        const { id, text, cfg } = e.data;
        if (!mm) return parent.postMessage({ id, error: 'mermaid unavailable' }, '*');
        try { mm.initialize(cfg); const { svg } = await mm.render('m' + id, text); parent.postMessage({ id, svg }, '*'); }
        catch (err) { parent.postMessage({ id, error: String(err && err.message || err) }, '*'); }
      });
      parent.postMessage({ ready: true }, '*');
    <\/script></body>`;
    addEventListener('message', e => {
      if (e.source !== f.contentWindow) return;
      if (e.data.ready) return res(f);
      const cb = mmWait.get(e.data.id); if (cb) { mmWait.delete(e.data.id); cb(e.data); }
    });
    document.body.appendChild(f);
  });
  return mmFrame;
}
async function mermaidSvg(text, fontSize = '13px') {
  const f = await mermaidFrame(), id = ++mmSeq;
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const cfg = { startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: v('--body'),
    themeVariables: { background: v('--card'), primaryColor: v('--bg2'), primaryTextColor: v('--text'), primaryBorderColor: v('--acc'),
                      lineColor: v('--dim'), secondaryColor: v('--card'), tertiaryColor: v('--bg2'), clusterBkg: v('--bg2'),
                      clusterBorder: v('--line2'), fontSize } };
  return new Promise(res => { mmWait.set(id, res); f.contentWindow.postMessage({ id, text, cfg }, '*'); setTimeout(() => res({ error: 'timeout' }), 15000); });
}
async function renderDiagrams(root) {
  for (const el of root.querySelectorAll('.mermaid-src')) {
    const r = await mermaidSvg(el.textContent);
    if (el.isConnected) el.outerHTML = r.svg ? `<div class="diagram">${r.svg}</div>` : `<pre class="faint" title="${esc(r.error || '')}">${esc(el.textContent)}</pre>`;
  }
}

async function designHome() {
  load();
  const d = await api('/api/design'), total = d.lessons.length, done = d.lessons.filter(l => l.done).length;
  const groups = [...new Set(d.sections.map(s => s.group))];
  const count = s => { const ls = d.lessons.filter(l => l.section === s.id); return `${ls.filter(l => l.done).length}/${ls.length}`; };
  $('#app').innerHTML = `<div class="ds-home enter">
    <aside class="ds-side"><div class="kicker">Sections</div>
      ${groups.map(g => `<div class="ds-side-g">${esc(g)}</div>` + d.sections.filter(s => s.group === g).map(s =>
        `<button data-sec="${s.id}"><span>${esc(s.title)}</span><small>${count(s)}</small></button>`).join('')).join('')}</aside>
    <div class="page"><a class="back" href="#/">← Home</a>
    <div class="list-head">${blob(CAST.sensei.seed, { size: 72, live: true, mood: done ? 'happy' : 'idle' })}
      <div><div class="kicker" style="color:var(--acc2)">Industry level</div><h1 style="margin:4px 0">System Design</h1>
      <div class="dim">Data systems and production AI, from first principles to fully worked case studies: clarify, estimate, design, then defend the trade-offs, the way strong candidates do.</div></div></div>
    <div class="dim" style="display:flex;margin-top:22px;font-size:12px"><span>${done} of ${total} completed</span><span class="sp"></span><span>${total ? Math.round(100 * done / total) : 0}%</span></div>
    <div class="bar"><i style="width:${total ? 100 * done / total : 0}%"></i></div>
    ${total ? '' : `<div class="empty">${blob(CAST.sensei.seed, { size: 64, mood: 'thinking' })}<p>Lessons are being written. Check back soon!</p></div>`}
    ${groups.map(g => `<div class="section-title">${esc(g)}</div>` + d.sections.filter(s => s.group === g).map(s => {
      const ls = d.lessons.filter(l => l.section === s.id);
      return `<div class="ds-section" id="sec-${s.id}"><div class="ds-sec-head"><h3>${esc(s.title)}</h3><span class="dim">${esc(s.desc)}</span><span class="sp"></span>
        <span class="faint">${ls.filter(l => l.done).length}/${ls.length}</span></div>
        <div class="grid">${ls.map(l => `<a class="card tile ds-tile" href="#/design/${l.id}"><span class="check ${l.done ? 'done' : ''}">${l.done ? '✓' : ''}</span>
          <div class="t"><h4>${esc(l.title)}</h4><p>${esc(l.big_idea)}</p>
          <div class="ds-tags"><span class="tag ${l.kind === 'case_study' ? 'medium' : ''}">${l.kind === 'case_study' ? 'Case study' : 'Lesson'}</span>
          ${l.difficulty ? diffTag(l.difficulty) : ''}${(l.companies || []).slice(0, 2).map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div></div></a>`).join('')}</div></div>`;
    }).join('')).join('')}</div></div>`;
  follow($('.list-head svg'));
  // left rail: jump to a section, and highlight the one you're reading
  const mark = id => document.querySelectorAll('.ds-side [data-sec]').forEach(b => b.classList.toggle('on', b.dataset.sec === id));
  let jumping = 0;  // a clicked section stays highlighted while we scroll to it (the last ones can't reach the top)
  $('.ds-side').onclick = e => { const b = e.target.closest('[data-sec]'); if (!b) return;
    mark(b.dataset.sec); jumping = Date.now() + 1000; $('#sec-' + b.dataset.sec).scrollIntoView({ behavior: 'smooth' }); };
  const spy = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && Date.now() > jumping && mark(e.target.id.slice(4))),
    { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.ds-section').forEach(el => spy.observe(el));
  cleanups.push(() => spy.disconnect());
}

async function designLesson(id) {
  load();
  const d = await api('/api/design/' + id);
  if (d.error) return $('#app').innerHTML = '<div class="empty">Lesson not found</div>';
  const list = items => `<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`;
  const key = 'dchat:' + id;
  let messages = JSON.parse(localStorage.getItem(key) || '[]'), quizRight = 0, quizDone = 0;
  $('#app').innerHTML = `<div class="ds-wrap enter">
    <article class="ds-article">
      <a class="back" href="#/design">← System Design</a>
      <div class="kicker" style="margin-top:14px;color:var(--acc2)">${d.kind === 'case_study' ? 'Case study' : 'Lesson'}</div>
      <h1>${esc(d.title)}</h1>
      <div class="ds-tags">${d.difficulty ? diffTag(d.difficulty) : ''}${(d.companies || []).map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div>
      <div class="big-idea"><b>The big idea</b><p>${inline(d.big_idea)}</p></div>
      ${md(d.summary)}
      ${d.diagram ? `<h3>Architecture</h3><div class="mermaid-src">${esc(d.diagram)}</div>` : ''}
      ${(d.blocks || []).map(b => `<h3>${esc(b.heading)}</h3>${md(b.body)}`).join('')}
      ${d.key_points?.length ? `<div class="callout ok"><b>Key points</b>${list(d.key_points)}</div>` : ''}
      ${d.common_mistakes?.length ? `<div class="callout warn"><b>Common mistakes</b>${list(d.common_mistakes)}</div>` : ''}
      ${d.interview_questions?.length ? `<h3>Interview follow-ups</h3>${d.interview_questions.map(q => `<details><summary>${inline(q)}</summary>
        <button class="ghost ask-q" data-q="${esc(q)}">Ask Sensei to quiz me on this →</button></details>`).join('')}` : ''}
      <h3>Check yourself</h3><div id="quiz">${d.quiz.map((q, i) => `<div class="card qz" data-i="${i}"><b>${i + 1}. ${inline(q.q)}</b>
        <div class="qz-opts">${q.options.map((o, k) => `<button data-k="${k}">${inline(o)}</button>`).join('')}</div><div class="qz-why"></div></div>`).join('')}</div>
      <div class="ds-foot"><button class="primary" id="ds-done">${d.done ? '✓ Completed' : 'Mark as complete'}</button><span class="sp"></span>
        ${d.prev ? `<a href="#/design/${d.prev}"><button>← Previous</button></a>` : ''}${d.next ? `<a href="#/design/${d.next}"><button>Next →</button></a>` : ''}</div>
    </article>
    <aside class="ds-coach card">
      <div class="coach-head"><div id="coach">${blob(CAST.sensei.seed, { size: 52, live: true })}</div><div><b>Sensei</b><div class="dim" style="font-size:11.5px">sees what you see</div></div>
        <span class="sp"></span><button class="ghost new-chat" id="new-chat" title="Clear this chat and start fresh">↺ New chat</button>
        <span class="status" id="status"><i></i>listening</span></div>
      <div class="chat" id="chat"></div>
      <div class="chips ds-suggest">${['Explain the diagram', 'A real-world example?', 'Quiz me', 'What would an interviewer push on?'].map(s => `<button>${s}</button>`).join('')}</div>
      <div class="chat-in"><textarea id="say" placeholder="Ask about this ${d.kind === 'case_study' ? 'case study' : 'lesson'}…"></textarea>
        <div class="row"><button class="primary" id="send">Send</button><span class="sp"></span><a class="faint" style="font-size:11px" href="#/setup">coach setup</a></div></div>
    </aside></div>`;
  renderDiagrams($('#app'));
  const face = $('#coach svg'), gz = follow(face);
  const bubble = m => m.role === 'assistant'
    ? `<div class="line them">${blob(CAST.sensei.seed, { size: 28, mood: m.mood || 'idle' })}<div class="msg assistant">${md(m.content)}</div></div>`
    : `<div class="line me"><div class="msg user">${esc(m.content)}</div>${blob(me() || 'you', { size: 28, mood: 'happy' })}</div>`;
  const render = () => { $('#chat').innerHTML = (messages.length ? messages : [{ role: 'assistant', mood: 'happy',
    content: `Hi${me() ? ' ' + me().split(' ')[0] : ''}! I've read "${d.title}" with you. Ask me anything about it, or tap a suggestion below.` }]).map(bubble).join(''); $('#chat').scrollTop = 1e9; };
  render();
  const send = async text => {
    if (!text.trim()) return;
    messages.push({ role: 'user', content: text }); render(); $('#say').value = '';
    $('#chat').insertAdjacentHTML('beforeend', `<div class="line them">${blob(CAST.sensei.seed, { size: 28, mood: 'thinking' })}<div class="msg assistant"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
    $('#chat').scrollTop = 1e9; setMood(face, 'thinking'); $('#status').lastChild.textContent = 'thinking…';
    const r = await api('/api/coach', { lesson: id, messages: messages.map(({ role, content }) => ({ role, content })) });
    messages.push({ role: 'assistant', content: r.reply || r.error, mood: 'happy' });
    localStorage.setItem(key, JSON.stringify(messages.slice(-40)));
    setMood(face, 'happy'); $('#status').lastChild.textContent = 'listening'; render();
  };
  $('#send').onclick = () => send($('#say').value);
  $('#new-chat').onclick = async () => {
    if (!await ask('Clear your chat with Sensei on this lesson and start fresh?', { ok: 'Start new chat', seed: CAST.sensei.seed })) return;
    messages = []; localStorage.removeItem(key); render();  // render() shows the greeting again
  };
  $('#say').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#say').value); } };
  $('#say').onfocus = () => gz && gz.lookAt($('#say')); $('#say').onblur = () => gz && gz.lookAt('pointer');
  $('.ds-suggest').onclick = e => { const b = e.target.closest('button'); if (b) send(b.textContent); };
  $('.ds-article').onclick = e => { const b = e.target.closest('.ask-q'); if (b) send(`Quiz me on this interview question: ${b.dataset.q}`); };
  $('#quiz').onclick = e => {
    const b = e.target.closest('.qz-opts button'); if (!b) return;
    const card = b.closest('.qz'), q = d.quiz[+card.dataset.i];
    if (card.classList.contains('answered')) return;
    card.classList.add('answered'); quizDone++;
    const right = +b.dataset.k === q.answer; if (right) quizRight++;
    card.querySelectorAll('.qz-opts button').forEach((x, k) => x.classList.add(k === q.answer ? 'right' : x === b ? 'wrong' : 'off'));
    card.querySelector('.qz-why').innerHTML = `<span class="${right ? 'pass' : 'fail'}">${right ? '✓ Correct.' : '✗ Not quite.'}</span> ${inline(q.why || '')}`;
    setMood(face, right ? 'happy' : 'unsure');
    if (quizDone === d.quiz.length) {
      const all = quizRight === d.quiz.length;
      setMood(face, all ? 'love' : 'happy'); if (all) confetti(card);
      messages.push({ role: 'assistant', mood: all ? 'love' : 'happy', content: all ? `Perfect ${quizRight}/${d.quiz.length}! Mark it complete and move on, or ask me to go deeper.`
        : `You got ${quizRight}/${d.quiz.length}. Want me to explain the ones you missed?` });
      render();
    }
  };
  $('#ds-done').onclick = async () => {
    await api('/api/design/done', { lesson: id }); d.done = !d.done;
    $('#ds-done').textContent = d.done ? '✓ Completed' : 'Mark as complete';
    if (d.done) { setMood(face, 'love'); confetti($('#ds-done')); }
    load();
  };
}

// ---------- brain games ----------
const GAME_COACH = { 'guess-output': 'sql', 'join-size': 'sensei', 'spot-bug': 'pyspark', 'big-o': 'python' };
async function gamesHome() {
  load();
  const games = await api('/api/games');
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/">← Home</a>
    <div class="list-head">${blob(CAST.sensei.seed, { size: 72, live: true, mood: 'happy' })}
      <div><div class="kicker" style="color:var(--acc2)">Take a break</div><h1 style="margin:4px 0">Brain Games</h1>
      <div class="dim">Sixty-second sprints that train the instincts behind SQL, joins, code review and complexity. Every score is tracked so you can chase your best.</div></div></div>
    <div class="grid two games">${games.map((g, i) => `<a class="card game-card" href="#/games/${g.id}">
      <div class="gc-top"><span class="gc-n">0${i + 1}</span>${blob(CAST[GAME_COACH[g.id]].seed, { size: 54, mood: g.best ? 'happy' : 'idle' })}</div>
      <div class="kicker">${esc(g.skill)}</div><h3>${esc(g.title)}</h3><p class="dim">${esc(g.desc)}</p>
      <div class="gc-foot"><span>${g.best != null ? `Best <b>${g.best}</b>` : 'Not played yet'}</span><span class="faint">${g.plays} play${g.plays === 1 ? '' : 's'}</span><span class="sp"></span><button class="primary">Play</button></div></a>`).join('')}</div></div>`;
}

async function gamePlay(gid) {
  load();
  const games = await api('/api/games'), g = games.find(x => x.id === gid);
  if (!g) return $('#app').innerHTML = '<div class="empty">Game not found</div>';
  const coachSeed = CAST[GAME_COACH[gid]].seed;
  let rounds = await api(`/api/games/${gid}/rounds`), i = 0, score = 0, combo = 0, left = 60, over = false, locked = false, misses = [];
  if (!rounds.length) return $('#app').innerHTML = `<div class="empty">${blob(coachSeed, { size: 64, mood: 'thinking' })}<p>Rounds for this game are still being written.</p></div>`;
  $('#app').innerHTML = `<div class="page enter game"><div class="game-head"><a class="back" href="#/games">← Games</a><h2>${esc(g.title)}</h2><span class="sp"></span>
      <span class="g-stat">Score <b id="g-score">0</b></span><span class="g-stat" id="g-combo"></span><span class="g-stat">${ic('timer', 13)} <b id="g-time">60</b>s</span></div>
    <div class="g-timer"><i id="g-bar"></i></div>
    <div class="game-body"><div class="card g-card" id="g-card"></div><div class="g-coach" id="g-coach">${blob(coachSeed, { size: 88, live: true })}<div class="g-say" id="g-say">Ready? Go!</div></div></div></div>`;
  const face = $('#g-coach svg'); follow(face);
  const tick = setInterval(() => {
    if (over) return;
    left = Math.max(0, left - .1);
    $('#g-time').textContent = Math.ceil(left); $('#g-bar').style.width = `${left / 60 * 100}%`;
    $('#g-bar').classList.toggle('low', left < 10);
    if (left <= 0) finish();
  }, 100);
  cleanups.push(() => { clearInterval(tick); over = true; });  // leaving the page ends the game; pending rounds stop
  const opts = (list, ans) => `<div class="g-opts">${list.map((o, k) => `<button data-k="${k}"><kbd>${k + 1}</kbd>${esc(o)}</button>`).join('')}</div>`;
  const kv = v => v === null ? '<i>NULL</i>' : esc(v);
  function show() {
    if (i >= rounds.length) i = 0;
    const r = rounds[i];
    let html = '';
    if (gid === 'guess-output') html = `<div class="kicker">What does this return?</div>${table(r.table.columns, r.table.rows)}<pre class="demo-code small">${hl(r.query, 'sql')}</pre>${opts(r.options)}`;
    if (gid === 'join-size') html = `<div class="kicker">How many rows?</div><div class="j-tables">
        <table class="data"><tr><th>a.k</th></tr>${r.a.map(x => `<tr><td>${kv(x)}</td></tr>`).join('')}</table>
        <div class="j-op">SELECT * FROM a<br><b>${r.join}</b> b USING (k)</div>
        <table class="data"><tr><th>b.k</th></tr>${r.b.map(x => `<tr><td>${kv(x)}</td></tr>`).join('')}</table></div>${opts(r.options)}`;
    if (gid === 'spot-bug') html = `<div class="kicker">${langTag(r.lang)} Click the buggy line</div><p class="g-goal">${inline(r.goal)}</p>
        <div class="g-lines">${r.code.split('\n').map((l, k) => `<button data-k="${k + 1}"><span>${k + 1}</span><code>${hl(l, r.lang === 'sql' ? 'sql' : 'python')}</code></button>`).join('')}</div>`;
    if (gid === 'big-o') html = `<div class="kicker">${langTag(r.lang)} What's the time complexity?</div><pre class="demo-code small">${hl(r.code, r.lang === 'sql' ? 'sql' : 'python')}</pre>
        ${opts(['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)', 'O(2ⁿ)'])}`;
    $('#g-card').innerHTML = html + '<div class="g-why" id="g-why"></div>';
    $('#g-card').classList.remove('flash-ok', 'flash-bad'); void $('#g-card').offsetWidth; $('#g-card').classList.add('in');
    locked = false;
  }
  function answer(k) {
    if (locked || over) return;
    locked = true;
    const r = rounds[i];
    const right = gid === 'spot-bug' ? k === r.bug_line : gid === 'big-o' ? ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)', 'O(2ⁿ)'][k] === r.answer : k === r.answer;
    const correctKey = gid === 'spot-bug' ? r.bug_line : gid === 'big-o' ? ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)', 'O(n²)', 'O(2ⁿ)'].indexOf(r.answer) : r.answer;
    $('#g-card').querySelectorAll('[data-k]').forEach(b => b.classList.add(+b.dataset.k === correctKey ? 'right' : +b.dataset.k === k ? 'wrong' : 'off'));
    if (right) { combo = Math.min(combo + 1, 5); score += 10 * combo; setMood(face, combo >= 3 ? 'love' : 'happy'); $('#g-say').textContent = combo >= 3 ? `Combo ×${combo}! 🔥` : ['Nice!', 'Yes!', 'Sharp!', 'Correct!'][score % 4]; }
    else { combo = 0; left = Math.max(0, left - 3); setMood(face, 'surprised'); $('#g-say').textContent = 'Oops! −3s'; misses.push(r); }
    $('#g-card').classList.add(right ? 'flash-ok' : 'flash-bad');
    $('#g-score').textContent = score; $('#g-combo').innerHTML = combo > 1 ? `Combo <b>×${combo}</b>` : '';
    $('#g-why').innerHTML = `<span class="${right ? 'pass' : 'fail'}">${right ? '✓' : '✗'}</span> ${inline(r.why || '')}${gid === 'spot-bug' ? `<div class="faint">Fix: <code>${esc(r.fix)}</code></div>` : ''}`;
    setTimeout(() => { if (!over) { i++; show(); setMood(face, 'idle'); } }, right ? 1100 : 2600);
  }
  async function finish() {
    if (over) return; over = true;
    const res = await api('/api/games/score', { game: gid, score });
    setMood(face, res.new_best && score ? 'love' : score ? 'happy' : 'sad');
    $('#g-card').innerHTML = `<div class="g-end"><div class="kicker">Time!</div><h2>${score} points</h2>
      <p class="dim">${res.new_best && score ? '🏆 New personal best!' : `Best: ${res.best}`}</p>
      <div class="row-end" style="justify-content:center"><button class="primary" id="g-again">Play again</button><a href="#/games"><button>All games</button></a></div>
      ${misses.length ? `<h3>Review your misses</h3>${misses.slice(0, 6).map(r => `<div class="callout warn">${inline(r.why || '')}${r.fix ? `<div>Fix: <code>${esc(r.fix)}</code></div>` : ''}</div>`).join('')}` : ''}</div>`;
    $('#g-say').textContent = res.new_best && score ? 'New best! I knew you had it!' : 'Good run! Again?';
    if (res.new_best && score) confetti($('#g-card'));
    $('#g-again').onclick = () => route();
    load();
  }
  $('#g-card').onclick = e => { const b = e.target.closest('[data-k]'); if (b) answer(+b.dataset.k); };
  const keys = e => { if (/^[1-9]$/.test(e.key)) { const b = $(`#g-card [data-k="${gid === 'spot-bug' ? e.key : e.key - 1}"]`); if (b) b.click(); } };
  document.addEventListener('keydown', keys); cleanups.push(() => document.removeEventListener('keydown', keys));
  show();
}

// ---------- first-run setup ("sign in" for the coaches' brain) ----------
const coachLabel = s => s.provider === 'ollama' ? `Local · ${s.model}` : `${({ anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' })[s.provider]} · ${s.model}`;
async function setupPage() {
  let st = await api('/api/setup'), step = 0, path = null, provider = 'anthropic', localModel = st.settings.provider === 'ollama' ? st.settings.model : 'gemma2:9b';
  const P = st.providers, steps = ['Welcome', 'Coach brain', 'Connect', 'Ready'];
  let poll = null; cleanups.push(() => clearInterval(poll));
  const shell = body => `<div class="setup"><div class="setup-card card">
      <div class="setup-steps">${steps.map((s, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}"><i>${i < step ? '✓' : i + 1}</i>${s}</span>`).join('')}</div>
      ${body}</div><div class="setup-foot">${step < 3 ? '<button class="ghost" id="su-skip">Skip for now</button> · ' : ''}You can change this anytime from your profile.</div></div>`;
  const render = () => {
    clearInterval(poll);
    if (step === 0) {
      $('#app').innerHTML = shell(`<div class="name-stage su-stage"><div class="name-glow"></div><div id="nm-blob">${blob(me() || 'dojo-guest', { size: 124, live: true, mood: me() ? 'happy' : 'shy' })}</div></div>
        <div class="kicker dot">Welcome to DataDojo</div><h2>Let's get you set up</h2>
        <p class="dim">Two quick steps: tell your coaches your name, then choose what powers them. Everything stays on this computer.</p>
        <input class="field big" id="nm-in" maxlength="40" placeholder="Your name…" value="${esc(me())}" autocomplete="off">
        <div class="name-cast">${['sensei', 'sql', 'python', 'pyspark'].map(l => `<span title="${CAST[l].name}">${blob(CAST[l].seed, { size: 34 })}</span>`).join('')}<small>Sensei, Duck, Pip and Sparky are ready.</small></div>
        <button class="primary wide" id="su-next">Continue →</button>`);
      let face = $('#nm-blob svg'), t; follow(face);
      $('#nm-in').focus();
      $('#nm-in').oninput = () => { clearTimeout(t); t = setTimeout(() => { const v = $('#nm-in').value.trim();
        $('#nm-blob').innerHTML = blob(v || 'dojo-guest', { size: 124, live: true, mood: v ? 'happy' : 'shy' }); face = $('#nm-blob svg'); face.classList.add('reseed'); follow(face); }, 120); };
      const next = () => { localStorage.setItem('displayName', $('#nm-in').value.trim().slice(0, 40)); renderMe(); step = 1; render(); };
      $('#su-next').onclick = next; $('#nm-in').onkeydown = e => { if (e.key === 'Enter') next(); };
    }
    if (step === 1) {
      $('#app').innerHTML = shell(`<div class="kicker dot">One-time setup</div><h2>What should power your coaches?</h2>
        <p class="dim">Your coaches give hints, review code and quiz you. Pick the brain behind them. You can switch later.</p>
        <div class="su-paths">
          <button class="su-path" data-p="api">${blob(CAST.sensei.seed, { size: 54, mood: 'love' })}<b>Use my API key</b><span class="tag easy">Sharpest</span>
            <small>Claude, OpenAI or Gemini. Your key is saved only on this computer and sent only to that provider.</small></button>
          <button class="su-path" data-p="local">${blob(CAST.python.seed, { size: 54, mood: 'happy' })}<b>Run locally with Ollama</b><span class="tag">Free · private</span>
            <small>Runs the open Gemma model on your own machine. No account, nothing leaves your laptop.</small></button>
        </div>`);
      document.querySelectorAll('.su-path').forEach(b => b.onclick = () => { path = b.dataset.p; step = 2; render(); });
    }
    const SSO = {
      anthropic: { btn: 'Sign in with your Anthropic account', note: 'Opens your browser, no key to copy. Usage is billed to your Anthropic Console account.',
        tool: "Sign-in uses Anthropic's <code>ant</code> command-line tool. Install it, then click again:",
        install: '<code>brew install anthropics/tap/ant</code> (Mac) · other systems: <a href="https://github.com/anthropics/anthropic-cli/releases" target="_blank" rel="noreferrer">download a release</a>' },
      openai: { btn: 'Sign in with ChatGPT', note: 'Opens your browser. Coaching then uses your personal ChatGPT plan (Plus or Pro) instead of API billing. OpenAI doesn\'t allow this for Enterprise or Team workspaces yet; use an API key there.' },
      gemini: { btn: 'Sign in with Google', note: 'Runs Gemini on Google Cloud (Vertex AI), billed to your Google Cloud project. Needs the gcloud tool and the Vertex AI API turned on in that project.',
        tool: "Sign-in uses Google's <code>gcloud</code> command-line tool. Install it, then click again:",
        install: '<a href="https://cloud.google.com/sdk/docs/install" target="_blank" rel="noreferrer">Install the Google Cloud CLI</a>' },
    };
    if (step === 2 && path === 'api') {
      const p = P[provider];
      $('#app').innerHTML = shell(`<div class="kicker dot">Connect your account</div><h2>Connect ${esc(p.title)}</h2>
        <div class="chips su-prov">${Object.entries(P).map(([id, v]) => `<button data-v="${id}" class="${id === provider ? 'on' : ''}">${esc(v.title)}${id === 'anthropic' ? ' · recommended' : ''}</button>`).join('')}</div>
        <div class="su-signin">
          ${provider === 'gemini' ? `<input class="field" id="su-proj" placeholder="Your Google Cloud project ID (optional if gcloud has one set)" value="${esc(st.settings.gcp_project || '')}" spellcheck="false">` : ''}
          <button class="primary" id="su-sso">${SSO[provider].btn}</button>
          <div class="faint" id="su-sso-msg">${st.settings.provider === provider && st.settings.auth === 'signin' ? '✓ Signed in. ' : ''}${SSO[provider].note}</div></div>
        <div class="su-or"><span>or paste an API key</span></div>
        <ol class="su-how"><li>Open <a href="${p.key_url}" target="_blank" rel="noreferrer">${esc(new URL(p.key_url).hostname)}</a> and sign in.</li>
          <li>Create a new API key and copy it.</li><li>Paste it below. It's stored in your DataDojo folder (readable only by you) and never shown again.</li></ol>
        <label>API key</label><div class="su-key"><input class="field" id="su-key" type="password" placeholder="${esc(p.key_hint)}" autocomplete="off" spellcheck="false">
          <button class="ghost" id="su-eye" title="Show / hide" aria-label="Show or hide the key">${ic('eye', 16)}</button></div>
        ${st.settings.provider === provider && st.settings.key_hint ? `<div class="faint" style="margin-top:6px">Saved key: ${esc(st.settings.key_hint)}. Leave empty to keep it.</div>` : ''}
        <label>Model</label><select id="su-model" class="field">${p.models.map((m, i) => `<option ${st.settings.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <div class="faint" id="su-models-note" style="margin-top:6px"></div>
        ${provider === 'anthropic' ? '<div class="faint" style="margin-top:6px">Opus is the sharpest; Sonnet and Haiku are faster and cheaper. Claude requests use automatic safety fallbacks.</div>' : ''}
        <div class="su-msg" id="su-msg"></div>
        <div class="row-end"><button class="ghost" id="su-back">← Back</button><button class="primary" id="su-save">Test & continue</button></div>`);
      document.querySelectorAll('.su-prov button').forEach(b => b.onclick = () => { provider = b.dataset.v; render(); });
      const loadModels = async () => {  // live list from the provider: new models appear, retired ones vanish
        const r = await api('/api/setup/models', { provider, api_key: $('#su-key').value.trim() });
        if (!r.models?.length || !$('#su-model')) return;
        const cur = $('#su-model').value;
        const ms = [...r.models, ...(st.settings.provider === provider && !r.models.includes(st.settings.model) && r.live === undefined ? [st.settings.model] : [])];
        $('#su-model').innerHTML = ms.map(m => `<option ${m === cur || m === st.settings.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
        $('#su-models-note').textContent = r.live ? `All ${r.models.length} chat models available to you, newest first.`
          : `${r.models.length} current models, updated daily. Sign in or paste a key to see exactly what your account can use.`;
      };
      let typing; $('#su-key').oninput = () => { clearTimeout(typing); typing = setTimeout(loadModels, 500); };  // list updates as soon as a key is pasted
      loadModels();
      $('#su-sso').onclick = async () => {  // browser sign-in instead of a key
        const msg = t => $('#su-sso-msg') && ($('#su-sso-msg').innerHTML = t), how = SSO[provider];
        let a = await api('/api/setup/signin', { provider, project: $('#su-proj')?.value.trim() || null });
        if (a.error) return msg(`<span class="fail">✗ ${esc(a.error)}</span>`);
        if (a.installed === false && a.can_install) {  // Claude: offer to install Anthropic's ant tool with Homebrew, then sign in
          if (!await ask("Signing in with Claude uses Anthropic's free `ant` tool, which isn't installed yet. Install it now with Homebrew? It takes about a minute, then your browser opens to sign in.",
            { ok: 'Install and sign in', seed: CAST.sensei.seed, mood: 'happy' })) return msg(`${how.tool}<br>${how.install}`);
          a = await api('/api/setup/signin', { provider, install: true });
        }
        if (a.installed === false && a.status !== 'running') return msg(`${how.tool}<br>${how.install}`);
        $('#su-sso').disabled = true;
        // stop waiting after 3 minutes or on Cancel: a provider that blocks the sign-in never sends the browser back here
        let cancelled = false, until = Date.now() + 180000;
        const waiting = t => { msg(`<span class="su-wait"><span><span class="spinner"></span>${t}${a.url ? ` <a href="${esc(a.url)}" target="_blank" rel="noreferrer">Open it again</a>` : ''}</span>
            <button class="su-cancel" id="su-cancel">Cancel</button></span>`);
          $('#su-cancel').onclick = () => { cancelled = true; $('#su-cancel').disabled = true; $('#su-cancel').textContent = 'Cancelling…'; }; };
        waiting('Finish signing in in the browser window that just opened…');
        do {
          await new Promise(r => setTimeout(r, 1500)); a = (await api('/api/setup')).signin[provider];
          if (a.step === 'installing') waiting('Installing Anthropic\'s ant tool with Homebrew…'), until = Date.now() + 180000;
        } while (a.status === 'running' && !cancelled && Date.now() < until && $('#su-sso'));
        if (!$('#su-sso')) return;
        $('#su-sso').disabled = false;
        if (a.status === 'running') return msg(`<span class="fail">✗ Stopped waiting for the sign-in.</span> If the provider showed an error page,
          your account may not allow this sign-in (for ChatGPT: Enterprise and Team workspaces). You can paste an API key below instead.`);
        if (a.status !== 'done') return msg(`<span class="fail">✗ ${esc(a.error || 'Sign-in did not finish.').replace(/https:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`)}</span>`);
        msg('✓ Signed in. Loading your models…'); await loadModels();
        const r = await api('/api/setup/save', { provider, model: $('#su-model').value, signin: true });
        if (r.error) return msg(`<span class="fail">✗ ${esc(r.error)}</span>`);
        st.settings = r.settings; step = 3; render();
      };
      $('#su-eye').onclick = () => { $('#su-key').type = $('#su-key').type === 'password' ? 'text' : 'password'; };
      $('#su-back').onclick = () => { step = 1; render(); };
      $('#su-save').onclick = async () => {
        const key = $('#su-key').value.trim(), keep = !key && st.settings.provider === provider && st.settings.key_hint;
        if (!key && !keep && $('#su-proj')?.value.trim()) return $('#su-sso').click();  // a project ID typed in means: sign in with Google
        if (!key && !keep) return void ($('#su-msg').innerHTML = '<span class="fail">Paste your API key, or use the sign-in button above.</span>');
        $('#su-save').disabled = true; $('#su-save').innerHTML = '<span class="spinner"></span>Checking your key…';
        const r = await api('/api/setup/save', { provider, model: $('#su-model').value, api_key: keep ? null : key });
        $('#su-save').disabled = false; $('#su-save').textContent = 'Test & continue';
        if (r.error) return void ($('#su-msg').innerHTML = `<span class="fail">✗ ${esc(r.error)}</span>`);
        st.settings = r.settings; step = 3; render();
      };
    }
    if (step === 2 && path === 'local') {
      const o = st.ollama, has = o.models.includes(localModel), pullState = o.pulls[localModel];
      const pct = pullState && pullState.total ? Math.round(100 * pullState.completed / pullState.total) : 0;
      const item = (ok, title, body) => `<li class="${ok ? 'ok' : ''}"><i>${ok ? '✓' : ''}</i><div><b>${title}</b>${ok ? '' : `<div class="dim">${body}</div>`}</div></li>`;
      $('#app').innerHTML = shell(`<div class="kicker dot">Run locally</div><h2>Choose your coach's model</h2>
        <p class="dim">Bigger models give sharper feedback but need more disk space and RAM. You can change this later by re-running setup.</p>
        <div class="su-models">${st.local_models.map(m => `<button class="su-model ${m.id === localModel ? 'on' : ''}" data-m="${m.id}">
          <div><b>${m.title}</b> <code>${m.id}</code>${o.models.includes(m.id) ? '<span class="tag easy">Downloaded</span>' : m.recommended ? '<span class="tag medium">Recommended</span>' : ''}</div>
          <small class="faint">${m.size}</small><small>${m.desc}</small></button>`).join('')}</div>
        <ol class="su-check">
          ${item(o.installed, 'Install Ollama', `Download it from <a href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download</a> (on a Mac you can also run <code>brew install ollama</code>).`)}
          ${item(o.running, 'Start Ollama', 'Open the Ollama app, or run <code>ollama serve</code> in a terminal. Leave it running.')}
          ${item(has, `Download ${localModel}`, pullState && pullState.status !== 'error' && pullState.status !== 'success'
            ? `<div class="su-bar"><i style="width:${pct}%"></i></div>${esc(pullState.status)} ${pct ? pct + '%' : ''}`
            : `${pullState?.status === 'error' ? `<span class="fail">${esc(pullState.error)}</span><br>` : ''}<button id="su-pull" ${o.running ? '' : 'disabled'}>Download now</button> or run <code>ollama pull ${localModel}</code>`)}
        </ol>
        <div class="su-msg" id="su-msg"></div>
        <div class="row-end"><button class="ghost" id="su-back">← Back</button><button class="ghost" id="su-recheck">Check again</button>
          <button class="primary" id="su-save" ${o.running && has ? '' : 'disabled'}>Use ${localModel} →</button></div>`);
      document.querySelectorAll('.su-model').forEach(b => b.onclick = () => { localModel = b.dataset.m; render(); });
      $('#su-back').onclick = () => { step = 1; render(); };
      const refresh = async () => {
        const next = await api('/api/setup');
        if (JSON.stringify(next) === JSON.stringify(st)) return;  // unchanged: don't redraw (and replay animations)
        st = next; if (step === 2 && path === 'local') render();
      };
      $('#su-recheck').onclick = refresh;
      if ($('#su-pull')) $('#su-pull').onclick = async () => { await api('/api/setup/pull', { model: localModel }); refresh(); };
      if (!(o.running && has)) poll = setInterval(refresh, 2500);
      $('#su-save').onclick = async () => {
        const r = await api('/api/setup/save', { provider: 'ollama', model: localModel });
        if (r.error) return void ($('#su-msg').innerHTML = `<span class="fail">✗ ${esc(r.error)}</span>`);
        st.settings = r.settings; step = 3; render();
      };
    }
    if (step === 3) {
      $('#app').innerHTML = shell(`<div class="name-stage su-stage"><div class="name-glow"></div><div id="nm-blob">${blob(CAST.sensei.seed, { size: 124, live: true, mood: 'love' })}</div></div>
        <div class="kicker dot">All set</div><h2>You're ready${me() ? ', ' + esc(me().split(' ')[0]) : ''}!</h2>
        <p class="dim">Your coaches are connected to <b>${esc(coachLabel(st.settings))}</b>. Pick any pattern and start a session; they'll be right there in the chat.</p>
        <button class="primary wide" id="su-go">Start practicing →</button>`);
      follow($('#nm-blob svg')); confetti($('.setup-card h2'));
      setupKnown = true; $('#su-go').onclick = () => { location.hash = '#/'; };
    }
    const skip = $('#su-skip');
    if (skip) skip.onclick = async () => { await api('/api/setup/skip', {}); setupKnown = true; location.hash = '#/'; };
  };
  render();
}

// ---------- interview ----------
const LEVEL_INFO = { entry: ['Entry level', 'Fundamentals: explain the core ideas clearly and correctly.'],
  mid: ['Mid level', 'More depth: trade-offs, failure modes and real scenarios.'],
  senior: ['Senior', 'System design and judgment: defend decisions under follow-up.'] };
// microphone icon (stroke, follows the button colour) and the two button states
const MIC = '<svg class="mic-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/></svg>';
const MIC_IDLE = `${MIC}<span>Speak</span>`, MIC_REC = '<i class="rec-dot"></i><span>Stop</span>';
const KIND_LABEL = { concept: 'Concept', scenario: 'Scenario', design: 'System design', behavioral: 'Behavioral' };
const STATUS_ICON = { covered: ['✓', 'pass', 'Covered'], partial: ['~', 'partial', 'Partly'], missed: ['✗', 'fail', 'Missed'] };

function roundReport(rep) {
  const mm = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, f = rep.followup_feedback || {};
  modal(`<div class="kicker dot">Coding round report</div><h3 style="margin:6px 0 2px">${esc(rep.title)}</h3>
    <div class="dim">${esc({ sql: 'SQL', python: 'Python', pyspark: 'PySpark', ml: 'ML & AI' }[rep.track] || rep.track || '')} · ${esc(LEVEL_INFO[rep.level]?.[0] || rep.level || '')} · ${mm(rep.seconds)} of ${rep.minutes}:00</div>
    <div class="rr-top">${ring(rep.total, 100, 86, rep.total >= 70 ? 'var(--easy)' : rep.total >= 45 ? 'var(--medium)' : 'var(--hard)')}
      <table class="rr-parts">${Object.entries(rep.parts).filter(([k, [v]]) => k !== 'Hints' || v).map(([k, [v, max]]) =>
        `<tr><td>${k}</td><td class="${v < 0 ? 'fail' : ''}">${v}${max ? ` / ${max}` : ''}</td></tr>`).join('')}</table></div>
    ${rep.eff_say ? `<div class="lbl">Efficiency</div><p style="margin:0">${esc(rep.eff_say)}</p>` : ''}
    ${rep.followup ? `<div class="lbl">Follow-up</div><p style="margin:0 0 6px"><b>${esc(rep.followup)}</b></p>
      ${f.error ? `<p class="faint">${esc(f.error)}</p>` : `<p class="dim" style="margin:0">${f.score == null ? 'Not answered.' : `Scored ${f.score}/10.`}</p>
      ${(f.improve || []).length ? `<ul class="rr-list">${f.improve.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${f.answer ? `<details><summary>A strong answer</summary><p>${esc(f.answer)}</p></details>` : ''}`}` : ''}
    <div class="row-end"><a href="#/interview"><button class="primary">Back to interviews</button></a></div>`);
}

async function interviewHome() {
  load();
  const [d, rounds] = await Promise.all([api('/api/interview'), api('/api/rounds')]);
  const title = id => d.tracks.find(t => t.id === id)?.title || id;
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/">← Home</a>
    <div class="list-head">${blob(CAST.sensei.seed, { size: 72, live: true, mood: 'happy' })}
      <div><div class="kicker" style="color:var(--acc2)">Interviews</div><h1 style="margin:4px 0">Practice like it's the real thing</h1>
      <div class="dim">Pick a role and a level, then answer out loud or by typing. Sensei, your head coach, grades every answer against what a strong answer covers, shows what to improve, and gives you a suggested answer.</div></div></div>
    <div class="grid two iv-tracks">${d.tracks.map((t, i) => `<a class="card game-card" href="#/interview/${t.id}">
      <div class="gc-top"><span class="gc-n">0${i + 1}</span>${blob(CAST[['pyspark', 'sensei', 'python', 'sql'][i % 4]].seed, { size: 54 })}</div>
      <div class="kicker">Solo · guided</div><h3>${esc(t.title)} Interview</h3><p class="dim">${esc(t.desc)}</p>
      <div class="gc-foot"><span>${t.count ? `<b>${t.count}</b> questions · ${t.topics.length} topics` : 'Questions coming soon'}</span><span class="sp"></span><button class="primary">Start</button></div></a>`).join('')}</div>
    <div class="section-title">Coding round</div>
    <div class="card cr-card"><div class="cr-text"><b>A timed coding problem, with ${CAST.sensei.name} as your interviewer</b>
      <div class="dim">Solve it, then defend it: if your code is slower than it needs to be you'll be asked to improve it, then answer one follow-up. Scored out of 100.</div></div>
      <div class="cr-pick"><div class="chips" id="cr-track">${[['sql', 'SQL'], ['python', 'Python'], ['pyspark', 'PySpark'], ['ml', 'ML & AI']].map(([k, l], i) => `<button data-v="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
        <div class="chips" id="cr-level">${[['entry', 'Easy'], ['mid', 'Medium'], ['senior', 'Hard']].map(([k, l], i) => `<button data-v="${k}" class="${i === 1 ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="primary" id="cr-start">Start round</button></div></div>
    ${rounds.length ? `<div class="cr-history">${rounds.map(r => `<a class="card iv-hist" href="#" data-round="${r.id}">${ring(r.score, 100, 40, r.score >= 70 ? 'var(--easy)' : r.score >= 45 ? 'var(--medium)' : 'var(--hard)')}
      <div><b>${esc(r.title)}</b> · ${esc({ sql: 'SQL', python: 'Python', pyspark: 'PySpark', ml: 'ML & AI' }[r.track] || r.track)} · ${esc(LEVEL_INFO[r.level]?.[0] || r.level)}<div class="faint">${esc(r.ts)} UTC</div></div><span class="sp"></span><span class="go">→</span></a>`).join('')}</div>` : ''}
    <div class="section-title iv-hist-head">Past interviews${d.history.length ? '<button class="ghost" id="iv-clear">Clear all</button>' : ''}</div>
    ${d.history.length ? `<div class="iv-history">${d.history.map(h => `<a class="card iv-hist" href="#/interview/review/${h.id}" data-id="${h.id}">
      ${h.score != null ? ring(h.score, 100, 40, h.score >= 70 ? 'var(--easy)' : h.score >= 45 ? 'var(--medium)' : 'var(--hard)') : '<span class="faint">-</span>'}
      <div><b>${esc(title(h.track))}</b> · ${esc(LEVEL_INFO[h.level]?.[0] || h.level)} · ${h.mode === 'drill' ? 'Drill' : 'Mock interview'}
      <div class="faint">${esc(h.ts)} UTC</div></div><span class="sp"></span>
      <button class="ghost iv-del" data-del="${h.id}" title="Delete this interview" aria-label="Delete this interview">✕</button><span class="go">→</span></a>`).join('')}</div>`
      : `<div class="faint">No interviews yet. Your reports will show up here.</div>`}</div>`;
  ['#cr-track', '#cr-level'].forEach(sel => $(sel).onclick = e => { const b = e.target.closest('button'); if (b) $(sel).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#cr-start').onclick = async () => {
    $('#cr-start').disabled = true; $('#cr-start').innerHTML = '<span class="spinner"></span>Picking a problem…';
    const r = await api('/api/round/start', { track: $('#cr-track .on').dataset.v, level: $('#cr-level .on').dataset.v });
    if (r.error) { $('#cr-start').disabled = false; $('#cr-start').textContent = 'Start round'; return; }
    localStorage.removeItem('roundchat:' + r.id);
    sessionStorage.setItem('round:' + r.id, JSON.stringify({ ...r, started: Date.now(), hints: 0, phase: 'coding' }));
    location.hash = `#/p/${r.id}/round`;
  };
  if ($('.cr-history')) $('.cr-history').onclick = async e => {
    const a = e.target.closest('[data-round]'); if (!a) return; e.preventDefault();
    roundReport(await api('/api/rounds/' + a.dataset.round));
  };
  if ($('#iv-clear')) $('#iv-clear').onclick = async () => {
    if (!await ask(`Delete all ${d.history.length} past interviews? Their reports can't be recovered.`, { ok: 'Delete all', seed: CAST.sensei.seed, mood: 'unsure' })) return;
    await api('/api/interview/delete', { all: true }); route();
  };
  if ($('.iv-history')) $('.iv-history').onclick = async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();  // the button sits inside the row's link
    if (!await ask('Delete this interview and its report?', { ok: 'Delete', seed: CAST.sensei.seed, mood: 'unsure' })) return;
    await api('/api/interview/delete', { session: +b.dataset.del });
    const row = b.closest('.iv-hist'); row.remove();
    if (!$('.iv-hist')) route();
  };
}

function voiceCallout(voice, onReady) {  // one-time local speech-to-text setup
  const box = document.createElement('div');
  const draw = v => {
    box.className = 'callout iv-voice';
    box.innerHTML = v.ready ? '' : `<b class="iv-voice-h">${MIC} Answer out loud (optional)</b>
      <p class="dim">Voice answers are transcribed on this computer with Whisper, so audio never leaves it. One-time download, about 300 MB.</p>
      ${v.status === 'error' ? `<p class="fail">${esc(v.error)}</p>` : ''}
      ${['idle', 'error', 'done'].includes(v.status) ? '<button id="voice-go">Set up voice answers</button>'
        : `<p><span class="spinner"></span>${esc(v.status)}… a minute or two.</p>`}`;
    if (v.ready) { box.remove(); onReady(); }
    if ($('#voice-go', box)) $('#voice-go', box).onclick = async () => { draw(await api('/api/setup/whisper', {})); poll(); };
  };
  const poll = () => { const t = setInterval(async () => { const v = (await api('/api/interview')).voice; draw(v); if (v.ready || v.status === 'error') clearInterval(t); }, 2500);
    cleanups.push(() => clearInterval(t)); };
  draw(voice);
  if (!['idle', 'error', 'done'].includes(voice.status) && !voice.ready) poll();
  return box;
}

async function interviewTrack(tid) {
  load();
  const t = await api('/api/interview/' + tid);
  if (t.error) return $('#app').innerHTML = '<div class="empty">Track not found</div>';
  let level = localStorage.getItem('iv-level') || 'mid';
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/interview">← Interviews</a>
    <div class="kicker" style="color:var(--acc2);margin-top:18px">Solo interview</div><h1 style="margin:4px 0">${esc(t.title)} interview with Sensei</h1>
    <div class="dim">${esc(t.desc)}</div>
    ${t.count ? '' : `<div class="callout warn" style="margin-top:18px">Questions for this track are still being written.</div>`}
    <div class="iv-step">1. Choose a level</div>
    <div class="iv-levels">${Object.entries(LEVEL_INFO).map(([k, [name, desc]]) => `<button class="card iv-opt" data-l="${k}"><b>${name}</b><span class="dim">${desc}</span></button>`).join('')}</div>
    <div class="iv-step">2. Mock interview</div>
    <div class="card iv-mock"><div><b>Six questions, like the real thing</b><div class="dim">Concepts, scenarios and design at your level, each graded, with a report at the end.</div></div>
      <span class="sp"></span><button class="primary" id="iv-start" ${t.count ? '' : 'disabled'}>Start interview</button></div>
    <div class="iv-step">Or drill one topic</div>
    <div class="chips iv-topics">${t.topics.map(x => `<button data-t="${x.id}" title="${esc(x.desc)}">${esc(x.title)} <span class="faint">${x.count}</span></button>`).join('')}</div>
    <div class="iv-step">Study</div>
    <a class="card tile" href="#/interview/${tid}/cheatsheet" ${t.sheet ? '' : 'style="pointer-events:none;opacity:.5"'}><span class="sheet-ic">${ic('notes', 20)}</span>
      <div class="t"><h4>${esc(t.title)} cheatsheet</h4><p>${t.sheet} sections in plain English, with how it works, real-world use and the interview-ready details. Every question links here.</p></div><span class="go">→</span></a>
    <div id="iv-voice-slot"></div></div>`;
  const mark = () => document.querySelectorAll('.iv-opt').forEach(b => b.classList.toggle('on', b.dataset.l === level));
  document.querySelectorAll('.iv-opt').forEach(b => b.onclick = () => { level = b.dataset.l; localStorage.setItem('iv-level', level); mark(); });
  mark();
  $('#iv-start').onclick = () => location.hash = `#/interview/${tid}/mock/${level}`;
  $('.iv-topics').onclick = e => { const b = e.target.closest('[data-t]'); if (b) location.hash = `#/interview/${tid}/drill/${level}/${b.dataset.t}`; };
  if (!t.voice.ready) $('#iv-voice-slot').append(voiceCallout(t.voice, () => {}));
}

function sheetSection(s) {
  return `<section class="card cs-sec" id="cs-${s.id}"><div class="kicker">${esc(s.group)}</div><h2>${esc(s.title)}</h2>
    ${s.plain ? `<div class="cs-plain"><div class="lbl">In plain English</div>${inline(s.plain)}</div>` : ''}
    ${s.how || s.uses ? `<div class="cs-cols">${s.how ? `<div><div class="lbl">How it works</div><ol class="cs-how">${s.how.map(x => `<li>${inline(x)}</li>`).join('')}</ol></div>` : ''}
      ${s.uses ? `<div><div class="lbl">Real-world use</div><ul class="cs-uses">${s.uses.map(x => `<li>${inline(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
    ${s.picture ? `<div class="cs-pic"><div class="lbl">Picture it</div>${inline(s.picture)}</div>` : ''}
    ${s.diagram ? `<div class="mermaid-src">${esc(s.diagram)}</div>` : ''}
    ${s.body ? `<div class="cs-body">${md(s.body)}</div>` : ''}</section>`;
}

async function interviewCheatsheet(tid, focus) {
  load();
  const d = await api(`/api/interview/${tid}/cheatsheet`);
  if (d.error) return $('#app').innerHTML = '<div class="empty">Cheatsheet not found</div>';
  const groups = [...new Set(d.sheet.map(s => s.group))];
  $('#app').innerHTML = `<div class="ds-home enter">
    <aside class="ds-side"><div class="kicker">Sections</div>
      ${groups.map(g => `<div class="ds-side-g">${esc(g)}</div>` + d.sheet.filter(s => s.group === g).map(s =>
        `<button data-sec="${s.id}"><span>${esc(s.title)}</span></button>`).join('')).join('')}</aside>
    <div class="page"><a class="back" href="#/interview/${tid}">← ${esc(d.title)} interview</a>
      <div class="kicker" style="color:var(--acc2);margin-top:18px">Cheatsheet</div><h1 style="margin:4px 0">${esc(d.title)}</h1>
      <div class="dim">Everything the interview asks about, explained simply first and then in interview-ready depth.</div>
      ${d.sheet.length ? d.sheet.map(sheetSection).join('') : '<div class="empty">Being written. Check back soon!</div>'}</div></div>`;
  const mark = id => document.querySelectorAll('.ds-side [data-sec]').forEach(b => b.classList.toggle('on', b.dataset.sec === id));
  let jumping = 0;
  $('.ds-side').onclick = e => { const b = e.target.closest('[data-sec]'); if (!b) return;
    mark(b.dataset.sec); jumping = Date.now() + 1000; $('#cs-' + b.dataset.sec).scrollIntoView({ behavior: 'smooth' }); };
  const spy = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && Date.now() > jumping && mark(e.target.id.slice(3))),
    { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.cs-sec').forEach(el => spy.observe(el));
  cleanups.push(() => spy.disconnect());
  renderDiagrams($('#app'));
  if (focus && $('#cs-' + focus)) { mark(focus); jumping = Date.now() + 1000; requestAnimationFrame(() => $('#cs-' + focus).scrollIntoView()); }
}

function gradeView(g) {
  if (!g) return '';
  const rubric = g.rubric_points.map((p, i) => {
    const r = g.rubric?.[i], [icon, cls, label] = STATUS_ICON[r?.status] || ['•', 'faint', ''];
    return `<li class="iv-pt ${cls}"><span class="iv-ico" title="${label}">${icon}</span><div>${inline(p)}${r?.note ? `<div class="faint">${inline(r.note)}</div>` : ''}</div></li>`;
  }).join('');
  const s = g.stats || {};
  return `<div class="iv-grade">
    ${g.error ? `<div class="callout warn">${esc(g.error)}</div>`
      : `<div class="iv-score">${ring(g.score, 10, 64, g.score >= 7 ? 'var(--easy)' : g.score >= 4 ? 'var(--medium)' : 'var(--hard)')}
        <div><b style="font-size:16px">${g.score >= 8 ? 'Strong answer' : g.score >= 6 ? 'Good, with gaps' : g.score >= 4 ? 'Partly there' : 'Needs work'}</b>
        ${g.structure ? `<div class="dim">${inline(g.structure)}</div>` : ''}</div></div>`}
    <div class="lbl">What a strong answer covers</div><ul class="iv-rubric">${rubric}</ul>
    ${g.strengths?.length ? `<div class="lbl">What you did well</div><ul>${g.strengths.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
    ${g.improve?.length ? `<div class="lbl">What to improve</div><ul class="iv-improve">${g.improve.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
    ${s.notes?.length || s.wpm ? `<div class="lbl">Delivery</div><div class="iv-stats faint">${s.words} words${s.wpm ? ` · ${s.wpm} words/min` : ''}${Object.keys(s.fillers || {}).length ? ` · fillers: ${Object.entries(s.fillers).map(([k, n]) => `${esc(k)} ×${n}`).join(', ')}` : ''}</div>
      ${s.notes.length ? `<ul>${s.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
    <details class="iv-model"><summary>Suggested answer</summary>${md(g.answer)}</details></div>`;
}

async function interviewSession(tid, mode, level, topic) {
  load();
  const [t, start] = await Promise.all([api('/api/interview/' + tid), api('/api/interview/start', { track: tid, level, mode, topic })]);
  if (t.error || !start.questions?.length) return $('#app').innerHTML = `<div class="empty">No questions here yet. <a href="#/interview/${tid}" style="text-decoration:underline">Back</a></div>`;
  const qs = start.questions, items = [];
  let i = 0, secs = 0, spoken = 0, voiceReady = t.voice.ready, rec = null;
  const tick = setInterval(() => { secs++; const c = $('#iv-clock'); if (c) c.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`; }, 1000);
  cleanups.push(() => { clearInterval(tick); if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } rec?.stream?.getTracks().forEach(x => x.stop()); });

  const finish = async () => {
    if (!items.length) return location.hash = `#/interview/${tid}`;
    const r = await api('/api/interview/finish', { track: tid, level, mode, topic, items });
    location.hash = `#/interview/review/${r.id}`;
  };

  const draw = () => {
    const q = qs[i], it = items[i];
    secs = 0; spoken = 0;
    $('#app').innerHTML = `<div class="page iv-page enter">
      <div class="iv-bar"><span class="kicker">${mode === 'drill' ? `Drill · ${esc(q.topic_title)}` : `${KIND_LABEL[q.kind]} question`} · ${i + 1} of ${qs.length}</span>
        <span class="iv-dots">${qs.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</span><span class="sp"></span>
        <span class="faint">${ic('timer', 13)} <span id="iv-clock">00:00</span></span><button class="ghost" id="iv-end">${mode === 'drill' ? 'Finish drill' : 'End interview'}</button></div>
      <div class="card iv-card">
        <div class="iv-q">${blob(CAST.sensei.seed, { size: 54, live: true, cls: 'live', mood: it?.grade ? (it.grade.score >= 7 ? 'love' : it.grade.score >= 4 ? 'happy' : 'unsure') : 'idle' })}
          <div><div class="faint" style="font-size:11px">${esc(LEVEL_INFO[q.level][0])} · ${esc(q.topic_title)} · ${KIND_LABEL[q.kind]}</div><h2>${esc(q.q)}</h2></div></div>
        <textarea id="iv-ans" placeholder="Answer in your own words, like you're speaking to an interviewer. Type here, or press the mic and talk." ${it?.grade ? 'readonly' : ''}>${esc(it?.answer || '')}</textarea>
        <div class="iv-ctrl" id="iv-ctrl"></div>
        <div id="iv-mic-msg"></div>
        <div id="iv-result">${it?.grade ? gradeView(it.grade) : ''}</div>
        ${it?.grade && it.grade.study ? `<button class="ghost" id="iv-study">${ic('notes', 14)}Study this in the cheatsheet</button>` : ''}
      </div></div>`;
    $('#iv-end').onclick = async () => { if (items.length || await ask('End now? Nothing has been graded yet.', { ok: 'End', seed: CAST.sensei.seed })) finish(); };
    if ($('#iv-study')) $('#iv-study').onclick = async () => {
      const d = await api(`/api/interview/${tid}/cheatsheet`), s = d.sheet.find(x => x.id === it.grade.study);
      if (s) { modal(sheetSection(s)); renderDiagrams($('#modal-body')); }
    };
    controls();
  };

  const controls = () => {
    const it = items[i], last = i === qs.length - 1;
    if (it?.grade) {
      $('#iv-ctrl').innerHTML = `<button id="iv-retry">Try again</button><span class="sp"></span>
        <button class="primary" id="iv-next">${last ? (mode === 'drill' ? 'Finish drill' : 'See your report') : 'Next question →'}</button>`;
      $('#iv-retry').onclick = () => { items[i] = { ...it, grade: null }; draw(); $('#iv-ans').focus(); };
      $('#iv-next').onclick = () => { if (last) finish(); else { i++; draw(); } };
      return;
    }
    const mic = localStorage.getItem('iv-mic');
    $('#iv-ctrl').innerHTML = `${mic === 'off' ? `<button class="ghost iv-mic" id="iv-mic-again" title="Use your voice instead of typing">${MIC}<span>Try microphone again</span></button>`
        : `<button id="iv-mic" class="iv-mic" title="Answer out loud">${MIC_IDLE}</button>`}
      <span class="faint" id="iv-rec-state"></span><span class="sp"></span>
      <button class="ghost" id="iv-skip">Skip</button><button class="primary" id="iv-submit">Submit answer</button>`;
    if ($('#iv-mic-again')) $('#iv-mic-again').onclick = () => { localStorage.removeItem('iv-mic'); controls(); $('#iv-mic').click(); };
    if ($('#iv-mic')) $('#iv-mic').onclick = toggleMic;
    $('#iv-skip').onclick = () => { items[i] = { ...qs[i], answer: '', grade: null, skipped: true }; if (i === qs.length - 1) finish(); else { i++; draw(); } };
    $('#iv-submit').onclick = submit;
    $('#iv-ans').onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); };
  };

  const typeInstead = why => {  // the microphone was declined: fall back to typing, gently
    localStorage.setItem('iv-mic', 'off');
    controls();
    $('#iv-mic-msg').innerHTML = `<div class="callout iv-note">${esc(why)} No problem: type your answer in the box above, Sensei grades it the same way.</div>`;
    $('#iv-ans').focus();
  };

  async function toggleMic() {
    if (rec && rec.state === 'recording') return rec.stop();
    if (!voiceReady) {
      const box = voiceCallout((await api('/api/interview')).voice, () => { voiceReady = true; $('#iv-mic-msg').innerHTML = ''; });
      $('#iv-mic-msg').replaceChildren(box);
      return;
    }
    if (localStorage.getItem('iv-mic') !== 'on') {
      const yes = await ask('Sensei would like to hear your answer. Allow the microphone? Your recording is transcribed on this computer and never uploaded.',
        { ok: 'Allow microphone', cancel: 'Type instead', seed: CAST.sensei.seed, mood: 'happy' });
      if (!yes) return typeInstead('You chose to type.');
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { return typeInstead(e.name === 'NotAllowedError' ? 'Microphone access was blocked.' : "Couldn't find a microphone."); }
    localStorage.setItem('iv-mic', 'on');
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(x => window.MediaRecorder?.isTypeSupported?.(x)) || '';
    const chunks = [], t0 = Date.now(), before = $('#iv-ans').value.trim();
    const send = async b => { try { return await (await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': b.type }, body: b })).json(); }
      catch { return { error: "Couldn't reach DataDojo." }; } };
    // live preview: Whisper works on whole recordings, so re-transcribe everything so far about once a second
    // (one request in flight at a time); the final pass on Stop replaces it with the exact text
    let busy = false;
    const preview = async () => {
      if (busy || rec.state !== 'recording') return;
      busy = true;
      const r = await send(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      busy = false;
      if (rec.state === 'recording' && r.text && $('#iv-ans')) $('#iv-ans').value = (before + ' ' + r.text).trim();
    };
    rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
    rec.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); preview(); } };
    $('#iv-ans').readOnly = true;
    const tickRec = setInterval(() => { if ($('#iv-rec-state')) $('#iv-rec-state').textContent = `● recording ${Math.round((Date.now() - t0) / 1000)}s · press Stop when done`; }, 500);
    rec.onstop = async () => {
      clearInterval(tickRec); stream.getTracks().forEach(x => x.stop());
      $('#iv-mic').classList.remove('on'); $('#iv-mic').innerHTML = MIC_IDLE; $('#iv-mic').disabled = true;
      $('#iv-rec-state').innerHTML = '<span class="spinner"></span>transcribing…';
      const r = await send(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      if (!$('#iv-ans')) return;
      $('#iv-mic').disabled = false; $('#iv-rec-state').textContent = ''; $('#iv-ans').readOnly = false;
      if (r.error) { $('#iv-ans').value = before; return void ($('#iv-mic-msg').innerHTML = `<div class="callout warn">${esc(r.error)}</div>`); }
      spoken += r.seconds || 0;
      const a = $('#iv-ans'); a.value = (before + ' ' + r.text).trim();
      $('#iv-rec-state').textContent = 'Check the text, fix anything misheard, then submit.';
    };
    rec.start(1000);  // a chunk every second feeds the live preview
    $('#iv-mic').classList.add('on'); $('#iv-mic').innerHTML = MIC_REC; $('#iv-mic-msg').innerHTML = '';
  }

  async function submit() {
    if (rec && rec.state === 'recording') return;
    const answer = $('#iv-ans').value.trim();
    if (!answer) return $('#iv-ans').focus();
    $('#iv-submit').disabled = true; $('#iv-ans').readOnly = true;
    $('#iv-result').innerHTML = `<div class="dim iv-wait"><span class="spinner"></span>Sensei is reviewing your answer…</div>`;
    const grade = await api('/api/interview/grade', { track: tid, id: qs[i].id, answer, seconds: spoken || null });
    items[i] = { ...qs[i], answer, grade, time: secs };
    draw();
  }
  draw();
}

async function interviewReview(id) {
  load();
  const [d, cat] = await Promise.all([api('/api/interview/session/' + id), api('/api/interview')]);
  if (d.error) return $('#app').innerHTML = '<div class="empty">Interview not found</div>';
  const t = cat.tracks.find(x => x.id === d.track) || { title: d.track }, r = d.report;
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/interview">← Interviews</a>
    <div class="card iv-report">
      ${r.score != null ? ring(r.score, 100, 96, r.score >= 70 ? 'var(--easy)' : r.score >= 45 ? 'var(--medium)' : 'var(--hard)') : ''}
      <div><div class="kicker">Interview report</div><h1 style="margin:4px 0">${esc(t.title)} · ${esc(LEVEL_INFO[d.level]?.[0] || d.level)}</h1>
        <div class="dim">${d.mode === 'drill' ? 'Topic drill' : 'Mock interview'} · ${r.answered} of ${r.total} answered and graded · ${esc(d.ts)} UTC</div></div>
      <span class="sp"></span>${blob(CAST.sensei.seed, { size: 80, live: true, mood: r.score >= 70 ? 'love' : r.score >= 45 ? 'happy' : 'unsure' })}</div>
    ${r.fixes.length ? `<div class="section-title">Your top things to work on</div><ol class="card iv-fixes">${r.fixes.map(x => `<li>${inline(x)}</li>`).join('')}</ol>` : ''}
    ${r.weak_topics.length ? `<div class="section-title">Weakest topics</div><div class="chips">${r.weak_topics.map(w => `<span class="tag">${esc(w.topic)} · ${w.score}/10</span>`).join(' ')}</div>` : ''}
    <div class="section-title">Question by question</div>
    ${d.items.map((it, k) => `<details class="card iv-item" ${k ? '' : 'open'}><summary><b>${k + 1}.</b> ${esc(it.q)}
      <span class="sp"></span>${it.grade?.score != null ? `<span class="tag ${it.grade.score >= 7 ? 'easy' : it.grade.score >= 4 ? 'medium' : 'hard'}">${it.grade.score}/10</span>` : `<span class="tag">${it.skipped ? 'skipped' : 'not graded'}</span>`}</summary>
      ${it.answer ? `<div class="lbl">Your answer</div><p class="iv-your">${esc(it.answer)}</p>` : ''}${gradeView(it.grade)}</details>`).join('')}
    <div class="row-end" style="margin-top:20px"><button class="ghost" id="iv-del-one">Delete this interview</button>
      <a href="#/interview/${d.track}/cheatsheet"><button>${ic('notes', 14)}Open the cheatsheet</button></a>
      <a href="#/interview/${d.track}"><button class="primary">Practice again</button></a></div></div>`;
  $('#iv-del-one').onclick = async () => {
    if (!await ask('Delete this interview and its report?', { ok: 'Delete', seed: CAST.sensei.seed, mood: 'unsure' })) return;
    await api('/api/interview/delete', { session: d.id }); location.hash = '#/interview';
  };
  if (r.score >= 80) confetti($('.iv-report'));
}

// ---------- modal + router ----------
let onModalClose = null;
function modal(html) { onModalClose = null; $('.modal-box').className = 'modal-box'; $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; const f = onModalClose; onModalClose = null; f && f(); }
// themed replacement for confirm(); resolves false on Cancel, ✕, Esc or a click outside
function ask(text, { ok = 'OK', cancel = 'Cancel', seed, mood = 'shy' } = {}) {
  return new Promise(res => {
    modal(`<div class="ask">${seed ? blob(seed, { size: 64, mood }) : ''}<p>${esc(text)}</p>
      <div class="row"><button id="ask-no">${esc(cancel)}</button><button class="primary" id="ask-ok">${esc(ok)}</button></div></div>`);
    $('.modal-box').classList.add('narrow');
    onModalClose = () => res(false);
    $('#ask-no').onclick = closeModal;
    $('#ask-ok').onclick = () => { res(true); closeModal(); };
    $('#ask-ok').focus();
  });
}
$('#modal-x').onclick = closeModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

let setupKnown = false;
async function setupDone() {
  if (setupKnown) return true;
  const check = api('/api/setup').then(r => { const done = !!r.settings?.setup_done;
    done ? localStorage.setItem('setupDone', '1') : localStorage.removeItem('setupDone'); return done; });
  if (localStorage.getItem('setupDone')) { check.then(d => { setupKnown = d; }); return setupKnown = true; }  // known: don't wait for the server
  return setupKnown = await check;
}
// The browser can't restore scroll itself: the page is empty until its data loads, so it lands at the top and
// then jumps back down later. We restore it in the same frame the page renders instead.
history.scrollRestoration = 'manual';
let firstRoute = true;
addEventListener('pagehide', () => sessionStorage.setItem('scroll:' + location.hash, scrollY));
async function route() {
  cleanups.forEach(f => f()); cleanups = [];
  closeModal();
  await blobReady;
  let [, page, arg, ...rest] = location.hash.replace(/^#/, '').split('/');
  if (page !== 'setup' && !(await setupDone())) { location.replace('#/setup'); page = 'setup'; }
  const swap = new MutationObserver(() => {  // runs right after the page writes #app, before the browser paints
    swap.disconnect();
    document.body.classList.toggle('ws', page === 'p');
    document.body.classList.toggle('setup-mode', page === 'setup');
    // a refresh reopens where you left off; any other navigation starts at the top
    window.scrollTo(0, firstRoute ? +sessionStorage.getItem('scroll:' + location.hash) || 0 : 0);
    firstRoute = false;
  });
  swap.observe($('#app'), { childList: true });
  cleanups.push(() => swap.disconnect());
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on',
    a.dataset.nav === (page === 'lang' ? arg : ['design', 'games', 'interview'].includes(page) ? page : page ? '' : 'home')));
  document.querySelectorAll('.dd').forEach(dd => { dd.classList.toggle('on', !!dd.querySelector('.dd-menu a.on')); dd.classList.remove('open'); });
  if (page === 'setup') await setupPage();
  else if (page === 'p') await workspace(arg, rest[0]);
  else if (page === 'feedback') await feedbackPage();
  else if (page === 'design') await (arg ? designLesson(arg) : designHome());
  else if (page === 'games') await (arg ? gamePlay(arg) : gamesHome());
  else if (page === 'interview') await (!arg ? interviewHome() : arg === 'review' ? interviewReview(rest[0])
    : rest[0] === 'cheatsheet' ? interviewCheatsheet(arg, rest[1]) : ['mock', 'drill'].includes(rest[0]) ? interviewSession(arg, rest[0], rest[1] || 'mid', rest[2])
    : interviewTrack(arg));
  else if (page === 'lang' && LANGS[arg]) await langPage(arg);
  else if (page === 'pattern' || page === 'list') await problemList(page, arg);
  else await home();
  stagger($('#app')); countUp($('#app'));
}
window.onhashchange = route;
// themed tooltip for anything with data-tip (heatmap days)
const tip = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tip', hidden: true }));
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]'); tip.hidden = !t; if (!t) return;
  const r = t.getBoundingClientRect(); tip.textContent = t.dataset.tip;
  tip.style.left = r.left + r.width / 2 + 'px'; tip.style.top = r.top + 'px';
});
document.querySelectorAll('.dd-btn').forEach(b => b.onclick = () => {  // click/tap; hover is CSS
  const dd = b.parentElement, open = !dd.classList.contains('open');
  document.querySelectorAll('.dd').forEach(x => x.classList.remove('open')); dd.classList.toggle('open', open);
});
document.addEventListener('click', e => { if (!e.target.closest('.dd')) document.querySelectorAll('.dd').forEach(x => x.classList.remove('open')); });
renderThemeToggle();
blobReady.then(renderMe);
api('/api/version').then(v => {
  if (!v.update) return;
  $('#nav-update').outerHTML = `<button class="pill-update" id="pill-update" title="You have ${esc(v.version)}">✨ Update to ${esc(v.latest)}</button>`;
  $('#pill-update').onclick = () => updateModal(v);
});

// "what's new" + the right way to update for how DataDojo was installed; progress lives in the data folder, so it survives
function updateModal(v) {
  const how = v.install === 'desktop' && v.download
    ? `<a class="up-dl" href="${esc(v.download)}"><button class="primary">⬇ Download DataDojo ${esc(v.latest)} for ${esc(v.os)}</button></a>
       <p class="dim" style="margin:10px 0 0">Open the download and install it over the old one${v.os === 'Mac' ? ' (drag DataDojo into Applications and choose Replace)' : ''}, then reopen DataDojo.</p>`
    : `<div class="dim" style="margin-bottom:6px">Run this in your terminal, then start <code>datadojo</code> again:</div>
       <div class="sol-code"><button class="copy" id="up-copy">Copy</button><pre>uv tool upgrade datadojo</pre></div>`;
  modal(`<div class="kicker dot">Update available</div>
    <h3 style="margin:6px 0 2px">DataDojo ${esc(v.latest)} is here</h3><div class="faint">You have ${esc(v.version)} · your progress, settings and history are kept</div>
    <div class="up-how">${how}</div>
    ${v.notes ? `<div class="up-notes">${md(v.notes.split(/^## How to update/m)[0].replace(/^## (.*)$/gm, '**$1**'))}</div>` : ''}
    <div class="row-end"><a class="faint" href="${esc(v.url)}" target="_blank" rel="noreferrer" style="text-decoration:underline">Release page on GitHub</a></div>`);
  if ($('#up-copy')) $('#up-copy').onclick = () => navigator.clipboard.writeText('uv tool upgrade datadojo').then(() => { $('#up-copy').textContent = 'Copied ✓'; });
}
// ---------- launch intro ----------
// The intro's markup and critical CSS live in index.html so it is on screen from the very first paint (no flash of the
// home page first). Here we only start it once the logo font is ready, and lift it: after ~2.9s, on click, or on a key.
function intro() {
  const el = document.getElementById('intro'); if (!el) return;
  let done = false;
  const finish = () => {
    if (done) return; done = true; removeEventListener('keydown', finish);
    const root = document.documentElement;  // one smooth handover: the intro dissolves while the app eases in as a whole
    el.classList.add('out'); root.classList.add('intro-reveal'); root.classList.remove('intro-on');
    setTimeout(() => { el.remove(); root.classList.remove('intro-reveal'); }, 1300);
  };
  el.onclick = finish; addEventListener('keydown', finish);
  const css = document.getElementById('font-css');  // the font stylesheet loads without blocking; wait for it, then the font
  const sheet = !css || css.dataset.ready ? Promise.resolve() : new Promise(r => { css.addEventListener('load', r); css.addEventListener('error', r); });
  const font = sheet.then(() => document.fonts ? document.fonts.load('800 150px "JetBrains Mono"') : null);
  Promise.race([font, new Promise(r => setTimeout(r, 450))]).then(() => {  // never wait long for the font
    if (done) return;
    el.classList.add('play'); setTimeout(finish, 2900);
  });
}
intro();
route();
