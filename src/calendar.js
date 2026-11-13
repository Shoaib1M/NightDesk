'use strict';
// Month calendar (Google Calendar when connected, local events otherwise) and Codeforces contests.

const cal = {
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  sel: ymd(new Date()),
  google: [], connected: false, editing: null, syncedAt: null, error: '',
  contests: store.get('cfCache', []), // last list fetched, so contests still show offline
};
const localEvents = () => store.get('events', []);
const gridStart = () => addDays(cal.month, -((cal.month.getDay() + 6) % 7));
const toDate = (s, allDay) => (allDay ? parseYmd(s) : new Date(s));

function allEvents() {
  const out = cal.google.map((e) => ({ ...e, src: 'google', start: toDate(e.start, e.allDay), end: toDate(e.end, e.allDay) }));
  for (const e of localEvents()) {
    out.push({ ...e, src: 'local', start: toDate(e.start, e.allDay), end: toDate(e.end, e.allDay), color: 'var(--accent)', editable: true });
  }
  if (settings.cfInCalendar) {
    for (const c of cal.contests) {
      if (out.some((e) => e.title === c.name && Math.abs(e.start - c.start) < 60000)) continue;
      out.push({ id: 'cf' + c.id, src: 'cf', title: c.name, start: new Date(c.start), end: new Date(c.start + c.duration), allDay: false, color: '#e0a040', editable: false, url: `https://codeforces.com/contests/${c.id}` });
    }
  }
  if (typeof examEvents === 'function') out.push(...examEvents());
  return out.sort((a, b) => a.start - b.start);
}
function eventsOn(events, day) {
  const next = addDays(day, 1);
  return events.filter((e) => e.start < next && (e.end > day || (+e.end === +e.start && e.start >= day)));
}

// ---------- keeping Google connected
// The app renews Google access by itself for as long as the login lasts. Google ends logins of apps
// still in "Testing" after 7 days, and only the user can approve a new one, so: a reminder on day 6,
// an alert if it signs out, and a one-click Reconnect. A login that outlives 7 days belongs to a
// published app and lasts for good, so the reminders stop.
const GOOGLE_TEST_LIMIT = 7 * 864e5;
function googleReminder(st, now = Date.now()) {
  cal.remindReconnect = false;
  if (!st || !st.configured) return '';
  const today = ymd(new Date(now));
  if (!st.connected) {
    if (store.get('gcalOutNotified', '') !== today) {
      store.set('gcalOutNotified', today);
      notify('Google Calendar signed out', 'Open Nightdesk → Calendar and press Reconnect. It takes one click.');
      buddySay('Google Calendar signed out. Press Reconnect on the Calendar tab.', 15000);
      return 'signed-out';
    }
    return '';
  }
  if (store.get('gcalLasting', false) || !(st.connectedAt > 0)) return '';
  const age = now - st.connectedAt;
  if (age > GOOGLE_TEST_LIMIT + 12 * 3600000) { store.set('gcalLasting', true); return 'lasting'; }
  if (age > 6 * 864e5) {
    cal.remindReconnect = true;
    if (store.get('gcalRemindDay', '') !== today) {
      store.set('gcalRemindDay', today);
      const ends = new Date(st.connectedAt + GOOGLE_TEST_LIMIT).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      notify('Reconnect Google Calendar today', `Google may sign Nightdesk out around ${ends}. Open Calendar → Reconnect (one click), or publish your Google Cloud app to stop this for good.`);
      buddySay(`Google Calendar needs a quick reconnect before ${ends}. Calendar tab → Reconnect.`, 15000);
      return 'reminded';
    }
  }
  return '';
}

async function syncCalendar() {
  if (api) {
    try {
      const gst = await call(api.gcal.status());
      cal.gst = gst;
      cal.connected = gst.connected;
      googleReminder(gst);
      if (cal.connected) {
        const from = gridStart(), to = addDays(from, 42), now = new Date(), soon = addDays(now, 30);
        const ranges = [[from, to]];
        if (now < from || soon > to) ranges.push([now, soon]);
        const lists = await Promise.all(ranges.map(([a, b]) => call(api.gcal.list(a.toISOString(), b.toISOString()))));
        const seen = new Map();
        lists.flat().forEach((e) => seen.set(e.calendarId + e.id, e));
        cal.google = [...seen.values()];
        cal.syncedAt = new Date();
      } else cal.google = [];
      cal.error = '';
    } catch (err) { cal.error = err.message; }
  }
  renderCal();
 
}

function renderCal() {
  const m = cal.month, events = allEvents(), today = ymd(new Date()), start = gridStart();
  $('#cal-title').textContent = m.toLocaleString('en', { month: 'long', year: 'numeric' });
  $('#cal-pick').value = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
  const st = $('#cal-status');
  st.className = 'status' + (cal.error ? ' err' : '');
  st.textContent = cal.error || (cal.connected ? `Google Calendar · synced ${cal.syncedAt ? fmtTime(cal.syncedAt) : ''}` : 'Saved on this PC · connect Google in Settings');
  // If Google ever signs out, one click reconnects with the saved credentials (just approve in the browser).
  const signedOut = !!(cal.gst && cal.gst.configured && !cal.gst.connected);
  if (signedOut && !cal.error) st.textContent = 'Google Calendar signed out · press Reconnect';
  if (cal.remindReconnect && !cal.error) st.textContent = `Google Calendar · reconnect before ${new Date(cal.gst.connectedAt + GOOGLE_TEST_LIMIT).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  let rc = $('#cal-reconnect');
  if ((cal.error && /expired|sign.?in/i.test(cal.error)) || signedOut || cal.remindReconnect) {
    if (!rc) {
      rc = h('button', { class: 'btn sm pri', id: 'cal-reconnect', onclick: async () => {
        rc.disabled = true; rc.textContent = 'Approve in your browser…';
        try { await call(api.gcal.connect({})); cal.error = ''; store.set('gcalRemindDay', ''); syncCalendar(); } catch (err) { toast(err.message); }
        rc.disabled = false; rc.textContent = 'Reconnect';
      } }, 'Reconnect');
      st.after(rc);
    }
  } else if (rc) rc.remove();
  const fills = dayFills();
  $('#cal-grid').replaceChildren(...[...Array(42)].map((_, i) => {
    const d = addDays(start, i), key = ymd(d), list = eventsOn(events, d), fill = DAY_COLORS.find(([id]) => id === fills[key]);
    const cell = h('button', {
      class: 'day' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (key === today ? ' today' : '') + (key === cal.sel ? ' sel' : '') + (fill ? ' filled' : ''),
      title: fill ? `${fill[1]} · double-click to clear` : 'Double-click to fill',
      onclick: () => dayClick(key),
    }, h('span', { class: 'dn' }, d.getDate()),
      list.slice(0, 3).map((e) => { const c = h('span', { class: 'chip' }, e.title); c.style.setProperty('--c', e.color); return c; }),
      list.length > 3 && h('span', { class: 'more' }, `+${list.length - 3} more`));
    if (fill) cell.style.setProperty('--fill', fill[2]);
    return cell;
  }));
  renderDayColors(fills[cal.sel]);

  const day = parseYmd(cal.sel);
  $('#day-title').textContent = day.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
  const todays = eventsOn(events, day);
  $('#day-list').replaceChildren(...todays.map((e) => {
    const el = h('div', { class: 'ev' },
      h('div', { class: 't' }, e.title),
      h('div', { class: 'm' }, (e.allDay ? 'All day' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`) + ' · ' + { google: 'Google', local: 'This PC', cf: 'Codeforces', exam: 'Exam' }[e.src]),
      h('div', { class: 'a' },
        e.editable && h('button', { class: 'btn sm', onclick: () => editEvent(e) }, 'Edit'),
        e.editable && h('button', { class: 'btn sm danger', onclick: () => deleteEvent(e) }, 'Delete'),
        e.url && h('button', { class: 'btn sm', onclick: () => api && api.app.open(e.url) }, 'Open')));
    el.style.setProperty('--c', e.color);
    return el;
  }));
  if (!todays.length) $('#day-list').append(h('p', { class: 'empty' }, 'Nothing planned.'));
  $('#ev-hint').textContent = cal.connected ? 'New events are saved to your Google Calendar.' : 'New events are saved on this PC.';
}

// ---------- post-it day fills (saved on this PC)
const DAY_COLORS = [
  ['yellow', 'Lemon', '#fff3a3'], ['pink', 'Blush', '#ffd3e0'], ['peach', 'Peach', '#ffd9b3'],
  ['mint', 'Mint', '#c9f2d0'], ['sky', 'Sky', '#cfe6ff'], ['lilac', 'Lilac', '#e4d9ff'],
];
const dayFills = () => store.get('dayFills', {});
function setDayFill(key, id) {
  const all = dayFills();
  if (id) all[key] = id; else delete all[key];
  store.set('dayFills', all);
  renderCal();
}
// A second click on the same day within 400 ms counts as a double-click: fill it, or clear it.
let lastDayClick = { key: '', at: 0 };
function dayClick(key) {
  const now = Date.now(), dbl = lastDayClick.key === key && now - lastDayClick.at < 400;
  lastDayClick = dbl ? { key: '', at: 0 } : { key, at: now };
  if (cal.sel !== key) { cal.sel = key; resetEventForm(); }
  if (dbl) setDayFill(key, dayFills()[key] ? '' : DAY_COLORS[0][0]);
  else renderCal();
}
function renderDayColors(current) {
  const box = $('#day-colors');
  box.replaceChildren(
    ...DAY_COLORS.map(([id, label, color]) => {
      const b = h('button', { class: 'fill-sw' + (current === id ? ' on' : ''), title: label, 'aria-label': `Fill with ${label}`, onclick: () => setDayFill(cal.sel, id) });
      b.style.background = color;
      return b;
    }),
    h('button', { class: 'fill-sw none' + (current ? '' : ' on'), title: 'No fill', 'aria-label': 'No fill', onclick: () => setDayFill(cal.sel, '') }));
}

function resetEventForm() {
  cal.editing = null;
  const next = new Date(); next.setHours(next.getHours() + 1, 0, 0, 0);
  $('#ev-title').value = '';
  $('#ev-allday').checked = false;
  $('#ev-start').value = `${pad(next.getHours())}:00`;
  $('#ev-end').value = `${pad((next.getHours() + 1) % 24)}:00`;
  $('#ev-times').hidden = false;
  $('#ev-form-title').textContent = 'New event';
  $('#ev-save').textContent = 'Add';
  $('#ev-cancel').hidden = true;
}
function editEvent(e) {
  cal.editing = e;
  $('#ev-title').value = e.title;
  $('#ev-allday').checked = e.allDay;
  $('#ev-times').hidden = e.allDay;
  if (!e.allDay) {
    $('#ev-start').value = `${pad(e.start.getHours())}:${pad(e.start.getMinutes())}`;
    $('#ev-end').value = `${pad(e.end.getHours())}:${pad(e.end.getMinutes())}`;
  }
  $('#ev-form-title').textContent = 'Edit event';
  $('#ev-save').textContent = 'Save';
  $('#ev-cancel').hidden = false;
  $('#ev-title').focus();
}

async function saveEvent(payload, editing) {
  if (editing && editing.src === 'google') await call(api.gcal.update(editing.calendarId, editing.id, payload));
  else if (editing) store.set('events', localEvents().map((e) => (e.id === editing.id ? { ...payload, id: e.id } : e)));
  else if (cal.connected) await call(api.gcal.create(payload));
  else store.set('events', [...localEvents(), { ...payload, id: 'l' + Date.now() }]);
}
async function deleteEvent(e) {
  if (!confirm(`Delete "${e.title}"?`)) return;
  try {
    if (e.src === 'google') await call(api.gcal.remove(e.calendarId, e.id));
    else store.set('events', localEvents().filter((x) => x.id !== e.id));
  } catch (err) { toast(err.message); }
  resetEventForm();
  syncCalendar();
}

$('#ev-allday').addEventListener('change', () => { $('#ev-times').hidden = $('#ev-allday').checked; });
$('#ev-cancel').addEventListener('click', resetEventForm);
$('#ev-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const title = $('#ev-title').value.trim();
  if (!title) return;
  let payload;
  if ($('#ev-allday').checked) payload = { title, allDay: true, start: cal.sel, end: ymd(addDays(parseYmd(cal.sel), 1)) };
  else {
    if (!$('#ev-start').value || !$('#ev-end').value) return toast('Pick a start and end time.');
    const at = (v) => { const d = parseYmd(cal.sel); const [hh, mm] = v.split(':').map(Number); d.setHours(hh, mm); return d; };
    const s = at($('#ev-start').value); let e = at($('#ev-end').value);
    if (e <= s) e = new Date(e.getTime() + 864e5); // ends after midnight
    payload = { title, allDay: false, start: s.toISOString(), end: e.toISOString() };
  }
  $('#ev-save').disabled = true;
  try { await saveEvent(payload, cal.editing); resetEventForm(); } catch (err) { toast(err.message); }
  $('#ev-save').disabled = false;
  syncCalendar();
});

const moveMonth = (n) => { cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() + n, 1); renderCal(); syncCalendar(); };
$('#cal-prev').addEventListener('click', () => moveMonth(-1));
$('#cal-next').addEventListener('click', () => moveMonth(1));
$('#cal-today').addEventListener('click', () => { cal.sel = ymd(new Date()); cal.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); syncCalendar(); });
$('#cal-sync').addEventListener('click', syncCalendar);
$('#cal-pick').addEventListener('change', (e) => { const [y, m] = e.target.value.split('-').map(Number); if (y && m) { cal.month = new Date(y, m - 1, 1); cal.sel = ymd(cal.month); resetEventForm(); renderCal(); syncCalendar(); } });
$('#cal-dow').append(...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('span', {}, d)));
on('gcal', syncCalendar);
on('view', (v) => { if (v === 'calendar') renderCal(); });


// ---------- Codeforces
const CF_FILTERS = [['all', 'All'], ['Div. 1', 'Div. 1'], ['Div. 2', 'Div. 2'], ['Div. 3', 'Div. 3'], ['Div. 4', 'Div. 4'], ['Educational', 'Educational']];
const cf = { filter: store.get('cfFilter', 'all'), added: store.get('cfAdded', []), reminded: store.get('cfReminded', []), error: '', handle: null, user: null };
const RANK_COLORS = [[2400, '#e5484d'], [2100, '#e0a040'], [1900, '#b07cf0'], [1600, '#5b9dff'], [1400, '#4fb8b0'], [1200, '#7fae8b'], [0, '#8c8c92']];

async function loadContests() {
  if (!api) return;
  try { cal.contests = await call(api.cf.contests()); cf.error = ''; store.set('cfCache', cal.contests); }
  catch (err) { cf.error = cal.contests.length ? 'Offline, showing the last saved list' : err.message; }
  renderContests(); renderCal();
}
async function loadCfUser() {
  if (!api || cf.handle === settings.cfHandle) return;
  cf.handle = settings.cfHandle; cf.user = null;
  if (cf.handle) { try { cf.user = await call(api.cf.user(cf.handle)); } catch (err) { cf.user = { error: err.message }; } }
  renderContests();
}

async function addContest(c) {
  try {
    await saveEvent({ title: c.name, allDay: false, start: new Date(c.start).toISOString(), end: new Date(c.start + c.duration).toISOString() }, null);
    cf.added.push(c.id); store.set('cfAdded', cf.added);
    toast(cal.connected ? 'Added to your Google Calendar.' : 'Added to the calendar on this PC.');
    syncCalendar(); renderContests();
  } catch (err) { toast(err.message); }
}

function renderContests() {
  $('#cf-filters').replaceChildren(...CF_FILTERS.map(([key, label]) => h('button', {
    class: 'chip-btn' + (cf.filter === key ? ' on' : ''),
    onclick: () => { cf.filter = key; store.set('cfFilter', key); renderContests(); },
  }, label)));
  const st = $('#cf-status');
  st.className = 'status' + (cf.error ? ' err' : '');
  st.textContent = cf.error || `${cal.contests.length} upcoming`;

  const u = $('#cf-user');
  u.replaceChildren();
  if (cf.user && cf.user.error) u.textContent = cf.user.error;
  else if (cf.user) {
    const name = h('b', {}, cf.user.handle);
    name.style.color = RANK_COLORS.find(([min]) => cf.user.rating >= min)[1];
    u.append(name, ` · ${cf.user.rating || 'unrated'} (${cf.user.rank}) · max ${cf.user.maxRating || '–'}`);
  }

  const now = Date.now();
  const list = cal.contests.filter((c) => c.start + c.duration > now && (cf.filter === 'all' || c.name.includes(cf.filter)));
  $('#cf-list').replaceChildren(...list.map((c) => {
    const d = new Date(c.start), added = cf.added.includes(c.id);
    return h('div', { class: 'cf-row' },
      h('div', { class: 'when' }, h('b', {}, d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })), h('span', {}, fmtTime(d))),
      h('div', { class: 'info' }, h('b', { title: c.name }, c.name),
        h('span', { class: c.start - now < 864e5 ? 'soon' : '' }, c.start > now ? `Starts ${fmtRel(c.start - now)}` : 'Running now'),
        h('span', {}, ` · ${fmtDur(c.duration / 60000)}`)),
      h('button', { class: 'btn sm', disabled: added, onclick: () => addContest(c) }, added ? 'Added' : 'Add to calendar'),
      h('button', { class: 'btn sm', onclick: () => api && api.app.open(`https://codeforces.com/contests/${c.id}`) }, 'Open'));
  }));
  if (!list.length) $('#cf-list').append(h('p', { class: 'empty' }, cf.error ? 'Could not load contests. Check your connection and press Refresh.' : 'No upcoming contests match this filter.'));
}

function contestReminders() {
  if (!settings.cfRemind) return;
  const now = Date.now();
  for (const c of cal.contests) {
    if (c.start > now && c.start - now <= 30 * 60000 && !cf.reminded.includes(c.id)) {
      cf.reminded = [...cf.reminded, c.id]; store.set('cfReminded', cf.reminded); // kept forever
      chime();
      notify('Codeforces contest soon', `${c.name} starts ${fmtRel(c.start - now)}.`);
      buddySay(`${c.name} starts ${fmtRel(c.start - now)}.`, 12000);
    }
  }
}

$('#cf-refresh').addEventListener('click', loadContests);
on('view', (v) => { if (v === 'contests') renderContests(); });
on('settings', () => { loadCfUser(); renderCal(); renderContests(); });
