// Terrain vocabulary shared by the defence arena and the optional tile art:
// which biomes exist, what materials are harvested, and the palette used when
// no art is loaded.
export const TILE_SIZE = 32;
export const TILE_HEIGHT = TILE_SIZE;
// Height of the side face drawn between two terraces.
export const HEIGHT_STEP = 12;

export type BiomeId = 'coast' | 'meadow' | 'forest' | 'sand' | 'snow' | 'swamp' | 'ruins' | 'water' | 'highland';
export type OreId = 'copper' | 'iron' | 'gold' | 'crystal';
export type DecorationId = 'tree' | 'pine' | 'cactus' | 'mushroom' | 'pillar' | 'rock' | 'oreRock' | 'bush';
export type MaterialId = 'soil' | 'stone' | 'sand' | 'snow' | 'wood' | 'copper' | 'iron' | 'gold' | 'crystal';
export type BiomePalette = { top: number; side: number; accent: number };

// Soft, high-brightness palettes: the arena should read as bright and friendly
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

export function biomePalette(biome: BiomeId): BiomePalette { return BIOME_PALETTE[biome]; }
export function biomeColor(biome: BiomeId) { return BIOME_PALETTE[biome].top; }

export function materialName(material: MaterialId) {
  return ({ soil: '泥土', stone: '石材', sand: '砂砾', snow: '冰块', wood: '木材', copper: '铜矿', iron: '铁矿', gold: '金矿', crystal: '晶石' } as const)[material];
}
