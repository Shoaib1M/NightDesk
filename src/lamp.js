'use strict';
// Lamp: the whole window becomes one solid colour, to use a monitor as a light.

const LAMPS = [
  ['White', '#ffffff'], ['Daylight', '#eaf2ff'], ['Warm', '#ffe6bf'], ['Candle', '#ffb766'], ['Sunset', '#ff8552'],
  ['Red', '#ff2a1a'], ['Rose', '#ffb0c4'], ['Lavender', '#c7b6ff'], ['Sky', '#8cc4ff'], ['Mint', '#a6ffd2'],
];
const lamp = Object.assign({ color: '#ffffff', bright: 100 }, store.get('lamp', {}));

function applyLamp() {
  const n = parseInt(lamp.color.slice(1), 16), k = lamp.bright / 100;
  $('#v-lamp').style.background = `rgb(${Math.round((n >> 16) * k)}, ${Math.round(((n >> 8) & 255) * k)}, ${Math.round((n & 255) * k)})`;
  $$('#lamp-ctl .swatch').forEach((s) => s.classList.toggle('on', s.dataset.c === lamp.color));
  $('#lamp-pick').value = lamp.color;
  store.set('lamp', lamp);
}

(function buildLamp() {
  const pick = h('input', { type: 'color', id: 'lamp-pick', title: 'Any colour', 'aria-label': 'Custom colour' });
  pick.addEventListener('input', () => { lamp.color = pick.value; applyLamp(); });
  const bright = h('input', { type: 'range', min: '5', max: '100', 'aria-label': 'Brightness' });
  bright.value = lamp.bright;
  bright.addEventListener('input', () => { lamp.bright = +bright.value; applyLamp(); });
  $('#lamp-ctl').append(
    h('div', { class: 'swatches' }, LAMPS.map(([name, c]) => {
      const b = h('button', { class: 'swatch', title: name, 'aria-label': name, 'data-c': c, onclick: () => { lamp.color = c; applyLamp(); } });
      b.style.background = c;
      return b;
    }), pick),
    h('div', { class: 'row' }, 'Brightness', bright,
      h('button', { class: 'btn sm', onclick: () => api && api.app.fullscreen() }, 'Fullscreen')),
  );
  applyLamp();
})();

// Keep the screen from sleeping while it is being used as a lamp.
on('view', (v) => { if (api) api.app.keepAwake(v === 'lamp'); });
