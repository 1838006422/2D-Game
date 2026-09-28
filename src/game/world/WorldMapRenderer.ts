import Phaser from 'phaser';
import {
  biomePalette, CHUNK_TILES, DecorationId, HEIGHT_STEP, isTileBlocking, MAX_HEIGHT, oreColor,
  REVEAL_RADIUS, TILE_HEIGHT, TILE_SIZE, WorldMapData, WorldTile, WORLD_COLUMNS, WORLD_HEIGHT, WORLD_ROWS,
} from './WorldMapData';
import { groundTexture, hasGroundArt, oreTexture, propTexture, sideTexture } from './WorldTiles';

type WorldChunk = {
  ground: Phaser.GameObjects.Graphics;
  wall: Phaser.GameObjects.Graphics;
  detail: Phaser.GameObjects.Graphics;
  /** One baked texture per chunk when tile art is available, otherwise unused. */
  surface?: Phaser.GameObjects.RenderTexture;
  fog: Phaser.GameObjects.Graphics;
  bodies: Phaser.GameObjects.GameObject[];
  decor: Phaser.GameObjects.GameObject[];
};

// Everything walkable shares one depth band so props, enemies and the hero sort
// against each other by their screen row, while HUD layers stay far above.
const PROP_DEPTH = 2;
const PROP_DEPTH_RANGE = .5;
const FOG_DEPTH = 4;
// Building a chunk allocates a render texture, so only a couple are built per frame.
const CHUNKS_PER_FRAME = 2;
// A 3x3 window of 512px chunks already covers the 960x540 viewport with margin.
const WINDOW_RADIUS = 1;

export class WorldMapRenderer {
  private chunks = new Map<string, WorldChunk>();
  private pending: { x: number; y: number; distance: number }[] = [];
  private lastTileKey = '';
  private lastChunkKey = '';
  private lastFogTile?: { x: number; y: number };

  /** Drains the chunk queue, building at most a couple per frame. */
  private flushPending() {
    for (let built = 0; built < CHUNKS_PER_FRAME && this.pending.length > 0; built++) {
      const next = this.pending.shift()!;
      if (!this.chunks.has(this.chunkKey(next.x, next.y))) this.buildChunk(next.x, next.y);
    }
  }

  private buildChunk(chunkX: number, chunkY: number) {
    const chunk = this.createChunk(chunkX, chunkY);
    this.drawChunkFog(chunk, chunkX, chunkY);
    this.chunks.set(this.chunkKey(chunkX, chunkY), chunk);
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly data: WorldMapData,
    private readonly obstacleGroup: Phaser.Physics.Arcade.StaticGroup,
  ) {}

  update(worldX: number, worldY: number) {
    // Chunks are expensive to build, so the queue is drained a little every frame
    // instead of building the whole window at once when the player crosses a border.
    this.flushPending();
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
      const missing: { x: number; y: number; distance: number }[] = [];
      for (let y = Math.max(0, chunkY - WINDOW_RADIUS); y <= Math.min(Math.ceil(WORLD_ROWS / CHUNK_TILES) - 1, chunkY + WINDOW_RADIUS); y++) {
        for (let x = Math.max(0, chunkX - WINDOW_RADIUS); x <= Math.min(Math.ceil(WORLD_COLUMNS / CHUNK_TILES) - 1, chunkX + WINDOW_RADIUS); x++) {
          const key = this.chunkKey(x, y); keep.add(key);
          if (!this.chunks.has(key)) missing.push({ x, y, distance: Math.hypot(x - chunkX, y - chunkY) });
        }
      }
      for (const [key, chunk] of this.chunks) {
        if (!keep.has(key)) { this.destroyChunk(chunk); this.chunks.delete(key); }
      }
      this.pending = this.pending.filter((entry) => keep.has(this.chunkKey(entry.x, entry.y)));
      const queued = new Set(this.pending.map((entry) => this.chunkKey(entry.x, entry.y)));
      missing.forEach((entry) => {
        // The chunk under the player is built immediately so the ground never
        // disappears beneath them while the rest of the window streams in.
        if (entry.distance === 0) this.buildChunk(entry.x, entry.y);
        else if (!queued.has(this.chunkKey(entry.x, entry.y))) this.pending.push(entry);
      });
      this.pending.sort((a, b) => a.distance - b.distance);
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

  /**
   * Rebuilds the chunk holding a point after the terrain changed. The rows in
   * front and behind are rebuilt too because a side face depends on the height of
   * the neighbouring tile, which may sit in another chunk.
   */
  rebuildAt(worldX: number, worldY: number) {
    const tile = this.data.toTile(worldX, worldY);
    const chunkX = Math.floor(tile.x / CHUNK_TILES);
    const chunkY = Math.floor(tile.y / CHUNK_TILES);
    for (let offset = -1; offset <= 1; offset++) {
      const cy = chunkY + offset;
      if (cy < 0 || cy >= Math.ceil(WORLD_ROWS / CHUNK_TILES)) continue;
      const key = this.chunkKey(chunkX, cy);
      const existing = this.chunks.get(key);
      if (!existing) continue;
      this.destroyChunk(existing);
      const fresh = this.createChunk(chunkX, cy);
      this.drawChunkFog(fresh, chunkX, cy);
      this.chunks.set(key, fresh);
    }
  }

  refreshFogAt(worldX: number, worldY: number) {
    const tile = this.data.toTile(worldX, worldY);
    this.refreshFog(tile.x, tile.y);
  }

  destroy() {
    this.chunks.forEach((chunk) => this.destroyChunk(chunk));
    this.chunks.clear();
    this.pending = [];
    this.lastTileKey = '';
    this.lastChunkKey = '';
    this.lastFogTile = undefined;
  }

  private createChunk(chunkX: number, chunkY: number): WorldChunk {
    const ground = this.scene.add.graphics().setDepth(-5);
    const wall = this.scene.add.graphics().setDepth(-4.6);
    const detail = this.scene.add.graphics().setDepth(-4);
    const fog = this.scene.add.graphics().setDepth(FOG_DEPTH);
    const bodies: Phaser.GameObjects.GameObject[] = [];
    const decor: Phaser.GameObjects.GameObject[] = [];
    const startX = chunkX * CHUNK_TILES;
    const startY = chunkY * CHUNK_TILES;
    const endX = Math.min(WORLD_COLUMNS, startX + CHUNK_TILES);
    const endY = Math.min(WORLD_ROWS, startY + CHUNK_TILES);
    const surface = hasGroundArt() ? this.createSurface(chunkX, chunkY) : undefined;
    // Batched so a whole chunk is uploaded as one draw instead of one per tile.
    surface?.beginDraw();

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = this.data.tileAt(x, y);
        const palette = biomePalette(tile.biome);
        const left = x * TILE_SIZE;
        const topY = y * TILE_HEIGHT - tile.height * HEIGHT_STEP;
        // A tile only shows a side face when it stands above the tile in front of
        // it, which turns the elevation field into visible terraces and cliffs.
        const drop = tile.height - this.data.heightAtTile(x, y + 1);

        if (surface) {
          this.drawArtTile(surface, tile, left, topY, drop);
        } else {
          ground.fillStyle(this.shadeColor(palette.top, tile.shade), 1);
          ground.fillRect(left, topY, TILE_SIZE + 1, TILE_HEIGHT + 1);
          if (drop > 0) {
            wall.fillStyle(this.shadeColor(palette.side, Math.max(.55, 1 - drop * .07)), 1);
            wall.fillRect(left, topY + TILE_HEIGHT, TILE_SIZE + 1, drop * HEIGHT_STEP + 1);
          }
          this.drawTileDetail(detail, tile, left, topY);
        }
        if (tile.decoration) this.createDecoration(tile, x, y, topY, bodies, decor);
      }
    }

    surface?.endDraw();
    this.createTerrainBodies(startX, startY, endX, endY, bodies);
    return { ground, wall, detail, fog, surface, bodies, decor };
  }

  private createSurface(chunkX: number, chunkY: number) {
    // Padding leaves room for lifted terraces above and side faces hanging below.
    const pad = MAX_HEIGHT * HEIGHT_STEP;
    const surface = this.scene.add.renderTexture(
      chunkX * CHUNK_TILES * TILE_SIZE,
      chunkY * CHUNK_TILES * TILE_HEIGHT - pad,
      CHUNK_TILES * TILE_SIZE,
      CHUNK_TILES * TILE_HEIGHT + pad * 2,
    );
    return surface.setOrigin(0, 0).setDepth(-5);
  }

  private drawArtTile(surface: Phaser.GameObjects.RenderTexture, tile: WorldTile, left: number, topY: number, drop: number) {
    const localX = left - surface.x;
    const localY = topY - surface.y;
    const tint = this.shadeTint(tile.shade);
    const ground = groundTexture(tile.biome, this.cellHash(left, topY + 7)) ?? groundTexture('meadow', 0);
    if (ground) surface.batchDraw(ground, localX, localY, 1, tint);
    const side = sideTexture(tile.biome);
    if (side && drop > 0) {
      for (let step = 0; step < drop; step++) surface.batchDraw(side, localX, localY + TILE_HEIGHT + step * HEIGHT_STEP, 1, tint);
    }
    const ore = tile.ore ? oreTexture(tile.ore) : null;
    if (ore) {
      const size = this.textureSize(ore);
      surface.batchDraw(ore, localX + (TILE_SIZE - size.width) / 2, localY + (TILE_HEIGHT - size.height) / 2);
    }
  }

  private createArtProp(key: string, centerX: number, baseY: number, depth: number, solid: boolean,
    bodies: Phaser.GameObjects.GameObject[], decor: Phaser.GameObjects.GameObject[]) {
    const image = this.scene.add.image(centerX, baseY + 1, key).setOrigin(.5, 1).setDepth(depth);
    decor.push(this.scene.add.ellipse(centerX, baseY + 1, image.width * .55, image.width * .22, 0x05080b, .3).setDepth(depth - .02));
    if (!solid) { decor.push(image); return; }
    this.obstacleGroup.add(image);
    const body = image.body as Phaser.Physics.Arcade.StaticBody | undefined;
    if (body) {
      const bodyWidth = Math.max(8, image.width * .45);
      const bodyHeight = Math.max(8, image.height * .3);
      body.setSize(bodyWidth, bodyHeight).setOffset((image.width - bodyWidth) / 2, image.height - bodyHeight);
    }
    bodies.push(image);
  }

  /** Greyscale tint reproduces the per-tile brightness jitter on real art. */
  private shadeTint(shade: number) {
    const level = Phaser.Math.Clamp(Math.round(shade * 255), 0, 255);
    return (level << 16) | (level << 8) | level;
  }

  private textureSize(key: string) {
    const source = this.scene.textures.get(key).getSourceImage() as HTMLImageElement | undefined;
    return { width: source?.width ?? TILE_SIZE, height: source?.height ?? TILE_HEIGHT };
  }

  private drawTileDetail(detail: Phaser.GameObjects.Graphics, tile: ReturnType<WorldMapData['tileAt']>, left: number, topY: number) {
    const cell = this.cellHash(left, topY);
    const palette = biomePalette(tile.biome);
    // Detail offsets are fractions of the tile so they stay put at any squash.
    if (tile.biome === 'water') {
      if (cell > .5) {
        const waveY = topY + TILE_HEIGHT * (.25 + cell * .45);
        detail.lineStyle(2, palette.accent, .16);
        detail.lineBetween(left + TILE_SIZE * .16, waveY, left + TILE_SIZE * .82, waveY);
      }
      return;
    }
    if (tile.ore) {
      detail.fillStyle(oreColor(tile.ore), .85);
      detail.fillCircle(left + TILE_SIZE * (.28 + cell * .4), topY + TILE_HEIGHT * (.3 + (1 - cell) * .4), 2.6);
      detail.fillStyle(oreColor(tile.ore), .45);
      detail.fillCircle(left + TILE_SIZE * (.66 - cell * .28), topY + TILE_HEIGHT * (.62 - cell * .28), 1.7);
      return;
    }
    if ((tile.biome === 'meadow' || tile.biome === 'forest' || tile.biome === 'swamp') && !tile.decoration && cell > .74) {
      detail.fillStyle(palette.accent, .22);
      detail.fillCircle(left + TILE_SIZE * (.19 + cell * .62), topY + TILE_HEIGHT * (.25 + cell * .5), 2);
    }
  }

  private createDecoration(
    tile: ReturnType<WorldMapData['tileAt']>,
    tileX: number, _tileY: number, topY: number,
    bodies: Phaser.GameObjects.GameObject[], decor: Phaser.GameObjects.GameObject[],
  ) {
    const kind = tile.decoration;
    if (!kind) return;
    const centerX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const baseY = topY + TILE_HEIGHT / 2;
    const depth = PROP_DEPTH + Phaser.Math.Clamp(baseY / WORLD_HEIGHT, 0, 1) * PROP_DEPTH_RANGE;

    // The stem is the physical part; canopies are pure decoration drawn above it.
    // `lift` places the canopy centre above the tile surface, `squash` flattens it.
    const shapes: Record<DecorationId, { body: [number, number]; color: number; crown?: { radius: number; color: number; lift: number; squash: number } }> = {
      tree: { body: [9, 19], color: 0x4a3524, crown: { radius: 16, color: 0x2c5340, lift: 19, squash: 1 } },
      pine: { body: [8, 15], color: 0x3d2f22, crown: { radius: 14, color: 0x2f5b4a, lift: 20, squash: .8 } },
      cactus: { body: [14, 26], color: 0x4f7142 },
      mushroom: { body: [8, 10], color: 0xd8cfc0, crown: { radius: 11, color: 0xb2705e, lift: 10, squash: 2.2 } },
      pillar: { body: [16, 29], color: 0x8d8170, crown: { radius: 10, color: 0xa2967f, lift: 29, squash: 2.6 } },
      rock: { body: [21, 16], color: 0x6f6d67 },
      oreRock: { body: [24, 19], color: 0x5f5d58 },
      bush: { body: [19, 14], color: 0x3f5c3a },
    };
    const artKey = propTexture(kind);
    if (artKey) {
      this.createArtProp(artKey, centerX, baseY, depth, isTileBlocking(tile), bodies, decor);
      return;
    }
    const shape = shapes[kind];
    const [bodyW, bodyH] = shape.body;
    const prop = this.scene.add.rectangle(centerX, baseY - bodyH / 2, bodyW, bodyH, shape.color, .98)
      .setStrokeStyle(1, 0x0d1218, .35).setDepth(depth);
    if (isTileBlocking(tile)) {
      this.obstacleGroup.add(prop);
      const body = prop.body as Phaser.Physics.Arcade.StaticBody | undefined;
      body?.setSize(Math.max(6, bodyW * .7), Math.max(6, bodyH * .55));
      bodies.push(prop);
    } else decor.push(prop);

    const shadow = this.scene.add.ellipse(centerX, baseY + 1, bodyW * 1.5, bodyW * .62, 0x05080b, .28).setDepth(depth - .02);
    decor.push(shadow);

    if (shape.crown) {
      const { radius, color, lift, squash } = shape.crown;
      const crownY = baseY - lift;
      const crown = this.scene.add.ellipse(centerX, crownY, radius * 2, (radius * 2) / squash, color, .98)
        .setStrokeStyle(1, 0x0d1218, .28).setDepth(depth + .01);
      decor.push(crown);
      const highlight = this.scene.add.ellipse(centerX - radius * .32, crownY - radius * .34, radius * .8, radius * .55, 0xffffff, .12).setDepth(depth + .02);
      decor.push(highlight);
    }
    if (kind === 'oreRock' && tile.ore) {
      const speck = this.scene.add.circle(centerX + 3, baseY - bodyH * .55, 3, oreColor(tile.ore), .95).setDepth(depth + .02);
      decor.push(speck);
    }
    if (kind === 'rock') {
      const gloss = this.scene.add.ellipse(centerX - bodyW * .2, baseY - bodyH * .78, bodyW * .5, bodyH * .3, 0xffffff, .12).setDepth(depth + .02);
      decor.push(gloss);
    }
  }

  /** Water and ridges become colliders; long water runs merge into one rectangle. */
  private createTerrainBodies(
    startX: number, startY: number, endX: number, endY: number,
    bodies: Phaser.GameObjects.GameObject[],
  ) {
    const isWater = (x: number, y: number) => this.data.tileAt(x, y).biome === 'water';

    for (let y = startY; y < endY; y++) {
      let runStart = -1;
      for (let x = startX; x <= endX; x++) {
        const wet = x < endX && isWater(x, y);
        if (wet && runStart < 0) runStart = x;
        if (runStart >= 0 && (!wet || x === endX)) {
          const runEnd = wet ? x + 1 : x;
          const width = (runEnd - runStart) * TILE_SIZE;
          const rect = this.scene.add.rectangle(runStart * TILE_SIZE + width / 2, y * TILE_HEIGHT + TILE_HEIGHT / 2, width, TILE_HEIGHT, 0x000000, 0);
          this.obstacleGroup.add(rect);
          bodies.push(rect);
          runStart = -1;
        }
      }
    }

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = this.data.tileAt(x, y);
        if (tile.biome !== 'highland' || tile.height < MAX_HEIGHT) continue;
        const topY = y * TILE_HEIGHT - tile.height * HEIGHT_STEP;
        const rect = this.scene.add.rectangle(x * TILE_SIZE + TILE_SIZE / 2, topY + TILE_HEIGHT / 2, TILE_SIZE, TILE_HEIGHT, 0x000000, 0);
        this.obstacleGroup.add(rect);
        bodies.push(rect);
      }
    }
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
        const height = this.data.heightAtTile(x, y);
        const topY = y * TILE_HEIGHT - height * HEIGHT_STEP;
        // Cover down to the row below so lifted terraces never leak through.
        const bottomY = Math.max(topY + TILE_HEIGHT, (y + 1) * TILE_HEIGHT + 1);
        chunk.fog.fillStyle(0x020407, 1);
        chunk.fog.fillRect(x * TILE_SIZE, topY, TILE_SIZE + 1, bottomY - topY);
      }
    }
  }

  private destroyChunk(chunk: WorldChunk) {
    chunk.ground.destroy(); chunk.wall.destroy(); chunk.detail.destroy(); chunk.fog.destroy();
    chunk.surface?.destroy();
    chunk.bodies.forEach((object) => this.obstacleGroup.remove(object, true, true));
    chunk.decor.forEach((object) => object.destroy());
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
