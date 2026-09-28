export const TILE_SIZE = 32;
export const CHUNK_TILES = 16;
export const WORLD_COLUMNS = 320;
export const WORLD_ROWS = 240;
export const REVEAL_RADIUS = 14;
export const WORLD_WIDTH = WORLD_COLUMNS * TILE_SIZE;
export const WORLD_HEIGHT = WORLD_ROWS * TILE_SIZE;

export type BiomeId = 'meadow' | 'forest' | 'sand' | 'water' | 'ruins';
export type WorldSave = { seed: number; explored: string[]; playerX: number; playerY: number; hp: number; tileSize?: number };
export type WorldTile = { biome: BiomeId; shade: number; decoration: 'tree' | 'rock' | 'ruin' | null };

const WORLD_SAVE_KEY = 'border-exploration-world-v1';
const BIOME_COLORS: Record<BiomeId, number> = {
  meadow: 0x394b3c,
  forest: 0x263f35,
  sand: 0x777052,
  water: 0x263c4a,
  ruins: 0x514a43,
};

function hash(seed: number, x: number, y: number) {
  let value = Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(seed: number, x: number, y: number, scale: number) {
  const gx = x / scale; const gy = y / scale;
  const x0 = Math.floor(gx); const y0 = Math.floor(gy);
  const tx = gx - x0; const ty = gy - y0;
  const fadeX = tx * tx * (3 - 2 * tx); const fadeY = ty * ty * (3 - 2 * ty);
  const a = hash(seed, x0, y0) * (1 - fadeX) + hash(seed, x0 + 1, y0) * fadeX;
  const b = hash(seed, x0, y0 + 1) * (1 - fadeX) + hash(seed, x0 + 1, y0 + 1) * fadeX;
  return a * (1 - fadeY) + b * fadeY;
}

export function loadWorldSave(): WorldSave | null {
  try {
    const value = JSON.parse(localStorage.getItem(WORLD_SAVE_KEY) ?? 'null') as Partial<WorldSave> | null;
    if (value && Number.isInteger(value.seed) && Array.isArray(value.explored)) {
      const explored = value.explored.filter((key): key is string => typeof key === 'string');
      // Saves created by the 64px prototype tile are expanded to the new 32px grid.
      const migrated = value.tileSize === 32 ? explored : explored.flatMap((key) => {
        const [oldX, oldY] = key.split(',').map(Number);
        if (!Number.isInteger(oldX) || !Number.isInteger(oldY)) return [];
        return [`${oldX * 2},${oldY * 2}`, `${oldX * 2 + 1},${oldY * 2}`, `${oldX * 2},${oldY * 2 + 1}`, `${oldX * 2 + 1},${oldY * 2 + 1}`];
      });
      return { seed: value.seed!, explored: migrated,
        playerX: Number(value.playerX) || WORLD_WIDTH / 2, playerY: Number(value.playerY) || WORLD_HEIGHT / 2,
        hp: Math.max(1, Math.min(100, Number(value.hp) || 100)), tileSize: TILE_SIZE };
    }
  } catch { /* Invalid or unavailable storage starts a new world. */ }
  return null;
}

export function saveWorldSave(save: WorldSave) {
  try { localStorage.setItem(WORLD_SAVE_KEY, JSON.stringify(save)); } catch { /* The current session can continue without persistence. */ }
}

export function createWorldSeed() { return Math.floor(Math.random() * 0x7fffffff); }

export class WorldMapData {
  private explored = new Set<string>();

  constructor(readonly seed: number, explored: string[] = []) {
    this.explored = new Set(explored);
  }

  static fromSave(save: WorldSave) { return new WorldMapData(save.seed, save.explored); }

  toTile(worldX: number, worldY: number) {
    return {
      x: Math.max(0, Math.min(WORLD_COLUMNS - 1, Math.floor(worldX / TILE_SIZE))),
      y: Math.max(0, Math.min(WORLD_ROWS - 1, Math.floor(worldY / TILE_SIZE))),
    };
  }

  biomeAtTile(tileX: number, tileY: number): BiomeId {
    const start = this.toTile(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    if (Math.hypot(tileX - start.x, tileY - start.y) < 11) return 'meadow';
    const elevation = smoothNoise(this.seed, tileX, tileY, 76) * .72 + smoothNoise(this.seed + 91, tileX, tileY, 26) * .28;
    const moisture = smoothNoise(this.seed + 227, tileX, tileY, 62);
    if (elevation < .28) return 'water';
    if (elevation < .37) return 'sand';
    if (elevation > .78 && moisture < .58) return 'ruins';
    if (moisture > .52) return 'forest';
    return 'meadow';
  }

  tileAt(tileX: number, tileY: number): WorldTile {
    const x = Math.max(0, Math.min(WORLD_COLUMNS - 1, tileX));
    const y = Math.max(0, Math.min(WORLD_ROWS - 1, tileY));
    const biome = this.biomeAtTile(x, y);
    const variant = hash(this.seed + 419, x, y);
    let decoration: WorldTile['decoration'] = null;
    const center = this.toTile(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    const nearStart = Math.hypot(x - center.x, y - center.y) < 11;
    if (!nearStart && biome === 'forest' && variant > .977) decoration = 'tree';
    else if (!nearStart && biome === 'ruins' && variant > .965) decoration = 'ruin';
    else if (!nearStart && (biome === 'meadow' || biome === 'sand') && variant > .99425) decoration = 'rock';
    return { biome, shade: .91 + hash(this.seed + 601, x, y) * .16, decoration };
  }

  revealAround(tileX: number, tileY: number, radius = REVEAL_RADIUS) {
    let changed = false;
    for (let y = Math.max(0, tileY - radius); y <= Math.min(WORLD_ROWS - 1, tileY + radius); y++) {
      for (let x = Math.max(0, tileX - radius); x <= Math.min(WORLD_COLUMNS - 1, tileX + radius); x++) {
        if (Math.hypot(x - tileX, y - tileY) > radius) continue;
        const key = this.key(x, y);
        if (!this.explored.has(key)) { this.explored.add(key); changed = true; }
      }
    }
    return changed;
  }

  isExplored(tileX: number, tileY: number) { return this.explored.has(this.key(tileX, tileY)); }

  biomeAtWorld(worldX: number, worldY: number) {
    const tile = this.toTile(worldX, worldY);
    return this.biomeAtTile(tile.x, tile.y);
  }

  exploredKeys() { return [...this.explored]; }
  private key(x: number, y: number) { return `${x},${y}`; }
}

export function biomeColor(biome: BiomeId) { return BIOME_COLORS[biome]; }
export function biomeName(biome: BiomeId) {
  return ({ meadow: '草原', forest: '森林', sand: '荒地', water: '浅水', ruins: '遗迹' } as const)[biome];
}
