// The world is drawn with a top-down camera in the Stardew-valley style: the
// ground grid stays square, and depth comes from props drawn upwards plus the
// side faces of elevation steps. TILE_SQUASH tilts the camera: 1 keeps tiles
// square, lower values flatten them for a more oblique, zoomed-out look.
export const TILE_SIZE = 32;
export const TILE_SQUASH = 1;
export const TILE_HEIGHT = Math.round(TILE_SIZE * TILE_SQUASH);
// Pixels a single elevation level lifts a tile, and therefore the height of the
// side face drawn between two terraces.
export const HEIGHT_STEP = 12;
export const MAX_HEIGHT = 5;
export const CHUNK_TILES = 16;
export const WORLD_COLUMNS = 512;
export const WORLD_ROWS = 256;
export const WORLD_WIDTH = WORLD_COLUMNS * TILE_SIZE;
export const WORLD_HEIGHT = WORLD_ROWS * TILE_HEIGHT;
export const REVEAL_RADIUS = 16;

const WORLD_SAVE_KEY = 'border-exploration-world-v2';
// The grid size, the exploration encoding and the landmark set are all part of the
// save format, so any change to them bumps the version and retires older saves.
const SAVE_VERSION = 6;
// The continent is split into vertical bands so the player walks from the coast
// on the left through a chain of biomes towards the far right.
const BAND_COUNT = 7;
const BAND_WARP = 26;
const EDGE_ROWS = 7;
const SEA_COLUMNS = 4;

export type BiomeId = 'coast' | 'meadow' | 'forest' | 'sand' | 'snow' | 'swamp' | 'ruins' | 'water' | 'highland';
export type OreId = 'copper' | 'iron' | 'gold' | 'crystal';
export type DecorationId = 'tree' | 'pine' | 'cactus' | 'mushroom' | 'pillar' | 'rock' | 'oreRock' | 'bush';
export type PoiKind = 'camp' | 'shrine' | 'merchant' | 'mine' | 'boss';
/** A landmark placed by world generation: the backbone of exploration content. */
export type Poi = { id: number; kind: PoiKind; tileX: number; tileY: number; biome: BiomeId; discovered: boolean; cleared: boolean };
export type MaterialId = 'soil' | 'stone' | 'sand' | 'snow' | 'wood' | 'copper' | 'iron' | 'gold' | 'crystal';
export type DigResult = { material: MaterialId; ore: OreId | null; removedProp: boolean; level: number };
export type WorldSave = {
  version: number; seed: number; explored: string; playerX: number; playerY: number; hp: number;
  dug: string[]; cleared: string[]; poi: string[];
};
export type WorldTile = { biome: BiomeId; height: number; shade: number; ore: OreId | null; decoration: DecorationId | null };
export type BiomePalette = { top: number; side: number; accent: number };

// Soft, high-brightness palettes: the world should read as bright andfriendly
// rather than the muted, desaturated tones of a realistic top-down map.
const BIOME_PALETTE: Record<BiomeId, BiomePalette> = {
  coast: { top: 0xf7e6b8, side: 0xdcbf85, accent: 0xfff6dc },
  meadow: { top: 0x8ed36a, side: 0x63ab4a, accent: 0xb6e88f },
  forest: { top: 0x5cb87a, side: 0x3f8f5c, accent: 0x8fd9a3 },
  sand: { top: 0xf5dfa8, side: 0xd9bc7e, accent: 0xfff0c8 },
  snow: { top: 0xf3f8fc, side: 0xd2e2ef, accent: 0xffffff },
  swamp: { top: 0x7fae7a, side: 0x5d8a58, accent: 0xa8cfa0 },
  ruins: { top: 0xb5a596, side: 0x918275, accent: 0xd8c9b8 },
  water: { top: 0x6cc3ef, side: 0x4a9dcb, accent: 0xa8e4ff },
  highland: { top: 0xa9a49c, side: 0x877f78, accent: 0xcbc6bd },
};

const ORE_COLORS: Record<OreId, number> = { copper: 0xc98a52, iron: 0xc2c6cb, gold: 0xe3bb52, crystal: 0x9b7ce0 };

// Each biome floods and rises at its own elevation thresholds, which keeps lakes
// and rocky hills looking different from one region to the next.
const WATER_LINE: Record<BiomeId, number> = { coast: .36, meadow: .24, forest: .22, sand: .16, snow: .28, swamp: .44, ruins: .2, water: .95, highland: 0 };
const ROCK_LINE: Record<BiomeId, number> = { coast: .82, meadow: .78, forest: .74, sand: .84, snow: .72, swamp: .86, ruins: .68, water: 1, highland: 0 };
const BLOCKING_DECORATIONS = new Set<DecorationId>(['tree', 'pine', 'cactus', 'pillar', 'rock', 'oreRock']);
// A tile can be dug down to bedrock and built up three levels above its natural height.
const MAX_BUILD_LEVELS = 3;
// What digging a surface yields, and what each prop is made of.
const BIOME_MATERIAL: Record<BiomeId, MaterialId> = {
  coast: 'sand', meadow: 'soil', forest: 'soil', sand: 'sand', snow: 'snow',
  swamp: 'soil', ruins: 'stone', water: 'sand', highland: 'stone',
};
const DECORATION_MATERIAL: Record<DecorationId, MaterialId> = {
  tree: 'wood', pine: 'wood', cactus: 'wood', mushroom: 'soil',
  pillar: 'stone', rock: 'stone', oreRock: 'stone', bush: 'wood',
};
export const BUILD_MATERIALS: MaterialId[] = ['stone', 'soil', 'sand', 'snow'];

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

function fbmNoise(seed: number, x: number, y: number, scale: number, octaves = 3) {
  let sum = 0; let amplitude = 1; let total = 0; let step = scale;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(seed + i * 17, x, y, step) * amplitude;
    total += amplitude; amplitude *= .5; step *= .5;
  }
  return sum / total;
}

// Landmarks are spread one to three per region so every biome band has a reason to
// be visited. Mine entrances and boss dens get added on top in a later pass.
const POI_PLAN: PoiKind[][] = [
  ['camp'],
  ['shrine'],
  ['camp', 'shrine'],
  ['camp', 'shrine', 'camp'],
  ['camp', 'shrine', 'camp'],
  ['camp', 'shrine', 'camp'],
  ['camp', 'shrine'],
];
const POI_SPACING = 34;
// One guardian den per stage, sitting at the far edge of its region so beating it
// is what opens the way into the next stretch of the continent.
const BOSS_BANDS = [2, 4, 6];

function isOpenForPoi(data: WorldMapData, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isTileBlocking(data.tileAt(x + dx, y + dy))) return false;
    }
  }
  return true;
}

function generatePois(data: WorldMapData): Poi[] {
  const pois: Poi[] = [];
  const bandWidth = WORLD_COLUMNS / BAND_COUNT;
  POI_PLAN.forEach((kinds, band) => {
    kinds.forEach((kind, slot) => {
      const roll = data.seed + band * 131 + slot * 17;
      const minX = Math.floor(band * bandWidth) + 5;
      const maxX = Math.floor((band + 1) * bandWidth) - 5;
      for (let attempt = 0; attempt < 140; attempt++) {
        const x = minX + Math.floor(hash(roll + attempt, attempt, 3) * Math.max(1, maxX - minX));
        const y = 16 + Math.floor(hash(roll + attempt, attempt, 11) * (WORLD_ROWS - 32));
        // Cheap rejection first: the centre tile, spacing, then the full 3x3.
        if (isTileBlocking(data.tileAt(x, y))) continue;
        if (pois.some((poi) => Math.hypot(poi.tileX - x, poi.tileY - y) < POI_SPACING)) continue;
        if (!isOpenForPoi(data, x, y)) continue;
        pois.push({ id: pois.length, kind, tileX: x, tileY: y, biome: data.tileAt(x, y).biome, discovered: false, cleared: false });
        break;
      }
    });
  });
  // Guardian dens are appended last so their ids double as the stage order.
  BOSS_BANDS.forEach((band) => {
    const roll = data.seed + band * 977 + 5;
    const minX = Math.floor((band + 1) * bandWidth) - 15;
    const maxX = Math.floor((band + 1) * bandWidth) - 5;
    for (let attempt = 0; attempt < 160; attempt++) {
      const x = minX + Math.floor(hash(roll + attempt, attempt, 5) * Math.max(1, maxX - minX));
      const y = 16 + Math.floor(hash(roll + attempt, attempt, 13) * (WORLD_ROWS - 32));
      if (isTileBlocking(data.tileAt(x, y))) continue;
      if (pois.some((poi) => Math.hypot(poi.tileX - x, poi.tileY - y) < POI_SPACING)) continue;
      if (!isOpenForPoi(data, x, y)) continue;
      pois.push({ id: pois.length, kind: 'boss', tileX: x, tileY: y, biome: data.tileAt(x, y).biome, discovered: false, cleared: false });
      break;
    }
  });
  return pois;
}

function shuffled<T>(items: T[], seed: number) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(hash(seed + i * 31, i, 7) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function loadWorldSave(): WorldSave | null {
  try {
    const value = JSON.parse(localStorage.getItem(WORLD_SAVE_KEY) ?? 'null') as Partial<WorldSave> | null;
    if (value && value.version === SAVE_VERSION && Number.isInteger(value.seed) && typeof value.explored === 'string') {
      return {
        version: SAVE_VERSION,
        seed: value.seed!,
        explored: value.explored,
        playerX: Number(value.playerX) || WORLD_WIDTH / 2,
        playerY: Number(value.playerY) || WORLD_HEIGHT / 2,
        hp: Math.max(1, Math.min(100, Number(value.hp) || 100)),
        dug: Array.isArray(value.dug) ? value.dug.filter((key): key is string => typeof key === 'string') : [],
        cleared: Array.isArray(value.cleared) ? value.cleared.filter((key): key is string => typeof key === 'string') : [],
        poi: Array.isArray(value.poi) ? value.poi.filter((key): key is string => typeof key === 'string') : [],
      };
    }
  } catch { /* Invalid or unavailable storage starts a new world. */ }
  return null;
}

export function saveWorldSave(save: Omit<WorldSave, 'version'>) {
  try { localStorage.setItem(WORLD_SAVE_KEY, JSON.stringify({ ...save, version: SAVE_VERSION })); } catch { /* The current session can continue without persistence. */ }
}

export function createWorldSeed() { return Math.floor(Math.random() * 0x7fffffff); }

export function biomePalette(biome: BiomeId): BiomePalette { return BIOME_PALETTE[biome]; }
export function biomeColor(biome: BiomeId) { return BIOME_PALETTE[biome].top; }
export function oreColor(ore: OreId) { return ORE_COLORS[ore]; }
export function isTileBlocking(tile: WorldTile) {
  if (tile.biome === 'water') return true;
  if (tile.biome === 'highland' && tile.height >= MAX_HEIGHT) return true;
  return tile.decoration !== null && BLOCKING_DECORATIONS.has(tile.decoration);
}
export function biomeName(biome: BiomeId) {
  return ({ coast: '海岸', meadow: '草原', forest: '森林', sand: '沙漠', snow: '雪原', swamp: '沼泽', ruins: '遗迹', water: '水域', highland: '高地' } as const)[biome];
}
export function oreName(ore: OreId) {
  return ({ copper: '铜矿', iron: '铁矿', gold: '金矿', crystal: '晶石' } as const)[ore];
}
export function materialName(material: MaterialId) {
  return ({ soil: '泥土', stone: '石材', sand: '砂砾', snow: '冰块', wood: '木材', copper: '铜矿', iron: '铁矿', gold: '金矿', crystal: '晶石' } as const)[material];
}

export class WorldMapData {
  // Exploration is a set of packed tile indices rather than "x,y" strings: a full
  // continent is ~131k tiles and the save would otherwise weigh over a megabyte.
  private readonly explored = new Set<number>();
  private readonly baseCache = new Map<number, WorldTile>();
  private readonly bands: BiomeId[];
  // Player edits live apart from the generated terrain, so the terrain cache stays
  // valid when the world is dug out or built up.
  private readonly dug = new Map<number, number>();
  private readonly cleared = new Set<number>();
  private readonly pois: Poi[] = [];

  constructor(readonly seed: number, explored = '') {
    this.decodeExplored(explored);
    // Band 0 is the landing coast, band 1 the home meadow, the rest is a shuffled
    // chain of the remaining biomes so every seed orders its regions differently.
    const pool = shuffled<BiomeId>(['forest', 'sand', 'snow', 'swamp', 'ruins'], seed);
    this.bands = ['coast', 'meadow', ...pool];
    this.pois = generatePois(this);
  }

  static fromSave(save: WorldSave) {
    const data = new WorldMapData(save.seed, save.explored);
    data.applyProgress(save.dug, save.cleared);
    data.applyPoiProgress(save.poi);
    return data;
  }

  applyProgress(dug: string[], cleared: string[]) {
    cleared.forEach((entry) => { const index = Number(entry); if (Number.isInteger(index)) this.cleared.add(index); });
    dug.forEach((entry) => {
      const [index, levels] = entry.split(',').map(Number);
      if (Number.isInteger(index) && Number.isInteger(levels)) this.dug.set(index, levels);
    });
  }

  private decodeExplored(base64: string) {
    if (!base64) return;
    try {
      const binary = atob(base64);
      for (let byte = 0; byte < binary.length; byte++) {
        const bits = binary.charCodeAt(byte);
        if (!bits) continue;
        for (let bit = 0; bit < 8; bit++) if (bits & (1 << bit)) this.explored.add(byte * 8 + bit);
      }
    } catch { /* Corrupt exploration data simply starts hidden again. */ }
  }

  /** Exploration packed into one byte per eight tiles, then base64 for storage. */
  exploredBitmap() {
    const bytes = new Uint8Array(Math.ceil(WORLD_COLUMNS * WORLD_ROWS / 8));
    for (const index of this.explored) {
      const byte = index >> 3;
      if (byte < bytes.length) bytes[byte] |= 1 << (index & 7);
    }
    let binary = '';
    // Chunked to stay clear of the argument limit of String.fromCharCode.
    for (let offset = 0; offset < bytes.length; offset += 4096) binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
    return btoa(binary);
  }

  dugEntries() { return [...this.dug].map(([index, levels]) => `${index},${levels}`); }
  clearedEntries() { return [...this.cleared].map(String); }

  getPois() { return this.pois; }
  poiAt(id: number) { return this.pois[id]; }

  /** Guardian dens open one after another: each needs every earlier den cleared. */
  isPoiUnlocked(poi: Poi) {
    if (poi.kind !== 'boss') return true;
    return this.pois.filter((other) => other.kind === 'boss' && other.id < poi.id).every((earlier) => earlier.cleared);
  }

  /** How many guardians have fallen, used to scale the next fight. */
  clearedBossCount() { return this.pois.filter((poi) => poi.kind === 'boss' && poi.cleared).length; }

  applyPoiProgress(entries: string[]) {
    entries.forEach((entry) => {
      const [id, discovered, cleared] = entry.split(',').map(Number);
      const poi = this.pois[id];
      if (!poi) return;
      if (discovered) poi.discovered = true;
      if (cleared) poi.cleared = true;
    });
  }

  poiEntries() {
    return this.pois.filter((poi) => poi.discovered || poi.cleared)
      .map((poi) => `${poi.id},${poi.discovered ? 1 : 0},${poi.cleared ? 1 : 0}`);
  }

  toTile(worldX: number, worldY: number) {
    return {
      x: Math.max(0, Math.min(WORLD_COLUMNS - 1, Math.floor(worldX / TILE_SIZE))),
      y: Math.max(0, Math.min(WORLD_ROWS - 1, Math.floor(worldY / TILE_HEIGHT))),
    };
  }

  /** Grid centre of a tile on the flat plane, used to address the chunk it belongs to. */
  tileCenter(tileX: number, tileY: number) {
    return {
      x: tileX * TILE_SIZE + TILE_SIZE / 2,
      y: tileY * TILE_HEIGHT + TILE_HEIGHT / 2,
    };
  }

  /** World position of the walkable surface of a tile, lifted by its elevation. */
  surfaceWorld(tileX: number, tileY: number, height = this.heightAtTile(tileX, tileY)) {
    return {
      x: tileX * TILE_SIZE + TILE_SIZE / 2,
      y: tileY * TILE_HEIGHT - height * HEIGHT_STEP + TILE_HEIGHT / 2,
    };
  }

  private elevationAt(x: number, y: number) {
    return fbmNoise(this.seed, x, y, 96) * .68 + smoothNoise(this.seed + 91, x, y, 30) * .32;
  }

  private moistureAt(x: number, y: number) {
    return fbmNoise(this.seed + 227, x, y, 74, 2);
  }

  private bandIndexAt(x: number, y: number) {
    const bandWidth = WORLD_COLUMNS / BAND_COUNT;
    // Borders wobble per row so the regions interlock instead of forming stripes.
    const warp = (smoothNoise(this.seed + 331, 0, y, 26) - .5) * 2 * BAND_WARP;
    return Math.max(0, Math.min(BAND_COUNT - 1, Math.floor((x - warp) / bandWidth)));
  }

  biomeAtTile(tileX: number, tileY: number): BiomeId {
    const x = Math.max(0, Math.min(WORLD_COLUMNS - 1, tileX));
    const y = Math.max(0, Math.min(WORLD_ROWS - 1, tileY));
    if (y < EDGE_ROWS || y >= WORLD_ROWS - EDGE_ROWS) return 'highland';
    if (x < SEA_COLUMNS || x >= WORLD_COLUMNS - SEA_COLUMNS) return 'water';
    const band = this.bands[this.bandIndexAt(x, y)];
    const elevation = this.elevationAt(x, y);
    if (elevation < WATER_LINE[band]) return 'water';
    if (elevation > ROCK_LINE[band]) return 'highland';
    return band;
  }

  heightAtTile(tileX: number, tileY: number): number {
    return this.tileAt(tileX, tileY).height;
  }

  private computeHeight(x: number, y: number) {
    if (y < EDGE_ROWS || y >= WORLD_ROWS - EDGE_ROWS) return MAX_HEIGHT;
    const biome = this.biomeAtTile(x, y);
    if (biome === 'water') return 0;
    const elevation = this.elevationAt(x, y);
    const band = this.bands[this.bandIndexAt(x, y)];
    const shore = WATER_LINE[band];
    const ridge = ROCK_LINE[band];
    if (biome === 'highland') return Math.min(MAX_HEIGHT, 4 + Math.round(Math.min(1, (elevation - ridge) * 7)));
    // Elevation is normalised against the band's own shore and ridge so every
    // region climbs through the full terrace range instead of sitting on one level.
    const slope = (elevation - shore) / Math.max(.05, ridge - shore);
    return Math.max(1, Math.min(4, 1 + Math.round(slope * 3)));
  }

  private oreAtTile(x: number, y: number, biome: BiomeId, height: number): OreId | null {
    if (biome !== 'highland' && height < 2) return null;
    if (smoothNoise(this.seed + 733, x, y, 13) < .84) return null;
    // Veins get richer the further the player travels from the landing coast.
    const travelled = x / WORLD_COLUMNS;
    return travelled < .28 ? 'copper' : travelled < .55 ? 'iron' : travelled < .8 ? 'gold' : 'crystal';
  }

  private decorationAt(x: number, y: number, biome: BiomeId, ore: OreId | null): DecorationId | null {
    const variant = hash(this.seed + 419, x, y);
    const moisture = this.moistureAt(x, y);
    if (ore && variant > .55) return 'oreRock';
    switch (biome) {
      case 'forest': return variant > .90 ? 'tree' : variant > .80 && moisture > .45 ? 'bush' : null;
      case 'meadow': return variant > .975 ? 'tree' : variant > .93 && moisture > .5 ? 'bush' : null;
      case 'snow': return variant > .93 ? 'pine' : null;
      case 'sand': return variant > .955 ? 'cactus' : null;
      case 'swamp': return variant > .94 ? 'mushroom' : null;
      case 'ruins': return variant > .95 ? 'pillar' : null;
      case 'highland': return variant > .965 ? 'rock' : null;
      default: return null;
    }
  }

  /** Terrain as generated by the seed, without any player edits. */
  private generate(x: number, y: number): WorldTile {
    const index = this.index(x, y);
    const cached = this.baseCache.get(index);
    if (cached) return cached;
    const biome = this.biomeAtTile(x, y);
    const height = this.computeHeight(x, y);
    const ore = this.oreAtTile(x, y, biome, height);
    const tile: WorldTile = {
      biome, height, ore,
      shade: .88 + hash(this.seed + 601, x, y) * .2,
      decoration: this.decorationAt(x, y, biome, ore),
    };
    // The cache is a plain working set: chunks are rebuilt often while streaming.
    if (this.baseCache.size > 60_000) this.baseCache.clear();
    this.baseCache.set(index, tile);
    return tile;
  }

  /** The terrain the player actually sees: generated terrain plus dig and build edits. */
  tileAt(tileX: number, tileY: number): WorldTile {
    const x = Math.max(0, Math.min(WORLD_COLUMNS - 1, tileX));
    const y = Math.max(0, Math.min(WORLD_ROWS - 1, tileY));
    const base = this.generate(x, y);
    const index = this.index(x, y);
    const cleared = this.cleared.has(index);
    const levels = this.dug.get(index) ?? 0;
    if (!cleared && levels === 0) return base;
    return {
      ...base,
      height: Math.max(0, base.height - levels),
      decoration: cleared ? null : base.decoration,
      ore: cleared || levels > 0 ? null : base.ore,
    };
  }

  /** Digs one step: props are harvested first, then the ground drops a level. */
  dig(tileX: number, tileY: number): DigResult | null {
    const x = Math.max(0, Math.min(WORLD_COLUMNS - 1, tileX));
    const y = Math.max(0, Math.min(WORLD_ROWS - 1, tileY));
    const base = this.generate(x, y);
    if (base.biome === 'water') return null;
    const index = this.index(x, y);
    if (!this.cleared.has(index) && base.decoration) {
      this.cleared.add(index);
      const ore = base.decoration === 'oreRock' ? base.ore : null;
      return { material: ore ?? DECORATION_MATERIAL[base.decoration], ore, removedProp: true, level: base.height };
    }
    const levels = this.dug.get(index) ?? 0;
    if (base.height - levels <= 0) return null;
    this.dug.set(index, levels + 1);
    const ore = levels === 0 ? base.ore : null;
    return { material: ore ?? BIOME_MATERIAL[base.biome], ore, removedProp: false, level: base.height - levels - 1 };
  }

  /** Builds the tile back up one level, spending a block from the player's bag. */
  fill(tileX: number, tileY: number): boolean {
    const x = Math.max(0, Math.min(WORLD_COLUMNS - 1, tileX));
    const y = Math.max(0, Math.min(WORLD_ROWS - 1, tileY));
    const base = this.generate(x, y);
    if (base.biome === 'water') return false;
    const index = this.index(x, y);
    if (!this.cleared.has(index) && base.decoration) return false;
    const levels = this.dug.get(index) ?? 0;
    if (levels <= -MAX_BUILD_LEVELS) return false;
    this.dug.set(index, levels - 1);
    return true;
  }

  /** True while the tile still has ground left to remove. */
  canDig(tileX: number, tileY: number) {
    const x = Math.max(0, Math.min(WORLD_COLUMNS - 1, tileX));
    const y = Math.max(0, Math.min(WORLD_ROWS - 1, tileY));
    const base = this.generate(x, y);
    if (base.biome === 'water') return false;
    if (!this.cleared.has(this.index(x, y)) && base.decoration) return true;
    return base.height - (this.dug.get(this.index(x, y)) ?? 0) > 0;
  }

  /** First walkable meadow tile near the middle of the home band. */
  findSpawnTile() {
    const bandWidth = WORLD_COLUMNS / BAND_COUNT;
    const startX = Math.floor(bandWidth * 1.5);
    const startY = Math.floor(WORLD_ROWS / 2);
    for (let ring = 0; ring < 40; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const x = startX + dx; const y = startY + dy;
          if (x < 1 || y < 1 || x >= WORLD_COLUMNS - 1 || y >= WORLD_ROWS - 1) continue;
          const tile = this.tileAt(x, y);
          if (tile.biome === 'meadow' && !isTileBlocking(tile)) return { x, y };
        }
      }
    }
    return { x: startX, y: startY };
  }

  revealAround(tileX: number, tileY: number, radius = REVEAL_RADIUS) {
    let changed = false;
    for (let y = Math.max(0, tileY - radius); y <= Math.min(WORLD_ROWS - 1, tileY + radius); y++) {
      for (let x = Math.max(0, tileX - radius); x <= Math.min(WORLD_COLUMNS - 1, tileX + radius); x++) {
        if (Math.hypot(x - tileX, y - tileY) > radius) continue;
        const index = this.index(x, y);
        if (!this.explored.has(index)) { this.explored.add(index); changed = true; }
      }
    }
    return changed;
  }

  isExplored(tileX: number, tileY: number) {
    // Out of bounds positions are addressed by the mini-map and never explored.
    if (tileX < 0 || tileY < 0 || tileX >= WORLD_COLUMNS || tileY >= WORLD_ROWS) return false;
    return this.explored.has(this.index(tileX, tileY));
  }

  biomeAtWorld(worldX: number, worldY: number) {
    const tile = this.toTile(worldX, worldY);
    return this.biomeAtTile(tile.x, tile.y);
  }

  private index(x: number, y: number) { return y * WORLD_COLUMNS + x; }
}
