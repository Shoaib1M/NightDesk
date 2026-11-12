'use strict';
// Pixel-art pet drawing, shared by the app window and the desktop pet window.
// The sprite is 16 x 18: five spare rows on top for ears and hats, then the 13-row body.

const PET_W = 16, PET_H = 18, PET_TOP = 5;
const PET_BODY = [
  '.kk........kk...',
  '.kok......kok...',
  '.kookkkkkkook...',
  '.kooooooooook...',
  '.kooeooooeook...',
  '.kooeooooeook...',
  '.kooooppooook...',
  '.kwwoooooowwk...',
  '..kkkkkkkkkk....',
  '..kowwwwwwok.kk.',
  '..kowwwwwwokkok.',
  '..kooooooookok..',
  '..kkkkkkkkkkk...',
];
// Colour palettes: fur, belly, nose, outline (ink) and eye colour.
const PET_PAL = {
  ginger:   { fur: '#e9a25b', belly: '#fff3e0', nose: '#f2959c', ink: '#2b2326', eye: '#2b2326' },
  cocoa:    { fur: '#9c6a3c', belly: '#ecd3ae', nose: '#3a2a22', ink: '#2a1c12', eye: '#2a1c12' },
  snow:     { fur: '#f6f3ee', belly: '#ffffff', nose: '#f29ab0', ink: '#5a5562', eye: '#3a3640' },
  tuxedo:   { fur: '#3c3944', belly: '#ffffff', nose: '#f2959c', ink: '#15131a', eye: '#ffd84a' },
  grey:     { fur: '#9aa0a8', belly: '#e9ecef', nose: '#d98a9a', ink: '#2c2f36', eye: '#2c2f36' },
  cream:    { fur: '#f0dcb4', belly: '#fff8ea', nose: '#c77d6a', ink: '#5a4630', eye: '#3f6fa8' },
  sakura:   { fur: '#f6b0c8', belly: '#fff0f5', nose: '#e0567f', ink: '#5a2a3c', eye: '#5a2a3c' },
  sky:      { fur: '#86bdf0', belly: '#eaf5ff', nose: '#3f7fc4', ink: '#1f3a5c', eye: '#1f3a5c' },
  mint:     { fur: '#8fd9b6', belly: '#effcf5', nose: '#3f9f77', ink: '#1f4a39', eye: '#1f4a39' },
  lavender: { fur: '#b9a4f2', belly: '#f3eeff', nose: '#7a5bd6', ink: '#33265e', eye: '#33265e' },
  galaxy:   { fur: '#4b3f8f', belly: '#9b87f5', nose: '#f4c542', ink: '#1a1436', eye: '#f4c542' },
  gold:     { fur: '#f2c14e', belly: '#fff6d6', nose: '#c9742a', ink: '#5c3d0c', eye: '#5c3d0c' },
};
const PET_INK = { t: '#6fb7ff', y: '#f4c542', r: '#e5484d', K: '#1f1b1e', g: '#f2b632', b: '#5b9dff' }; // tear and hat colours
// Hats: [first row, pixel rows]. Drawn over the sprite.
const PET_HATS = {
  party: [3, ['......yy........', '......rr........', '.....yyyy.......', '....rrrrrr......']],
  tophat: [3, ['.....KKKK.......', '.....KKKK.......', '.....rrrr.......', '....KKKKKK......']],
  crown: [5, ['....g.gg.g......', '....gggggg......']],
  grad: [5, ['...KKKKKKKK.....', '.....KKKK.y.....']],
  phones: [5, ['....KKKKKK......', '...K......K.....', '', 'bb..........bb..', 'bb..........bb..']],
};

function petRows(kind) {
  const blank = '.'.repeat(PET_W);
  const rows = Array(PET_TOP).fill(blank).concat(PET_BODY);
  const set = (y, x, ch) => { rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); };
  if (kind !== 'cat') { rows[5] = blank; rows[6] = blank; rows[7] = '.kkkkkkkkkkkk...'; } // no pointed ears
  if (kind === 'bunny') {
    rows[1] = '..kkk....kkk....';
    for (let y = 2; y <= 6; y++) rows[y] = '..kok....kok....';
    rows[7] = '.kkokkkkkkokk...';
  }
  if (kind === 'dog') for (let y = 8; y <= 11; y++) for (const x of [2, 3, 10, 11]) set(y, x, 'd'); // floppy ears
  return rows;
}

// look: { kind, color, hat }   opts: { closed, sad }
function drawPet(ctx, look, opts = {}) {
  const pal = PET_PAL[look.color] || PET_PAL.ginger;
  const ink = { k: pal.ink, o: pal.fur, w: pal.belly, p: pal.nose, e: pal.eye };
  ctx.clearRect(0, 0, PET_W, PET_H);
  const px = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };
  petRows(look.kind).forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    if (ch === 'e' && (opts.closed || opts.sad)) ch = y === 9 ? 'o' : opts.closed ? 'k' : 'e';
    if (ch === 'd') { px(x, y, pal.fur); ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(x, y, 1, 1); }
    else px(x, y, ink[ch]);
  }));
  if (opts.sad && !opts.closed) px(3, 11, PET_INK.t); // a tear
  const hat = PET_HATS[look.hat];
  if (hat) hat[1].forEach((row, i) => [...row].forEach((ch, x) => { if (ch !== '.') px(x, hat[0] + i, PET_INK[ch]); }));
}
