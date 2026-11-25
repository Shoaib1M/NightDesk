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
  ['Zoom', 'chat', /\bzoom\b/], ['Google Meet', 'chat', /google meet|meet\.google/], ['Slack', 'chat', /slack/], ['Gmail', 'chat', /gmail/], ['Outlook', 'chat', /outlook/],
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
  let hit = null;
  for (const [label, cat, re] of SCREEN_RULES) if (re.test(hay)) { hit = { app: label, cat }; break; }
  if (!hit) { const name = proc ? proc.replace(/\.exe$/i, '') : 'Windows'; hit = { app: name.charAt(0).toUpperCase() + name.slice(1), cat: 'other' }; }
  const mine = (settings.scrCats || {})[hit.app]; // the category you picked for this app
  if (mine && SCREEN_CATS.some((c) => c.id === mine)) hit.cat = mine;
  return hit;
}
const scrIgnored = (app) => (settings.scrIgnore || []).includes(app);
// Videos and calls keep counting while you sit still (up to the two-minute gap rule per check).
const keepsCounting = (cur) => !!cur && (cur.cat === 'watch' || /^(Zoom|Teams|Google Meet|Discord)$/.test(cur.app));

// ---------- tracking
const scr = { cur: null, since: 0, paused: false, run: 0, cont: 0, lastWin: null, dayView: 0, mode: 'day', all: false };
const screenKey = (day) => 'screen-' + day;
// ha: per hour, per app (newer days; lets a category change re-colour the hour chart too).
const emptyDay = () => ({ total: 0, apps: {}, appCat: {}, cats: {}, hours: {}, ha: null, switches: 0, longest: { app: '', ms: 0 }, late: 0, flags: {} });
const screenDay = (day) => Object.assign(emptyDay(), store.get(screenKey(day), {}));

// A day as shown: your own categories applied and untracked apps left out.
function scrView(d) {
  const mine = settings.scrCats || {}, catOf = (a) => mine[a] || d.appCat[a] || 'other';
  const v = { ...d, total: 0, apps: {}, appCat: {}, cats: {}, hours: {} };
  for (const [a, ms] of Object.entries(d.apps || {})) {
    if (scrIgnored(a)) continue;
    const c = catOf(a);
    v.apps[a] = ms; v.appCat[a] = c; v.cats[c] = (v.cats[c] || 0) + ms; v.total += ms;
  }
  if (d.ha) {
    for (const [hr, apps] of Object.entries(d.ha)) for (const [a, ms] of Object.entries(apps)) {
      if (scrIgnored(a)) continue;
      const c = catOf(a);
      v.hours[hr] = v.hours[hr] || {}; v.hours[hr][c] = (v.hours[hr][c] || 0) + ms;
    }
  } else v.hours = d.hours || {};
  return v;
}
// Several days added up (the week view).
function scrSum(days) {
  const s = { ...emptyDay(), days: 0 };
  for (const raw of days) {
    const v = scrView(raw);
    if (v.total) s.days++;
    s.total += v.total; s.switches += v.switches || 0; s.late += v.late || 0;
    for (const [a, ms] of Object.entries(v.apps)) { s.apps[a] = (s.apps[a] || 0) + ms; s.appCat[a] = v.appCat[a]; }
    for (const [c, ms] of Object.entries(v.cats)) s.cats[c] = (s.cats[c] || 0) + ms;
    for (const [hr, cs] of Object.entries(v.hours)) { s.hours[hr] = s.hours[hr] || {}; for (const [c, ms] of Object.entries(cs)) s.hours[hr][c] = (s.hours[hr][c] || 0) + ms; }
    if ((v.longest || {}).ms > s.longest.ms) s.longest = v.longest;
  }
  return s;
}

// ---------- limits and reminders
const limitName = (key) => key === 'total' ? 'screen time' : key.startsWith('cat:') ? catName(key.slice(4)) : key.slice(4);
const limitUsed = (key, v) => key === 'total' ? v.total : key.startsWith('cat:') ? (v.cats[key.slice(4)] || 0) : (v.apps[key.slice(4)] || 0);
const limitColor = (key, v) => key.startsWith('cat:') ? catColor(key.slice(4)) : key.startsWith('app:') ? catColor(v.appCat[key.slice(4)] || 'other') : 'var(--accent)';
const bedMin = () => { const m = /^(\d\d):(\d\d)$/.exec(settings.scrBed || ''); return m ? +m[1] * 60 + +m[2] : null; };
// From bedtime until 5 am counts as late (a bedtime after midnight: from then until 5 am).
function isLate(date) {
  const b = bedMin();
  if (b == null) return false;
  const t = date.getHours() * 60 + date.getMinutes();
  return b >= 300 ? (t >= b || t < 300) : (t >= b && t < 300);
}
const bedLabel = () => { const b = bedMin(); return new Date(2000, 0, 1, Math.floor(b / 60), b % 60).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', hour12: !settings.h24 }); };

// Called after each bit of counted time today: daily limits, breaks and bedtime.
function screenWatch(d, day, now) {
  let changed = false;
  d.flags = d.flags || {};
  const v = scrView(d);
  for (const [key, min] of Object.entries(settings.scrLimits || {})) {
    if (!(min > 0)) continue;
    const used = limitUsed(key, v), cap = min * 60000, name = limitName(key);
    // Only speak up while you are using what the limit is for (a limit set when already over is quiet).
    const using = key === 'total' || (scr.cur && (key === 'cat:' + scr.cur.cat || key === 'app:' + scr.cur.app));
    if (!using) { if (used >= cap && d.flags[key] !== 'over') { d.flags[key] = 'over'; changed = true; } continue; }
    if (used >= cap && d.flags[key] !== 'over') {
      d.flags[key] = 'over'; changed = true;
      buddySay(`That's your ${fmtDur(min)} of ${name} for today. Time for something else?`, 12000);
      notify(`Daily limit reached: ${name}`, `You've used your ${fmtDur(min)} for today.`);
    } else if (used < cap && used >= cap - 10 * 60000 && min >= 20 && !d.flags[key]) {
      d.flags[key] = 'warn'; changed = true;
      buddySay(`10 minutes of ${name} left for today.`, 9000);
    }
  }
  if (settings.scrBreak > 0 && scr.cont >= settings.scrBreak * 60000) {
    scr.cont = 0;
    if (!pomo.running) { // focus blocks have their own breaks
      buddySay(`${fmtDur(settings.scrBreak)} on screen without a break. Look at something far away for 20 seconds and stretch?`, 12000);
      notify('Time for a short break', 'Look at something 20 feet away for 20 seconds, stand up, drink some water.');
    }
  }
  const night = ymd(now.getHours() < 5 ? addDays(now, -1) : now);
  if (isLate(now) && store.get('scrBedNudged', '') !== night) {
    store.set('scrBedNudged', night);
    buddySay(`It's past your bedtime (${bedLabel()}). Sleep is when memory sticks. Wrap up?`, 15000);
    notify('Past your bedtime', `You set ${bedLabel()}. Time to wind down.`);
  }
  return changed;
}

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
  d.ha = d.ha || {}; d.ha[hr] = d.ha[hr] || {};
  d.ha[hr][app] = (d.ha[hr][app] || 0) + ms;
  if (isLate(start)) d.late = (d.late || 0) + ms;
  scr.run += ms;
  scr.cont += ms;
  if (scr.run > d.longest.ms) d.longest = { app, ms: scr.run };
  if (day === ymd(new Date(now))) screenWatch(d, day, new Date(now));
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
  if (scrIgnored(next.app)) { scr.cur = null; return; }
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
  // No mouse or keys for 2 minutes: paused, unless a video or call is in front. Locked: always paused.
  if (state === 'locked' || (state !== 'active' && !keepsCounting(scr.cur))) { screenAdd(now); scr.paused = true; scr.run = 0; scr.cont = 0; return; }
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

const hourName = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString('en', { hour: 'numeric' });

function screenInsight(d, week) {
  if (!d.total) return 'Nothing tracked yet for this day. Leave NightDesk running and it fills in as you go.';
  const topCat = Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0];
  const topApp = Object.entries(d.apps).sort((a, b) => b[1] - a[1])[0];
  const fun = (d.cats.watch || 0) + (d.cats.social || 0) + (d.cats.games || 0);
  const busiest = Object.entries(d.hours).map(([hr, v]) => [+hr, Object.values(v).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1])[0];
  const tips = [];
  const over = Object.entries(settings.scrLimits || {}).filter(([k, m]) => m > 0 && limitUsed(k, d) >= m * 60000);
  if (over.length) tips.push(`Over your limit for ${over.map(([k]) => limitName(k)).join(' and ')}.`);
  if (topCat[0] === 'work') tips.push(`Most of it was ${catName('work')} (${fmtH(topCat[1])}). ${pet.name} approves.`);
  if (fun >= 30 * 60000) tips.push(`${fmtH(fun)} on videos, social and games: that is ${(fun / (settings.focusMin * 60000)).toFixed(1)} focus blocks.`);
  if (d.late >= 15 * 60000) tips.push(`${fmtH(d.late)} after your bedtime.`);
  if (topApp) tips.push(`Most used: ${topApp[0]} for ${fmtH(topApp[1])}.`);
  if (busiest) tips.push(`Busiest hour: ${hourName(busiest[0])}.`);
  if (d.longest.ms >= 20 * 60000) tips.push(`Longest unbroken stretch: ${fmtH(d.longest.ms)} in ${d.longest.app}.`);
  const avg = week.filter((x) => x.total).reduce((a, x) => a + x.total, 0) / Math.max(1, week.filter((x) => x.total).length);
  if (avg && d.total > avg * 1.3) tips.push(`That is ${pct(d.total - avg, avg)}% more screen time than your average.`);
  return tips.slice(0, 3).join(' ');
}

// The weekly report: how this week compares with the one before.
function weekInsight(w, before, days) {
  if (!w.total) return 'Nothing tracked this week yet.';
  const tips = [];
  if (before.total) {
    const ch = Math.round(((w.total - before.total) / before.total) * 100);
    tips.push(`${fmtH(w.total)} this week, ${Math.abs(ch)}% ${ch >= 0 ? 'more' : 'less'} than the week before.`);
    const moved = SCREEN_CATS.map((c) => [c, (w.cats[c.id] || 0) - (before.cats[c.id] || 0)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (moved && Math.abs(moved[1]) >= 30 * 60000) tips.push(`${moved[0].name} ${moved[1] > 0 ? 'up' : 'down'} ${fmtH(Math.abs(moved[1]))}.`);
  } else tips.push(`${fmtH(w.total)} this week.`);
  const best = days.filter((x) => x.total).sort((a, b) => (b.cats.work || 0) - (a.cats.work || 0))[0];
  if (best && best.cats.work) tips.push(`Most focused day: ${best.date.toLocaleDateString('en', { weekday: 'long' })} (${fmtH(best.cats.work)} of study & work).`);
  if (w.late >= 30 * 60000) tips.push(`${fmtH(w.late)} after bedtime this week.`);
  return tips.slice(0, 3).join(' ');
}

function stackOf(cats, max) {
  const stack = h('div', { class: 'stack' });
  for (const c of SCREEN_CATS) if (cats[c.id]) { const seg = h('i'); seg.style.height = (cats[c.id] / max) * 100 + '%'; seg.style.background = catColor(c.id); stack.append(seg); }
  return stack;
}

function renderScreen() {
  if (!$('#v-screen') || !$('#v-screen').classList.contains('on')) return;
  const week = scr.mode === 'week';
  const dayDate = addDays(new Date(), -scr.dayView), day = ymd(dayDate);
  const days = [...Array(7)].map((_, i) => { const date = addDays(dayDate, i - 6); return { date, ...scrView(screenDay(ymd(date))) }; });
  const before = week ? scrSum([...Array(7)].map((_, i) => screenDay(ymd(addDays(dayDate, i - 13))))) : null;
  const d = week ? scrSum(days.map((x) => screenDay(ymd(x.date)))) : days[6];
  const prev = days.slice(0, 6).filter((x) => x.total);
  const avg = prev.length ? prev.reduce((a, x) => a + x.total, 0) / prev.length : 0;
  const productive = pct(d.cats.work || 0, d.total);
  const short = (x) => x.toLocaleDateString('en', { day: 'numeric', month: 'short' });

  $$('#scr-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === scr.mode));
  $('#scr-prev').setAttribute('aria-label', week ? 'Previous week' : 'Previous day');
  $('#scr-next').setAttribute('aria-label', week ? 'Next week' : 'Next day');
  $('#scr-day').textContent = week ? (scr.dayView === 0 ? 'This week' : `${short(days[0].date)} – ${short(dayDate)}`)
    : scr.dayView === 0 ? 'Today' : scr.dayView === 1 ? 'Yesterday' : dayDate.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#scr-next').disabled = scr.dayView === 0;
  $('#scr-donut').innerHTML = donut(d.cats, d.total);
  if (week) $('#scr-donut .d-sub').textContent = 'this week';
  $('#scr-legend').replaceChildren(...SCREEN_CATS.filter((c) => d.cats[c.id]).sort((a, b) => d.cats[b.id] - d.cats[a.id]).map((c) => {
    const sw = h('i'); sw.style.background = catColor(c.id);
    return h('div', { class: 'lg' }, sw, h('span', {}, c.name), h('b', {}, fmtH(d.cats[c.id])), h('small', {}, pct(d.cats[c.id], d.total) + '%'));
  }));
  if (!d.total) $('#scr-legend').append(h('p', { class: 'empty' }, 'No screen time yet.'));

  // Daily limits for the day shown (a week shows the daily average against each limit).
  const lims = Object.entries(settings.scrLimits || {}).filter(([, m]) => m > 0);
  $('.scr-left').classList.toggle('has-limits', lims.length > 0);
  $('#scr-limits').replaceChildren(...(lims.length ? [h('h4', {}, week ? 'Daily limits · average day' : 'Daily limits')] : []), ...lims.map(([key, min]) => {
    const used = limitUsed(key, d) / (week ? Math.max(1, d.days) : 1), cap = min * 60000, over = used >= cap;
    const bar = h('i'); bar.style.width = Math.min(100, (used / cap) * 100) + '%'; bar.style.background = over ? 'var(--warn, #e5484d)' : limitColor(key, d);
    return h('div', { class: 'lim' + (over ? ' over' : ''), title: `Limit: ${fmtDur(min)} a day` },
      h('span', {}, key === 'total' ? 'All screen time' : limitName(key)), h('div', { class: 'ab' }, bar),
      h('small', {}, `${fmtH(used)} / ${fmtDur(min)}`));
  }));

  $('#scr-insight').textContent = week ? weekInsight(d, before, days) : screenInsight(d, days);
  // What you studied (focus blocks and logged time), and what distracted you.
  const inRange = (x) => week ? days.some((y) => ymd(y.date) === x) : x === day;
  const sessions = study.log.filter((e) => inRange(sessionDay(e)));
  const bySubj = {};
  for (const e of sessions) bySubj[e.s] = (bySubj[e.s] || 0) + e.m;
  const studiedMin = sessions.reduce((a, e) => a + e.m, 0);
  const awayAll = store.get('distractions', {}), awayBy = {};
  for (const [k, apps] of Object.entries(awayAll)) if (inRange(k)) for (const [a, ms] of Object.entries(apps)) awayBy[a] = (awayBy[a] || 0) + ms;
  const away = Object.entries(awayBy).sort((a, b) => b[1] - a[1]);
  const st = $('#scr-studied');
  st.replaceChildren();
  if (studiedMin) st.append('Studied ', h('b', {}, fmtDur(studiedMin)), ': ', Object.entries(bySubj).sort((a, b) => b[1] - a[1]).map(([id, m]) => `${subjName(id)} ${fmtDur(m)}`).join(', '));
  else st.append(week ? 'No study logged this week.' : 'No study logged this day.');
  if (away.length) st.append(h('br'), 'Distracted during focus: ', away.slice(0, 4).map(([a, ms]) => `${a} ${fmtH(ms)}`).join(', '));
  $('#scr-pick').value = day;
  $('#scr-pick').max = ymd(new Date());

  const kpi = (label, value, sub) => h('div', { class: 'kpi' }, h('span', {}, label), h('b', {}, value), h('small', {}, sub));
  if (week) {
    const ch = before.total ? Math.round(((d.total - before.total) / before.total) * 100) : null;
    const best = days.filter((x) => x.total).sort((a, b) => (b.cats.work || 0) - (a.cats.work || 0))[0];
    $('#scr-kpis').replaceChildren(
      kpi('This week', fmtH(d.total), ch == null ? 'no week before to compare' : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs the week before`),
      kpi('Daily average', fmtH(d.total / Math.max(1, d.days)), `${d.days} day${d.days === 1 ? '' : 's'} tracked`),
      kpi('Productive', productive + '%', `${fmtH(d.cats.work || 0)} on study & work`),
      kpi('Most focused day', best && best.cats.work ? best.date.toLocaleDateString('en', { weekday: 'long' }) : '—', best && best.cats.work ? `${fmtH(best.cats.work)} of study & work` : 'no study & work yet'));
  } else {
    const delta = avg ? Math.round(((d.total - avg) / avg) * 100) : null;
    $('#scr-kpis').replaceChildren(
      kpi('Screen time', fmtH(d.total), delta == null ? 'no earlier days yet' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs 7-day average`),
      kpi('Productive', productive + '%', `${fmtH(d.cats.work || 0)} on study & work`),
      kpi('App switches', String(d.switches), d.total ? `about every ${fmtDur(Math.max(1, Math.round(d.total / 60000 / Math.max(1, d.switches))))}` : '—'),
      kpi('Longest stretch', d.longest.ms ? fmtH(d.longest.ms) : '—', d.longest.app || 'on one app'));
  }

  // 24 hours, stacked by category (a week: all seven days added up, so your usual rhythm shows)
  $('#scr-hours-h').replaceChildren(week ? 'Your week ' : 'Your day ', h('small', {}, week ? 'hour by hour, all 7 days together' : 'hour by hour'));
  const maxHr = Math.max(15 * 60000, ...Object.values(d.hours).map((v) => Object.values(v).reduce((a, b) => a + b, 0)));
  const now = new Date(), b = bedMin();
  $('#scr-hours').replaceChildren(...[...Array(24)].map((_, hr) => {
    const v = d.hours[hr] || {}, sum = Object.values(v).reduce((a, x) => a + x, 0);
    const label = hr % 6 === 0 ? hourName(hr).replace(' ', '').toLowerCase() : '';
    const tip = `${hourName(hr)}: ${fmtH(sum)}` + SCREEN_CATS.filter((c) => v[c.id]).map((c) => `\n${c.name} ${fmtH(v[c.id])}`).join('');
    const late = b != null && isLate(new Date(2000, 0, 1, hr, 30));
    return h('div', { class: 'col' + (!week && scr.dayView === 0 && hr === now.getHours() ? ' now' : '') + (late ? ' late' : ''), title: tip + (late ? '\nafter bedtime' : '') }, stackOf(v, maxHr), h('span', {}, label));
  }));

  // apps: the top six, or all of them
  const allApps = Object.entries(d.apps).sort((a, b) => b[1] - a[1]);
  const apps = scr.all ? allApps : allApps.slice(0, 6);
  const top = apps.length ? apps[0][1] : 1;
  $('#scr-all').hidden = allApps.length <= 6;
  $('#scr-all').textContent = scr.all ? 'Top 6' : `All ${allApps.length}`;
  $('#scr-apps').classList.toggle('all', scr.all);
  $('#scr-apps').replaceChildren(...apps.map(([app, ms]) => {
    const bar = h('i'); bar.style.width = Math.max(2, (ms / top) * 100) + '%'; bar.style.background = catColor(d.appCat[app]);
    const lim = (settings.scrLimits || {})['app:' + app];
    return h('button', { class: 'app', title: `${app} · ${catName(d.appCat[app])}${lim ? ` · limit ${fmtDur(lim)} a day` : ''}\nClick to change`, onclick: (e) => appMenu(app, d.appCat[app], e.currentTarget) },
      h('span', { class: 'nm' }, app), h('div', { class: 'ab' }, bar), h('b', {}, fmtH(ms)));
  }));
  if (!apps.length) $('#scr-apps').append(h('p', { class: 'empty' }, 'Apps you use show up here.'));

  // the seven days
  $('#scr-week-h').replaceChildren(week ? 'This week ' : 'Last 7 days ', h('small', {}, 'click a day'));
  const maxDay = Math.max(60 * 60000, ...days.map((x) => x.total));
  $('#scr-week').replaceChildren(...days.map((x, i) => h('button', { class: 'col' + (i === 6 && !week ? ' sel' : ''), title: `${x.date.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })}: ${fmtH(x.total)}`, onclick: () => { scr.dayView += 6 - i; scr.mode = 'day'; renderScreen(); } },
    stackOf(x.cats, maxDay), h('span', {}, x.date.toLocaleDateString('en', { weekday: 'narrow' })))));
}

// ---------- click an app: change its category, give it a limit, or stop tracking it
function appMenu(app, cat, btn) {
  const m = $('#scr-menu'), close = () => { m.hidden = true; };
  const setCat = (id) => {
    const mine = { ...(settings.scrCats || {}) };
    const rule = SCREEN_RULES.find(([label]) => label === app);
    if ((rule ? rule[1] : 'other') === id) delete mine[app]; else mine[app] = id;
    settings.scrCats = mine; saveSettings();
    if (scr.cur && scr.cur.app === app) scr.cur.cat = id;
    close(); renderScreen();
    toast(`${app} now counts as ${catName(id)}`);
  };
  const lim = (settings.scrLimits || {})['app:' + app];
  m.replaceChildren(
    h('div', { class: 'sm-h' }, `${app} counts as`),
    ...SCREEN_CATS.map((c) => { const sw = h('i'); sw.style.background = catColor(c.id); return h('button', { class: c.id === cat ? 'on' : '', onclick: () => setCat(c.id) }, sw, c.name, c.id === cat ? ' ✓' : ''); }),
    h('hr'),
    h('button', { onclick: () => { close(); setLimit('app:' + app, lim || 30); openScreenPanel(); } }, lim ? `Daily limit: ${fmtDur(lim)}…` : 'Set a daily limit…'),
    h('button', { class: 'danger', onclick: () => {
      close();
      settings.scrIgnore = [...new Set([...(settings.scrIgnore || []), app])]; saveSettings();
      if (scr.cur && scr.cur.app === app) { screenAdd(); scr.cur = null; }
      renderScreen();
      toast(`${app} is no longer tracked`, { label: 'Undo', fn: () => { settings.scrIgnore = settings.scrIgnore.filter((a) => a !== app); saveSettings(); renderScreen(); } });
    } }, 'Stop tracking this app'));
  const r = btn.getBoundingClientRect(), wrap = $('#v-screen .scr').getBoundingClientRect();
  m.hidden = false;
  m.style.left = Math.max(6, r.left - wrap.left) + 'px';
  m.style.top = Math.max(6, Math.min(r.bottom - wrap.top + 4, wrap.height - m.offsetHeight - 6)) + 'px';
}

function setLimit(key, min) {
  const all = { ...(settings.scrLimits || {}) };
  if (min > 0) all[key] = Math.min(24 * 60, Math.round(min)); else delete all[key];
  settings.scrLimits = all; saveSettings();
  // a new or raised limit can warn again today
  const day = ymd(new Date()), d = screenDay(day);
  if (d.flags && d.flags[key]) { delete d.flags[key]; store.set(screenKey(day), d); }
}

// ---------- the limits & reminders panel
function openScreenPanel() {
  const p = $('#scr-panel');
  const recent = scrSum([...Array(7)].map((_, i) => screenDay(ymd(addDays(new Date(), -i)))));
  const minInput = (val, onset, label) => {
    const i = h('input', { type: 'number', min: '0', max: '1440', step: '5', 'aria-label': label });
    i.value = val;
    i.addEventListener('change', () => { onset(Math.max(0, Math.min(1440, Math.round(+i.value || 0)))); });
    return i;
  };
  const paint = () => {
    const lims = Object.entries(settings.scrLimits || {});
    const choices = [['total', 'All screen time'], ...SCREEN_CATS.filter((c) => c.id !== 'other').map((c) => ['cat:' + c.id, c.name]),
      ...Object.entries(recent.apps).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([a]) => ['app:' + a, a])].filter(([k]) => !(k in (settings.scrLimits || {})));
    const add = h('select', { 'aria-label': 'Add a limit' }, h('option', { value: '' }, '+ Add a limit for…'), choices.map(([k, n]) => h('option', { value: k }, n)));
    add.addEventListener('change', () => { if (add.value) { setLimit(add.value, add.value === 'total' ? 360 : 60); paint(); renderScreen(); } });
    const bed = h('input', { type: 'time', 'aria-label': 'Bedtime' });
    bed.value = settings.scrBed || '';
    bed.addEventListener('change', () => { settings.scrBed = bed.value || ''; saveSettings(); renderScreen(); });
    const ign = settings.scrIgnore || [];
    p.replaceChildren(...[
      h('h3', {}, 'Daily limits', h('div', { class: 'sp' }), h('button', { class: 'ib', 'aria-label': 'Close', html: icon('close'), onclick: () => { p.hidden = true; } })),
      h('p', { class: 'hint' }, `${pet.name} warns you 10 minutes before and tells you when you reach one. Nothing is blocked.`),
      ...lims.map(([key, min]) => h('div', { class: 'srow lrow' }, h('span', {}, key === 'total' ? 'All screen time' : limitName(key)),
        minInput(min, (v) => { setLimit(key, v); paint(); renderScreen(); }, 'Minutes a day for ' + limitName(key)), h('small', {}, 'min'),
        h('button', { class: 'ib', 'aria-label': 'Remove limit', html: icon('close'), onclick: () => { setLimit(key, 0); paint(); renderScreen(); } }))),
      add,
      h('h3', {}, 'Reminders'),
      h('label', { class: 'srow lrow' }, h('span', {}, 'Break after', h('small', {}, 'minutes of screen time without a 2-minute pause. 0 is off')),
        minInput(settings.scrBreak || 0, (v) => { settings.scrBreak = v; saveSettings(); }, 'Break reminder minutes'), h('small', {}, 'min')),
      h('label', { class: 'srow lrow' }, h('span', {}, 'Bedtime', h('small', {}, 'a nudge once a night, and late screen time is marked')), bed,
        h('button', { class: 'btn sm', onclick: () => { settings.scrBed = ''; saveSettings(); paint(); renderScreen(); } }, 'Off')),
      ign.length ? h('h3', {}, 'Not tracked') : null,
      ...ign.map((a) => h('div', { class: 'srow lrow' }, h('span', {}, a), h('button', { class: 'btn sm', onclick: () => { settings.scrIgnore = (settings.scrIgnore || []).filter((x) => x !== a); saveSettings(); paint(); renderScreen(); } }, 'Track again'))),
    ].filter(Boolean));
  };
  paint();
  p.hidden = false;
}

$('#scr-gear').innerHTML = icon('gear');
$('#scr-gear').addEventListener('click', () => { if ($('#scr-panel').hidden) openScreenPanel(); else $('#scr-panel').hidden = true; });
$$('#scr-mode button').forEach((b) => b.addEventListener('click', () => { scr.mode = b.dataset.mode; renderScreen(); }));
$('#scr-all').addEventListener('click', () => { scr.all = !scr.all; renderScreen(); });
document.addEventListener('mousedown', (e) => {
  if (!$('#scr-menu').hidden && !e.target.closest('#scr-menu')) $('#scr-menu').hidden = true;
  if (!$('#scr-panel').hidden && !e.target.closest('#scr-panel, #scr-gear, #scr-menu, .toast')) $('#scr-panel').hidden = true;
});
$('#scr-prev').addEventListener('click', () => { scr.dayView += scr.mode === 'week' ? 7 : 1; renderScreen(); });
$('#scr-next').addEventListener('click', () => { scr.dayView = Math.max(0, scr.dayView - (scr.mode === 'week' ? 7 : 1)); renderScreen(); });
// Jump straight to any day, however long ago.
$('#scr-pick').addEventListener('change', (e) => {
  if (!e.target.value) return;
  scr.dayView = Math.max(0, Math.round((parseYmd(ymd(new Date())) - parseYmd(e.target.value)) / 864e5));
  renderScreen();
});
if (api) api.focus.onWindow(screenOnWindow);
on('view', (v) => { if (v === 'screen') { scr.dayView = 0; screenAdd(); renderScreen(); } else { $('#scr-menu').hidden = true; $('#scr-panel').hidden = true; } });
on('settings', () => { if (settings.view === 'screen') renderScreen(); });
setInterval(screenTick, 15000);

// Dev only: a sample day and week for screenshots and tests (not saved unless a test asks).
function screenDemo(save = true) {
  const mk = (seed) => {
    const d = emptyDay();
    const plan = [[9, 'VS Code', 'work', 50], [10, 'Codeforces', 'work', 40], [10, 'Chrome', 'browse', 15], [11, 'YouTube', 'watch', 25], [13, 'WhatsApp', 'chat', 20],
      [14, 'Notion', 'work', 45], [15, 'Instagram', 'social', 18], [16, 'VS Code', 'work', 55], [19, 'Valorant', 'games', 35], [21, 'NightDesk', 'work', 50],
      [22, 'VS Code', 'work', 40], [23, 'YouTube', 'watch', 20], [23, 'File Explorer', 'other', 6], [12, 'Spotify', 'watch', 8], [17, 'Discord', 'chat', 12]];
    for (const [hr, app, cat, min] of plan) {
      const ms = Math.round(min * (0.6 + ((seed * 7 + hr) % 9) / 10) * (seed >= 7 ? 1.15 : 1) * 60000);
      d.total += ms; d.apps[app] = (d.apps[app] || 0) + ms; d.appCat[app] = cat; d.cats[cat] = (d.cats[cat] || 0) + ms;
      d.hours[hr] = d.hours[hr] || {}; d.hours[hr][cat] = (d.hours[hr][cat] || 0) + ms;
      d.ha = d.ha || {}; d.ha[hr] = d.ha[hr] || {}; d.ha[hr][app] = (d.ha[hr][app] || 0) + ms;
      if (hr >= 23) d.late += ms;
    }
    d.switches = 140 + seed * 9; d.longest = { app: 'VS Code', ms: (62 + seed * 3) * 60000 };
    return d;
  };
  for (let i = 0; i < 14; i++) if (save) store.set(screenKey(ymd(addDays(new Date(), -i))), mk(i));
  renderScreen();
}
// Dev only: limits and a bedtime for screenshots.
function screenDemoLimits() {
  settings.scrLimits = { total: 420, 'cat:watch': 45, 'app:Instagram': 20 };
  settings.scrBed = '23:00';
  saveSettings(); renderScreen();
}
