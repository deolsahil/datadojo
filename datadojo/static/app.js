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
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${done}/${total}</text></svg>`;
}
const cell = v => v === null ? '<i>NULL</i>' : esc(typeof v === 'string' ? v : JSON.stringify(v));
const table = (cols, rows) => `<table class="data">${cols ? `<tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` : ''}${
  rows.map(r => `<tr>${(Array.isArray(r) ? r : [r]).map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</table>`;
const tables = ts => Object.entries(ts).map(([n, t]) =>
  `<div class="tblname">${esc(n)}</div>` + (t.rows.length ? table(t.columns.split(',').map(c => c.trim()), t.rows) : '<div class="faint">(empty table)</div>')).join('');
const value = v => Array.isArray(v) && v.length && v.every(Array.isArray) ? table(null, v)
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
matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
  if (!localStorage.getItem('theme')) setTheme(e.matches ? 'sakura' : 'midnight', false);
});

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
  const today = new Date(), start = new Date(today);
  start.setDate(today.getDate() - 52 * 7 - today.getDay());
  let cells = '', i = 0;
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1), i++) {
    const key = dayKey(d), n = days[key] || 0;
    const lvl = n === 0 ? '' : n < 3 ? 'l1' : n < 6 ? 'l2' : n < 10 ? 'l3' : 'l4';
    cells += `<i class="${lvl}" style="--w:${Math.floor(i / 7)}" title="${key}: ${n} run${n === 1 ? '' : 's'}"></i>`;
  }
  const months = [...Array(12)].map((_, k) => new Date(today.getFullYear(), today.getMonth() - 11 + k, 1).toLocaleString('en', { month: 'short' }));
  return `<div class="months">${months.map(m => `<span>${m}</span>`).join('')}</div><div class="heat">${cells}</div>`;
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

async function home() {
  const [{ cat, stats }, profile] = await Promise.all([load(), api('/api/profile')]);
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
    <div class="section-title">See it in action</div>${demoShell()}
    <div class="section-title">Curated lists</div>${listTiles(cat)}
    ${Object.keys(LANGS).map(l => coachHead(l, cat) + patternTiles(cat, l)).join('')}
    ${reviewCard()}
    <footer class="foot">Spotted a mistake in a problem? Use <b>⚑ Report</b> in the workspace. · <a href="#/feedback">All reviews & reports →</a></footer>
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
  const all = cat.problems.filter(p => kind === 'pattern' ? p.pattern === id : (p.lists || []).includes(id))
    .sort((a, b) => ['easy', 'medium', 'hard'].indexOf(a.difficulty) - ['easy', 'medium', 'hard'].indexOf(b.difficulty));
  const [d, t] = count(all);
  const coach = CAST[kind === 'pattern' ? meta.lang : 'sensei'];
  let filter = 'all';
  const render = () => {
    const ps = all.filter(p => filter === 'all' || p.difficulty === filter || (filter === 'todo' && !p.solved));
    $('#cards').innerHTML = ps.map(p => `<div class="card pcard"><div class="row"><span class="check ${p.solved ? 'done' : ''}">${p.solved ? '✓' : ''}</span>
      <div><h4>${esc(p.title)}</h4><div style="margin-top:6px;display:flex;gap:6px">${diffTag(p.difficulty)}${kind === 'list' ? langTag(p.lang) : ''}</div></div></div>
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
const monacoReady = new Promise(res => {
  if (!window.require) return res(null);
  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });
  require(['vs/editor/editor.main'], () => { monacoTheme(); res(window.monaco); }, () => res(null));
});

async function workspace(id) {
  const p = await api('/api/problems/' + id);
  load();
  if (p.error) return $('#app').innerHTML = '<div class="empty">Problem not found</div>';
  const coach = CAST[p.lang], you = me() || 'you';
  const chatKey = 'chat:' + id, stageKey = 'stage:' + id;
  let messages = JSON.parse(localStorage.getItem(chatKey) || '[]');
  let stage = +(localStorage.getItem(stageKey) || 0), last = null, hintsShown = 0, secs = 0, ticking = true;
  let fontSize = +(localStorage.getItem('fontSize') || 13), inst = null, resting = 'idle';
  const hints = p.hints || [];

  $('#app').innerHTML = `
    <div class="ws-top"><a class="back" href="#/pattern/${p.pattern}" title="Back">←</a>
      <span class="timer">⏱ <span id="clock">00:00</span><button id="pause" title="Pause">⏸</button><button id="rst" title="Reset">↺</button></span>
      <button id="subs">📋 Submissions</button>
      <button id="report" title="Wrong expected output, unclear statement, typo…">⚑ Report a mistake${p.open_reports ? ` <span class="badge">${p.open_reports}</span>` : ''}</button>
      <div class="stages" id="stages"></div></div>
    <div class="cols">
      <section class="col"><div class="col-h"># Problem</div><div class="scroll prob">
        <h2>${esc(p.title)}</h2>
        <div class="tags">${langTag(p.lang)}${diffTag(p.difficulty)}<span class="tag">${p.tests} tests</span>${p.solved ? '<span class="tag easy">solved ✓</span>' : ''}</div>
        ${md(p.statement)}
        <div class="col-h" style="padding:10px 0 2px">Example input</div>
        ${p.sample.tables ? tables(p.sample.tables) : `<pre>${esc(p.function)}(${p.sample.args.map(a => JSON.stringify(a)).join(', ')})</pre>`}
        ${hints.length ? `<div class="hints"><div class="h">💡 Hints <button id="more-hint">Show a hint (${hints.length})</button></div><ol id="hint-list"></ol></div>` : ''}
        ${p.source_url ? `<div class="faint">Inspired by: <a href="${esc(p.source_url)}" target="_blank" rel="noreferrer" style="text-decoration:underline">${esc(new URL(p.source_url).hostname)}</a></div>` : ''}
      </div></section>
      <section class="col"><div class="col-h"># Editor</div>
        <div class="toolbar"><select id="engine" title="Engine / version"></select>${p.function ? `<code>${esc(p.function)}()</code>` : ''}<span class="sp"></span>
          <button class="ghost" id="fs-dn">A-</button><span class="faint" id="fs">${fontSize}</span><button class="ghost" id="fs-up">A+</button>
          <button id="reset">Reset</button><button id="sol">Solution</button><button class="primary" id="run" title="Run tests (⌘/Ctrl + Enter)">▶ Run</button></div>
        <div id="editor-wrap"><div id="editor"></div><textarea id="fallback" spellcheck="false"></textarea></div>
        <div id="out"><div class="faint">Test results will appear here. Run with ⌘/Ctrl + Enter.</div></div>
      </section>
      <section class="col">
        <div class="coach-head"><div id="coach">${blob(coach.seed, { size: 58, live: true, cls: 'live' })}</div>
          <div><b>${coach.name}</b><div class="dim" style="font-size:11.5px">${coach.role}</div></div><span class="sp"></span>
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

  // timer
  const tick = setInterval(() => {
    if (!ticking) return;
    secs++;
    $('#clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }, 1000);
  cleanups.push(() => clearInterval(tick));
  $('#pause').onclick = () => { ticking = !ticking; $('#pause').textContent = ticking ? '⏸' : '▶'; };
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
      if (a.pyspark.length) { clearInterval(t); route(); } else draw(a.spark_install); }, 2500); cleanups.push(() => clearInterval(t)); };
    draw(all.spark_install);
    if (!['idle', 'error', 'done'].includes(all.spark_install.status)) poll();
  }

  // editor
  const code = () => inst ? inst.getValue() : $('#fallback').value;
  const setCode = v => inst ? inst.setValue(v) : ($('#fallback').value = v);
  $('#fallback').value = p.last_code || p.starter || '';
  monacoReady.then(m => {
    if (!m || !document.body.contains($('#editor'))) {
      $('#editor').style.display = 'none'; $('#fallback').style.display = 'block'; return;
    }
    inst = m.editor.create($('#editor'), { value: $('#fallback').value, language: p.lang === 'sql' ? 'sql' : 'python', theme: 'dojo',
      fontSize, fontFamily: getComputedStyle(document.body).getPropertyValue('--body'), minimap: { enabled: false }, automaticLayout: true,
      scrollBeyondLastLine: false, tabSize: 4, padding: { top: 10 }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on' });
    inst.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, runTests);
    inst.onDidFocusEditorText(() => gz && gz.lookAt($('#editor-wrap')));
    inst.onDidBlurEditorText(() => gz && gz.lookAt('pointer'));
    cleanups.push(() => inst.dispose());
  });
  $('#fallback').onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runTests(); };
  const setFont = n => { fontSize = Math.max(10, Math.min(22, n)); localStorage.setItem('fontSize', fontSize);
    $('#fs').textContent = fontSize; inst && inst.updateOptions({ fontSize }); };
  $('#fs-dn').onclick = () => setFont(fontSize - 1);
  $('#fs-up').onclick = () => setFont(fontSize + 1);
  $('#reset').onclick = () => confirm('Replace your code with the starter?') && setCode(p.starter || '');
  $('#sol').onclick = async () => {
    react('shy', 2500);
    if (!confirm(`Peek at the reference solution? ${coach.name} thinks a hint might be enough!`)) return;
    const r = await api(`/api/problems/${id}/solution`);
    modal(`<h3>Reference solution</h3><pre>${esc(r.solution.trim())}</pre>`);
  };

  // hints
  if (hints.length) $('#more-hint').onclick = () => {
    if (hintsShown < hints.length) $('#hint-list').insertAdjacentHTML('beforeend', `<li>${inline(hints[hintsShown++])}</li>`);
    $('#more-hint').textContent = hintsShown < hints.length ? `Next hint (${hints.length - hintsShown} left)` : 'No more hints';
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
  if (!messages.length) goStage(stage); else { renderStages(); renderChat(); }

  const send = async text => {
    if (!text.trim()) return;
    messages.push({ role: 'user', content: text });
    renderChat(); $('#say').value = '';
    $('#chat').insertAdjacentHTML('beforeend', `<div class="line them" id="typing">${blob(coach.seed, { size: 30, mood: 'thinking' })}<div class="msg assistant"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
    $('#chat').scrollTop = 1e9;
    status('thinking…', 'thinking');
    const r = await api('/api/coach', { id, code: code(), result: last, stage: STAGES[stage][0],
      messages: messages.filter(m => m.role !== 'sys').map(({ role, content }) => ({ role, content })) });
    status('listening', resting);
    say(r.reply || r.error, last?.passed ? 'happy' : 'idle');
  };
  $('#send').onclick = () => send($('#say').value);
  $('#nudge').onclick = () => send("I'm stuck. Can you give me a small hint without the answer?");
  $('#say').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#say').value); } };

  // run
  async function runTests() {
    $('#run').disabled = true; $('#run').innerHTML = '<span class="spinner"></span>Running';
    status('watching…', 'thinking');
    $('#out').innerHTML = `<div class="dim"><span class="spinner"></span>Running${p.lang === 'pyspark' ? ' (Spark needs ~10s to start)' : ''}…</div>`;
    last = await api('/api/run', { id, code: code(), engine: $('#engine').value });
    $('#run').disabled = false; $('#run').innerHTML = '▶ Run';
    status('listening');
    if (last.error) {
      $('#out').innerHTML = `<div class="verdict fail">Error</div><pre class="fail">${esc(last.error)}</pre>`;
      resting = 'unsure'; react('surprised', 1200);
      return say("Whoa, that didn't run. Check the error in the results panel; I can help you read it.", 'surprised', true);
    }
    const n = last.results.filter(t => t.passed).length, total = last.results.length;
    $('#out').innerHTML = `<div class="verdict ${last.passed ? 'pass' : 'fail'}">${last.passed ? `All ${n} tests passed 🎉` : `${n}/${total} tests passed`}</div>`
      + `<div class="faint" style="margin:-4px 0 8px">ran on ${esc($('#engine').selectedOptions[0]?.textContent || last.engine)} · expected output from the default engine</div>`
      + (last.translated ? `<details><summary>SQL as executed (translated to DuckDB)</summary><pre>${esc(last.translated)}</pre></details>` : '')
      + (last.stdout ? `<details open><summary>stdout</summary><pre>${esc(last.stdout)}</pre></details>` : '')
      + last.results.map(t => `<details ${t.passed ? '' : 'open'}><summary class="${t.passed ? 'pass' : 'fail'}">Test ${t.test} ${t.passed ? 'passed' : 'failed'}</summary>
          ${t.error ? `<pre class="fail">${esc(t.error)}</pre>` : ''}
          <div class="lbl">Input</div>${Array.isArray(t.input) ? `<pre>${esc(t.input.map(a => JSON.stringify(a)).join(', '))}</pre>` : tables(t.input)}
          <div class="lbl">Expected</div>${value(t.expected)}${'got' in t ? `<div class="lbl">Your output</div>${value(t.got)}` : ''}</details>`).join('');
    if (last.passed) {
      resting = 'happy'; react('love', 2500); confetti($('#out .verdict'));
      say(`All ${n} tests pass! 🎉 Nicely done${me() ? ', ' + me().split(' ')[0] : ''}. Want me to review it, or try the edge cases on another engine?`, 'love', true);
      if (stage < STAGES.length - 1) { stage = STAGES.length - 2; goStage(STAGES.length - 1); }
    } else {
      resting = n ? 'unsure' : 'sad'; react(n ? 'unsure' : 'sad', 2000);
      say(n ? `${n} of ${total} passing, so you're close! Compare "Expected" and "Your output" on the failing test.`
            : `None passing yet, and that's okay. Look at the first failing test and check the shape of your output.`, n ? 'unsure' : 'sad', true);
    }
  }
  $('#run').onclick = runTests;

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
      : `<span class="tag hard">⚑ ${esc(f.category || 'report')}</span><a href="#/p/${f.problem}"><b>${esc(title[f.problem] || f.problem)}</b></a>`}
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
    ['me', 'NOT EXISTS?'], ['them', 'Exactly! NOT EXISTS ignores that NULL. Run it and see. 🎉']] },
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
        if (who === 'them') { setMood(face, 'thinking'); await wait(900, t); setMood(face, text.includes('🎉') ? 'love' : 'happy'); }
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
    out.insertAdjacentHTML('beforeend', `<div class="verdict pass">All ${d.tests.length} tests passed 🎉</div>`);
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
async function mermaidSvg(text) {
  const f = await mermaidFrame(), id = ++mmSeq;
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const cfg = { startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: v('--body'),
    themeVariables: { background: v('--card'), primaryColor: v('--bg2'), primaryTextColor: v('--text'), primaryBorderColor: v('--acc'),
                      lineColor: v('--dim'), secondaryColor: v('--card'), tertiaryColor: v('--bg2'), clusterBkg: v('--bg2'),
                      clusterBorder: v('--line2'), fontSize: '13px' } };
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
  $('#app').innerHTML = `<div class="page enter"><a class="back" href="#/">← Home</a>
    <div class="list-head">${blob(CAST.sensei.seed, { size: 72, live: true, mood: done ? 'happy' : 'idle' })}
      <div><div class="kicker" style="color:var(--acc2)">Industry level</div><h1 style="margin:4px 0">Data System Design</h1>
      <div class="dim">From first principles to fully worked case studies: clarify, estimate, design, then defend the trade-offs, the way strong candidates do.</div></div></div>
    <div class="dim" style="display:flex;margin-top:22px;font-size:12px"><span>${done} of ${total} completed</span><span class="sp"></span><span>${total ? Math.round(100 * done / total) : 0}%</span></div>
    <div class="bar"><i style="width:${total ? 100 * done / total : 0}%"></i></div>
    ${total ? '' : `<div class="empty">${blob(CAST.sensei.seed, { size: 64, mood: 'thinking' })}<p>Lessons are being written. Check back soon!</p></div>`}
    ${groups.map(g => `<div class="section-title">${esc(g)}</div>` + d.sections.filter(s => s.group === g).map(s => {
      const ls = d.lessons.filter(l => l.section === s.id);
      return `<div class="ds-section"><div class="ds-sec-head"><h3>${esc(s.title)}</h3><span class="dim">${esc(s.desc)}</span><span class="sp"></span>
        <span class="faint">${ls.filter(l => l.done).length}/${ls.length}</span></div>
        <div class="grid">${ls.map(l => `<a class="card tile ds-tile" href="#/design/${l.id}"><span class="check ${l.done ? 'done' : ''}">${l.done ? '✓' : ''}</span>
          <div class="t"><h4>${esc(l.title)}</h4><p>${esc(l.big_idea)}</p>
          <div class="ds-tags"><span class="tag ${l.kind === 'case_study' ? 'medium' : ''}">${l.kind === 'case_study' ? 'Case study' : 'Lesson'}</span>
          ${l.difficulty ? diffTag(l.difficulty) : ''}${(l.companies || []).slice(0, 2).map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div></div></a>`).join('')}</div></div>`;
    }).join('')).join('')}</div>`;
  follow($('.list-head svg'));
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
      <a class="back" href="#/design">← Data System Design</a>
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
    <aside class="ds-side card">
      <div class="coach-head"><div id="coach">${blob(CAST.sensei.seed, { size: 52, live: true })}</div><div><b>Sensei</b><div class="dim" style="font-size:11.5px">sees what you see</div></div>
        <span class="sp"></span><span class="status" id="status"><i></i>listening</span></div>
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
      messages.push({ role: 'assistant', mood: all ? 'love' : 'happy', content: all ? `Perfect ${quizRight}/${d.quiz.length}! 🎉 Mark it complete and move on, or ask me to go deeper.`
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
      <span class="g-stat">Score <b id="g-score">0</b></span><span class="g-stat" id="g-combo"></span><span class="g-stat">⏱ <b id="g-time">60</b>s</span></div>
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
    if (step === 2 && path === 'api') {
      const p = P[provider];
      $('#app').innerHTML = shell(`<div class="kicker dot">Bring your own key</div><h2>Connect ${esc(p.title)}</h2>
        <div class="chips su-prov">${Object.entries(P).map(([id, v]) => `<button data-v="${id}" class="${id === provider ? 'on' : ''}">${esc(v.title)}${id === 'anthropic' ? ' · recommended' : ''}</button>`).join('')}</div>
        <ol class="su-how"><li>Open <a href="${p.key_url}" target="_blank" rel="noreferrer">${esc(new URL(p.key_url).hostname)}</a> and sign in.</li>
          <li>Create a new API key and copy it.</li><li>Paste it below. It's stored in your DataDojo folder (readable only by you) and never shown again.</li></ol>
        <label>API key</label><div class="su-key"><input class="field" id="su-key" type="password" placeholder="${esc(p.key_hint)}" autocomplete="off" spellcheck="false">
          <button class="ghost" id="su-eye" title="Show / hide">👁</button></div>
        ${st.settings.provider === provider && st.settings.key_hint ? `<div class="faint" style="margin-top:6px">Saved key: ${esc(st.settings.key_hint)}. Leave empty to keep it.</div>` : ''}
        <label>Model</label><select id="su-model" class="field">${p.models.map((m, i) => `<option ${st.settings.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        ${provider === 'anthropic' ? '<div class="faint" style="margin-top:6px">Opus is the sharpest; Sonnet and Haiku are faster and cheaper. Claude requests use automatic safety fallbacks.</div>' : ''}
        <div class="su-msg" id="su-msg"></div>
        <div class="row-end"><button class="ghost" id="su-back">← Back</button><button class="primary" id="su-save">Test & continue</button></div>`);
      document.querySelectorAll('.su-prov button').forEach(b => b.onclick = () => { provider = b.dataset.v; render(); });
      $('#su-eye').onclick = () => { $('#su-key').type = $('#su-key').type === 'password' ? 'text' : 'password'; };
      $('#su-back').onclick = () => { step = 1; render(); };
      $('#su-save').onclick = async () => {
        const key = $('#su-key').value.trim(), keep = !key && st.settings.provider === provider && st.settings.key_hint;
        if (!key && !keep) return void ($('#su-msg').innerHTML = '<span class="fail">Paste your API key first.</span>');
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
      const refresh = async () => { st = await api('/api/setup'); if (step === 2 && path === 'local') render(); };
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

// ---------- modal + router ----------
function modal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
$('#modal-x').onclick = closeModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

let setupKnown = false;
async function setupDone() {
  if (!setupKnown) setupKnown = (await api('/api/setup')).settings.setup_done;
  return setupKnown;
}
async function route() {
  cleanups.forEach(f => f()); cleanups = [];
  closeModal();
  await blobReady;
  let [, page, arg] = location.hash.replace(/^#/, '').split('/');
  if (page !== 'setup' && !(await setupDone())) { location.replace('#/setup'); page = 'setup'; }
  document.body.classList.toggle('ws', page === 'p');
  document.body.classList.toggle('setup-mode', page === 'setup');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on',
    a.dataset.nav === (page === 'lang' ? arg : page === 'design' || page === 'games' ? page : page ? '' : 'home')));
  window.scrollTo(0, 0);
  if (page === 'setup') await setupPage();
  else if (page === 'p') await workspace(arg);
  else if (page === 'feedback') await feedbackPage();
  else if (page === 'design') await (arg ? designLesson(arg) : designHome());
  else if (page === 'games') await (arg ? gamePlay(arg) : gamesHome());
  else if (page === 'lang' && LANGS[arg]) await langPage(arg);
  else if (page === 'pattern' || page === 'list') await problemList(page, arg);
  else await home();
  stagger($('#app')); countUp($('#app'));
}
window.onhashchange = route;
renderThemeToggle();
blobReady.then(renderMe);
api('/api/version').then(v => { if (v.update) $('#nav-update').outerHTML = `<a class="pill-update" href="${esc(v.url)}" target="_blank" rel="noreferrer"
  title="You have ${esc(v.version)}">✨ Update to ${esc(v.latest)}</a>`; });
route();
