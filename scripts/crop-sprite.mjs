import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

// ---------- PNG decode ----------
function decodePng(buffer) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buffer[i] !== sig[i]) throw new Error('not a png');
  let pos = 8, ihdr = null, palette = null, trns = null;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (ihdr.interlace !== 0 || ihdr.bitDepth !== 8) throw new Error('unsupported png');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  const { width, height } = ihdr;
  const raw = inflateSync(Buffer.concat(idat));
  const rawStride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(rawStride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + rawStride)); p += rawStride;
    for (let i = 0; i < rawStride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[i] = (line[i] + a) & 255; break;
        case 2: line[i] = (line[i] + b) & 255; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 255; break;
        case 4: { const pr = a + b - c, pa = Math.abs(pr - a), pb = Math.abs(pr - b), pc = Math.abs(pr - c); line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; break; }
        default: throw new Error('bad filter ' + filter);
      }
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (ihdr.colorType === 0) r = g = b = line[s];
      else if (ihdr.colorType === 2) { r = line[s]; g = line[s + 1]; b = line[s + 2]; }
      else if (ihdr.colorType === 3) {
        const idx = line[s];
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) a = trns[idx];
      } else if (ihdr.colorType === 4) { r = g = b = line[s]; a = line[s + 1]; }
      else { r = line[s]; g = line[s + 1]; b = line[s + 2]; a = line[s + 3]; }
      out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = a;
    }
  }
  return { width, height, data: out };
}

// ---------- PNG encode ----------
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
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 4 + body.length);
  return out;
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const row = w * 4;
  const raw = Buffer.alloc(h * (row + 1));
  for (let y = 0; y < h; y++) { raw[y * (row + 1)] = 0; rgba.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Frame detection: dilate + connected components ----------
function findFrames(img, radius = 14, minPixels = 800) {
  const { width, height, data } = img;
  const solid = new Uint8Array(width * height);
  let total = 0;
  for (let i = 0; i < width * height; i++) if (data[i * 4 + 3] > 24) { solid[i] = 1; total++; }

  // integral image
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += solid[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + sum;
    }
  }
  const area = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(width - 1, x1); y1 = Math.min(height - 1, y1);
    if (x1 < x0 || y1 < y0) return 0;
    return integral[(y1 + 1) * (width + 1) + (x1 + 1)] - integral[y0 * (width + 1) + (x1 + 1)] - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
  };

  const dilated = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (area(x - radius, y - radius, x + radius, y + radius) > 0) dilated[y * width + x] = 1;
    }
  }

  const label = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = [];
  for (let start = 0; start < width * height; start++) {
    if (!dilated[start] || label[start] >= 0) continue;
    const id = components.length;
    let minX = width, minY = height, maxX = -1, maxY = -1, pixels = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % width, y = (i - x) / width;
      if (solid[i]) {
        pixels++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (x > 0 && dilated[i - 1] && label[i - 1] < 0) { label[i - 1] = id; stack.push(i - 1); }
      if (x < width - 1 && dilated[i + 1] && label[i + 1] < 0) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && dilated[i - width] && label[i - width] < 0) { label[i - width] = id; stack.push(i - width); }
      if (y < height - 1 && dilated[i + width] && label[i + width] < 0) { label[i + width] = id; stack.push(i + width); }
    }
    if (pixels >= minPixels && maxX >= 0) components.push({ minX, minY, maxX, maxY, pixels });
  }
  return { components, solid, total };
}

/** Splits a component that swallowed two neighbouring frames by finding a blank column gap. */
function splitComponent(solid, width, comp, maxWidth, minGap = 6) {
  const w = comp.maxX - comp.minX + 1;
  if (w <= maxWidth) return [comp];
  const counts = new Int32Array(w);
  for (let y = comp.minY; y <= comp.maxY; y++)
    for (let x = comp.minX; x <= comp.maxX; x++)
      if (solid[y * width + x]) counts[x - comp.minX]++;
  // Pick the emptiest vertical band: a sliding window with the fewest solid pixels.
  const from = Math.floor(w * 0.15), to = Math.floor(w * 0.85);
  const win = Math.max(4, Math.round(w * 0.05));
  let best = -1, bestSum = Infinity;
  for (let x = from; x + win <= to; x++) {
    let sum = 0;
    for (let k = 0; k < win; k++) sum += counts[x + k];
    if (sum < bestSum) { bestSum = sum; best = x + Math.floor(win / 2); }
  }
  const height = comp.maxY - comp.minY + 1;
  if (best < 0 || bestSum > win * height * 0.15) return [comp];
  const left = { ...comp, maxX: comp.minX + best };
  const right = { ...comp, minX: comp.minX + best + 1 };
  return [...splitComponent(solid, width, left, maxWidth, minGap), ...splitComponent(solid, width, right, maxWidth, minGap)];
}

/** Re-crops to the tight bounding box of visible pixels. */
function trim(img) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] > 24) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return img;
  return crop(img, minX, minY, maxX, maxY);
}

function crop(img, x0, y0, x1, y1) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y + y0) * img.width + x + x0) * 4, d = (y * w + x) * 4;
    out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
  }
  return { width: w, height: h, data: out };
}

/** Area-average downscale with premultiplied alpha. */
function resize(img, targetHeight) {
  const scale = img.height / targetHeight;
  const dw = Math.max(1, Math.round(img.width / scale));
  const dh = targetHeight;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * img.height / dh), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * img.height / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * img.width / dw), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * img.width / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const s = (sy * img.width + sx) * 4, al = img.data[s + 3] / 255;
        r += img.data[s] * al; g += img.data[s + 1] * al; b += img.data[s + 2] * al; a += al; n++;
      }
      const d = (y * dw + x) * 4;
      if (a > 0) { out[d] = Math.round(r / a); out[d + 1] = Math.round(g / a); out[d + 2] = Math.round(b / a); out[d + 3] = Math.round(255 * Math.min(1, a / n * 1.0)); }
    }
  }
  return { width: dw, height: dh, data: out };
}

// ---------- Main ----------
const src = process.argv[2];
const outDir = process.argv[3];
const rowNames = (process.argv[4] || 'walk,attack,idle,special').split(',');
const targetHeight = Number(process.argv[5] || 104);
const [mainRow, indexRaw] = (process.argv[6] || 'idle').split(':');
const mainIndex = Number(indexRaw || 1);
const radius = Number(process.argv[7] || 14);
const flip = process.argv[8] || '0';

const img = decodePng(readFileSync(src));
console.log(`source ${img.width}x${img.height}`);

const { components, solid } = findFrames(img, radius);
console.log(`found ${components.length} components`);

// Drop thin scraps (effects strips), then split components that merged two frames.
const kept = components.filter((c) => (c.maxY - c.minY + 1) >= 80);
const widths = kept.map((c) => c.maxX - c.minX + 1).sort((a, b) => a - b);
const maxWidth = (widths[Math.floor(widths.length / 2)] ?? 200) * 1.5;
const parts = [];
kept.forEach((c) => parts.push(...splitComponent(solid, img.width, c, maxWidth)));
console.log(`components ${components.length} -> kept ${kept.length} -> frames ${parts.length} (maxWidth ${Math.round(maxWidth)})`);

// group into rows by vertical centre
const sorted = [...parts].sort((a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2);
const rows = [];
sorted.forEach((c) => {
  const cy = (c.minY + c.maxY) / 2;
  const row = rows.find((r) => Math.abs((r.top + r.bottom) / 2 - cy) < 96);
  if (row) { row.items.push(c); row.top = Math.min(row.top, c.minY); row.bottom = Math.max(row.bottom, c.maxY); }
  else rows.push({ items: [c], top: c.minY, bottom: c.maxY });
});

mkdirSync(`${outDir}/player_frames`, { recursive: true });
const collected = {};
rows.forEach((row, index) => {
  const name = rowNames[index] ?? `row${index}`;
  row.items.sort((a, b) => a.minX - b.minX);
  row.items.forEach((c, i) => {
    const frame = trim(crop(img, c.minX, c.minY, c.maxX, c.maxY));
    writeFileSync(`${outDir}/player_frames/${name}_${i + 1}.png`, encodePng(frame.width, frame.height, frame.data));
    (collected[name] ??= []).push(frame);
  });
  console.log(`row ${index} (${name}): ${collected[name].length} frames ->`, collected[name].map(f => `${f.width}x${f.height}`).join(' '));
});

function flipX(frame) {
  const out = Buffer.alloc(frame.data.length);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const s = (y * frame.width + x) * 4, d = (y * frame.width + (frame.width - 1 - x)) * 4;
    out[d] = frame.data[s]; out[d + 1] = frame.data[s + 1]; out[d + 2] = frame.data[s + 2]; out[d + 3] = frame.data[s + 3];
  }
  return { width: frame.width, height: frame.height, data: out };
}

const pool = collected[mainRow] ?? Object.values(collected)[0];
const main = pool?.[Math.max(0, mainIndex - 1)] ?? pool?.[0];
if (!main) throw new Error('no frame found');
const oriented = flip === '1' ? flipX(main) : main;
const scaled = resize(oriented, targetHeight);
writeFileSync(`${outDir}/player.png`, encodePng(scaled.width, scaled.height, scaled.data));
console.log(`player.png -> ${scaled.width}x${scaled.height} (${mainRow} frame ${main.width}x${main.height}, flip=${flip === '1'})`);
