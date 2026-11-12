'use strict';
// Google Calendar: OAuth (desktop loopback + PKCE) and the few Calendar API calls the app needs.
// Credentials and tokens are kept encrypted in the app's user-data folder, never in the renderer.
const { app, shell, safeStorage, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const API = 'https://www.googleapis.com/calendar/v3';
const file = () => path.join(app.getPath('userData'), 'google.bin');

let state = null;
let pendingServer = null;

function load() {
  if (state) return state;
  try {
    const raw = fs.readFileSync(file());
    state = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
  } catch {
    state = {};
  }
  return state;
}

function save() {
  const s = JSON.stringify(state);
  fs.writeFileSync(file(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : s);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function status() {
  const s = load();
  return { configured: !!(s.clientId && s.clientSecret), connected: !!s.refreshToken };
}

async function tokenRequest(params) {
  const res = await net.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `Google sign-in failed (${res.status})`);
    err.code = json.error;
    throw err;
  }
  return json;
}

function connect(creds = {}) {
  const s = load();
  const clientId = (creds.clientId || '').trim() || s.clientId;
  const clientSecret = (creds.clientSecret || '').trim() || s.clientSecret;
  if (!clientId || !clientSecret) throw new Error('Enter your Google Client ID and Client secret first.');

  if (pendingServer) { try { pendingServer.close(); } catch {} pendingServer = null; }

  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const nonce = b64url(crypto.randomBytes(16));
    let redirect = '';
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { server.close(); } catch {}
      if (pendingServer === server) pendingServer = null;
      err ? reject(err) : resolve(status());
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, redirect);
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const page = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Nightdesk</title><body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>${msg}</p></body>`);
      };
      if (url.searchParams.get('error')) {
        page('Sign-in was cancelled. You can close this tab.');
        return finish(new Error('Google sign-in was cancelled.'));
      }
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.get('state') !== nonce) {
        page('Unexpected response. You can close this tab.');
        return finish(new Error('Unexpected response from Google.'));
      }
      try {
        const tok = await tokenRequest({
          code, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier,
        });
        if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Try connecting again.');
        Object.assign(s, {
          clientId, clientSecret,
          refreshToken: tok.refresh_token,
          accessToken: tok.access_token,
          expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
        });
        save();
        page('Nightdesk is connected to your Google Calendar. You can close this tab.');
        finish();
      } catch (err) {
        page('Could not finish sign-in. Check Nightdesk for details.');
        finish(err);
      }
    });

    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), 5 * 60 * 1000);
    server.on('error', (err) => finish(err));
    server.listen(0, '127.0.0.1', () => {
      pendingServer = server;
      redirect = `http://127.0.0.1:${server.address().port}`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256',
        access_type: 'offline', prompt: 'consent', state: nonce,
      }).toString();
      shell.openExternal(auth.toString());
    });
  });
}

function disconnect() {
  const s = load();
  delete s.refreshToken; delete s.accessToken; delete s.expiresAt;
  save();
  return status();
}

async function accessToken() {
  const s = load();
  if (!s.refreshToken) throw new Error('Google Calendar is not connected.');
  if (s.accessToken && Date.now() < (s.expiresAt || 0) - 60000) return s.accessToken;
  try {
    const tok = await tokenRequest({
      client_id: s.clientId, client_secret: s.clientSecret,
      refresh_token: s.refreshToken, grant_type: 'refresh_token',
    });
    s.accessToken = tok.access_token;
    s.expiresAt = Date.now() + (tok.expires_in || 3600) * 1000;
    save();
    return s.accessToken;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      disconnect();
      throw new Error('Google sign-in expired. Reconnect in Settings.');
    }
    throw err;
  }
}

async function call(method, pathname, query, body) {
  const token = await accessToken();
  const url = new URL(API + pathname);
  if (query) url.search = new URLSearchParams(query).toString();
  const res = await net.fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || `Google Calendar error (${res.status})`);
  return json;
}

async function list(timeMin, timeMax) {
  const cals = ((await call('GET', '/users/me/calendarList', { minAccessRole: 'reader' })).items || [])
    .filter((c) => c.selected !== false && !c.hidden);
  const results = await Promise.allSettled(cals.map(async (c) => {
    const r = await call('GET', `/calendars/${encodeURIComponent(c.id)}/events`, {
      singleEvents: 'true', orderBy: 'startTime', timeMin, timeMax, maxResults: '500',
    });
    const editable = c.accessRole === 'owner' || c.accessRole === 'writer';
    return (r.items || []).filter((e) => e.status !== 'cancelled' && e.start).map((e) => ({
      id: e.id,
      calendarId: c.id,
      title: e.summary || '(No title)',
      allDay: !!e.start.date,
      start: e.start.date || e.start.dateTime,
      end: (e.end && (e.end.date || e.end.dateTime)) || e.start.date || e.start.dateTime,
      color: c.backgroundColor || '#4285f4',
      editable,
      url: e.htmlLink || '',
    }));
  }));
  if (results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

function toBody(ev) {
  const title = String(ev.title || '').slice(0, 300);
  if (ev.allDay) return { summary: title, start: { date: ev.start }, end: { date: ev.end } };
  return { summary: title, start: { dateTime: ev.start }, end: { dateTime: ev.end } };
}

const create = (ev) => call('POST', '/calendars/primary/events', null, toBody(ev));
const update = (calendarId, id, ev) =>
  call('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, null, toBody(ev));
const remove = (calendarId, id) =>
  call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);

module.exports = { status, connect, disconnect, list, create, update, remove };
