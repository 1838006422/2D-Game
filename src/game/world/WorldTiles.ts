import Phaser from 'phaser';
import { BiomeId, DecorationId, HEIGHT_STEP, OreId, TILE_SIZE } from './WorldMapData';

// Art is optional: the world renders as vector shapes until real art is dropped
// into public/tiles together with a manifest.json that lists the files.
const TILE_DIR = 'tiles/';

/** manifest.json maps an art id to a file name, e.g. { "ground_meadow": "meadow.png" }. */
export type TileManifest = Record<string, string>;

let manifest: TileManifest = {};
const groundTextures = new Map<string, string[]>();
const sideTextures = new Map<string, string>();
const propTextures = new Map<string, string>();
const oreTextures = new Map<string, string>();
const actorTextures = new Map<string, string>();

/** Actors are normalised to these heights so art of any size fits the world. */
const ACTOR_HEIGHT: Record<string, number> = { player: 52, pet: 30, stalker: 44, brute: 54, caster: 48, boss: 88 };

function textureKey(id: string) { return `tile-${id}`; }

/**
 * Art ids are `<kind>_<name>` with an optional `_N` variant suffix:
 * ground_meadow, ground_meadow_2, side_forest, prop_tree, ore_gold.
 */
export async function loadTileManifest(): Promise<boolean> {
  try {
    const response = await fetch(TILE_DIR + 'manifest.json', { cache: 'no-store' });
    if (!response.ok) return false;
    const value = await response.json() as TileManifest;
    manifest = value && typeof value === 'object' ? value : {};
    return Object.keys(manifest).length > 0;
  } catch { /* No manifest means the world keeps its vector look. */ }
  return false;
}

/** Queues every manifest entry that actually resolved into a texture. */
export function queueTileImages(scene: Phaser.Scene) {
  Object.keys(manifest).forEach((id) => scene.load.image(textureKey(id), TILE_DIR + manifest[id]));
}

/**
 * Rescales a texture to an exact size so art of any resolution fits the grid, and
 * adds a one pixel bleed: the last column and row are duplicated into the margin,
 * so neighbouring tiles overlap instead of leaving a hairline seam between them.
 */
function fitTexture(scene: Phaser.Scene, key: string, width: number, height: number) {
  const source = scene.textures.get(key).getSourceImage() as HTMLImageElement | undefined;
  if (!source || !source.width || !source.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width + 1; canvas.height = height + 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, width, height);
  context.drawImage(source, source.width - 1, 0, 1, source.height, width, 0, 1, height);
  context.drawImage(source, 0, source.height - 1, source.width, 1, 0, height, width, 1);
  context.drawImage(source, source.width - 1, source.height - 1, 1, 1, width, height, 1, 1);
  const fitted = `${key}@fit`;
  if (scene.textures.exists(fitted)) scene.textures.remove(fitted);
  scene.textures.addCanvas(fitted, canvas);
  return fitted;
}

/** Rescales an actor to a fixed height, keeping its aspect ratio. */
function fitHeight(scene: Phaser.Scene, key: string, height: number) {
  const source = scene.textures.get(key).getSourceImage() as HTMLImageElement | undefined;
  if (!source || !source.width || !source.height) return null;
  if (source.height === height) return key;
  const width = Math.max(1, Math.round(source.width * height / source.height));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, width, height);
  const fitted = `${key}@fit`;
  if (scene.textures.exists(fitted)) scene.textures.remove(fitted);
  scene.textures.addCanvas(fitted, canvas);
  return fitted;
}

/** Sorts every loaded texture into the lookup tables the renderer reads. */
export function registerTiles(scene: Phaser.Scene) {
  groundTextures.clear(); sideTextures.clear(); propTextures.clear(); oreTextures.clear();
  actorTextures.clear();
  Object.keys(manifest).forEach((id) => {
    const key = textureKey(id);
    if (!scene.textures.exists(key)) return;
    const [kind, name] = id.split('_');
    if (!kind || !name) return;
    if (kind === 'ground') {
      const fitted = fitTexture(scene, key, TILE_SIZE, TILE_SIZE) ?? key;
      groundTextures.set(name, [...(groundTextures.get(name) ?? []), fitted]);
    } else if (kind === 'side') {
      sideTextures.set(name, fitTexture(scene, key, TILE_SIZE, HEIGHT_STEP) ?? key);
    } else if (kind === 'prop') {
      propTextures.set(name, key);
    } else if (kind === 'ore') {
      oreTextures.set(name, key);
    } else if (kind === 'actor') {
      const height = ACTOR_HEIGHT[name];
      actorTextures.set(name, height ? (fitHeight(scene, key, height) ?? key) : key);
    }
  });
}

export function hasGroundArt() { return groundTextures.size > 0; }

/** Picks a ground texture, spreading the variants by a per-tile roll. */
export function groundTexture(biome: BiomeId, roll: number) {
  const list = groundTextures.get(biome);
  if (!list || list.length === 0) return null;
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}

export function sideTexture(biome: BiomeId) { return sideTextures.get(biome) ?? null; }
export function propTexture(decoration: DecorationId) { return propTextures.get(decoration) ?? null; }
export function oreTexture(oreId: OreId) { return oreTextures.get(oreId) ?? null; }
export function actorTexture(name: string) { return actorTextures.get(name) ?? null; }
