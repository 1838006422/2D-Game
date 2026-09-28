import Phaser from 'phaser';
import { BiomeId, biomePalette } from '../world/WorldMapData';
import { groundTexture, hasGroundArt } from '../world/WorldTiles';
import { CORE_CLEAR_RADIUS, MAP_COLUMNS, MAP_HEIGHT, MAP_ROWS, MAP_WIDTH, NodeKind, TILE } from './DefenseConfig';

export type ResourceNode = { id: number; kind: NodeKind; x: number; y: number; hp: number };

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

/** One compact, fully random arena per run: ground, water and harvestable nodes. */
export class DefenseWorld {
  readonly tiles: BiomeId[] = [];
  readonly nodes: ResourceNode[] = [];
  readonly coreTile = { x: Math.floor(MAP_COLUMNS / 2), y: Math.floor(MAP_ROWS / 2) };

  constructor(readonly seed: number) {
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLUMNS; x++) {
        const elevation = smoothNoise(seed, x, y, 13) * .7 + smoothNoise(seed + 91, x, y, 5) * .3;
        let biome: BiomeId = elevation < .30 ? 'water' : elevation > .74 ? 'highland' : elevation < .38 ? 'sand' : 'meadow';
        // Keep the core surroundings and the map rim flat and buildable.
        const distanceToCore = Math.hypot(x - this.coreTile.x, y - this.coreTile.y);
        const rim = x < 3 || y < 3 || x >= MAP_COLUMNS - 3 || y >= MAP_ROWS - 3;
        if (distanceToCore < CORE_CLEAR_RADIUS + 2 || rim) biome = 'meadow';
        this.tiles.push(biome);
      }
    }
    this.scatterNodes();
  }

  index(x: number, y: number) { return y * MAP_COLUMNS + x; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < MAP_COLUMNS && y < MAP_ROWS; }
  biomeAt(x: number, y: number): BiomeId {
    return this.inBounds(x, y) ? this.tiles[this.index(x, y)] : 'water';
  }

  /** Water cannot hold buildings; everything else can. */
  isBuildable(x: number, y: number) { return this.biomeAt(x, y) !== 'water'; }

  private scatterNodes() {
    const wanted: NodeKind[] = [];
    for (let i = 0; i < 120; i++) wanted.push('tree');
    for (let i = 0; i < 70; i++) wanted.push('rock');
    for (let i = 0; i < 22; i++) wanted.push('crystalVein');
    wanted.forEach((kind, slot) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = 2 + Math.floor(hash(this.seed + slot * 31, attempt, 3) * (MAP_COLUMNS - 4));
        const y = 2 + Math.floor(hash(this.seed + slot * 31, attempt, 9) * (MAP_ROWS - 4));
        if (Math.hypot(x - this.coreTile.x, y - this.coreTile.y) < CORE_CLEAR_RADIUS + 1) continue;
        if (this.biomeAt(x, y) === 'water') continue;
        if (this.nodes.some((node) => Math.hypot(node.x - x, node.y - y) < 1.4)) continue;
        this.nodes.push({ id: this.nodes.length, kind, x, y, hp: 0 });
        return;
      }
    });
  }

  tileCenter(x: number, y: number) { return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }; }

  /** Draws the whole arena once; baked into a texture when tile art is available. */
  render(scene: Phaser.Scene) {
    if (hasGroundArt()) {
      const surface = scene.add.renderTexture(0, 0, MAP_WIDTH, MAP_HEIGHT).setOrigin(0, 0).setDepth(-8);
      surface.beginDraw();
      for (let y = 0; y < MAP_ROWS; y++) {
        for (let x = 0; x < MAP_COLUMNS; x++) {
          const art = groundTexture(this.biomeAt(x, y), hash(this.seed + 7, x, y));
          if (art) surface.batchDraw(art, x * TILE, y * TILE);
        }
      }
      surface.endDraw();
      return surface;
    }
    const graphics = scene.add.graphics().setDepth(-8);
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLUMNS; x++) {
        graphics.fillStyle(biomePalette(this.biomeAt(x, y)).top, 1);
        graphics.fillRect(x * TILE, y * TILE, TILE + 1, TILE + 1);
      }
    }
    return graphics;
  }
}
