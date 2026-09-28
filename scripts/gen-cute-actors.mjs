import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'tiles', 'actor');
mkdirSync(OUT_DIR, { recursive: true });

// ---------- PNG encoder (no deps) ----------
function crc32(buf) {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (-306674912 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const chunk = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + chunk.length);
  out.writeUInt32BE(data.length, 0);
  chunk.copy(out, 4);
  out.writeUInt32BE(crc32(chunk), 4 + chunk.length);
  return out;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = width * 4;
  const raw = Buffer.alloc(height * (row + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 0;
    rgba.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  }
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', deflateSync(raw)), makeChunk('IEND', Buffer.alloc(0))]);
}

// ---------- Pixel canvas ----------
class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.buf = Buffer.alloc(w * h * 4);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = c.r; this.buf[i + 1] = c.g; this.buf[i + 2] = c.b; this.buf[i + 3] = c.a ?? 255;
  }
  rect(x, y, w, h, c) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.set(xx, yy, c);
  }
  circle(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.set(x, y, c);
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  line(x1, y1, x2, y2, c, thick = 1) {
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      for (let yy = y1 - Math.floor((thick - 1) / 2); yy < y1 + Math.ceil(thick / 2); yy++)
        for (let xx = x1 - Math.floor((thick - 1) / 2); xx < x1 + Math.ceil(thick / 2); xx++)
          this.set(xx, yy, c);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x1 += sx; }
      if (e2 < dx) { err += dx; y1 += sy; }
    }
  }
  save(name) {
    const path = join(OUT_DIR, name + '.png');
    writeFileSync(path, encodePng(this.w, this.h, this.buf));
    console.log('wrote', path);
  }
}

// ---------- Palette ----------
const C = {
  skin: { r: 255, g: 220, b: 200 },
  blush: { r: 255, g: 158, b: 180 },
  eye: { r: 43, g: 35, b: 66 },
  mouth: { r: 120, g: 60, b: 80 },
  hair: { r: 142, g: 123, b: 216 },      // lavender
  hairDark: { r: 104, g: 86, b: 168 },
  kimono: { r: 185, g: 163, b: 232 },    // light purple
  kimonoDark: { r: 140, g: 117, b: 190 },
  obi: { r: 240, g: 199, b: 94 },        // gold
  white: { r: 255, g: 255, b: 255 },
  wood: { r: 109, g: 92, b: 68 },
  blade: { r: 201, g: 186, b: 255 },
  lightning: { r: 180, g: 160, b: 255 },
  petPurple: { r: 160, g: 130, b: 220 },
  petWhite: { r: 245, g: 245, b: 255 },
  stalker: { r: 255, g: 120, b: 130 },
  brute: { r: 255, g: 160, b: 90 },
  caster: { r: 130, g: 110, b: 220 },
  bossDark: { r: 90, g: 70, b: 140 },
  bossGlow: { r: 160, g: 120, b: 255 },
  shadow: { r: 0, g: 0, b: 0, a: 40 },
};

// ---------- Player (cute chibi Raiden-inspired) ----------
function drawPlayer() {
  const c = new Canvas(38, 54);
  // soft drop shadow
  c.ellipse(19, 51, 14, 3, C.shadow);
  // back hair / ponytail
  c.ellipse(9, 25, 7, 14, C.hairDark);
  c.ellipse(18, 18, 16, 15, C.hair);
  // face
  c.circle(19, 18, 10, C.skin);
  // bangs
  c.rect(10, 8, 18, 7, C.hair);
  c.rect(8, 13, 5, 8, C.hair);
  c.rect(25, 13, 5, 8, C.hair);
  // eyes
  c.set(15, 19, C.eye); c.set(23, 19, C.eye);
  c.set(15, 18, C.white); c.set(23, 18, C.white);
  // blush
  c.set(12, 22, C.blush); c.set(26, 22, C.blush);
  c.set(13, 23, C.blush); c.set(25, 23, C.blush);
  // mouth
  c.set(19, 24, C.mouth);
  // kimono body
  c.rect(10, 28, 18, 14, C.kimono);
  // obi
  c.rect(10, 31, 18, 4, C.obi);
  // sleeves
  c.rect(5, 27, 7, 10, C.kimonoDark);
  c.rect(26, 27, 7, 10, C.kimonoDark);
  // arms
  c.rect(7, 31, 4, 6, C.skin);
  c.rect(27, 31, 4, 6, C.skin);
  // legs
  c.rect(13, 42, 4, 8, C.skin);
  c.rect(21, 42, 4, 8, C.skin);
  // shoes
  c.rect(11, 49, 7, 3, C.kimonoDark);
  c.rect(20, 49, 7, 3, C.kimonoDark);
  // naginata held in right hand
  c.rect(31, 6, 2, 32, C.wood);
  c.ellipse(32, 5, 3, 6, C.blade);
  c.line(30, 8, 28, 12, C.lightning, 1);
  c.line(33, 14, 31, 18, C.lightning, 1);
  c.save('player');
}

// ---------- Pet (tiny lightning fox) ----------
function drawPet() {
  const c = new Canvas(30, 32);
  c.ellipse(15, 28, 10, 3, C.shadow);
  // tail
  c.ellipse(5, 20, 4, 9, C.petPurple);
  c.line(4, 14, 7, 10, C.lightning, 1);
  // body
  c.ellipse(15, 22, 10, 7, C.petWhite);
  // head
  c.circle(15, 12, 9, C.petWhite);
  // ears
  c.ellipse(9, 5, 3, 5, C.petPurple);
  c.ellipse(21, 5, 3, 5, C.petPurple);
  // face
  c.set(12, 12, C.eye); c.set(18, 12, C.eye);
  c.set(11, 15, C.blush); c.set(19, 15, C.blush);
  c.set(15, 15, C.mouth);
  // paws
  c.rect(10, 27, 3, 3, C.petPurple);
  c.rect(17, 27, 3, 3, C.petPurple);
  c.save('pet');
}

// ---------- Boss (grander chibi, darker) ----------
function drawBoss() {
  const c = new Canvas(56, 96);
  c.ellipse(28, 91, 22, 4, C.shadow);
  // long hair back
  c.ellipse(12, 45, 10, 26, C.bossDark);
  c.ellipse(44, 45, 10, 26, C.bossDark);
  c.ellipse(28, 30, 22, 20, C.bossDark);
  // head
  c.circle(28, 28, 14, C.skin);
  // bangs / headdress
  c.rect(15, 12, 26, 10, C.bossDark);
  c.rect(10, 18, 8, 14, C.bossDark);
  c.rect(38, 18, 8, 14, C.bossDark);
  // glowing hairpin
  c.line(18, 10, 22, 6, C.bossGlow, 2);
  // eyes
  c.set(22, 30, C.eye); c.set(34, 30, C.eye);
  c.set(22, 29, C.white); c.set(34, 29, C.white);
  // mouth
  c.set(28, 37, C.mouth);
  // elaborate kimono
  c.rect(14, 48, 28, 24, C.bossDark);
  c.rect(14, 56, 28, 5, C.obi);
  c.rect(8, 50, 8, 14, C.kimonoDark);
  c.rect(40, 50, 8, 14, C.kimonoDark);
  // legs
  c.rect(20, 72, 5, 14, C.skin);
  c.rect(31, 72, 5, 14, C.skin);
  // shoes
  c.rect(17, 85, 9, 4, C.hairDark);
  c.rect(30, 85, 9, 4, C.hairDark);
  // large polearm
  c.rect(48, 14, 3, 58, C.wood);
  c.ellipse(49, 12, 5, 10, C.blade);
  c.line(46, 18, 42, 26, C.bossGlow, 2);
  c.save('boss');
}

// ---------- Stalker (cute pink pest) ----------
function drawStalker() {
  const c = new Canvas(26, 44);
  c.ellipse(13, 40, 9, 3, C.shadow);
  c.ellipse(13, 26, 10, 14, C.stalker);
  c.circle(13, 12, 9, C.stalker);
  // ears
  c.ellipse(6, 6, 3, 6, C.stalker);
  c.ellipse(20, 6, 3, 6, C.stalker);
  // eyes
  c.set(9, 12, C.eye); c.set(17, 12, C.eye);
  c.set(9, 11, C.white); c.set(17, 11, C.white);
  // blush
  c.set(7, 16, C.blush); c.set(19, 16, C.blush);
  c.save('stalker');
}

// ---------- Brute (chubby orange) ----------
function drawBrute() {
  const c = new Canvas(34, 54);
  c.ellipse(17, 50, 13, 4, C.shadow);
  c.ellipse(17, 35, 15, 16, C.brute);
  c.circle(17, 15, 11, C.brute);
  // small horns
  c.ellipse(7, 8, 3, 5, C.hairDark);
  c.ellipse(27, 8, 3, 5, C.hairDark);
  // eyes
  c.set(12, 16, C.eye); c.set(22, 16, C.eye);
  // angry brow
  c.line(10, 12, 14, 14, C.eye, 1);
  c.line(24, 14, 28, 12, C.eye, 1);
  c.save('brute');
}

// ---------- Caster (tiny witch) ----------
function drawCaster() {
  const c = new Canvas(28, 48);
  c.ellipse(14, 44, 9, 3, C.shadow);
  // robe
  c.ellipse(14, 33, 11, 12, C.caster);
  // head
  c.circle(14, 18, 9, C.skin);
  // hat/hood
  c.ellipse(14, 10, 12, 8, C.caster);
  c.rect(9, 4, 10, 8, C.caster);
  // eyes
  c.set(10, 19, C.eye); c.set(18, 19, C.eye);
  c.set(10, 18, C.white); c.set(18, 18, C.white);
  // staff
  c.rect(22, 16, 2, 22, C.wood);
  c.ellipse(23, 14, 3, 3, C.bossGlow);
  c.save('caster');
}

// ---------- Run ----------
drawPlayer();
drawPet();
drawBoss();
drawStalker();
drawBrute();
drawCaster();

console.log('All cute actor placeholders generated in', OUT_DIR);
