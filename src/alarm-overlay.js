'use strict';
// The full-screen "Alarm rang" window shown on every monitor.
const ACCENTS = { rose: '#d98a7c', blue: '#5b9dff', sage: '#7fae8b', amber: '#e0a040', violet: '#9b87f5' };
let h24 = false;

function tick() {
  const d = new Date(), mm = String(d.getMinutes()).padStart(2, '0');
  document.getElementById('now').textContent = h24 ? `${String(d.getHours()).padStart(2, '0')}:${mm}` : `${d.getHours() % 12 || 12}:${mm}`;
}

const act = (action) => window.api.alarm.action(action);
document.getElementById('snooze').addEventListener('click', () => act('snooze'));
document.getElementById('stop').addEventListener('click', () => act('stop'));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') act('stop');
  if (e.key === 'Enter') { e.preventDefault(); act('snooze'); }
});

window.api.alarm.data().then((r) => {
  const d = (r && r.data) || {};
  h24 = !!d.h24;
  if (d.img) document.getElementById('bg').style.backgroundImage = `url(data:image/jpeg;base64,${d.img})`;
  document.getElementById('label').textContent = d.label || '';
  document.getElementById('snooze').textContent = `Snooze · ${d.snoozeMin || 9} min`;
  document.documentElement.style.setProperty('--accent', ACCENTS[d.palette] || '#ff9f0a');
  tick();
});
tick();
setInterval(tick, 1000);
document.getElementById('snooze').focus();
