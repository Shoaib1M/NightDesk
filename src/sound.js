'use strict';
// Background sound mixer. Everything is synthesised locally with Web Audio, no audio files.

const SOUNDS = [
  ['white', 'White', 'Bright hiss that masks everything'],
  ['pink', 'Pink', 'Softer, balanced hiss'],
  ['brown', 'Brown', 'Deep, warm rumble'],
  ['study', 'Study', 'Warm rumble with soft air'],
  ['rain', 'Rain', 'Steady rainfall'],
  ['ocean', 'Ocean', 'Slow rolling waves'],
  ['cabin', 'Cabin', 'Airplane cabin hum'],
  ['fire', 'Fireplace', 'Crackle and low roar'],
  ['beats', 'Focus beats', 'Binaural 14 Hz, use headphones'],
];

const mix = { vol: store.get('vol', {}), master: store.get('master', 0.6), live: {}, out: null, bufs: {} };
const volOf = (id) => (mix.vol[id] == null ? 0.7 : mix.vol[id]);

function noiseBuf(kind) {
  if (mix.bufs[kind]) return mix.bufs[kind];
  const ac = audio();
  const n = ac.sampleRate * 8;
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (kind === 'white') {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } else if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const delta = d[n - 1] - d[0]; // remove the jump at the loop point
      for (let i = 0; i < n; i++) d[i] -= delta * (i / (n - 1));
    } else if (kind === 'crackle') {
      let i = 0;
      while (i < n) {
        i += Math.floor(Math.random() * ac.sampleRate * 0.22) + 200;
        const amp = Math.random() ** 2, len = Math.floor(60 + Math.random() * 500);
        for (let j = 0; j < len && i + j < n; j++) d[i + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / (len * 0.25));
      }
    }
  }
  return (mix.bufs[kind] = buf);
}

function buildSound(id) {
  const ac = audio();
  const out = ac.createGain();
  const started = [];
  const src = (kind) => {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf(kind); s.loop = true; s.start(0, Math.random() * 4);
    started.push(s);
    return s;
  };
  const filt = (type, freq, q) => { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q; return f; };
  const gain = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); nodes[nodes.length - 1].connect(out); };
  const lfo = (freq, depth, param) => {
    const o = ac.createOscillator(), g = gain(depth);
    o.frequency.value = freq; o.connect(g).connect(param); o.start();
    started.push(o);
  };

  if (id === 'white') chain(src('white'), gain(0.18));
  else if (id === 'pink') chain(src('pink'), gain(0.55));
  else if (id === 'brown') chain(src('brown'), gain(0.75));
  else if (id === 'study') {
    chain(src('brown'), filt('lowpass', 420), gain(1.0));
    chain(src('pink'), filt('lowpass', 2400), gain(0.12));
  } else if (id === 'rain') {
    chain(src('white'), filt('highpass', 900), filt('lowpass', 7500), gain(0.16));
    chain(src('pink'), filt('bandpass', 450, 0.6), gain(0.3));
  } else if (id === 'ocean') {
    const swell = gain(0.5);
    lfo(0.085, 0.38, swell.gain);
    chain(src('brown'), filt('lowpass', 650), swell);
    const foam = gain(0.035);
    lfo(0.085, 0.03, foam.gain);
    chain(src('white'), filt('highpass', 2200), foam);
  } else if (id === 'cabin') {
    chain(src('brown'), filt('lowpass', 190), gain(1.5));
    chain(src('white'), filt('bandpass', 1100, 0.5), gain(0.03));
  } else if (id === 'fire') {
    chain(src('crackle'), filt('highpass', 1400), gain(0.5));
    chain(src('brown'), filt('lowpass', 320), gain(0.6));
  } else if (id === 'beats') {
    for (const [freq, panVal] of [[200, -1], [214, 1]]) {
      const o = ac.createOscillator(), p = ac.createStereoPanner();
      o.frequency.value = freq; p.pan.value = panVal; o.start();
      started.push(o);
      chain(o, p, gain(0.1));
    }
  }
  return { out, stop: () => started.forEach((s) => { try { s.stop(); } catch {} }) };
}

function soundSet(id, onNow) {
  const ac = audio();
  if (!mix.out) { mix.out = ac.createGain(); mix.out.gain.value = mix.master; mix.out.connect(ac.destination); }
  const cur = mix.live[id];
  if (onNow && !cur) {
    const node = buildSound(id);
    node.out.gain.setValueAtTime(0, ac.currentTime);
    node.out.gain.linearRampToValueAtTime(volOf(id), ac.currentTime + 0.7);
    node.out.connect(mix.out);
    mix.live[id] = node;
  } else if (!onNow && cur) {
    delete mix.live[id];
    cur.out.gain.cancelScheduledValues(ac.currentTime);
    cur.out.gain.setValueAtTime(cur.out.gain.value, ac.currentTime);
    cur.out.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
    setTimeout(() => { cur.stop(); cur.out.disconnect(); }, 500);
  }
  paintSound();
}

function paintSound() {
  const any = Object.keys(mix.live).length > 0;
  $('#b-sound').classList.toggle('on', any);
  $$('#sound-pop .tile').forEach((t) => t.classList.toggle('on', !!mix.live[t.dataset.id]));
}

function buildSoundPop() {
  const pop = $('#sound-pop');
  const master = h('input', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': 'Master volume' });
  master.value = mix.master;
  master.addEventListener('input', () => {
    mix.master = +master.value; store.set('master', mix.master);
    if (mix.out) mix.out.gain.setTargetAtTime(mix.master, audio().currentTime, 0.05);
  });
  pop.append(
    h('h3', {}, 'Sounds', h('div', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: () => Object.keys(mix.live).forEach((id) => soundSet(id, false)) }, 'Stop all')),
    h('div', { class: 'tiles' }, SOUNDS.map(([id, name, desc]) => {
      const slider = h('input', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': name + ' volume' });
      slider.value = volOf(id);
      slider.addEventListener('input', () => {
        mix.vol[id] = +slider.value; store.set('vol', mix.vol);
        if (mix.live[id]) mix.live[id].out.gain.setTargetAtTime(+slider.value, audio().currentTime, 0.05);
      });
      return h('div', { class: 'tile', 'data-id': id },
        h('button', { onclick: () => soundSet(id, !mix.live[id]) }, h('b', {}, name), h('small', {}, desc)), slider);
    })),
    h('div', { class: 'row' }, 'Volume', master),
    h('div', { class: 'spot', id: 'spot' }),
  );
}

// ---------- Spotify mini player
const spot = { connected: false, timer: null };

async function spotRefresh() {
  const box = $('#spot');
  if (!box || !api) return;
  try {
    spot.connected = (await call(api.spotify.status())).connected;
    if (!spot.connected) {
      box.replaceChildren(h('div', { class: 'tx' }, h('b', {}, 'Spotify'), h('span', {}, 'Link your account in Settings to control music here.')),
        h('button', { class: 'btn sm', onclick: openSettings }, 'Settings'));
      return;
    }
    const now = await call(api.spotify.now());
    const ctl = (ic, action, label) => h('button', { class: 'ib', 'aria-label': label, html: icon(ic), onclick: async () => {
      try { await call(api.spotify.control(action)); setTimeout(spotRefresh, 400); } catch (err) { toast(err.message); }
    } });
    const art = h('img', { alt: '' });
    if (now.art) art.src = now.art;
    box.replaceChildren(art,
      h('div', { class: 'tx' }, h('b', {}, now.title || 'Nothing playing'), h('span', {}, now.artist || 'Start Spotify on any device')),
      ctl('prev', 'prev', 'Previous'), ctl(now.playing ? 'pause' : 'play', now.playing ? 'pause' : 'play', now.playing ? 'Pause' : 'Play'), ctl('next', 'next', 'Next'));
  } catch (err) {
    box.replaceChildren(h('div', { class: 'tx' }, h('b', {}, 'Spotify'), h('span', {}, err.message)));
  }
}

function toggleSoundPop(force) {
  const pop = $('#sound-pop');
  if (!pop.firstChild) buildSoundPop();
  pop.hidden = force == null ? !pop.hidden : !force;
  clearInterval(spot.timer);
  if (!pop.hidden) { paintSound(); spotRefresh(); spot.timer = setInterval(spotRefresh, 6000); }
}
on('spotify', spotRefresh);
addEventListener('mousedown', (e) => {
  if (!$('#sound-pop').hidden && !e.target.closest('#sound-pop, #b-sound')) toggleSoundPop(false);
});
