// Visual layout checks:  node scripts/run-tests.js smoke-visual.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };

  // ----- flip clock: the divider must cut the digits in half
  showView('clock');
  await wait(400);
  centerFlipDigits();
  for (const theme of ['dark', 'light']) {
    settings.theme = theme; applyTheme();
    for (const [w, hgt] of [[1280, 800], [1600, 900], [960, 700]]) {
      // fake the viewport by sizing the clock var directly
      $('.clock').style.setProperty('--cw', `${Math.min(w * 0.36, hgt * 0.56)}px`);
      centerFlipDigits();
      await wait(50);
      for (const f of [flipH, flipM]) {
        const span = f._s[0], card = f.getBoundingClientRect();
        const cs = getComputedStyle(span), size = parseFloat(cs.fontSize);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const g = ctx.measureText('0123456789');
        const lift = parseFloat(f.style.getPropertyValue('--flip-lift')) || 0;
        // where the glyphs land: centre of the (padded) span box, then the font's own offset
        const spanBox = span.getBoundingClientRect();
        const contentMid = spanBox.top + (spanBox.height - lift) / 2;
        const baseline = contentMid - size / 2 + (size - (g.fontBoundingBoxAscent + g.fontBoundingBoxDescent)) / 2 + g.fontBoundingBoxAscent;
        const glyphMid = baseline - (g.actualBoundingBoxAscent - g.actualBoundingBoxDescent) / 2;
        const divider = card.top + card.height / 2;
        check(`digits centred on the divider (${theme}, ${w}x${hgt}, ${f.id})`, Math.abs(glyphMid - divider) <= 2, { glyphMid, divider, lift });
      }
    }
  }
  $('.clock').style.removeProperty('--cw');

  // ----- the pet moves by transform only (no left/bottom repaint of the page underneath)
  settings.buddy = true; pet.desktop = false; pet.roam = false; buddyTick();
  const el = $('#buddy');
  pet.nudgeOn = false; $('#buddy-say').hidden = true;
  pet.pos = { x: 300, y: 200 }; placeBuddy(true);
  const r = el.getBoundingClientRect();
  check('pet placed by transform', el.style.left === '' && el.style.bottom === '' && /translate3d\(300px, -200px/.test(el.style.transform), el.style.cssText);
  check('pet lands where its position says', Math.round(r.left) === 300 && Math.round(innerHeight - r.bottom) === 200, r.toJSON());
  check('pet box is only as wide as the pet', r.width < 120, r.width);
  check('pet is on its own compositor layer', getComputedStyle(el).willChange.includes('transform'), getComputedStyle(el).willChange);
  pet.roam = true; walkTo(700); await wait(50);
  check('walking animates transform', el.style.transition.startsWith('transform'), el.style.transition);
  stopWalk(); pet.roam = false;
  buddySay('A fairly long message from the pet to make the bubble wide enough to matter.', 3000);
  await wait(50);
  check('bubble does not stretch the pet box to the window edge', el.getBoundingClientRect().width <= 240, el.getBoundingClientRect().width);

  settings.theme = 'dark'; applyTheme();
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();
