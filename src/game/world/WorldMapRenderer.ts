import Phaser from 'phaser';
import {
  biomeColor, CHUNK_TILES, REVEAL_RADIUS, TILE_SIZE, WorldMapData, WORLD_COLUMNS, WORLD_ROWS,
} from './WorldMapData';

type WorldChunk = { ground: Phaser.GameObjects.Graphics; detail: Phaser.GameObjects.Graphics; fog: Phaser.GameObjects.Graphics; obstacles: Phaser.GameObjects.GameObject[] };

export class WorldMapRenderer {
  private chunks = new Map<string, WorldChunk>();
  private lastTileKey = '';
  private lastChunkKey = '';
  private lastFogTile?: { x: number; y: number };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly data: WorldMapData,
    private readonly obstacleGroup: Phaser.Physics.Arcade.StaticGroup,
  ) {}

  update(worldX: number, worldY: number) {
    const tile = this.data.toTile(worldX, worldY);
    const tileKey = `${tile.x},${tile.y}`;
    const changed = tileKey !== this.lastTileKey;
    if (!changed) return false;
    this.lastTileKey = tileKey;
    this.data.revealAround(tile.x, tile.y);

    const chunkX = Math.floor(tile.x / CHUNK_TILES);
    const chunkY = Math.floor(tile.y / CHUNK_TILES);
    const chunkKey = this.chunkKey(chunkX, chunkY);
    const changedChunk = chunkKey !== this.lastChunkKey;
    if (changedChunk) {
      this.lastChunkKey = chunkKey;
      const keep = new Set<string>();
      for (let y = Math.max(0, chunkY - 2); y <= Math.min(Math.ceil(WORLD_ROWS / CHUNK_TILES) - 1, chunkY + 2); y++) {
        for (let x = Math.max(0, chunkX - 2); x <= Math.min(Math.ceil(WORLD_COLUMNS / CHUNK_TILES) - 1, chunkX + 2); x++) {
          const key = this.chunkKey(x, y); keep.add(key);
          if (!this.chunks.has(key)) {
            const chunk = this.createChunk(x, y);
            this.drawChunkFog(chunk, x, y);
            this.chunks.set(key, chunk);
          }
        }
      }
      for (const [key, chunk] of this.chunks) {
        if (!keep.has(key)) { this.destroyChunk(chunk); this.chunks.delete(key); }
      }
    }

    // Revealing still tracks every tile, but redrawing fog is throttled to avoid
    // rebuilding thousands of tile rectangles on every small movement step.
    const shouldRefreshFog = changedChunk || !this.lastFogTile
      || Math.abs(tile.x - this.lastFogTile.x) >= 4 || Math.abs(tile.y - this.lastFogTile.y) >= 4;
    if (shouldRefreshFog) {
      this.lastFogTile = { x: tile.x, y: tile.y };
      this.refreshFog(tile.x, tile.y);
    }
    return true;
  }

  refreshFogAt(worldX: number, worldY: number) {
    const tile = this.data.toTile(worldX, worldY);
    this.refreshFog(tile.x, tile.y);
  }

  destroy() {
    this.chunks.forEach((chunk) => this.destroyChunk(chunk));
    this.chunks.clear();
    this.lastTileKey = '';
    this.lastChunkKey = '';
    this.lastFogTile = undefined;
  }

  private createChunk(chunkX: number, chunkY: number): WorldChunk {
    const ground = this.scene.add.graphics().setDepth(-5);
    const detail = this.scene.add.graphics().setDepth(-4);
    const fog = this.scene.add.graphics().setDepth(2.8);
    const obstacles: Phaser.GameObjects.GameObject[] = [];
    const startX = chunkX * CHUNK_TILES;
    const startY = chunkY * CHUNK_TILES;
    for (let y = startY; y < Math.min(WORLD_ROWS, startY + CHUNK_TILES); y++) {
      for (let x = startX; x < Math.min(WORLD_COLUMNS, startX + CHUNK_TILES); x++) {
        const tile = this.data.tileAt(x, y);
        const worldX = x * TILE_SIZE; const worldY = y * TILE_SIZE;
        ground.fillStyle(this.shadeColor(biomeColor(tile.biome), tile.shade), 1);
        ground.fillRect(worldX, worldY, TILE_SIZE + 1, TILE_SIZE + 1);
        const detailHash = this.cellHash(x, y);
        if (tile.biome === 'water' && detailHash > .57) {
          detail.lineStyle(2, 0x8bb3bb, .13);
          detail.lineBetween(worldX + 13, worldY + 22 + detailHash * 17, worldX + 42, worldY + 22 + detailHash * 17);
        } else if ((tile.biome === 'meadow' || tile.biome === 'forest') && tile.decoration === null && detailHash > .75) {
          detail.fillStyle(tile.biome === 'forest' ? 0x668367 : 0x93a775, .19);
          detail.fillCircle(worldX + 16 + detailHash * 28, worldY + 18 + detailHash * 27, 2 + detailHash * 2);
        }
        if (tile.decoration) {
          const size = tile.decoration === 'tree' ? 43 : tile.decoration === 'ruin' ? 42 : 29;
          const color = tile.decoration === 'tree' ? 0x1c3028 : tile.decoration === 'ruin' ? 0x61594f : 0x736e61;
          const object = this.scene.add.ellipse(worldX + TILE_SIZE / 2, worldY + TILE_SIZE / 2, size, size * .82, color, .98)
            .setStrokeStyle(2, tile.decoration === 'tree' ? 0x496b4e : 0x969083, .42).setDepth(2.55);
          this.obstacleGroup.add(object);
          const body = object.body as Phaser.Physics.Arcade.StaticBody | undefined;
          body?.setSize(size * .66, size * .55).updateFromGameObject();
          obstacles.push(object);
          detail.fillStyle(tile.decoration === 'tree' ? 0x9db17a : 0xb2a993, .27);
          detail.fillCircle(worldX + TILE_SIZE / 2 - 7, worldY + TILE_SIZE / 2 - 8, 3);
        }
      }
    }
    return { ground, detail, fog, obstacles };
  }

  private refreshFog(centerX: number, centerY: number) {
    const minChunkX = Math.floor(Math.max(0, centerX - REVEAL_RADIUS) / CHUNK_TILES);
    const maxChunkX = Math.floor(Math.min(WORLD_COLUMNS - 1, centerX + REVEAL_RADIUS) / CHUNK_TILES);
    const minChunkY = Math.floor(Math.max(0, centerY - REVEAL_RADIUS) / CHUNK_TILES);
    const maxChunkY = Math.floor(Math.min(WORLD_ROWS - 1, centerY + REVEAL_RADIUS) / CHUNK_TILES);
    for (let y = minChunkY; y <= maxChunkY; y++) {
      for (let x = minChunkX; x <= maxChunkX; x++) {
        const chunk = this.chunks.get(this.chunkKey(x, y));
        if (chunk) this.drawChunkFog(chunk, x, y);
      }
    }
  }

  private drawChunkFog(chunk: WorldChunk, chunkX: number, chunkY: number) {
    chunk.fog.clear();
    for (let y = chunkY * CHUNK_TILES; y < Math.min(WORLD_ROWS, (chunkY + 1) * CHUNK_TILES); y++) {
      for (let x = chunkX * CHUNK_TILES; x < Math.min(WORLD_COLUMNS, (chunkX + 1) * CHUNK_TILES); x++) {
        // Exploration is permanent: only never-visited tiles stay hidden.
        if (this.data.isExplored(x, y)) continue;
        chunk.fog.fillStyle(0x020407, 1);
        chunk.fog.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE + 1, TILE_SIZE + 1);
      }
    }
  }

  private destroyChunk(chunk: WorldChunk) {
    chunk.ground.destroy(); chunk.detail.destroy(); chunk.fog.destroy();
    chunk.obstacles.forEach((obstacle) => this.obstacleGroup.remove(obstacle, true, true));
  }

  private shadeColor(color: number, factor: number) {
    const red = Math.min(255, ((color >> 16) & 255) * factor);
    const green = Math.min(255, ((color >> 8) & 255) * factor);
    const blue = Math.min(255, (color & 255) * factor);
    return (red << 16) | (green << 8) | blue;
  }

  private cellHash(x: number, y: number) {
    let value = Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3) ^ this.data.seed;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  private chunkKey(x: number, y: number) { return `${x},${y}`; }
}
