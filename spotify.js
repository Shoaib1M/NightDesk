'use strict';
// Spotify: OAuth (PKCE, no client secret) plus now-playing and playback controls.
const { app, shell, safeStorage, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 43897;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const file = () => path.join(app.getPath('userData'), 'spotify.bin');

let state = null;
let pendingServer = null;

// Only a missing file means "not set up". Any other read problem (file busy, encryption not ready
// yet) is temporary: report not-connected for now but do not remember it, so the next call retries.
function load() {
  if (state) return state;
  let raw;
  try { raw = fs.readFileSync(file()); }
  catch (err) { if (err.code === 'ENOENT') return (state = {}); console.error('[credentials] read failed, will retry', err.message); return {}; }
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    state = JSON.parse(safeStorage.decryptString(raw));
  } catch (err) { console.error('[credentials] could not decrypt yet, will retry', err.message); return {}; }
  return state;
}
function save() {
  const s = JSON.stringify(state);
  fs.writeFileSync(file(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : s);
}
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const status = () => { const s = load(); return { configured: !!s.clientId, connected: !!s.refreshToken }; };

async function tokenRequest(params) {
  const res = await net.fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || `Spotify sign-in failed (${res.status})`);
    err.code = json.error;
    throw err;
  }
  return json;
}
function storeTokens(tok) {
  const s = load();
  s.accessToken = tok.access_token;
  s.expiresAt = Date.now() + (tok.expires_in || 3600) * 1000;
  if (tok.refresh_token) s.refreshToken = tok.refresh_token;
  save();
}

function connect(id) {
  const s = load();
  const clientId = String(id || '').trim() || s.clientId;
  if (!clientId) throw new Error('Enter your Spotify Client ID first.');
  if (pendingServer) { try { pendingServer.close(); } catch {} pendingServer = null; }

  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const nonce = b64url(crypto.randomBytes(16));
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
      const url = new URL(req.url, REDIRECT);
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const page = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Nightdesk</title><body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>${msg}</p></body>`);
      };
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.get('state') !== nonce) {
        page('Sign-in was cancelled. You can close this tab.');
        return finish(new Error('Spotify sign-in was cancelled.'));
      }
      try {
        const tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
        s.clientId = clientId;
        storeTokens(tok);
        page('Nightdesk is connected to Spotify. You can close this tab.');
        finish();
      } catch (err) {
        page('Could not finish sign-in. Check Nightdesk for details.');
        finish(err);
      }
    });
    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), 5 * 60 * 1000);
    server.on('error', (err) => finish(err.code === 'EADDRINUSE' ? new Error(`Port ${PORT} is in use. Close the other app and try again.`) : err));
    server.listen(PORT, '127.0.0.1', () => {
      pendingServer = server;
      const auth = new URL('https://accounts.spotify.com/authorize');
      auth.search = new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPE,
        code_challenge_method: 'S256', code_challenge: challenge, state: nonce,
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
  if (!s.refreshToken) throw new Error('Spotify is not connected.');
  if (s.accessToken && Date.now() < (s.expiresAt || 0) - 60000) return s.accessToken;
  try {
    storeTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId }));
    return s.accessToken;
  } catch (err) {
    if (err.code === 'invalid_grant') { disconnect(); throw new Error('Spotify sign-in expired. Reconnect in Settings.'); }
    throw err;
  }
}

async function call(method, pathname) {
  const res = await net.fetch('https://api.spotify.com/v1' + pathname, {
    method, headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 204 || res.status === 202) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = json && json.error && json.error.reason;
    if (reason === 'PREMIUM_REQUIRED' || res.status === 403) throw new Error('Playback controls need Spotify Premium.');
    if (reason === 'NO_ACTIVE_DEVICE' || res.status === 404) throw new Error('Open Spotify on a device and start playing first.');
    throw new Error((json && json.error && json.error.message) || `Spotify error (${res.status})`);
  }
  return json;
}

async function now() {
  const p = await call('GET', '/me/player?additional_types=track');
  if (!p || !p.item) return { playing: false };
  const images = (p.item.album && p.item.album.images) || [];
  return {
    playing: !!p.is_playing,
    title: p.item.name,
    artist: (p.item.artists || []).map((a) => a.name).join(', '),
    art: images.length ? images[images.length - 1].url : '',
  };
}

function control(action) {
  const map = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], prev: ['POST', '/me/player/previous'] };
  if (!map[action]) throw new Error('Unknown action.');
  return call(...map[action]);
}

module.exports = { status, connect, disconnect, now, control };
