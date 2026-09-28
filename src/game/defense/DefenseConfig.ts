import { MaterialId } from '../world/WorldMapData';

// The defence run plays on one compact arena instead of the huge continent, so the
// whole map can be generated and drawn in one pass without chunk streaming.
export const TILE = 32;
export const MAP_COLUMNS = 64;
export const MAP_ROWS = 64;
export const MAP_WIDTH = MAP_COLUMNS * TILE;
export const MAP_HEIGHT = MAP_ROWS * TILE;

export const CORE_HP = 1000;
/** Clear radius around the core so the first wave is never spawned on top of it. */
export const CORE_CLEAR_RADIUS = 5;

export type BuildKind = 'woodWall' | 'stoneWall' | 'arrowTower' | 'frostTower' | 'thornWall' | 'cannonTower';
export type BuildDef = {
  name: string;
  cost: Partial<Record<MaterialId, number>>;
  hp: number;
  blocking: boolean;
  color: number;
  /** Towers only: auto attack stats. */
  range?: number;
  damage?: number;
  cooldown?: number;
  slow?: number;
  /** Thorn walls only: damage reflected to melee attackers. */
  thorn?: number;
};

export const BUILDS: Record<BuildKind, BuildDef> = {
  woodWall: { name: '木墙', cost: { wood: 5 }, hp: 220, blocking: true, color: 0x9b6b45 },
  stoneWall: { name: '石墙', cost: { stone: 8 }, hp: 560, blocking: true, color: 0x9a9590 },
  arrowTower: { name: '箭塔', cost: { wood: 10, stone: 5 }, hp: 260, blocking: true, color: 0xc9a86a, range: 210, damage: 9, cooldown: 780 },
  frostTower: { name: '冰塔', cost: { stone: 6, crystal: 3 }, hp: 240, blocking: true, color: 0x8fd0e8, range: 170, damage: 3, cooldown: 1100, slow: .5 },
  thornWall: { name: '荆棘墙', cost: { wood: 8, stone: 4 }, hp: 400, blocking: true, color: 0x5f8f3f, thorn: 6 },
  cannonTower: { name: '炮塔', cost: { iron: 8, crystal: 4 }, hp: 320, blocking: true, color: 0xd08b6a, range: 270, damage: 28, cooldown: 2300 },
};
export const BUILD_ORDER: BuildKind[] = ['woodWall', 'stoneWall', 'arrowTower', 'frostTower', 'thornWall', 'cannonTower'];

/** Meta unlocks: blueprints open up once lifetime kills pass the threshold. */
export const BUILD_UNLOCK: Partial<Record<BuildKind, number>> = { thornWall: 150, cannonTower: 400 };
/** The fox levels up with lifetime kills as well, capping out at the top level. */
export const PET_LEVEL_KILLS = 120;
export const PET_MAX_LEVEL = 12;

export type NodeKind = 'tree' | 'rock' | 'crystalVein';
export type NodeDef = { name: string; hp: number; yield: MaterialId; amount: number; color: number; radius: number };
export const NODES: Record<NodeKind, NodeDef> = {
  tree: { name: '树木', hp: 3, yield: 'wood', amount: 4, color: 0x4a8f5e, radius: 15 },
  rock: { name: '岩石', hp: 4, yield: 'stone', amount: 4, color: 0x8d8880, radius: 14 },
  crystalVein: { name: '晶簇', hp: 6, yield: 'crystal', amount: 3, color: 0x9b7ce0, radius: 13 },
};

export type EnemyKind = 'grunt' | 'brute' | 'runner' | 'elite';
export type EnemyDef = { hp: number; speed: number; damage: number; color: number; radius: number; xp: number };
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: { hp: 12, speed: 62, damage: 8, color: 0xe77d70, radius: 12, xp: 4 },
  runner: { hp: 8, speed: 104, damage: 6, color: 0xf0c26a, radius: 10, xp: 5 },
  brute: { hp: 38, speed: 40, damage: 18, color: 0xe79b5b, radius: 17, xp: 10 },
  elite: { hp: 120, speed: 52, damage: 26, color: 0xb38bed, radius: 20, xp: 30 },
};

export type BoonId = 'damage' | 'speed' | 'towerRate' | 'petPower' | 'harvest' | 'coreRepair';
export type Boon = { id: BoonId; name: string; description: string };
/** Offered as a pick-one-of-three every time the threat level rises. */
export const BOONS: Boon[] = [
  { id: 'damage', name: '利刃', description: '你的攻击伤害 +3' },
  { id: 'speed', name: '疾风步', description: '移动速度 +20' },
  { id: 'towerRate', name: '机械润滑', description: '所有防御塔攻速 +25%' },
  { id: 'petPower', name: '灵狐共鸣', description: '灵狐伤害 +3，跑得更快' },
  { id: 'harvest', name: '丰饶之锄', description: '采集产出 +50%' },
  { id: 'coreRepair', name: '紧急修复', description: '核心回复 250 点生命' },
];

/**
 * Endless escalation: threat climbs every `THREAT_INTERVAL` seconds and drives
 * spawn rate, enemy health and how many spawn at once.
 */
export const THREAT_INTERVAL = 30;
export const BASE_SPAWN_INTERVAL = 2600;
export const MIN_SPAWN_INTERVAL = 520;
export const AIRDROP_INTERVAL = 45;
export const AIRDROP_LIFETIME = 40;
/**
 * The fox only fetches airdrops that landed this close to the player. Drops
 * further out are the player's risk to run for, which keeps the "leave the
 * base" pressure of airdrops intact.
 */
export const PET_LEASH = 240;
