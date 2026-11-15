'use strict';
// Todoist: tasks with a due date shown in the calendar and as pet quests; ticking one off in
// Nightdesk completes it in Todoist. Uses the personal API token from Todoist → Settings →
// Integrations → Developer. The token is kept encrypted in the user-data folder, never in the page.
const { app, safeStorage, net } = require('electron');
const fs = require('fs');
const path = require('path');

// NIGHTDESK_TODOIST_URL points the app at a stand-in server for tests.
const API = (process.env.NIGHTDESK_TODOIST_URL || 'https://api.todoist.com').replace(/\/$/, '') + '/api/v1';
const file = () => path.join(app.getPath('userData'), 'todoist.bin');
let token = null;

function load() {
  if (token !== null) return token;
  let raw;
  try { raw = fs.readFileSync(file()); } catch (err) { if (err.code === 'ENOENT') token = ''; return ''; }
  try { token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString(); } catch { return ''; }
  return token;
}
function save(t) {
  token = t;
  if (!t) { try { fs.unlinkSync(file()); } catch {} return; }
  fs.writeFileSync(file(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : t);
}

async function api(method, p, t = load()) {
  if (!t) throw new Error('Todoist is not connected.');
  const res = await net.fetch(API + p, { method, headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Todoist did not accept the token. Copy it again from Todoist → Settings → Integrations → Developer.');
  if (!res.ok) throw new Error(`Todoist is not responding (${res.status}).`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// A task's due date: all-day ('YYYY-MM-DD') or a time (an ISO date-time).
function dueOf(d) {
  if (!d) return null;
  const at = d.datetime || (/T\d/.test(d.date || '') ? d.date : '');
  if (at) return { allDay: false, at: new Date(at).toISOString() }; // no zone = the PC's local time
  return /^\d{4}-\d{2}-\d{2}/.test(d.date || '') ? { allDay: true, date: d.date.slice(0, 10) } : null;
}

async function tasks() {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const r = await api('GET', '/tasks?' + q);
    const list = Array.isArray(r) ? r : (r && r.results) || [];
    for (const t of list) {
      const due = dueOf(t.due);
      if (!due || t.checked || t.is_deleted) continue;
      out.push({ id: String(t.id), title: String(t.content || '').slice(0, 200), priority: t.priority || 1, recurring: !!(t.due && t.due.is_recurring), ...due });
    }
    cursor = !Array.isArray(r) && r && r.next_cursor;
    if (!cursor) break;
  }
  return out;
}

module.exports = {
  status: () => ({ connected: !!load() }),
  async connect(t) {
    t = String(t || '').trim();
    if (!/^[A-Za-z0-9]{20,80}$/.test(t)) throw new Error('That does not look like a Todoist API token (Todoist → Settings → Integrations → Developer).');
    await api('GET', '/tasks?limit=1', t); // checks the token before keeping it
    save(t);
    return { connected: true };
  },
  disconnect: () => { save(''); return { connected: false }; },
  tasks,
  async close(id) {
    if (!/^[\w-]{1,40}$/.test(String(id))) throw new Error('Bad task id.');
    await api('POST', `/tasks/${encodeURIComponent(id)}/close`);
    return true;
  },
};
