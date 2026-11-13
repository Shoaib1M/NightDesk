'use strict';
// Screen time: which app or site is in front while NightDesk runs, by category, per day.
// Only the app/site name and category are saved, never window titles. Idle and locked time is
// not counted. Each day is its own saved item ('screen-YYYY-MM-DD'), kept forever.

// Categories in fixed order (colours validated for light and dark; "Other" is neutral).
const SCREEN_CATS = [
  { id: 'work', name: 'Study & work', light: '#2a78d6', dark: '#3987e5' },
  { id: 'browse', name: 'Browsing', light: '#eb6834', dark: '#d95926' },
  { id: 'chat', name: 'Communication', light: '#1baf7a', dark: '#199e70' },
  { id: 'watch', name: 'Entertainment', light: '#eda100', dark: '#c98500' },
  { id: 'social', name: 'Social', light: '#e87ba4', dark: '#d55181' },
  { id: 'games', name: 'Games', light: '#008300', dark: '#008300' },
  { id: 'other', name: 'Other', light: '#9a9893', dark: '#73726d' },
];
const catColor = (id) => { const c = SCREEN_CATS.find((x) => x.id === id) || SCREEN_CATS[6]; return settings.theme === 'light' ? c.light : c.dark; };
const catName = (id) => (SCREEN_CATS.find((x) => x.id === id) || SCREEN_CATS[6]).name;

// Sites and apps, most specific first: [label, category, pattern on "process title"].
const SCREEN_RULES = [
  ['YouTube', 'watch', /youtube/], ['Netflix', 'watch', /netflix/], ['Prime Video', 'watch', /prime video/], ['Hotstar', 'watch', /hotstar/],
  ['Twitch', 'watch', /twitch/], ['Spotify', 'watch', /spotify/], ['VLC', 'watch', /\bvlc\b/], ['Disney+', 'watch', /disney\+/],
  ['Instagram', 'social', /instagram/], ['Reddit', 'social', /reddit/], ['X', 'social', /twitter| \/ x\b|^x\b/], ['Facebook', 'social', /facebook/],
  ['LinkedIn', 'social', /linkedin/], ['Snapchat', 'social', /snapchat/], ['Threads', 'social', /threads/], ['TikTok', 'social', /tiktok/],
  ['WhatsApp', 'chat', /whatsapp/], ['Telegram', 'chat', /telegram/], ['Discord', 'chat', /discord/], ['Teams', 'chat', /\bteams\b|ms-teams/],
  ['Zoom', 'chat', /\bzoom\b/], ['Slack', 'chat', /slack/], ['Gmail', 'chat', /gmail/], ['Outlook', 'chat', /outlook/],
  ['Steam', 'games', /steam/], ['Epic Games', 'games', /epicgames|epic games/], ['Valorant', 'games', /valorant/], ['Minecraft', 'games', /minecraft/],
  ['Roblox', 'games', /roblox/], ['Genshin Impact', 'games', /genshin/], ['Arknights', 'games', /arknights/], ['League of Legends', 'games', /league of legends|leagueclient/],
  ['Codeforces', 'work', /codeforces/], ['LeetCode', 'work', /leetcode/], ['GitHub', 'work', /github/], ['Stack Overflow', 'work', /stack overflow|stackoverflow/],
  ['GeeksforGeeks', 'work', /geeksforgeeks/], ['ChatGPT', 'work', /chatgpt/], ['Claude', 'work', /^claude |claude\.ai| - claude$/], ['Google Docs', 'work', /google docs/],
  ['Overleaf', 'work', /overleaf/], ['Notion', 'work', /notion/], ['Obsidian', 'work', /obsidian/], ['Coursera', 'work', /coursera/],
  ['VS Code', 'work', /^code /], ['Visual Studio', 'work', /^devenv /], ['IntelliJ IDEA', 'work', /^idea64 /], ['PyCharm', 'work', /^pycharm/],
  ['Word', 'work', /^winword /], ['Excel', 'work', /^excel /], ['PowerPoint', 'work', /^powerpnt /], ['OneNote', 'work', /^onenote /],
  ['Acrobat', 'work', /^acrobat|^acrord32/], ['Terminal', 'work', /^windowsterminal |^cmd |^powershell |^wt /], ['NightDesk', 'work', /^nightdesk /],
  ['Chrome', 'browse', /^chrome /], ['Edge', 'browse', /^msedge /], ['Firefox', 'browse', /^firefox /], ['Brave', 'browse', /^brave /],
  ['Comet', 'browse', /^comet /], ['Opera', 'browse', /^opera /],
  ['File Explorer', 'other', /^explorer /],
];
const SCREEN_IGNORE = /^(lockapp|searchhost|startmenuexperiencehost|shellexperiencehost|idle)$/i;

function classifyWindow(proc, title) {
  const hay = `${proc} ${title}`.toLowerCase();
  for (const [label, cat, re] of SCREEN_RULES) if (re.test(hay)) return { app: label, cat };
  const name = proc ? proc.replace(/\.exe$/i, '') : 'Windows';
  return { app: name.charAt(0).toUpperCase() + name.slice(1), cat: 'other' };
}

// ---------- tracking
const scr = { cur: null, since: 0, paused: false, run: 0, lastWin: null, dayView: 0 };
const screenKey = (day) => 'screen-' + day;
const emptyDay = () => ({ total: 0, apps: {}, appCat: {}, cats: {}, hours: {}, switches: 0, longest: { app: '', ms: 0 } });
const screenDay = (day) => Object.assign(emptyDay(), store.get(screenKey(day), {}));

// Adds the time since the last check to the app in front. A gap of more than two minutes
// (the PC slept, the app froze) is never counted.
function screenAdd(now = Date.now()) {
  const from = scr.since;
  scr.since = now;
  if (!scr.cur || scr.paused || !from) return;
  const ms = Math.min(now - from, 120000);
  if (ms <= 0) return;
  const start = new Date(now - ms), day = ymd(start), d = screenDay(day), hr = start.getHours();
  const { app, cat } = scr.cur;
  d.total += ms;
  d.apps[app] = (d.apps[app] || 0) + ms;
  d.appCat[app] = cat;
  d.cats[cat] = (d.cats[cat] || 0) + ms;
  d.hours[hr] = d.hours[hr] || {};
  d.hours[hr][cat] = (d.hours[hr][cat] || 0) + ms;
  scr.run += ms;
  if (scr.run > d.longest.ms) d.longest = { app, ms: scr.run };
  store.set(screenKey(day), d);
}

function screenOnWindow(w) {
  if (w && window.__fakeWindowsOnly && !w.fake) return; // tests: ignore the real desktop
  if (!w || w.stopped) return;
  scr.lastWin = w;
  if (settings.screenTime === false) return;
  const now = Date.now();
  if (SCREEN_IGNORE.test(w.proc || '')) { screenAdd(now); scr.cur = null; return; }
  const next = classifyWindow(w.proc || '', w.title || '');
  screenAdd(now);
  if (!scr.cur || scr.cur.app !== next.app) {
    if (scr.cur) { const d = screenDay(ymd(new Date(now))); d.switches++; store.set(screenKey(ymd(new Date(now))), d); }
    scr.run = 0;
  }
  scr.cur = next;
}

async function screenTick() {
  if (!api || settings.screenTime === false) { scr.cur = null; return; }
  let state = 'active';
  try { state = (await call(api.focus.idle())) || 'active'; } catch {}
  const now = Date.now();
  if (state !== 'active') { screenAdd(now); scr.paused = true; scr.run = 0; return; }
  if (scr.paused) { scr.paused = false; scr.since = now; return; }
  screenAdd(now);
  if (settings.view === 'screen' && scr.dayView === 0) renderScreen();
}

// ---------- the Screen time tab
const fmtH = (ms) => fmtDur(Math.round(ms / 60000));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function donut(cats, total, size = 210) {
  const r = 78, w = 26, c = size / 2, C = 2 * Math.PI * r;
  const svg = ['<svg viewBox="0 0 ' + size + ' ' + size + '" class="donut" role="img" aria-label="Time by category">'];
  svg.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${w}"/>`);
  let off = 0;
  const gap = total ? 2.2 : 0; // a thin surface gap between slices
  for (const cat of SCREEN_CATS) {
    const ms = cats[cat.id] || 0;
    if (!ms || !total) continue;
    const len = (ms / total) * C;
    const seg = Math.max(0.5, len - gap);
    svg.push(`<circle class="slice" data-cat="${cat.id}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${catColor(cat.id)}" stroke-width="${w}" stroke-dasharray="${seg} ${C - seg}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"><title>${cat.name}: ${fmtH(ms)} (${pct(ms, total)}%)</title></circle>`);
    off += len;
  }
  svg.push(`<text x="${c}" y="${c - 4}" text-anchor="middle" class="d-total">${total ? fmtH(total) : '0m'}</text>`);
  svg.push(`<text x="${c}" y="${c + 18}" text-anchor="middle" class="d-sub">screen time</text></svg>`);
  return svg.join('');
}

function screenInsight(d, week) {
  if (!d.total) return 'Nothing tracked yet for this day. Leave NightDesk running and it fills in as you go.';
  const topCat = Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0];
  const topApp = Object.entries(d.apps).sort((a, b) => b[1] - a[1])[0];
  const fun = (d.cats.watch || 0) + (d.cats.social || 0) + (d.cats.games || 0);
  const busiest = Object.entries(d.hours).map(([hr, v]) => [+hr, Object.values(v).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1])[0];
  const hourName = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString('en', { hour: 'numeric' });
  const tips = [];
  if (topCat[0] === 'work') tips.push(`Most of it was ${catName('work')} (${fmtH(topCat[1])}). ${pet.name} approves.`);
  if (fun >= 30 * 60000) tips.push(`${fmtH(fun)} on videos, social and games: that is ${(fun / (settings.focusMin * 60000)).toFixed(1)} focus blocks.`);
  if (topApp) tips.push(`Most used: ${topApp[0]} for ${fmtH(topApp[1])}.`);
  if (busiest) tips.push(`Busiest hour: ${hourName(busiest[0])}.`);
  if (d.longest.ms >= 20 * 60000) tips.push(`Longest unbroken stretch: ${fmtH(d.longest.ms)} in ${d.longest.app}.`);
  const avg = week.filter((x) => x.total).reduce((a, x) => a + x.total, 0) / Math.max(1, week.filter((x) => x.total).length);
  if (avg && d.total > avg * 1.3) tips.push(`That is ${pct(d.total - avg, avg)}% more screen time than your average.`);
  return tips.slice(0, 3).join(' ');
}

function renderScreen() {
  if (!$('#v-screen') || !$('#v-screen').classList.contains('on')) return;
  const dayDate = addDays(new Date(), -scr.dayView), day = ymd(dayDate), d = screenDay(day);
  const week = [...Array(7)].map((_, i) => ({ date: addDays(dayDate, i - 6), ...screenDay(ymd(addDays(dayDate, i - 6))) }));
  const prev = week.slice(0, 6).filter((x) => x.total);
  const avg = prev.length ? prev.reduce((a, x) => a + x.total, 0) / prev.length : 0;
  const productive = pct(d.cats.work || 0, d.total);

  $('#scr-day').textContent = scr.dayView === 0 ? 'Today' : scr.dayView === 1 ? 'Yesterday' : dayDate.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#scr-next').disabled = scr.dayView === 0;
  $('#scr-donut').innerHTML = donut(d.cats, d.total);
  $('#scr-legend').replaceChildren(...SCREEN_CATS.filter((c) => d.cats[c.id]).sort((a, b) => d.cats[b.id] - d.cats[a.id]).map((c) => {
    const sw = h('i'); sw.style.background = catColor(c.id);
    return h('div', { class: 'lg' }, sw, h('span', {}, c.name), h('b', {}, fmtH(d.cats[c.id])), h('small', {}, pct(d.cats[c.id], d.total) + '%'));
  }));
  if (!d.total) $('#scr-legend').append(h('p', { class: 'empty' }, 'No screen time yet.'));
  $('#scr-insight').textContent = screenInsight(d, week);
  // What you studied that day (focus blocks and logged time), and what distracted you.
  const sessions = study.log.filter((e) => sessionDay(e) === day);
  const bySubj = {};
  for (const e of sessions) bySubj[e.s] = (bySubj[e.s] || 0) + e.m;
  const studiedMin = sessions.reduce((a, e) => a + e.m, 0);
  const away = Object.entries(store.get('distractions', {})[day] || {}).sort((a, b) => b[1] - a[1]);
  const st = $('#scr-studied');
  st.replaceChildren();
  if (studiedMin) st.append('Studied ', h('b', {}, fmtDur(studiedMin)), ': ', Object.entries(bySubj).sort((a, b) => b[1] - a[1]).map(([id, m]) => `${subjName(id)} ${fmtDur(m)}`).join(', '));
  else st.append('No study logged this day.');
  if (away.length) st.append(h('br'), 'Distracted during focus: ', away.map(([a, ms]) => `${a} ${fmtH(ms)}`).join(', '));
  $('#scr-pick').value = day;
  $('#scr-pick').max = ymd(new Date());

  const delta = avg ? Math.round(((d.total - avg) / avg) * 100) : null;
  const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('span', {}, label), h('b', {}, value), h('small', {}, sub));
  $('#scr-kpis').replaceChildren(
    kpi('Screen time', fmtH(d.total), delta == null ? 'no earlier days yet' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs 7-day average`),
    kpi('Productive', productive + '%', `${fmtH(d.cats.work || 0)} on study & work`),
    kpi('App switches', String(d.switches), d.total ? `about every ${fmtDur(Math.max(1, Math.round(d.total / 60000 / Math.max(1, d.switches))))}` : '—'),
    kpi('Longest stretch', d.longest.ms ? fmtH(d.longest.ms) : '—', d.longest.app || 'on one app'));

  // 24-hour day, stacked by category
  const maxHr = Math.max(15 * 60000, ...Object.values(d.hours).map((v) => Object.values(v).reduce((a, b) => a + b, 0)));
  const now = new Date();
  $('#scr-hours').replaceChildren(...[...Array(24)].map((_, hr) => {
    const v = d.hours[hr] || {}, sum = Object.values(v).reduce((a, b) => a + b, 0);
    const stack = h('div', { class: 'stack' });
    for (const c of SCREEN_CATS) if (v[c.id]) { const seg = h('i'); seg.style.height = (v[c.id] / maxHr) * 100 + '%'; seg.style.background = catColor(c.id); stack.append(seg); }
    const label = hr % 6 === 0 ? new Date(2000, 0, 1, hr).toLocaleTimeString('en', { hour: 'numeric' }).replace(' ', '').toLowerCase() : '';
    const tip = `${new Date(2000, 0, 1, hr).toLocaleTimeString('en', { hour: 'numeric' })}: ${fmtH(sum)}` + SCREEN_CATS.filter((c) => v[c.id]).map((c) => `\n${c.name} ${fmtH(v[c.id])}`).join('');
    return h('div', { class: 'col' + (scr.dayView === 0 && hr === now.getHours() ? ' now' : ''), title: tip }, stack, h('span', {}, label));
  }));

  // top apps
  const apps = Object.entries(d.apps).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const top = apps.length ? apps[0][1] : 1;
  $('#scr-apps').replaceChildren(...apps.map(([app, ms]) => {
    const bar = h('i'); bar.style.width = Math.max(2, (ms / top) * 100) + '%'; bar.style.background = catColor(d.appCat[app]);
    return h('div', { class: 'app', title: `${app} · ${catName(d.appCat[app])}` }, h('span', { class: 'nm' }, app), h('div', { class: 'ab' }, bar), h('b', {}, fmtH(ms)));
  }));
  if (!apps.length) $('#scr-apps').append(h('p', { class: 'empty' }, 'Apps you use show up here.'));

  // this week, stacked by category
  const maxDay = Math.max(60 * 60000, ...week.map((x) => x.total));
  $('#scr-week').replaceChildren(...week.map((x, i) => {
    const stack = h('div', { class: 'stack' });
    for (const c of SCREEN_CATS) if (x.cats[c.id]) { const seg = h('i'); seg.style.height = (x.cats[c.id] / maxDay) * 100 + '%'; seg.style.background = catColor(c.id); stack.append(seg); }
    return h('button', { class: 'col' + (i === 6 ? ' sel' : ''), title: `${x.date.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })}: ${fmtH(x.total)}`, onclick: () => { scr.dayView += 6 - i; renderScreen(); } },
      stack, h('span', {}, x.date.toLocaleDateString('en', { weekday: 'narrow' })));
  }));
}

$('#scr-prev').addEventListener('click', () => { scr.dayView++; renderScreen(); });
$('#scr-next').addEventListener('click', () => { scr.dayView = Math.max(0, scr.dayView - 1); renderScreen(); });
// Jump straight to any day, however long ago.
$('#scr-pick').addEventListener('change', (e) => {
  if (!e.target.value) return;
  scr.dayView = Math.max(0, Math.round((parseYmd(ymd(new Date())) - parseYmd(e.target.value)) / 864e5));
  renderScreen();
});
if (api) api.focus.onWindow(screenOnWindow);
on('view', (v) => { if (v === 'screen') { scr.dayView = 0; screenAdd(); renderScreen(); } });
on('settings', () => { if (settings.view === 'screen') renderScreen(); });
setInterval(screenTick, 15000);

// Dev only: a sample day and week for screenshots and tests (not saved unless a test asks).
function screenDemo(save = true) {
  const mk = (seed) => {
    const d = emptyDay();
    const plan = [[9, 'VS Code', 'work', 50], [10, 'Codeforces', 'work', 40], [10, 'Chrome', 'browse', 15], [11, 'YouTube', 'watch', 25], [13, 'WhatsApp', 'chat', 20],
      [14, 'Notion', 'work', 45], [15, 'Instagram', 'social', 18], [16, 'VS Code', 'work', 55], [19, 'Valorant', 'games', 35], [21, 'NightDesk', 'work', 50],
      [22, 'VS Code', 'work', 40], [23, 'YouTube', 'watch', 20], [23, 'File Explorer', 'other', 6]];
    for (const [hr, app, cat, min] of plan) {
      const ms = Math.round(min * (0.6 + ((seed * 7 + hr) % 9) / 10) * 60000);
      d.total += ms; d.apps[app] = (d.apps[app] || 0) + ms; d.appCat[app] = cat; d.cats[cat] = (d.cats[cat] || 0) + ms;
      d.hours[hr] = d.hours[hr] || {}; d.hours[hr][cat] = (d.hours[hr][cat] || 0) + ms;
    }
    d.switches = 140 + seed * 9; d.longest = { app: 'VS Code', ms: (62 + seed * 3) * 60000 };
    return d;
  };
  for (let i = 0; i < 7; i++) if (save) store.set(screenKey(ymd(addDays(new Date(), -i))), mk(i));
  renderScreen();
}
