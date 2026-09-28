import Phaser from 'phaser';
import './style.css';
import { biomeColor, biomeName, createWorldSeed, loadWorldSave, saveWorldSave, TILE_SIZE, WorldMapData, WORLD_HEIGHT, WORLD_WIDTH } from './game/world/WorldMapData';
import { WorldMapRenderer } from './game/world/WorldMapRenderer';

const W = 960;
const H = 540;
const WORLD_W = WORLD_WIDTH;
const WORLD_H = WORLD_HEIGHT;
const COLORS = { floor: 0x171e28, grid: 0x202a37, wall: 0x354153, player: 0x91e1c4, pet: 0xa9e9dc, enemy: 0xe77d70, gold: 0xffc77d, ink: 0x10151d };
type PetSkillId = 'mark' | 'breath' | 'shock' | 'ferocity' | 'scavenger';
type AutoSkillId = 'hunter_shot' | 'battle_focus' | 'shockwave';
const PLAYER_PASSIVE_KEY = 'border-expedition-player-passive';
const PLAYER_AUTO_KEY = 'border-expedition-player-auto';
const AUTO_SKILLS: Record<AutoSkillId, { name: string; description: string }> = {
  hunter_shot: { name: '追击弹', description: '自动攻击最近的敌人，造成单体伤害。' },
  battle_focus: { name: '战斗专注', description: '附近出现敌人时自动强化攻击，持续 4 秒。' },
  shockwave: { name: '震荡波', description: '附近至少有两名敌人时自动发动群体攻击。' },
};
const PET_SKILL_BOOKS: Record<PetSkillId, { name: string; description: string; default: boolean }> = {
  mark: { name: '追猎印记', description: '每四次扑击标记敌人，你的下一次攻击造成额外伤害。', default: true },
  breath: { name: '守护灵息', description: '生命低于一半时治疗 14 点，冷却 12 秒。', default: true },
  shock: { name: '震荡吼', description: '每 6.5 秒对灵狐周围的敌人造成伤害并击退。', default: false },
  ferocity: { name: '猎手本能', description: '灵狐的扑击伤害提高。', default: false },
  scavenger: { name: '寻迹嗅觉', description: '提高宠物技能书的发现概率。', default: false },
};
const OWNED_SKILLS_KEY = 'border-expedition-pet-skills';
const EQUIPPED_SKILLS_KEY = 'border-expedition-pet-loadout';
const PROGRESS_KEY = 'border-expedition-progress';
const DUNGEON_KEY = 'border-expedition-dungeon';
const CORE_KEY = 'border-expedition-cores';
const EQUIPMENT_KEY = 'border-expedition-equipment';
const CHARACTER_PROGRESS_KEY = 'border-expedition-character-progress';
type ExpeditionProgress = { highestUnlocked: number; continueStage: number };
type RoomKind = 'combat' | 'treasure' | 'rest' | 'boss';
type FeatureKind = 'treasure' | 'rest';
type EnemyKind = 'stalker' | 'brute' | 'caster' | 'boss';
type DungeonNode = { id: number; x: number; y: number; type: RoomKind; discovered: boolean; visited: boolean; cleared: boolean };
type DungeonSave = { stage: number; seed: number; currentRoom: number; hp: number; completed: boolean; nodes: DungeonNode[]; edges: [number, number][] };
type EquipmentSlot = 'weapon' | 'armor';
type GearRarity = 'common' | 'rare' | 'epic';
type EquipmentItem = { id: string; name: string; slot: EquipmentSlot; rarity: GearRarity; weaponType?: 'sword' | 'spear' | 'staff'; attackBonus: number; defense: number; upgradeLevel: number; description: string };
type EquipmentState = { items: EquipmentItem[]; equipped: { weapon: string | null; armor: string | null } };
type CharacterAttributes = { power: number; focus: number; agility: number };
type CharacterProgress = { level: number; xp: number; statPoints: number; attributes: CharacterAttributes };

function getCharacterProgress(): CharacterProgress {
  try {
    const value = JSON.parse(localStorage.getItem(CHARACTER_PROGRESS_KEY) ?? 'null') as Partial<CharacterProgress> | null;
    if (value && Number.isInteger(value.level) && Number.isInteger(value.xp) && Number.isInteger(value.statPoints) && value.attributes) {
      return { level: Math.max(1, value.level!), xp: Math.max(0, value.xp!), statPoints: Math.max(0, value.statPoints!), attributes: {
        power: Math.max(0, Number(value.attributes.power) || 0), focus: Math.max(0, Number(value.attributes.focus) || 0), agility: Math.max(0, Number(value.attributes.agility) || 0),
      } };
    }
  } catch { /* Use the level-one defaults when saved character data is invalid. */ }
  return { level: 1, xp: 0, statPoints: 0, attributes: { power: 0, focus: 0, agility: 0 } };
}

function saveCharacterProgress(progress: CharacterProgress) {
  try { localStorage.setItem(CHARACTER_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Keep progression active for this visit. */ }
}

function xpToNextLevel(level: number) { return 100 + (level - 1) * 60; }

function getEquipmentState(): EquipmentState {
  try {
    const value = JSON.parse(localStorage.getItem(EQUIPMENT_KEY) ?? 'null') as Partial<EquipmentState> | null;
    if (value && Array.isArray(value.items) && value.equipped) {
      const items = value.items.filter((item) => Boolean(item && typeof item.id === 'string' && (item.slot === 'weapon' || item.slot === 'armor')))
        .map((item) => ({ ...item, upgradeLevel: Number.isInteger((item as EquipmentItem).upgradeLevel) ? Math.max(0, Math.min(5, (item as EquipmentItem).upgradeLevel)) : 0 } as EquipmentItem));
      return { items, equipped: {
        weapon: items.some((item) => item.id === value.equipped!.weapon && item.slot === 'weapon') ? value.equipped.weapon! : null,
        armor: items.some((item) => item.id === value.equipped!.armor && item.slot === 'armor') ? value.equipped.armor! : null,
      } };
    }
  } catch { /* Start with an empty bag if saved equipment is unavailable. */ }
  return { items: [], equipped: { weapon: null, armor: null } };
}

function saveEquipmentState(state: EquipmentState) {
  try { localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(state)); } catch { /* Loot remains usable for this visit. */ }
}

function getEquippedItem(slot: EquipmentSlot): EquipmentItem | undefined {
  const state = getEquipmentState(); const id = state.equipped[slot];
  return id ? state.items.find((item) => item.id === id) : undefined;
}

function getCoreCount() {
  try { return Math.max(0, Number(localStorage.getItem(CORE_KEY)) || 0); } catch { return 0; }
}

function setCoreCount(value: number) {
  try { localStorage.setItem(CORE_KEY, String(Math.max(0, Math.floor(value)))); } catch { /* Core spending stays available for this visit. */ }
}

function describeEquipment(item: EquipmentItem) {
  if (item.slot === 'weapon') {
    const weaponName = { sword: '单手剑', spear: '长枪', staff: '法杖' }[item.weaponType ?? 'sword'];
    return `${weaponName}攻击伤害 +${item.attackBonus} · 强化 +${item.upgradeLevel}`;
  }
  return `受到的伤害减少 ${item.defense} · 强化 +${item.upgradeLevel}`;
}

function formatStage(stage: number) { return `${Math.floor((stage - 1) / 10) + 1}-${((stage - 1) % 10) + 1}`; }

function getExpeditionProgress(): ExpeditionProgress {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null') as Partial<ExpeditionProgress> | null;
    if (parsed && Number.isInteger(parsed.highestUnlocked) && Number.isInteger(parsed.continueStage)) {
      return { highestUnlocked: Math.max(1, parsed.highestUnlocked!), continueStage: Math.max(1, parsed.continueStage!) };
    }
  } catch { /* Start at the first stage if local storage is unavailable. */ }
  return { highestUnlocked: 1, continueStage: 1 };
}

function saveExpeditionProgress(progress: ExpeditionProgress) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress remains playable for this visit. */ }
}

function generateDungeon(stage: number): DungeonSave {
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const random = new Phaser.Math.RandomDataGenerator([String(seed)]);
  const firstUtility = random.pick(['treasure', 'rest'] as FeatureKind[]);
  const secondUtility: FeatureKind = firstUtility === 'treasure' ? 'rest' : 'treasure';
  const utilityFirst = random.frac() < .5;
  const positions = [[0, 1], [1, 0], [1, 2], [2, 1], [3, 1]];
  const nodes = positions.map(([x, y], id): DungeonNode => ({
    id, x, y, type: id === 0 ? 'combat' : id === 4 ? 'boss' : id === 1 ? (utilityFirst ? firstUtility : 'combat') : id === 2 ? (utilityFirst ? 'combat' : firstUtility) : secondUtility,
    discovered: id === 0, visited: false, cleared: false,
  }));
  return { stage, seed, currentRoom: 0, hp: 100, completed: false,
    nodes, edges: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]] };
}

function loadDungeonSave(): DungeonSave | null {
  try {
    const value = JSON.parse(localStorage.getItem(DUNGEON_KEY) ?? 'null') as DungeonSave | null;
    if (value && Array.isArray(value.nodes) && value.nodes.length === 5 && Array.isArray(value.edges) && Number.isInteger(value.stage)) return value;
  } catch { /* Start a new dungeon when saved data is invalid. */ }
  return null;
}

function saveDungeon(dungeon: DungeonSave) {
  try { localStorage.setItem(DUNGEON_KEY, JSON.stringify(dungeon)); } catch { /* The current run remains playable without browser storage. */ }
}

function loadPetSkills(key: string, fallback: PetSkillId[]): PetSkillId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(parsed)) return parsed.filter((id): id is PetSkillId => id in PET_SKILL_BOOKS);
  } catch { /* Use the prototype defaults when storage is unavailable or invalid. */ }
  return fallback;
}

function savePetSkills(key: string, skills: PetSkillId[]) {
  try { localStorage.setItem(key, JSON.stringify(skills)); } catch { /* The game remains playable without persistent browser storage. */ }
}

function getOwnedPetSkills(): PetSkillId[] {
  const saved = loadPetSkills(OWNED_SKILLS_KEY, []);
  return (Object.keys(PET_SKILL_BOOKS) as PetSkillId[]).filter((id) => PET_SKILL_BOOKS[id].default || saved.includes(id));
}

function getEquippedPetSkills(): PetSkillId[] {
  return loadPetSkills(EQUIPPED_SKILLS_KEY, ['mark', 'breath']).filter((id) => getOwnedPetSkills().includes(id)).slice(0, 3);
}

function getAutoSkill(): AutoSkillId {
  try {
    const value = localStorage.getItem(PLAYER_AUTO_KEY);
    if (value && value in AUTO_SKILLS) return value as AutoSkillId;
  } catch { /* Use the default auto skill. */ }
  return 'hunter_shot';
}

function hasSwiftStep(): boolean {
  try { return localStorage.getItem(PLAYER_PASSIVE_KEY) !== 'false'; } catch { return true; }
}

class CombatScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private pet!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hp = 100;
  private room = 1;
  private dungeon!: DungeonSave;
  private kills = 0;
  private attackTimer = 0;
  private petTimer = 0;
  private petBites = 0;
  private petRescueReadyAt = 0;
  private petHudTimer = 0;
  private petShockTimer = 0;
  private petSkills: PetSkillId[] = getEquippedPetSkills();
  private autoSkill: AutoSkillId = getAutoSkill();
  private swiftStep = hasSwiftStep();
  private activeSkillReadyAt = 0;
  private autoSkillReadyAt = 0;
  private autoBuffUntil = 0;
  private restBuffUntil = 0;
  private characterHudTimer = 0;
  private checkpointTimer = 0;
  private skillBookDrops!: Phaser.Physics.Arcade.Group;
  private rewardDrops!: Phaser.Physics.Arcade.Group;
  private gearDrops!: Phaser.Physics.Arcade.Group;
  private pendingSkillBooks = new Set<PetSkillId>();
  private dashReady = true;
  private dashTimer = 0;
  private invulnerable = 0;
  private attackHeld = false;
  private weapon: 'sword' | 'spear' | 'staff' = 'sword';
  private playerHpBar!: Phaser.GameObjects.Rectangle;
  private roomText!: Phaser.GameObjects.Text;
  private roomNameText!: Phaser.GameObjects.Text;
  private mapLayer!: Phaser.GameObjects.Container;
  private worldMiniMapCells: Phaser.GameObjects.Rectangle[] = [];
  private worldMiniMapOrigin?: { x: number; y: number };
  private worldMiniMapMarker?: Phaser.GameObjects.Arc;
  private worldMiniMapTitle?: Phaser.GameObjects.Text;
  private interactionHint!: Phaser.GameObjects.Text;
  private roomFeature?: Phaser.GameObjects.Container;
  private roomFeatureKind: FeatureKind | null = null;
  private roomCombatActive = false;
  private lootPhase = false;
  private combatWaves: Exclude<EnemyKind, 'boss'>[][] = [];
  private nextCombatWaveIndex = 0;
  private waveSpawnEvent?: Phaser.Time.TimerEvent;
  private transientEffects = new Set<Phaser.GameObjects.GameObject>();
  private terrainDecor: Phaser.GameObjects.GameObject[] = [];
  private dashText!: Phaser.GameObjects.Text;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private terrain!: Phaser.Physics.Arcade.StaticGroup;
  private worldData?: WorldMapData;
  private worldRenderer?: WorldMapRenderer;
  private wildernessSpawnTimer = 3_000;

  constructor() { super('combat'); }

  create() {
    this.game.events.on('world:begin', this.beginWorld, this);
    this.game.events.on('world:resume', this.resumeWorld, this);
    this.game.events.on('world:leave', this.leaveWorld, this);
    this.game.events.on('weapon:select', this.handleWeaponSelection, this);
    this.game.events.on('pet-skills:changed', this.handlePetSkillsChanged, this);
    this.game.events.on('character-skills:changed', this.handleCharacterSkillsChanged, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('world:begin', this.beginWorld, this);
      this.game.events.off('world:resume', this.resumeWorld, this);
      this.game.events.off('world:leave', this.leaveWorld, this);
      this.game.events.off('weapon:select', this.handleWeaponSelection, this);
      this.game.events.off('pet-skills:changed', this.handlePetSkillsChanged, this);
      this.game.events.off('character-skills:changed', this.handleCharacterSkillsChanged, this);
    });
    this.createTextures();
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x05080b).setDepth(-10);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.walls = this.physics.add.staticGroup();
    this.addWall(WORLD_W / 2, 28, WORLD_W, 56); this.addWall(WORLD_W / 2, WORLD_H - 28, WORLD_W, 56);
    this.addWall(28, WORLD_H / 2, 56, WORLD_H); this.addWall(WORLD_W - 28, WORLD_H / 2, 56, WORLD_H);
    this.terrain = this.physics.add.staticGroup();
    this.player = this.physics.add.sprite(WORLD_W / 2, WORLD_H / 2, 'player').setDepth(3).setCircle(14).setCollideWorldBounds(true);
    this.pet = this.physics.add.sprite(WORLD_W / 2 - 36, WORLD_H / 2 + 22, 'pet').setDepth(3).setCircle(9);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.skillBookDrops = this.physics.add.group();
    this.rewardDrops = this.physics.add.group();
    this.gearDrops = this.physics.add.group();
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.player, this.terrain);
    this.physics.add.collider(this.enemies, this.terrain);
    this.physics.add.collider(this.pet, this.walls);
    this.physics.add.collider(this.pet, this.terrain);
    this.physics.add.collider(this.player, this.enemies, (_p, e) => this.touchEnemy(e as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.pet, this.enemies, (_p, e) => this.petHit(e as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.skillBookDrops, (_p, book) => this.pickUpSkillBook(book as Phaser.GameObjects.Arc));
    this.physics.add.overlap(this.player, this.rewardDrops, (_p, reward) => this.pickUpCore(reward as Phaser.GameObjects.Arc));
    this.physics.add.overlap(this.player, this.gearDrops, (_p, gear) => this.pickUpGear(gear as Phaser.GameObjects.Arc));
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,Q,E,SPACE,ONE,TWO,THREE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.on('pointerdown', () => { this.attackHeld = true; });
    this.input.on('pointerup', () => { this.attackHeld = false; });
    this.input.on('gameout', () => { this.attackHeld = false; });
    this.playerHpBar = this.add.rectangle(0, 0, 36, 4, 0x83d7b1).setDepth(5).setOrigin(.5, .5);
    this.roomText = this.add.text(54, 48, '', { fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#aeb9ca', letterSpacing: 1 }).setDepth(8).setScrollFactor(0);
    this.roomNameText = this.add.text(W / 2, 48, '', { fontFamily: 'Manrope, sans-serif', fontSize: '12px', color: '#e5c58f', fontStyle: 'bold' }).setOrigin(.5, 0).setDepth(8).setScrollFactor(0);
    this.dashText = this.add.text(W - 54, 48, '', { fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#ffc77d' }).setOrigin(1, 0).setDepth(8).setScrollFactor(0);
    this.mapLayer = this.add.container(W - 238, 76).setDepth(8).setScrollFactor(0);
    this.interactionHint = this.add.text(W / 2, H - 73, '', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '13px', color: '#fff0c2', backgroundColor: '#10151ddd', padding: { x: 13, y: 8 } }).setOrigin(.5).setDepth(9).setScrollFactor(0).setVisible(false);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H).startFollow(this.player, true, .12, .12);
    this.updateCoreHud();
    this.updateCharacterProgressHud();
    this.setWeapon(this.weapon);
    this.dungeon = generateDungeon(1); this.updateLabels(); this.mapLayer.removeAll(true);
    this.scene.pause();
  }

  private beginExpedition(startStage = 1) {
    this.clearExpeditionEntities();
    const progress = getExpeditionProgress();
    this.room = Phaser.Math.Clamp(Math.floor(startStage), 1, progress.highestUnlocked);
    this.dungeon = generateDungeon(this.room); this.hp = 100; this.kills = 0;
    this.restBuffUntil = 0;
    saveDungeon(this.dungeon);
    progress.continueStage = this.room; saveExpeditionProgress(progress);
    this.setWeapon(this.weapon);
    this.resetCombatState();
    this.enterDungeonRoom(0);
    this.scale.refresh();
  }

  private beginWorld() {
    this.clearExpeditionEntities();
    this.worldData = new WorldMapData(createWorldSeed());
    this.worldMiniMapOrigin = undefined;
    this.room = 1; this.dungeon = generateDungeon(1); this.hp = 100; this.kills = 0;
    this.restBuffUntil = 0; this.wildernessSpawnTimer = 3_000;
    this.resetCombatState();
    this.activateWorld(WORLD_W / 2, WORLD_H / 2);
    this.saveCurrentCheckpoint();
  }

  private resumeWorld() {
    const saved = loadWorldSave();
    if (!saved) { this.beginWorld(); return; }
    this.clearExpeditionEntities();
    this.worldData = WorldMapData.fromSave(saved);
    this.room = 1; this.dungeon = generateDungeon(1); this.hp = saved.hp; this.kills = 0;
    this.wildernessSpawnTimer = 5_000;
    this.resetCombatState();
    this.activateWorld(saved.playerX, saved.playerY);
  }

  private activateWorld(playerX: number, playerY: number) {
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.player.setPosition(playerX, playerY).setVelocity(0, 0);
    this.pet.setPosition(playerX - 36, playerY + 22).setVelocity(0, 0);
    this.cameras.main.startFollow(this.player, true, .12, .12);
    this.worldRenderer?.destroy();
    this.worldRenderer = new WorldMapRenderer(this, this.worldData!, this.terrain);
    this.worldRenderer.update(this.player.x, this.player.y);
    const safeSpawn = this.findOpenAt(this.player.x, this.player.y, 44);
    this.player.setPosition(safeSpawn.x, safeSpawn.y).setVelocity(0, 0);
    this.pet.setPosition(safeSpawn.x - 36, safeSpawn.y + 22).setVelocity(0, 0);
    this.worldRenderer.update(safeSpawn.x, safeSpawn.y);
    this.roomCombatActive = false; this.lootPhase = false;
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = '自由探索中 · 未探索区域被迷雾遮挡';
    this.updateLabels(); this.drawMiniMap(); this.updateHealthHud(); this.scene.resume(); this.scale.refresh();
  }

  private leaveWorld() {
    if (this.worldData) this.saveCurrentCheckpoint();
    this.scene.pause();
  }

  private resumeExpedition() {
    this.clearExpeditionEntities();
    const saved = loadDungeonSave();
    if (!saved || saved.completed) { this.beginExpedition(getExpeditionProgress().continueStage); return; }
    this.dungeon = saved; this.room = saved.stage; this.hp = Phaser.Math.Clamp(saved.hp, 1, 100);
    this.setWeapon(this.weapon);
    this.kills = saved.nodes.filter((node) => node.cleared && node.type === 'combat').length;
    this.resetCombatState();
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    if (!node) { this.beginExpedition(getExpeditionProgress().continueStage); return; }
    this.generateRoomTerrain(node);
    this.revealNeighbors(node.id); this.drawMiniMap(); this.updateLabels(); this.updateHealthHud();
    if (node.cleared) this.showResult(`${this.roomTitle(node)}已清理`, '已恢复远征地图。选择一条相连路线继续探索。', true);
    else this.startRoomEncounter(node);
    this.scale.refresh();
  }

  private clearExpeditionEntities() {
    this.tweens.killAll();
    this.clearTransientEffects();
    this.skillBookDrops.getChildren().forEach((book) => (book.getData('glyph') as Phaser.GameObjects.Text | undefined)?.destroy());
    this.skillBookDrops.clear(true, true);
    this.rewardDrops.getChildren().forEach((reward) => (reward.getData('glyph') as Phaser.GameObjects.Text | undefined)?.destroy());
    this.rewardDrops.clear(true, true);
    this.gearDrops.getChildren().forEach((gear) => {
      (gear.getData('glyph') as Phaser.GameObjects.Text | undefined)?.destroy();
      (gear.getData('rarityLabel') as Phaser.GameObjects.Text | undefined)?.destroy();
    });
    this.gearDrops.clear(true, true);
    this.pendingSkillBooks.clear();
    this.clearRoomFeature();
    this.worldRenderer?.destroy(); this.worldRenderer = undefined;
    this.waveSpawnEvent?.remove(false); this.waveSpawnEvent = undefined; this.combatWaves = []; this.nextCombatWaveIndex = 0;
    this.terrainDecor.forEach((decoration) => decoration.destroy()); this.terrainDecor = [];
    this.roomCombatActive = false;
    this.lootPhase = false;
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      (enemy.getData('bar') as Phaser.GameObjects.Rectangle | undefined)?.destroy();
      (enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined)?.destroy();
      this.clearEnemyWarnings(enemy);
      enemy.destroy();
    });
  }

  private resetCombatState() {
    this.attackTimer = 0; this.petTimer = 0; this.petBites = 0; this.petRescueReadyAt = 0; this.petHudTimer = 0; this.petShockTimer = 0;
    this.petSkills = getEquippedPetSkills();
    this.autoSkill = getAutoSkill(); this.swiftStep = hasSwiftStep(); this.activeSkillReadyAt = 0; this.autoSkillReadyAt = 0; this.autoBuffUntil = 0; this.characterHudTimer = 0; this.checkpointTimer = 0;
    this.dashReady = true; this.dashTimer = 0; this.invulnerable = 0;
    this.roomCombatActive = false;
    this.lootPhase = false;
    this.combatWaves = []; this.nextCombatWaveIndex = 0; this.waveSpawnEvent?.remove(false); this.waveSpawnEvent = undefined;
    this.player.setPosition(WORLD_W / 2, WORLD_H / 2).setVelocity(0, 0).setAlpha(1);
    this.pet.setPosition(WORLD_W / 2 - 36, WORLD_H / 2 + 22).setVelocity(0, 0);
    this.updateHealthHud(); this.updatePetSkillHud(); this.updateCharacterSkillHud();
  }

  private trackTransient<T extends Phaser.GameObjects.GameObject>(effect: T): T {
    this.transientEffects.add(effect);
    effect.once(Phaser.GameObjects.Events.DESTROY, () => this.transientEffects.delete(effect));
    return effect;
  }

  private clearTransientEffects() {
    [...this.transientEffects].forEach((effect) => {
      this.tweens.killTweensOf(effect);
      effect.destroy();
    });
    this.transientEffects.clear();
  }

  private enterDungeonRoom(roomId: number) {
    const node = this.dungeon.nodes[roomId];
    if (!node) return;
    this.dungeon.currentRoom = roomId; node.visited = true; node.discovered = true;
    this.generateRoomTerrain(node);
    this.revealNeighbors(roomId); this.drawMiniMap(); this.updateLabels();
    this.player.setPosition(WORLD_W / 2, WORLD_H / 2).setVelocity(0, 0);
    this.pet.setPosition(WORLD_W / 2 - 36, WORLD_H / 2 + 22).setVelocity(0, 0);
    this.roomNameText.setText(this.roomTitle(node));
    this.saveCurrentCheckpoint();
    if (node.cleared) {
      this.showResult(`${this.roomTitle(node)}已探索`, '这个房间已经清理过了。可以返回岔路，或继续前进。', true);
      return;
    }
    this.startRoomEncounter(node);
  }

  private startRoomEncounter(node: DungeonNode) {
    this.waveSpawnEvent?.remove(false); this.waveSpawnEvent = undefined;
    this.combatWaves = []; this.nextCombatWaveIndex = 0;
    this.roomNameText.setText(this.roomTitle(node));
    if (node.type === 'combat' || node.type === 'boss') {
      const status = document.querySelector<HTMLElement>('#status');
      if (status) status.textContent = node.type === 'boss' ? '挑战首领' : '清理房间中的敌人';
      this.roomCombatActive = true;
      if (node.type === 'boss') this.spawnBoss(); else this.spawnWave();
    } else {
      const status = document.querySelector<HTMLElement>('#status');
      if (status) status.textContent = node.type === 'treasure' ? '靠近宝箱，按 E 开启' : '靠近篝火，按 E 休整';
      this.roomCombatActive = false;
      this.player.setPosition(WORLD_W / 2 - 145, WORLD_H / 2).setVelocity(0, 0);
      this.pet.setPosition(WORLD_W / 2 - 180, WORLD_H / 2 + 24).setVelocity(0, 0);
      this.createRoomFeature(node.type);
    }
    this.scene.resume();
  }

  private generateRoomTerrain(node: DungeonNode) {
    if (!this.terrain) return;
    this.terrain.getChildren().forEach((object) => (object.getData('glint') as Phaser.GameObjects.GameObject | undefined)?.destroy());
    this.terrain.clear(true, true);
    this.terrainDecor.forEach((decoration) => decoration.destroy()); this.terrainDecor = [];
    const cx = WORLD_W / 2; const cy = WORLD_H / 2;
    const flipX = (this.dungeon.seed + node.id) % 2 === 0 ? 1 : -1;
    const entryFight: [number, number, number, number][] = [
      [-300,-190,130,54],[-300,190,130,54],[300,-190,130,54],[300,190,130,54],
      [-520,0,72,166],[520,0,72,166],[0,-310,150,46],[0,310,150,46],
    ];
    const sideFight: [number, number, number, number][] = [
      [-420,-245,150,48],[-420,-150,92,46],[-420,245,150,48],
      [420,-245,150,48],[420,150,92,46],[420,245,150,48],[-90,-320,145,44],[90,320,145,44],
    ];
    const bossArena: [number, number, number, number][] = [
      [-260,-185,70,70],[260,-185,70,70],[-260,185,70,70],[260,185,70,70],
      [-440,0,58,118],[440,0,58,118],[0,-300,118,52],[0,300,118,52],
    ];
    const utilityRoom: [number, number, number, number][] = [
      [-540,-260,120,48],[-540,260,120,48],[540,-260,120,48],[540,260,120,48],
      [-650,0,70,145],[650,0,70,145],[-350,350,110,42],[350,-350,110,42],
    ];
    const layout = node.type === 'boss' ? bossArena : node.type === 'combat' ? (node.id === 0 ? entryFight : sideFight) : utilityRoom;
    const tint = node.type === 'boss' ? 0x673d47 : node.type === 'combat' ? 0x64503c : node.type === 'treasure' ? 0x7a6536 : 0x3b6654;
    const region = this.add.rectangle(cx, cy, WORLD_W - 112, WORLD_H - 112, tint, .045).setDepth(.12);
    this.terrainDecor.push(region);
    if (node.type === 'boss') {
      const arenaRing = this.add.circle(cx, cy, 250, 0x000000, 0).setStrokeStyle(3, 0xc36b69, .18).setDepth(.2);
      this.terrainDecor.push(arenaRing);
    } else {
      const pathX = node.type === 'combat' && node.id !== 0 ? cx + flipX * 330 : cx;
      const path = this.add.rectangle((cx + pathX) / 2, cy, Math.abs(pathX - cx) + 440, 82, 0xc5b68c, .045).setDepth(.2);
      this.terrainDecor.push(path);
    }
    for (const [dx, dy, width, height] of layout) {
      const x = cx + dx * flipX;
      const y = cy + dy;
      const color = node.type === 'boss' ? 0x493d42 : node.type === 'treasure' ? 0x4a483d : 0x3b4447;
      const rock = this.add.rectangle(x, y, width, height, color, .98).setStrokeStyle(2, 0x73766e, .42).setDepth(2.6);
      this.terrain.add(rock);
      const body = rock.body as Phaser.Physics.Arcade.StaticBody | undefined;
      body?.setSize(width * .78, height * .72).updateFromGameObject();
      const glint = this.add.rectangle(x - width * .12, y - height * .28, width * .36, 3, 0xadb19f, .18).setDepth(2.7);
      rock.setData('glint', glint);
    }
  }

  private createRoomFeature(kind: FeatureKind) {
    this.clearRoomFeature();
    this.roomFeatureKind = kind;
    const feature = this.add.container(WORLD_W / 2 + 105, WORLD_H / 2).setDepth(2);
    this.roomFeature = feature;
    const isTreasure = kind === 'treasure';
    const glowColor = isTreasure ? 0xffc66e : 0x86e0bd;
    const glow = this.add.circle(0, 3, 42, glowColor, .15).setBlendMode(Phaser.BlendModes.ADD);
    feature.add(glow);
    this.tweens.add({ targets: glow, alpha: .32, scale: 1.18, duration: 850, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    if (isTreasure) {
      feature.add([
        this.add.rectangle(0, 10, 52, 28, 0x765033).setStrokeStyle(2, 0xe8b86f),
        this.add.rectangle(0, -8, 56, 15, 0xd9a34e).setStrokeStyle(2, 0xffdf9a),
        this.add.rectangle(0, 4, 8, 30, 0xf4d37c),
        this.add.rectangle(0, -1, 8, 8, 0xffedb0),
      ]);
      const sparkle = this.add.star(0, -32, 4, 3, 7, 0xffedb0).setBlendMode(Phaser.BlendModes.ADD);
      feature.add(sparkle);
      this.tweens.add({ targets: sparkle, angle: 360, alpha: .35, scale: .65, duration: 1500, yoyo: true, repeat: -1 });
    } else {
      feature.add([
        this.add.ellipse(0, 14, 58, 19, 0x40514b, .9),
        this.add.rectangle(-5, 19, 37, 6, 0x75533c).setAngle(-11),
        this.add.rectangle(5, 19, 37, 6, 0x75533c).setAngle(11),
      ]);
      const flame = this.add.triangle(0, 1, 0, 24, 15, 1, 0, -22, 0xff985e, .96).setBlendMode(Phaser.BlendModes.ADD);
      const core = this.add.triangle(0, 6, 0, 16, 8, 2, 0, -11, 0xffe6a3, .95).setBlendMode(Phaser.BlendModes.ADD);
      feature.add([flame, core]);
      this.tweens.add({ targets: [flame, core], scaleX: .82, scaleY: 1.12, alpha: .7, duration: 210, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const accent = this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W - 112, WORLD_H - 112, glowColor, .025).setStrokeStyle(2, glowColor, .32).setDepth(1);
    feature.setData('accent', accent);
  }

  private clearRoomFeature() {
    if (this.roomFeature?.active) {
      const accent = this.roomFeature.getData('accent') as Phaser.GameObjects.Rectangle | undefined;
      accent?.destroy(); this.roomFeature.destroy(true);
    }
    this.roomFeature = undefined; this.roomFeatureKind = null;
    if (this.interactionHint?.active) this.interactionHint.setVisible(false);
  }

  private interactWithRoomFeature() {
    if (this.roomFeatureKind === 'treasure') this.openTreasureChest();
    else if (this.roomFeatureKind === 'rest') this.showRestChoices();
  }

  private openTreasureChest() {
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    if (!node || node.cleared) return;
    node.cleared = true; this.roomCombatActive = false; this.roomFeatureKind = null;
    this.cameras.main.flash(170, 255, 214, 128);
    this.showFeatureBurst(0xffd27e, '补给 +18');
    this.hp = Math.min(100, this.hp + 18);
    this.tryDropPetSkillBook(this.roomFeature!.x, this.roomFeature!.y - 20, true);
    this.updateHealthHud(); this.drawMiniMap();
    this.beginLootPhase('宝箱已开启，先收集技能书，再按 E 查看路线。');
  }

  private showRestChoices() {
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    if (!node || node.cleared) return;
    this.scene.pause();
    const overlay = document.querySelector('#overlay')!; overlay.classList.remove('hidden');
    document.querySelector('#result-title')!.textContent = '篝火休整';
    document.querySelector('#result-text')!.textContent = '选择一种补给方式。休整后可以继续选择路线。';
    const routes = document.querySelector<HTMLElement>('#route-options')!;
    routes.replaceChildren(); routes.classList.remove('hidden');
    const choices = [
      { label: '恢复生命 +28', action: () => { this.hp = Math.min(100, this.hp + 28); return '恢复了 28 点生命。'; } },
      { label: '攻击强化 20 秒', action: () => { this.restBuffUntil = this.time.now + 20000; return '接下来 20 秒造成的伤害提高。'; } },
    ];
    choices.forEach(({ label, action }) => {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = () => {
        const message = action(); node.cleared = true; this.roomFeatureKind = null;
        overlay.classList.add('hidden'); this.cameras.main.flash(220, 142, 226, 188);
        this.updateCharacterSkillHud(); this.updateHealthHud(); this.drawMiniMap(); this.saveCurrentCheckpoint();
        this.showResult('休整完成', `${message}选择一条路线继续探索。`, true);
      };
      routes.append(button);
    });
    document.querySelector<HTMLButtonElement>('#continue')!.classList.add('hidden');
  }

  private showFeatureBurst(color: number, text: string) {
    const x = this.roomFeature?.x ?? this.player.x, y = this.roomFeature?.y ?? this.player.y;
    const ring = this.add.circle(x, y, 18, color, .16).setStrokeStyle(3, color, .9).setDepth(6);
    this.trackTransient(ring);
    this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
    const label = this.add.text(x, y - 36, text, { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '13px', color: '#fff0c2', fontStyle: 'bold', stroke: '#161922', strokeThickness: 3 }).setOrigin(.5).setDepth(7);
    this.trackTransient(label);
    this.tweens.add({ targets: label, y: y - 68, alpha: 0, duration: 850, onComplete: () => label.destroy() });
  }

  private spawnBoss() {
    const tier = Math.floor((this.room - 1) / 3);
    const maxHp = 14 + tier * 4;
    const spawn = this.findOpenEnemySpawn(0, 360, 64);
    const enemy = this.physics.add.sprite(spawn.x, spawn.y, 'enemy').setDepth(2).setCircle(23).setScale(1.85)
      .setTint(0xb84f62).setData({ kind: 'boss' as EnemyKind, tint: 0xb84f62, hp: maxHp, maxHp, hitAt: 0, moveSpeed: 34 + Math.min(18, tier * 3), aiState: 'approach', nextSpecialAt: this.time.now + Math.max(1150, 1800 - tier * 90), specialCount: 0, touchDamage: 8 + Math.floor(tier / 2) });
    enemy.setCollideWorldBounds(true); this.enemies.add(enemy);
    const bar = this.add.rectangle(enemy.x, enemy.y - 34, 52, 5, 0x9b3c50).setDepth(3);
    enemy.setData('bar', bar);
    this.kills = 0; this.updateLabels();
  }

  private roomTitle(node: DungeonNode) {
    return ({ combat: '遭遇战', treasure: '宝箱房', rest: '休息点', boss: '首领房' } as const)[node.type];
  }

  private revealNeighbors(roomId: number) {
    this.dungeon.edges.forEach(([a, b]) => {
      if (a === roomId) this.dungeon.nodes[b].discovered = true;
      if (b === roomId) this.dungeon.nodes[a].discovered = true;
    });
  }

  private updateHealthHud() {
    const fill = document.querySelector<HTMLElement>('#health'); const label = document.querySelector<HTMLElement>('#health-label');
    if (fill) fill.style.width = `${this.hp}%`; if (label) label.textContent = `${this.hp} / 100`;
  }

  private drawMiniMap() {
    if (!this.mapLayer || !this.dungeon) return;
    if (this.worldData) {
      const center = this.worldData.toTile(this.player.x, this.player.y);
      const cell = 4, columns = 31, rows = 23;
      const sx = 12, sy = 13;
      if (this.worldMiniMapCells.length !== columns * rows) {
        this.mapLayer.removeAll(true);
        this.worldMiniMapCells = [];
        for (let index = 0; index < columns * rows; index++) {
          const col = index % columns, row = Math.floor(index / columns);
          const cellRect = this.add.rectangle(sx + col * cell, sy + row * cell, cell - 1, cell - 1, 0x080d13, .9).setOrigin(0);
          this.worldMiniMapCells.push(cellRect);
          this.mapLayer.add(cellRect);
        }
        this.worldMiniMapMarker = this.add.circle(0, 0, 3, 0xffd08b).setStrokeStyle(1, 0xffffff);
        this.mapLayer.add(this.worldMiniMapMarker);
        this.worldMiniMapTitle = this.add.text(sx + columns * cell, 0, 'WORLD MAP', { fontFamily: 'DM Mono, monospace', fontSize: '8px', color: '#8795a8', letterSpacing: 1 }).setOrigin(1, 0);
        this.mapLayer.add(this.worldMiniMapTitle);
      }
      const recenter = !this.worldMiniMapOrigin
        || Math.abs(center.x - this.worldMiniMapOrigin.x) >= 4 || Math.abs(center.y - this.worldMiniMapOrigin.y) >= 4;
      if (recenter) {
        this.worldMiniMapOrigin = { x: center.x, y: center.y };
        const startX = center.x - Math.floor(columns / 2), startY = center.y - Math.floor(rows / 2);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < columns; col++) {
            const x = startX + col, y = startY + row;
            const explored = this.worldData.isExplored(x, y);
            this.worldMiniMapCells[row * columns + col].setFillStyle(explored ? biomeColor(this.worldData.biomeAtTile(x, y)) : 0x080d13, explored ? .95 : .9);
          }
        }
      }
      const origin = this.worldMiniMapOrigin!;
      const markerX = sx + (center.x - origin.x + Math.floor(columns / 2)) * cell + cell / 2;
      const markerY = sy + (center.y - origin.y + Math.floor(rows / 2)) * cell + cell / 2;
      this.worldMiniMapMarker?.setPosition(markerX, markerY);
      return;
    }
    this.worldMiniMapCells = []; this.worldMiniMapOrigin = undefined;
    this.worldMiniMapMarker = undefined; this.worldMiniMapTitle = undefined;
    this.mapLayer.removeAll(true);
    const sx = 16, sy = 14, dx = 46, dy = 33;
    const point = (node: DungeonNode) => ({ x: sx + node.x * dx, y: sy + node.y * dy });
    this.dungeon.edges.forEach(([a, b]) => {
      const left = this.dungeon.nodes[a], right = this.dungeon.nodes[b];
      if (!left.discovered && !right.discovered) return;
      const p1 = point(left), p2 = point(right);
      const line = this.add.line(0, 0, p1.x, p1.y, p2.x, p2.y, 0x657488, .72).setLineWidth(2);
      this.mapLayer.add(line);
    });
    this.dungeon.nodes.forEach((node) => {
      const p = point(node); const current = node.id === this.dungeon.currentRoom;
      const color = !node.discovered ? 0x313b49 : current ? 0xffc77d : node.cleared ? 0x83d7b1 : 0x718198;
      this.mapLayer.add(this.add.circle(p.x, p.y, current ? 9 : 7, color, node.discovered ? .95 : .55).setStrokeStyle(current ? 2 : 1, current ? 0xffe0aa : 0x9caabc, .9));
      const labels: Record<RoomKind, string> = { combat: '战', treasure: '箱', rest: '休', boss: '首' };
      const label = this.add.text(p.x, p.y + 11, node.discovered ? labels[node.type] : '?', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '8px', color: node.discovered ? '#b7c2d0' : '#6c798b' }).setOrigin(.5, 0);
      this.mapLayer.add(label);
    });
    const title = this.add.text(sx + 3 * dx, 0, 'MAP', { fontFamily: 'DM Mono, monospace', fontSize: '8px', color: '#8795a8', letterSpacing: 1 }).setOrigin(1, 0);
    this.mapLayer.add(title);
  }

  private handleWeaponSelection(weapon: string) {
    if (weapon === 'sword' || weapon === 'spear' || weapon === 'staff') this.setWeapon(weapon);
  }

  private handlePetSkillsChanged() {
    this.petSkills = getEquippedPetSkills();
    this.petShockTimer = 0;
    this.updatePetSkillHud();
  }

  private handleCharacterSkillsChanged() {
    this.autoSkill = getAutoSkill(); this.swiftStep = hasSwiftStep();
    this.updateCharacterSkillHud();
  }

  private createTextures() {
    const make = (key: string, color: number, radius: number) => {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(color, 1); graphics.fillCircle(radius, radius, radius);
      graphics.lineStyle(2, 0xffffff, .7); graphics.strokeCircle(radius, radius, radius - 3);
      graphics.fillStyle(COLORS.ink, .35); graphics.fillCircle(radius + 4, radius - 2, Math.max(2, radius / 4));
      graphics.generateTexture(key, radius * 2, radius * 2); graphics.destroy();
    };
    make('player', COLORS.player, 16); make('pet', COLORS.pet, 11); make('enemy', COLORS.enemy, 14);
  }

  private drawRoom() {
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, COLORS.floor);
    const graphics = this.add.graphics().setDepth(0);
    graphics.lineStyle(1, COLORS.grid, .58);
    for (let x = 56; x < WORLD_W; x += 48) graphics.lineBetween(x, 56, x, WORLD_H - 56);
    for (let y = 56; y < WORLD_H; y += 48) graphics.lineBetween(56, y, WORLD_W - 56, y);
    graphics.lineStyle(1, 0x465366, .5); graphics.strokeRect(56, 56, WORLD_W - 112, WORLD_H - 112);
    this.add.text(68, 66, 'SECTOR 01  /  ABANDONED OUTPOST', { fontFamily: 'DM Mono, monospace', fontSize: '9px', color: '#647187', letterSpacing: 1 }).setDepth(1);
  }

  private addWall(x: number, y: number, width: number, height: number) {
    const wall = this.add.rectangle(x, y, width, height, COLORS.wall).setDepth(4);
    this.physics.add.existing(wall, true);
    this.walls.add(wall);
    this.add.rectangle(x, y - height / 2 + 3, width, 4, 0x59677c).setDepth(5).setAlpha(.42);
  }

  private spawnWave() {
    const tier = Math.floor((this.room - 1) / 3);
    const count = 4 + Math.min(tier, 4);
    const roster: Exclude<EnemyKind, 'boss'>[] = Array.from({ length: count }, (_, i) =>
      i === 0 || (tier >= 2 && i === 2) ? 'brute' : i === 1 || (tier >= 4 && i === 3) ? 'caster' : 'stalker');
    const waveCount = count >= 6 ? 3 : 2;
    this.combatWaves = Array.from({ length: waveCount }, () => [] as Exclude<EnemyKind, 'boss'>[]);
    roster.forEach((kind, index) => this.combatWaves[index % waveCount].push(kind));
    this.nextCombatWaveIndex = 0;
    this.spawnNextCombatWave();
    this.kills = 0; this.updateLabels();
  }

  private spawnWorldEncounter() {
    if (!this.worldData || this.enemies.countActive() >= 5) return;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const radius = Phaser.Math.Between(470, 620);
    const anchor = this.findOpenAt(
      Phaser.Math.Clamp(this.player.x + Math.cos(angle) * radius, 120, WORLD_W - 120),
      Phaser.Math.Clamp(this.player.y + Math.sin(angle) * radius, 120, WORLD_H - 120), 72,
    );
    const biome = this.worldData.biomeAtWorld(anchor.x, anchor.y);
    const kind: Exclude<EnemyKind, 'boss'> = biome === 'ruins' ? 'caster' : biome === 'sand' ? 'brute' : biome === 'forest' ? 'stalker' : Phaser.Utils.Array.GetRandom(['stalker', 'brute']);
    const count = Math.min(5 - this.enemies.countActive(), Phaser.Math.Between(1, 3));
    const offsets: [number, number][] = [[0, 0], [58, -28], [-54, 38]];
    for (let i = 0; i < count; i++) {
      const [dx, dy] = offsets[i];
      const spawn = this.findOpenAt(anchor.x + dx, anchor.y + dy, 62);
      this.spawnEnemy(kind, spawn.x, spawn.y);
    }
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = `${biomeName(biome)} · 发现敌对生物`;
  }

  private spawnNextCombatWave() {
    const wave = this.combatWaves[this.nextCombatWaveIndex];
    if (!wave) return;
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    const flipX = (this.dungeon.seed + (node?.id ?? 0)) % 2 === 0 ? 1 : -1;
    const anchors = node?.id === 0
      ? [[0,-320],[430,20],[0,330]]
      : [[-430,20],[0,-320],[430,20]];
    const [anchorDx, anchorDy] = anchors[this.nextCombatWaveIndex % anchors.length];
    const anchorX = WORLD_W / 2 + anchorDx * flipX;
    const anchorY = WORLD_H / 2 + anchorDy;
    const offsets: [number,number][] = [[0,0],[-54,-36],[54,36],[-58,42]];
    const waveNumber = this.nextCombatWaveIndex + 1;
    const totalWaves = this.combatWaves.length;
    wave.forEach((kind, index) => {
      const [offsetX, offsetY] = offsets[index % offsets.length];
      const spawn = this.findOpenAt(anchorX + offsetX, anchorY + offsetY, kind === 'brute' ? 76 : 58);
      this.spawnEnemy(kind, spawn.x, spawn.y);
    });
    this.nextCombatWaveIndex++;
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = `遭遇战 · 威胁等级 ${Math.floor((this.room - 1) / 3) + 1} · 第 ${waveNumber}/${totalWaves} 波`;
    this.cameras.main.flash(100, 206, 184, 136);
  }

  private spawnEnemy(kind: Exclude<EnemyKind, 'boss'>, x: number, y: number) {
    const tier = Math.floor((this.room - 1) / 3);
    const stats = {
      stalker: { hp: 2 + Math.min(6, tier), speed: 66 + Math.min(18, tier * 3), color: 0xe77d70, scale: 1, damage: 6 + Math.floor(tier / 2), barY: 19 },
      brute: { hp: 4 + Math.min(12, tier * 2), speed: 34 + Math.min(12, tier * 2), color: 0xe79b5b, scale: 1.28, damage: 11 + tier, barY: 24 },
      caster: { hp: 2 + Math.min(6, tier), speed: 50 + Math.min(15, tier * 2), color: 0xb38bed, scale: 1.08, damage: 5 + Math.floor(tier / 2), barY: 21 },
    }[kind];
    const enemy = this.physics.add.sprite(x, y, 'enemy').setDepth(2).setCircle(12).setScale(stats.scale)
      .setTint(stats.color).setData({ kind, tint: stats.color, hp: stats.hp, maxHp: stats.hp, hitAt: 0, moveSpeed: stats.speed, touchDamage: stats.damage, castAt: this.time.now + Phaser.Math.Between(900, 1700) });
    enemy.setCollideWorldBounds(true); this.enemies.add(enemy);
    const barColor = kind === 'caster' ? 0x664b79 : kind === 'brute' ? 0x795437 : 0x664b50;
    const bar = this.add.rectangle(x, y - stats.barY, kind === 'brute' ? 31 : 27, 3, barColor).setDepth(3);
    enemy.setData('bar', bar);
  }

  private findOpenEnemySpawn(angle: number, radius: number, clearance = 52) {
    return this.findOpenAt(WORLD_W / 2 + Math.cos(angle) * radius, WORLD_H / 2 + Math.sin(angle) * radius * .72, clearance);
  }

  private findOpenAt(anchorX: number, anchorY: number, clearance = 52) {
    const offsets: [number,number][] = [[0,0],[72,0],[-72,0],[0,72],[0,-72],[72,72],[-72,-72],[110,40],[-110,-40],[40,-110],[-40,110]];
    for (const [dx,dy] of offsets) {
      const x = Phaser.Math.Clamp(anchorX + dx, 105, WORLD_W - 105);
      const y = Phaser.Math.Clamp(anchorY + dy, 105, WORLD_H - 105);
      const blocked = this.terrain.getChildren().some((object) => {
        const obstacle = object as Phaser.GameObjects.Rectangle;
        return Math.abs(x - obstacle.x) < obstacle.width / 2 + clearance && Math.abs(y - obstacle.y) < obstacle.height / 2 + clearance;
      });
      if (!blocked) return { x, y };
    }
    return { x: anchorX, y: anchorY };
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 32);
    const left = this.keys.A.isDown || this.cursors.left.isDown;
    const right = this.keys.D.isDown || this.cursors.right.isDown;
    const up = this.keys.W.isDown || this.cursors.up.isDown;
    const down = this.keys.S.isDown || this.cursors.down.isDown;
    const move = new Phaser.Math.Vector2(Number(right) - Number(left), Number(down) - Number(up)).normalize();
    const agilityBonus = 1 + Math.min(.3, getCharacterProgress().attributes.agility * .02);
    const speed = (this.dashTimer > 0 ? 570 : 205 * (this.swiftStep ? 1.12 : 1)) * agilityBonus;
    this.player.setVelocity(move.x * speed, move.y * speed);
    if (this.worldRenderer?.update(this.player.x, this.player.y)) {
      this.updateLabels(); this.drawMiniMap();
    }
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.petTimer = Math.max(0, this.petTimer - dt);
    this.petShockTimer = Math.max(0, this.petShockTimer - dt);
    this.petHudTimer = Math.max(0, this.petHudTimer - dt);
    this.characterHudTimer = Math.max(0, this.characterHudTimer - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashReady) this.dash();
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) this.castActiveSkill();
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      if (this.lootPhase) this.finishLootPhase();
      else if (this.roomFeatureKind) {
        const feature = this.roomFeature;
        if (feature && Phaser.Math.Distance.Between(this.player.x, this.player.y, feature.x, feature.y) <= 82) this.interactWithRoomFeature();
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) this.setWeapon('sword');
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) this.setWeapon('spear');
    if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) this.setWeapon('staff');
    this.checkpointTimer = Math.max(0, this.checkpointTimer - dt);
    if (this.checkpointTimer <= 0) { this.checkpointTimer = 2500; if (!this.lootPhase) this.saveCurrentCheckpoint(); }
    const pointer = this.input.activePointer;
    if (this.attackHeld && this.attackTimer <= 0) this.attack(pointer.worldX, pointer.worldY);
    this.movePet(); this.moveEnemies(dt); this.updateAutomaticSkill();
    if (this.worldData) {
      this.wildernessSpawnTimer = Math.max(0, this.wildernessSpawnTimer - dt);
      if (this.wildernessSpawnTimer === 0) {
        this.wildernessSpawnTimer = Phaser.Math.Between(5_500, 8_500);
        if (this.enemies.countActive() < 4) this.spawnWorldEncounter();
      }
    }
    if (this.lootPhase) {
      this.interactionHint.setText('区域已肃清 · 收集掉落物，按 E 查看路线（技能书会自动收好）');
      this.interactionHint.setVisible(true);
    } else if (this.roomFeatureKind && this.roomFeature?.active) {
      const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.roomFeature.x, this.roomFeature.y) <= 110;
      this.interactionHint.setText(near ? `E  ${this.roomFeatureKind === 'treasure' ? '开启宝箱' : '在篝火旁休息'}` : '');
      this.interactionHint.setVisible(near);
    } else this.interactionHint.setVisible(false);
    if (this.petHudTimer <= 0) { this.updatePetSkillHud(); this.petHudTimer = 250; }
    if (this.characterHudTimer <= 0) { this.updateCharacterSkillHud(); this.characterHudTimer = 250; }
    this.playerHpBar.setPosition(this.player.x, this.player.y - 23).setScale(Math.max(.05, this.hp / 100), 1);
    this.player.setAlpha(this.invulnerable > 0 && Math.floor(this.invulnerable / 70) % 2 === 0 ? .45 : 1);
    if (!this.dashReady && this.dashTimer <= 0) { this.dashReady = true; this.updateLabels(); }
    if (this.roomCombatActive && this.enemies.countActive() === 0 && !this.scene.isPaused()) {
      if (this.nextCombatWaveIndex < this.combatWaves.length) {
        if (!this.waveSpawnEvent) {
          const status = document.querySelector<HTMLElement>('#status');
          if (status) status.textContent = '区域暂时安静 · 前方有敌人接近';
          this.waveSpawnEvent = this.time.delayedCall(850, () => {
            this.waveSpawnEvent = undefined;
            if (this.roomCombatActive && !this.scene.isPaused()) this.spawnNextCombatWave();
          });
        }
      } else this.roomCleared();
    }
  }

  private attack(x: number, y: number) {
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
    if (this.weapon === 'sword') this.swingSword(angle);
    else if (this.weapon === 'spear') this.thrustSpear(angle);
    else this.fireStaffOrb(angle);
  }

  private castActiveSkill() {
    if (this.time.now < this.activeSkillReadyAt) return;
    this.activeSkillReadyAt = this.time.now + 5200;
    const radius = 105;
    const slash = this.trackTransient(this.add.circle(this.player.x, this.player.y, 18, 0x91e1c4, .2).setStrokeStyle(3, 0xb8ffe4, .9).setDepth(4));
    this.tweens.add({ targets: slash, alpha: 0, scale: radius / 18, duration: 300, onComplete: () => slash.destroy() });
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active || Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) > radius) return;
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      this.damageEnemy(enemy, 2, angle, 190);
    });
  }

  private updateAutomaticSkill() {
    const living = this.enemies.getChildren().filter((obj) => (obj as Phaser.Physics.Arcade.Sprite).active) as Phaser.Physics.Arcade.Sprite[];
    if (!living.length || this.time.now < this.autoSkillReadyAt) return;
    const nearest = [...living].sort((a, b) => Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) - Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y))[0];
    if (this.autoSkill === 'hunter_shot') {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, nearest.x, nearest.y) > 420) return;
      this.autoSkillReadyAt = this.time.now + 3600;
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, nearest.x, nearest.y);
      const bolt = this.trackTransient(this.add.circle(this.player.x, this.player.y, 5, 0x8ce4dc).setStrokeStyle(2, 0xd4fff6).setDepth(4));
      this.tweens.add({ targets: bolt, x: nearest.x, y: nearest.y, duration: 230, onComplete: () => {
        if (nearest.active) this.damageEnemy(nearest, 2, angle, 90);
        bolt.destroy();
      } });
    } else if (this.autoSkill === 'battle_focus') {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, nearest.x, nearest.y) > 220) return;
      this.autoSkillReadyAt = this.time.now + 8500; this.autoBuffUntil = this.time.now + 4300;
      const aura = this.trackTransient(this.add.circle(this.player.x, this.player.y, 22, 0xffc77d, .18).setStrokeStyle(2, 0xffd996, .9).setDepth(4));
      this.tweens.add({ targets: aura, alpha: 0, scale: 2.6, duration: 460, onComplete: () => aura.destroy() });
    } else {
      const nearby = living.filter((enemy) => Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < 125);
      if (nearby.length < 2) return;
      this.autoSkillReadyAt = this.time.now + 6500;
      const wave = this.trackTransient(this.add.circle(this.player.x, this.player.y, 16, 0xff9b79, .2).setStrokeStyle(3, 0xffbc96, .9).setDepth(4));
      this.tweens.add({ targets: wave, alpha: 0, scale: 7, duration: 370, onComplete: () => wave.destroy() });
      nearby.forEach((enemy) => {
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        this.damageEnemy(enemy, 1, angle, 210);
      });
    }
  }

  private swingSword(angle: number) {
    this.attackTimer = 260;
    const range = 70;
    const hit = this.trackTransient(this.add.arc(this.player.x + Math.cos(angle) * 39, this.player.y + Math.sin(angle) * 39, 28,
      Phaser.Math.RadToDeg(angle - .82), Phaser.Math.RadToDeg(angle + .82), false, COLORS.gold, .32).setDepth(4));
    this.tweens.add({ targets: hit, alpha: 0, scale: 1.35, duration: 120, onComplete: () => hit.destroy() });
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const toward = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y) - angle));
      if (dist < range && toward < .9) this.damageEnemy(enemy, 1, angle, 150);
    });
  }

  private thrustSpear(angle: number) {
    this.attackTimer = 560;
    const range = 178;
    const endX = this.player.x + Math.cos(angle) * range;
    const endY = this.player.y + Math.sin(angle) * range;
    const thrust = this.trackTransient(this.add.line(0, 0, this.player.x, this.player.y, endX, endY, 0x94d9ef, .9).setLineWidth(7).setDepth(4));
    this.tweens.add({ targets: thrust, alpha: 0, duration: 170, onComplete: () => thrust.destroy() });
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const dx = enemy.x - this.player.x, dy = enemy.y - this.player.y;
      const forward = dx * Math.cos(angle) + dy * Math.sin(angle);
      const side = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle));
      if (forward > 18 && forward < range && side < 20) this.damageEnemy(enemy, 2, angle, 250);
    });
  }

  private fireStaffOrb(angle: number) {
    this.attackTimer = 470;
    const range = 430;
    const startX = this.player.x + Math.cos(angle) * 20;
    const startY = this.player.y + Math.sin(angle) * 20;
    const orb = this.trackTransient(this.add.circle(startX, startY, 9, 0xb89aff).setStrokeStyle(2, 0xe1d7ff).setDepth(4));
    let impacted = false;
    this.tweens.add({ targets: orb, x: startX + Math.cos(angle) * range, y: startY + Math.sin(angle) * range,
      duration: 470, onUpdate: () => {
        if (impacted || !orb.active) return;
        const target = this.enemies.getChildren().find((obj) => {
          const enemy = obj as Phaser.Physics.Arcade.Sprite;
          return enemy.active && Phaser.Math.Distance.Between(orb.x, orb.y, enemy.x, enemy.y) < 22;
        }) as Phaser.Physics.Arcade.Sprite | undefined;
        if (target) {
          impacted = true;
          this.damageEnemy(target, 2, angle, 100);
          // Leave the current tween alone while its update callback is running.
          // Hide the projectile now, then let onComplete clean it up safely.
          orb.setActive(false).setVisible(false);
        }
      }, onComplete: () => orb.destroy() });
  }

  private setWeapon(weapon: 'sword' | 'spear' | 'staff') {
    this.weapon = weapon;
    const names = { sword: '单手剑', spear: '长枪', staff: '法杖' };
    const colors = { sword: '#ffc77d', spear: '#94d9ef', staff: '#c8afff' };
    const label = document.querySelector<HTMLElement>('#weapon-label');
    const gear = getEquippedItem('weapon');
    if (label) { label.textContent = `当前武器：${names[weapon]}${gear?.weaponType === weapon ? ` · 伤害 +${gear.attackBonus}` : ''}`; label.style.color = colors[weapon]; }
  }

  private dash() {
    const pointer = this.input.activePointer;
    let dir = new Phaser.Math.Vector2(pointer.worldX - this.player.x, pointer.worldY - this.player.y).normalize();
    if (dir.lengthSq() === 0) dir.set(1, 0);
    this.player.setVelocity(dir.x * 570, dir.y * 570); this.dashTimer = 180; this.dashReady = false;
    this.invulnerable = 320; this.updateLabels();
    const trail = this.trackTransient(this.add.circle(this.player.x, this.player.y, 16, COLORS.player, .35).setDepth(2));
    this.tweens.add({ targets: trail, alpha: 0, scale: 2, duration: 230, onComplete: () => trail.destroy() });
  }

  private movePet() {
    const targets = this.enemies.getChildren().filter((o) => (o as Phaser.GameObjects.GameObject).active) as Phaser.Physics.Arcade.Sprite[];
    let tx = this.player.x - 31, ty = this.player.y + 23;
    if (targets.length) {
      targets.sort((a, b) => Phaser.Math.Distance.Between(this.pet.x, this.pet.y, a.x, a.y) - Phaser.Math.Distance.Between(this.pet.x, this.pet.y, b.x, b.y));
      const target = targets[0];
      if (Phaser.Math.Distance.Between(this.pet.x, this.pet.y, target.x, target.y) < 150) { tx = target.x; ty = target.y; }
    }
    this.physics.moveTo(this.pet, tx, ty, 240, 170);
    if (Phaser.Math.Distance.Between(this.pet.x, this.pet.y, tx, ty) < 20) this.pet.setVelocity(0, 0);
    if (targets.length && this.petTimer <= 0) {
      const target = targets[0];
      if (Phaser.Math.Distance.Between(this.pet.x, this.pet.y, target.x, target.y) < 34) {
        this.petTimer = 820;
        this.tweens.add({ targets: this.pet, x: target.x, y: target.y, duration: 100, yoyo: true, onYoyo: () => this.petBite(target) });
      }
    }
    if (this.petSkills.includes('shock') && this.petShockTimer <= 0) {
      const nearby = targets.filter((target) => Phaser.Math.Distance.Between(this.pet.x, this.pet.y, target.x, target.y) < 105);
      if (nearby.length > 0) {
        this.petShockTimer = 6500;
        const pulse = this.trackTransient(this.add.circle(this.pet.x, this.pet.y, 16, 0xb89aff, .24).setStrokeStyle(2, 0xd6c6ff, .9).setDepth(4));
        this.tweens.add({ targets: pulse, alpha: 0, scale: 5, duration: 360, onComplete: () => pulse.destroy() });
        nearby.forEach((target) => {
          const angle = Phaser.Math.Angle.Between(this.pet.x, this.pet.y, target.x, target.y);
          this.damageEnemy(target, 1, angle, 220, 'pet');
        });
      }
    }
  }

  private moveEnemies(dt: number) {
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const kind = (enemy.getData('kind') as EnemyKind | undefined) ?? 'stalker';
      if (kind === 'boss') this.updateBossAI(enemy);
      else if (kind === 'caster') this.updateCasterAI(enemy);
      else this.moveEnemyTowardPlayer(enemy, (enemy.getData('moveSpeed') as number | undefined) ?? 46 + this.room * 3);
      const bar = enemy.getData('bar') as Phaser.GameObjects.Rectangle;
      const barOffset = kind === 'boss' ? 39 : kind === 'brute' ? 24 : kind === 'caster' ? 21 : 19;
      bar.setPosition(enemy.x, enemy.y - barOffset);
      const markedUntil = (enemy.getData('markedUntil') as number | undefined) ?? 0;
      const markRing = enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined;
      if (markRing?.active && markedUntil > this.time.now) markRing.setPosition(enemy.x, enemy.y);
      else if (markRing?.active) { markRing.destroy(); enemy.setData('markRing', undefined); enemy.setData('markedUntil', 0); }
      const hitAt = enemy.getData('hitAt') as number;
      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) < 28 && this.time.now > hitAt) {
        this.damagePlayer((enemy.getData('touchDamage') as number | undefined) ?? 7); enemy.setData('hitAt', this.time.now + (kind === 'boss' ? 1050 : 850));
      }
    });
    void dt;
  }

  private moveEnemyTowardPlayer(enemy: Phaser.Physics.Arcade.Sprite, speed: number) {
    const body = enemy.body as Phaser.Physics.Arcade.Body | undefined;
    if (body && (body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down)) {
      const toward = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();
      const side = (Math.floor(enemy.x + enemy.y) % 2 === 0) ? 1 : -1;
      const detour = new Phaser.Math.Vector2(-toward.y * side, toward.x * side);
      const direction = toward.add(detour.scale(1.15)).normalize();
      enemy.setVelocity(direction.x * speed, direction.y * speed);
      return;
    }
    this.physics.moveToObject(enemy, this.player, speed);
  }

  private updateCasterAI(enemy: Phaser.Physics.Arcade.Sprite) {
    const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    if (distance < 175) {
      const retreatAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const retreatSpeed = enemy.getData('moveSpeed') as number;
      enemy.setVelocity(Math.cos(retreatAngle) * retreatSpeed, Math.sin(retreatAngle) * retreatSpeed);
    } else if (distance > 270) {
      this.physics.moveToObject(enemy, this.player, enemy.getData('moveSpeed') as number);
    } else enemy.setVelocity(0, 0);
    if (distance < 390 && distance > 105 && this.time.now >= (enemy.getData('castAt') as number)) this.castEnemyBolt(enemy);
  }

  private castEnemyBolt(enemy: Phaser.Physics.Arcade.Sprite) {
    enemy.setData('castAt', this.time.now + 2800);
    enemy.setVelocity(0, 0);
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    const targetX = this.player.x, targetY = this.player.y;
    const warning = this.trackTransient(this.add.line(0, 0, enemy.x, enemy.y, targetX, targetY, 0xd49cff, .78).setLineWidth(2).setDepth(1.5));
    const marker = this.trackTransient(this.add.circle(targetX, targetY, 19, 0xb889ed, .12).setStrokeStyle(2, 0xd8b5ff, .9).setDepth(1.5));
    enemy.setData('warningLine', warning); enemy.setData('warningRing', marker);
    this.tweens.add({ targets: [warning, marker], alpha: .25, duration: 140, yoyo: true, repeat: 2 });
    this.time.delayedCall(480, () => {
      warning.destroy(); marker.destroy();
      if (!enemy.active) return;
      const bolt = this.trackTransient(this.add.circle(enemy.x, enemy.y, 7, 0xc394f4).setStrokeStyle(2, 0xf0dfff).setDepth(4));
      let hit = false;
      this.tweens.add({ targets: bolt, x: targetX, y: targetY, duration: 560, onUpdate: () => {
        if (!hit && Phaser.Math.Distance.Between(bolt.x, bolt.y, this.player.x, this.player.y) < 20) {
          hit = true; this.damagePlayer(9); this.cameras.main.flash(90, 187, 133, 234); bolt.setVisible(false);
        }
      }, onComplete: () => bolt.destroy() });
    });
  }

  private updateBossAI(boss: Phaser.Physics.Arcade.Sprite) {
    const state = boss.getData('aiState') as string;
    const now = this.time.now;
    if (state === 'chargeWarning' && now >= (boss.getData('stateUntil') as number)) {
      this.clearEnemyWarnings(boss);
      const angle = Phaser.Math.Angle.Between(boss.x, boss.y, boss.getData('chargeX') as number, boss.getData('chargeY') as number);
      boss.setVelocity(Math.cos(angle) * 560, Math.sin(angle) * 560);
      boss.setData('aiState', 'charge'); boss.setData('stateUntil', now + 420);
      boss.setTint(0xff7777); this.cameras.main.shake(100, .002);
      return;
    }
    if (state === 'charge' && now >= (boss.getData('stateUntil') as number)) {
      boss.setVelocity(0, 0); boss.setTint(boss.getData('tint') as number);
      const status = document.querySelector<HTMLElement>('#status'); if (status) status.textContent = '首领冲锋结束，抓住间隙攻击';
      boss.setData('aiState', 'recover'); boss.setData('stateUntil', now + 620); return;
    }
    if (state === 'slamWarning' && now >= (boss.getData('stateUntil') as number)) {
      this.clearEnemyWarnings(boss);
      const radius = 124;
      const wave = this.trackTransient(this.add.circle(boss.x, boss.y, 24, 0xff5353, .22).setStrokeStyle(4, 0xff8a79, .95).setDepth(4));
      this.tweens.add({ targets: wave, scale: radius / 24, alpha: 0, duration: 340, onComplete: () => wave.destroy() });
      if (Phaser.Math.Distance.Between(boss.x, boss.y, this.player.x, this.player.y) <= radius) {
        const angle = Phaser.Math.Angle.Between(boss.x, boss.y, this.player.x, this.player.y);
        this.damagePlayer(13); this.player.setVelocity(Math.cos(angle) * 300, Math.sin(angle) * 300);
      }
      this.cameras.main.shake(180, .006);
      const status = document.querySelector<HTMLElement>('#status'); if (status) status.textContent = '震荡结束，首领正在恢复';
      boss.setData('aiState', 'recover'); boss.setData('stateUntil', now + 720); return;
    }
    if (state === 'recover' && now >= (boss.getData('stateUntil') as number)) {
      boss.setData('aiState', 'approach'); boss.setData('nextSpecialAt', now + 700); return;
    }
    if (state === 'chargeWarning' || state === 'slamWarning' || state === 'charge' || state === 'recover') return;
    const distance = Phaser.Math.Distance.Between(boss.x, boss.y, this.player.x, this.player.y);
    if (distance > 145) this.moveEnemyTowardPlayer(boss, boss.getData('moveSpeed') as number);
    else boss.setVelocity(0, 0);
    if (now >= (boss.getData('nextSpecialAt') as number)) {
      const count = boss.getData('specialCount') as number;
      boss.setData('specialCount', count + 1);
      if (count % 2 === 0) this.startBossCharge(boss); else this.startBossSlam(boss);
    }
  }

  private startBossCharge(boss: Phaser.Physics.Arcade.Sprite) {
    const targetX = this.player.x, targetY = this.player.y;
    boss.setVelocity(0, 0); boss.setData('aiState', 'chargeWarning'); boss.setData('stateUntil', this.time.now + 760);
    boss.setData('chargeX', targetX); boss.setData('chargeY', targetY);
    const line = this.trackTransient(this.add.line(0, 0, boss.x, boss.y, targetX, targetY, 0xff5959, .9).setLineWidth(9).setDepth(1.6));
    const marker = this.trackTransient(this.add.circle(targetX, targetY, 24, 0xff4444, .15).setStrokeStyle(3, 0xff8d7d, .95).setDepth(1.7));
    boss.setData('warningLine', line); boss.setData('warningRing', marker);
    const status = document.querySelector<HTMLElement>('#status'); if (status) status.textContent = '首领蓄力！躲开红色直线';
    this.tweens.add({ targets: [line, marker], alpha: .2, duration: 160, yoyo: true, repeat: 2 });
  }

  private startBossSlam(boss: Phaser.Physics.Arcade.Sprite) {
    boss.setVelocity(0, 0); boss.setData('aiState', 'slamWarning'); boss.setData('stateUntil', this.time.now + 900);
    const ring = this.trackTransient(this.add.circle(boss.x, boss.y, 124, 0xff4545, .07).setStrokeStyle(4, 0xff615b, .9).setDepth(1.6));
    const center = this.trackTransient(this.add.circle(boss.x, boss.y, 28, 0xff4545, .2).setStrokeStyle(2, 0xffaaa0, .9).setDepth(1.7));
    boss.setData('warningRing', ring); boss.setData('warningCenter', center);
    const status = document.querySelector<HTMLElement>('#status'); if (status) status.textContent = '首领准备范围震荡！离开红圈';
    this.tweens.add({ targets: [ring, center], alpha: .34, duration: 180, yoyo: true, repeat: 3 });
  }

  private clearEnemyWarnings(enemy: Phaser.Physics.Arcade.Sprite) {
    for (const key of ['warningLine', 'warningRing', 'warningCenter']) {
      const warning = enemy.getData(key) as Phaser.GameObjects.GameObject | undefined;
      if (warning) { this.tweens.killTweensOf(warning); warning.destroy(); }
      enemy.setData(key, undefined);
    }
  }

  private petBite(enemy: Phaser.Physics.Arcade.Sprite) {
    if (!enemy.active) return;
    this.petBites++;
    if (this.petSkills.includes('mark') && this.petBites % 4 === 0) this.markEnemy(enemy);
    const damage = this.petSkills.includes('ferocity') ? 2 : 1;
    this.damageEnemy(enemy, damage, 0, 100, 'pet');
  }

  private markEnemy(enemy: Phaser.Physics.Arcade.Sprite) {
    enemy.setData('markedUntil', this.time.now + 4200);
    let ring = enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined;
    if (!ring?.active) {
      ring = this.add.circle(enemy.x, enemy.y, 19, 0x000000, 0).setStrokeStyle(2, COLORS.gold, .95).setDepth(2.5);
      enemy.setData('markRing', ring);
    }
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, damage: number, angle: number, knockback = 170, source: 'player' | 'pet' = 'player') {
    if (!enemy.active) return;
    let actualDamage = damage;
    const markedUntil = (enemy.getData('markedUntil') as number | undefined) ?? 0;
    if (source === 'player' && markedUntil > this.time.now) {
      actualDamage++;
      (enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined)?.destroy();
      enemy.setData('markRing', undefined); enemy.setData('markedUntil', 0);
    }
    const weaponGear = getEquippedItem('weapon');
    if (source === 'player' && weaponGear?.weaponType === this.weapon) actualDamage += weaponGear.attackBonus;
    if (source === 'player') {
      const attributes = getCharacterProgress().attributes;
      actualDamage += this.weapon === 'staff' ? Math.floor(attributes.focus / 2) : Math.floor(attributes.power / 2);
    }
    if (source === 'player' && (this.time.now < this.autoBuffUntil || this.time.now < this.restBuffUntil)) actualDamage = Math.ceil(actualDamage * 1.3);
    const hp = (enemy.getData('hp') as number) - actualDamage; enemy.setData('hp', hp);
    const bar = enemy.getData('bar') as Phaser.GameObjects.Rectangle;
    const maxHp = (enemy.getData('maxHp') as number | undefined) ?? (2 + Math.floor(this.room / 2));
    bar.setScale(Math.max(.05, hp / maxHp), 1);
    enemy.setTint(0xffffff); this.time.delayedCall(75, () => { if (enemy.active) enemy.setTint(enemy.getData('tint') as number | undefined); });
    enemy.setVelocity(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
    if (hp <= 0) {
      const isBoss = enemy.getData('kind') === 'boss';
      this.grantExperience(isBoss ? 120 + this.room * 10 : 16 + this.room * 2);
      if (isBoss) {
        this.clearEnemyWarnings(enemy);
        this.tryDropPetSkillBook(enemy.x - 16, enemy.y, true);
        this.spawnCoreDrop(enemy.x + 17, enemy.y + 5);
        this.spawnGearDrop(enemy.x - 30, enemy.y - 8, 'weapon', true);
        this.spawnGearDrop(enemy.x + 30, enemy.y - 8, 'armor', true);
      } else this.tryDropPetSkillBook(enemy.x, enemy.y);
      if (!isBoss && Math.random() < .14) this.spawnGearDrop(enemy.x, enemy.y + 14);
      bar.destroy(); (enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined)?.destroy();
      enemy.destroy(); this.kills++; this.updateLabels();
    }
  }

  private tryDropPetSkillBook(x: number, y: number, guaranteed = false) {
    const owned = getOwnedPetSkills();
    const available = (Object.keys(PET_SKILL_BOOKS) as PetSkillId[]).filter((id) => !PET_SKILL_BOOKS[id].default && !owned.includes(id) && !this.pendingSkillBooks.has(id));
    if (available.length === 0) return;
    const dropChance = guaranteed ? 1 : this.petSkills.includes('scavenger') ? .34 : .2;
    if (Math.random() > dropChance) return;
    const id = Phaser.Utils.Array.GetRandom(available);
    this.pendingSkillBooks.add(id);
    const book = this.add.circle(x, y, 11, 0xb89aff, .95).setStrokeStyle(2, 0xe1d7ff, 1).setDepth(3);
    book.setData('skillId', id);
    const glyph = this.add.text(x, y - 1, '书', { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '11px', color: '#171322', fontStyle: 'bold' }).setOrigin(.5).setDepth(4);
    book.setData('glyph', glyph);
    this.physics.add.existing(book);
    this.skillBookDrops.add(book);
    const body = book.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setCircle(11);
    this.tweens.add({ targets: [book, glyph], y: '-=3', duration: 500, yoyo: true, repeat: -1 });
  }

  private spawnCoreDrop(x: number, y: number) {
    const core = this.add.circle(x, y, 13, 0xffb95f, .96).setStrokeStyle(2, 0xffedb2, 1).setDepth(3);
    const glyph = this.add.star(x, y, 4, 4, 8, 0xfff0b0).setDepth(4);
    core.setData('glyph', glyph);
    this.physics.add.existing(core); this.rewardDrops.add(core);
    (core.body as Phaser.Physics.Arcade.Body | undefined)?.setCircle(13);
    this.tweens.add({ targets: [core, glyph], y: '-=4', alpha: .68, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  private spawnGearDrop(x: number, y: number, forcedSlot?: EquipmentSlot, guaranteed = false) {
    if (!guaranteed && Math.random() > .14) return;
    const slot = forcedSlot ?? (Math.random() < .62 ? 'weapon' : 'armor');
    const roll = Math.random();
    const rarity: GearRarity = guaranteed ? (roll > .72 ? 'epic' : 'rare') : roll > .94 ? 'epic' : roll > .66 ? 'rare' : 'common';
    const rarityName: Record<GearRarity, string> = { common: '普通', rare: '精良', epic: '稀有' };
    const rarityColor: Record<GearRarity, number> = { common: 0xc0cad6, rare: 0x79d7ef, epic: 0xffcf75 };
    const weaponOptions = [
      { type: 'sword' as const, name: '裂锋短剑' }, { type: 'spear' as const, name: '巡猎长枪' }, { type: 'staff' as const, name: '星火法杖' },
    ];
    const selectedWeapon = Phaser.Utils.Array.GetRandom(weaponOptions);
    const attackBonus = slot === 'weapon' ? (rarity === 'epic' ? 3 : rarity === 'rare' ? 2 : 1) + Math.floor(this.room / 5) : 0;
    const defense = slot === 'armor' ? (rarity === 'epic' ? 3 : rarity === 'rare' ? 2 : 1) + Math.floor(this.room / 6) : 0;
    const item: EquipmentItem = {
      id: `gear-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: slot === 'weapon' ? selectedWeapon.name : '边境守卫护甲', slot, rarity,
      weaponType: slot === 'weapon' ? selectedWeapon.type : undefined,
      attackBonus, defense, upgradeLevel: 0,
      description: slot === 'weapon' ? `${{ sword: '单手剑', spear: '长枪', staff: '法杖' }[selectedWeapon.type]}攻击伤害 +${attackBonus}` : `受到的伤害减少 ${defense}`,
    };
    item.description = describeEquipment(item);
    const color = rarityColor[rarity];
    const drop = this.add.circle(x, y, 13, color, .96).setStrokeStyle(2, 0xffffff, .95).setDepth(3);
    const glyph = this.add.text(x, y, slot === 'weapon' ? '武' : '甲', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '10px', color: '#171922', fontStyle: 'bold' }).setOrigin(.5).setDepth(4);
    drop.setData({ item, glyph });
    this.physics.add.existing(drop); this.gearDrops.add(drop);
    (drop.body as Phaser.Physics.Arcade.Body | undefined)?.setCircle(13);
    this.tweens.add({ targets: [drop, glyph], y: '-=4', alpha: .72, duration: 460, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const label = this.add.text(x, y - 27, rarityName[rarity], { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '9px', color: `#${color.toString(16).padStart(6, '0')}`, stroke: '#11151c', strokeThickness: 3 }).setOrigin(.5).setDepth(4);
    drop.setData('rarityLabel', label);
  }

  private pickUpGear(drop: Phaser.GameObjects.Arc) {
    if (!drop.active) return;
    const item = drop.getData('item') as EquipmentItem;
    const state = getEquipmentState(); state.items.push(item); saveEquipmentState(state);
    const glyph = drop.getData('glyph') as Phaser.GameObjects.GameObject | undefined;
    const rarityLabel = drop.getData('rarityLabel') as Phaser.GameObjects.GameObject | undefined;
    glyph?.destroy(); rarityLabel?.destroy(); this.tweens.killTweensOf(drop);
    this.gearDrops.remove(drop, true, true);
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = `获得${item.name}，已存入军需官背包`;
    this.cameras.main.flash(100, 160, 220, 240);
    const toast = this.add.text(this.player.x, this.player.y - 38, `${item.name} 已收纳`, { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '12px', color: item.rarity === 'epic' ? '#ffdc8e' : item.rarity === 'rare' ? '#91e7ff' : '#e1e7ef', fontStyle: 'bold', stroke: '#161922', strokeThickness: 3 }).setOrigin(.5).setDepth(7);
    this.trackTransient(toast);
    this.tweens.add({ targets: toast, y: toast.y - 32, alpha: 0, duration: 850, onComplete: () => toast.destroy() });
  }

  private claimAllGearDrops() {
    [...this.gearDrops.getChildren()].forEach((drop) => this.pickUpGear(drop as Phaser.GameObjects.Arc));
  }

  private pickUpCore(core: Phaser.GameObjects.Arc) {
    if (!core.active) return;
    const total = getCoreCount() + 1;
    setCoreCount(total);
    (core.getData('glyph') as Phaser.GameObjects.GameObject | undefined)?.destroy();
    this.tweens.killTweensOf(core); this.rewardDrops.remove(core, true, true);
    this.updateCoreHud();
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = `获得首领晶片 +1 · 累计 ${total}`;
    this.cameras.main.flash(120, 255, 218, 132);
    const label = this.add.text(this.player.x, this.player.y - 34, '首领晶片 +1', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '12px', color: '#ffe4a0', fontStyle: 'bold', stroke: '#161922', strokeThickness: 3 }).setOrigin(.5).setDepth(7);
    this.trackTransient(label);
    this.tweens.add({ targets: label, y: label.y - 32, alpha: 0, duration: 750, onComplete: () => label.destroy() });
  }

  private updateCoreHud() {
    const counter = document.querySelector<HTMLElement>('#core-count');
    if (!counter) return;
    counter.textContent = `晶片 ${getCoreCount()}`;
  }

  private updateCharacterProgressHud() {
    const progress = getCharacterProgress();
    const needed = xpToNextLevel(progress.level);
    const level = document.querySelector<HTMLElement>('#character-level');
    const fill = document.querySelector<HTMLElement>('#character-xp-fill');
    const label = document.querySelector<HTMLElement>('#character-xp-label');
    if (level) level.textContent = `Lv. ${progress.level}`;
    if (fill) fill.style.width = `${Math.min(100, progress.xp / needed * 100)}%`;
    if (label) label.textContent = `${progress.xp} / ${needed} XP`;
  }

  private grantExperience(amount: number) {
    const progress = getCharacterProgress();
    progress.xp += amount;
    let levelsGained = 0;
    while (progress.level < 99 && progress.xp >= xpToNextLevel(progress.level)) {
      progress.xp -= xpToNextLevel(progress.level);
      progress.level++;
      progress.statPoints++;
      levelsGained++;
    }
    saveCharacterProgress(progress);
    this.updateCharacterProgressHud();
    const message = levelsGained ? `+${amount} EXP · 升级 Lv.${progress.level} · 属性点 +${levelsGained}` : `+${amount} EXP`;
    const label = this.add.text(this.player.x, this.player.y - 48, message, { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '12px', color: levelsGained ? '#ffe09b' : '#b9e7d1', fontStyle: 'bold', stroke: '#161922', strokeThickness: 3 }).setOrigin(.5).setDepth(7);
    this.trackTransient(label);
    this.tweens.add({ targets: label, y: label.y - 32, alpha: 0, duration: 1000, onComplete: () => label.destroy() });
  }

  private claimAllCoreDrops() {
    [...this.rewardDrops.getChildren()].forEach((core) => this.pickUpCore(core as Phaser.GameObjects.Arc));
  }

  private beginLootPhase(message: string) {
    this.lootPhase = true;
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = message;
    this.cameras.main.flash(190, 135, 223, 188);
    this.showFeatureBurst(0xa9e9dc, '区域安全');
  }

  private finishLootPhase() {
    if (!this.lootPhase) return;
    this.lootPhase = false;
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    const books = this.skillBookDrops.countActive();
    const cores = this.rewardDrops.countActive();
    const gear = this.gearDrops.countActive();
    this.claimAllSkillBooks(); this.claimAllCoreDrops(); this.claimAllGearDrops();
    if (node?.type === 'boss') {
      this.dungeon.completed = true;
      const progress = getExpeditionProgress();
      progress.highestUnlocked = Math.max(progress.highestUnlocked, this.room + 1);
      progress.continueStage = Math.min(progress.highestUnlocked, this.room + 1);
      saveExpeditionProgress(progress);
    }
    this.drawMiniMap(); this.saveCurrentCheckpoint();
    const rewardText = [books ? `收纳宠物技能书 ×${books}` : '', cores ? `首领晶片 ×${cores} 已自动收取` : '', gear ? `装备 ×${gear} 已存入背包` : ''].filter(Boolean).join('；');
    const message = rewardText ? `${rewardText}。选择一条路线继续。` : '房间已清理。选择一条路线继续。';
    this.showResult(node?.type === 'boss' ? '首领讨伐成功' : `${this.roomTitle(node!)}已清理`, message, true);
  }

  private pickUpSkillBook(book: Phaser.GameObjects.Arc) {
    if (!book.active) return;
    const id = book.getData('skillId') as PetSkillId;
    this.pendingSkillBooks.delete(id);
    const owned = getOwnedPetSkills();
    if (!owned.includes(id)) {
      owned.push(id); savePetSkills(OWNED_SKILLS_KEY, owned);
      const status = document.querySelector<HTMLElement>('#status');
      if (status) status.textContent = `获得宠物技能书：${PET_SKILL_BOOKS[id].name}`;
    }
    (book.getData('glyph') as Phaser.GameObjects.Text | undefined)?.destroy();
    this.tweens.killTweensOf(book);
    this.skillBookDrops.remove(book, true, true);
  }

  private petHit(_enemy: Phaser.Physics.Arcade.Sprite) { /* contact is handled by the pet's short lunge */ }

  private damagePlayer(damage: number) {
    if (this.invulnerable > 0) return;
    const armor = getEquippedItem('armor');
    const mitigatedDamage = Math.max(1, damage - (armor?.defense ?? 0));
    this.hp = Math.max(0, this.hp - mitigatedDamage);
    if (this.petSkills.includes('breath') && this.hp > 0 && this.hp <= 50 && this.time.now >= this.petRescueReadyAt) {
      this.hp = Math.min(100, this.hp + 14);
      this.petRescueReadyAt = this.time.now + 12000;
    const pulse = this.trackTransient(this.add.circle(this.player.x, this.player.y, 17, COLORS.pet, .25).setDepth(4));
      this.tweens.add({ targets: pulse, alpha: 0, scale: 2.6, duration: 380, onComplete: () => pulse.destroy() });
    }
    const fill = document.querySelector<HTMLElement>('#health'); const label = document.querySelector<HTMLElement>('#health-label');
    if (fill) fill.style.width = `${this.hp}%`; if (label) label.textContent = `${this.hp} / 100`;
    this.cameras.main.shake(90, .003);
    if (this.hp <= 0) { this.saveCurrentCheckpoint(); this.showResult('远征中断', `你抵达了 ${formatStage(this.room)} 的第 ${this.dungeon.currentRoom + 1} 个房间，击败了 ${this.kills} 个敌人。`, false); }
  }

  private updatePetSkillHud() {
    const active = document.querySelector<HTMLElement>('#pet-skills-active');
    if (active) {
      active.replaceChildren();
      this.petSkills.forEach((id) => {
        const tag = document.createElement('span'); tag.textContent = PET_SKILL_BOOKS[id].name; tag.title = PET_SKILL_BOOKS[id].description; active.append(tag);
      });
    }
    const state = document.querySelector<HTMLElement>('#pet-rescue-state');
    const remaining = Math.max(0, Math.ceil((this.petRescueReadyAt - this.time.now) / 1000));
    if (state) {
      state.classList.toggle('hidden', !this.petSkills.includes('breath'));
      state.textContent = remaining > 0 ? `守护灵息 ${remaining}s` : '守护灵息 可用';
      state.classList.toggle('cooling', remaining > 0);
    }
  }

  private updateCharacterSkillHud() {
    const active = document.querySelector<HTMLElement>('#active-skill-state');
    if (active) {
      const remaining = Math.max(0, Math.ceil((this.activeSkillReadyAt - this.time.now) / 1000));
      active.textContent = remaining > 0 ? `Q 风刃 ${remaining}s` : 'Q 风刃 可用';
    }
    const passive = document.querySelector<HTMLElement>('#passive-skill-state');
    if (passive) passive.textContent = this.swiftStep ? '被动 迅捷步伐' : '被动 未装备';
    const automatic = document.querySelector<HTMLElement>('#auto-skill-state');
    if (automatic) {
      const remaining = Math.max(0, Math.ceil((this.autoSkillReadyAt - this.time.now) / 1000));
      const buff = this.autoSkill === 'battle_focus' && this.autoBuffUntil > this.time.now;
      automatic.textContent = buff ? `自动 ${AUTO_SKILLS[this.autoSkill].name} 激活` : remaining > 0 ? `自动 ${AUTO_SKILLS[this.autoSkill].name} ${remaining}s` : `自动 ${AUTO_SKILLS[this.autoSkill].name} 待命`;
    }
    const restBuff = document.querySelector<HTMLElement>('#buff-state');
    if (restBuff) {
      const seconds = Math.max(0, Math.ceil((this.restBuffUntil - this.time.now) / 1000));
      restBuff.classList.toggle('hidden', seconds === 0);
      restBuff.textContent = seconds ? `篝火增伤 ${seconds}s` : '';
    }
  }

  private saveCurrentCheckpoint() {
    if (this.worldData) {
      saveWorldSave({ seed: this.worldData.seed, explored: this.worldData.exploredKeys(), playerX: this.player.x, playerY: this.player.y, hp: this.hp, tileSize: TILE_SIZE });
      return;
    }
    const progress = getExpeditionProgress();
    progress.continueStage = this.dungeon?.completed ? Math.min(progress.highestUnlocked, this.dungeon.stage + 1) : this.room;
    saveExpeditionProgress(progress);
    if (this.dungeon) { this.dungeon.hp = this.hp; saveDungeon(this.dungeon); }
  }

  private touchEnemy(enemy: Phaser.Physics.Arcade.Sprite) {
    if (!enemy.active || this.invulnerable > 0) return;
    const chargingBoss = enemy.getData('aiState') === 'charge';
    if (!chargingBoss) {
      const direction = new Phaser.Math.Vector2(enemy.x - this.player.x, enemy.y - this.player.y).normalize();
      enemy.setVelocity(direction.x * 190, direction.y * 190);
    }
    this.damagePlayer(((enemy.getData('touchDamage') as number | undefined) ?? 7) + (chargingBoss ? 4 : 0));
    this.invulnerable = 430;
  }

  private roomCleared() {
    this.roomCombatActive = false;
    this.waveSpawnEvent?.remove(false); this.waveSpawnEvent = undefined;
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    if (node) node.cleared = true;
    this.drawMiniMap();
    this.beginLootPhase(node?.type === 'boss' ? '首领已击败！收集奖励，按 E 结算并前往下一远征。' : '房间已清理！收集掉落物，按 E 查看路线。');
  }

  private showResult(title: string, body: string, canContinue: boolean) {
    this.transientEffects.forEach((effect) => { this.tweens.killTweensOf(effect); effect.destroy(); });
    this.transientEffects.clear();
    this.scene.pause();
    const overlay = document.querySelector('#overlay')!; overlay.classList.remove('hidden');
    document.querySelector('#result-title')!.textContent = title; document.querySelector('#result-text')!.textContent = body;
    const continueButton = document.querySelector<HTMLButtonElement>('#continue')!;
    const returnButton = document.querySelector<HTMLButtonElement>('#return-hub')!;
    const routes = document.querySelector<HTMLElement>('#route-options');
    continueButton.classList.toggle('hidden', !canContinue);
    continueButton.classList.add('hidden');
    if (routes) { routes.replaceChildren(); routes.classList.toggle('hidden', !canContinue); }
    returnButton.textContent = '返回营地';
    if (canContinue && routes) this.populateRouteChoices(routes);
    returnButton.onclick = () => {
      overlay.classList.add('hidden');
      this.claimAllSkillBooks();
      this.claimAllGearDrops();
      this.game.events.emit('expedition:return');
    };
  }

  private populateRouteChoices(container: HTMLElement) {
    const current = this.dungeon.nodes[this.dungeon.currentRoom];
    const neighbors = this.dungeon.edges.flatMap(([a, b]) => a === current.id ? [b] : b === current.id ? [a] : []);
    if (this.dungeon.completed) {
      const button = document.createElement('button');
      button.textContent = `进入下一远征 · ${formatStage(this.room + 1)} →`;
      button.onclick = () => { document.querySelector('#overlay')!.classList.add('hidden'); this.claimAllSkillBooks(); this.beginExpedition(this.room + 1); };
      container.append(button); return;
    }
    neighbors.forEach((id) => {
      const node = this.dungeon.nodes[id];
      const button = document.createElement('button');
      button.textContent = `${node.cleared ? '返回' : '前往'} · ${this.roomTitle(node)}${node.cleared ? '（已探索）' : ''} →`;
      button.onclick = () => {
        document.querySelector('#overlay')!.classList.add('hidden'); this.claimAllSkillBooks();
        this.clearExpeditionEntities(); this.resetCombatState(); this.enterDungeonRoom(id);
      };
      container.append(button);
    });
  }

  private claimAllSkillBooks() {
    [...this.skillBookDrops.getChildren()].forEach((book) => this.pickUpSkillBook(book as Phaser.GameObjects.Arc));
  }

  private updateLabels() {
    if (this.worldData) {
      const tile = this.worldData.toTile(this.player.x, this.player.y);
      this.roomText.setText(`WORLD  ${tile.x + 1} · ${tile.y + 1}`);
      this.roomNameText.setText(biomeName(this.worldData.biomeAtTile(tile.x, tile.y)));
      this.dashText.setText(this.dashReady ? 'SPACE  /  DASH READY' : 'DASH RECHARGING');
      return;
    }
    this.roomText.setText(`STAGE ${formatStage(this.room)}     ROOM ${this.dungeon ? this.dungeon.currentRoom + 1 : 1}/5     ${this.kills} KILLS`);
    this.dashText.setText(this.dashReady ? 'SPACE  /  DASH READY' : 'DASH RECHARGING');
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO, width: W, height: H, parent: 'game', backgroundColor: '#171e28',
  render: { antialias: true, pixelArt: false },
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [CombatScene],
});

const hubScreen = document.querySelector<HTMLElement>('#hub-screen')!;
const combatScreen = document.querySelector<HTMLElement>('#combat-screen')!;
const dialog = document.querySelector<HTMLElement>('#npc-dialog')!;
const dialogText = document.querySelector<HTMLElement>('#dialog-text')!;
const dialogOptions = document.querySelector<HTMLElement>('#dialog-options')!;
const characterPage = document.querySelector<HTMLElement>('#character-page')!;
const characterContent = document.querySelector<HTMLElement>('#character-content')!;
let characterPageTab: 'overview' | 'skills' | 'equipment' = 'overview';

type NpcId = 'quartermaster' | 'trainer' | 'petkeeper' | 'guide';
type DialogChoice = { label: string; action: string; hint?: string };
const npcProfiles: Record<NpcId, { role: string; name: string; avatar: string; text: string; options: DialogChoice[] }> = {
  quartermaster: { role: 'OUTPOST QUARTERMASTER', name: '军需官·老霍', avatar: '⚒', text: '装备、武器和强化都可以在人物信息页统一整备。出发前记得检查你的配置。', options: [
    { label: '打开人物信息', action: 'character:open', hint: '装备 · 属性 · 技能' }, { label: '我再看看', action: 'close' },
  ] },
  trainer: { role: 'VETERAN TRAINER', name: '老兵教官·岑', avatar: '✦', text: '人物属性和技能配置已经整合进人物信息页。职业之间的跨系学习规则，可以向我了解。', options: [
    { label: '打开人物信息', action: 'character:open', hint: '属性 · 技能' }, { label: '了解跨职业学习', action: 'trainer:rules', hint: '训练规则' }, { label: '回到营地', action: 'close' },
  ] },
  petkeeper: { role: 'BEAST KEEPER', name: '驯宠师·阿禾', avatar: '❋', text: '灵狐已经准备好了。战宠会跟随你并自动追击，带上它一起出发吧。', options: [
    { label: '配置灵狐技能', action: 'pet:manage', hint: '最多装备 3 种' }, { label: '宠物技能书怎么获得？', action: 'pet:books', hint: '听听说明' }, { label: '摸摸灵狐，准备出发', action: 'close' },
  ] },
  guide: { role: 'EXPEDITION GUIDE', name: '远征向导·林', avatar: '⌖', text: '哨站入口已经开放。清理当前区域后，你可以继续深入，或者随时回营地整备。', options: [
    { label: '现在出发', action: 'embark', hint: '进入副本' }, { label: '等我准备一下', action: 'close' },
  ] },
};

function selectWeapon(weapon: string) {
  document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach((button) => {
    const selected = button.dataset.weapon === weapon;
    button.classList.toggle('selected', selected);
    if (selected) game.events.emit('weapon:select', weapon);
  });
}

function renderDialogOptions(options: DialogChoice[]) {
  dialogOptions.replaceChildren();
  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = `dialog-option${option.action === 'close' ? ' muted-option' : ''}`;
    button.innerHTML = `${option.label}${option.hint ? `<span>${option.hint} →</span>` : ''}`;
    button.addEventListener('click', () => handleDialogAction(option.action));
    dialogOptions.append(button);
  });
}

function openNpc(id: NpcId) {
  const npc = npcProfiles[id];
  document.querySelector('#dialog-role')!.textContent = npc.role;
  document.querySelector('#dialog-name')!.textContent = npc.name;
  document.querySelector('#dialog-avatar')!.textContent = npc.avatar;
  dialogText.textContent = npc.text;
  renderDialogOptions(npc.options);
  dialog.classList.remove('hidden');
}

function showGearMenu(message?: string) {
  const state = getEquipmentState();
  const equippedWeapon = state.items.find((item) => item.id === state.equipped.weapon);
  const equippedArmor = state.items.find((item) => item.id === state.equipped.armor);
  dialogText.textContent = message ?? `背包装备 ${state.items.length} 件 · 首领晶片 ${getCoreCount()}。强化只作用于已装备物品，最高 +5。`;
  const rarity: Record<GearRarity, string> = { common: '普通', rare: '精良', epic: '稀有' };
  const options: DialogChoice[] = [];
  options.push({ label: `武器槽：${equippedWeapon ? `${rarity[equippedWeapon.rarity]} · ${equippedWeapon.name} · 强化 +${equippedWeapon.upgradeLevel}` : '未装备'}`, action: equippedWeapon ? 'gear:unequip:weapon' : 'gear:manage', hint: equippedWeapon ? '卸下' : '空槽' });
  options.push({ label: `护甲槽：${equippedArmor ? `${rarity[equippedArmor.rarity]} · ${equippedArmor.name} · 强化 +${equippedArmor.upgradeLevel}` : '未装备'}`, action: equippedArmor ? 'gear:unequip:armor' : 'gear:manage', hint: equippedArmor ? '卸下' : '空槽' });
  [equippedWeapon, equippedArmor].forEach((item) => {
    if (!item || item.upgradeLevel >= 5) return;
    const cost = item.upgradeLevel + 1;
    options.push({ label: `强化已装备${item.slot === 'weapon' ? '武器' : '护甲'} · ${item.name}`, action: `gear:upgrade:${item.id}`, hint: `消耗 ${cost} 晶片 · ${item.slot === 'weapon' ? '攻击 +1' : '减伤 +1'}` });
  });
  state.items.forEach((item) => {
    const equipped = state.equipped[item.slot] === item.id;
    const marker = item.rarity === 'epic' ? '✦' : item.rarity === 'rare' ? '◆' : '•';
    options.push({ label: `${equipped ? '✓ 已装备' : marker} ${rarity[item.rarity]} · ${item.name} · 强化 +${item.upgradeLevel}`, action: `gear:equip:${item.id}`, hint: describeEquipment(item) });
  });
  if (state.items.length === 0) options.push({ label: '还没有装备，进入副本击败敌人寻找掉落。', action: 'close' });
  options.push({ label: '返回军需官', action: 'open:quartermaster', hint: '←' });
  renderDialogOptions(options);
}

function handleDialogAction(action: string) {
  if (action.startsWith('weapon:')) {
    const weapon = action.split(':')[1];
    selectWeapon(weapon);
    const names: Record<string, string> = { sword: '单手剑', spear: '长枪', staff: '法杖' };
    dialogText.textContent = `好眼光，${names[weapon]}已经为你备好。你可以在副本里随时切换武器。`;
    renderDialogOptions([{ label: '继续挑选武器', action: 'open:quartermaster' }, { label: '回到营地', action: 'close' }]);
  } else if (action.startsWith('open:')) openNpc(action.split(':')[1] as NpcId);
  else if (action === 'gear:manage') openCharacterPage('equipment');
  else if (action.startsWith('gear:upgrade:')) {
    const id = action.slice('gear:upgrade:'.length); const state = getEquipmentState();
    const item = state.items.find((entry) => entry.id === id);
    if (!item) { showGearMenu('没有找到这件装备。'); return; }
    if (state.equipped[item.slot] !== item.id) { showGearMenu('只能强化当前已装备的物品。'); return; }
    if (item.upgradeLevel >= 5) { showGearMenu('这件装备已经强化到上限。'); return; }
    const cost = item.upgradeLevel + 1; const cores = getCoreCount();
    if (cores < cost) { showGearMenu(`晶片不足：强化需要 ${cost} 枚，目前只有 ${cores} 枚。`); return; }
    setCoreCount(cores - cost); item.upgradeLevel++;
    if (item.slot === 'weapon') item.attackBonus++;
    else item.defense++;
    item.description = describeEquipment(item); saveEquipmentState(state);
    if (item.slot === 'weapon') game.events.emit('weapon:select', document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon ?? 'sword');
    showGearMenu(`强化成功！${item.name}达到 +${item.upgradeLevel}，${describeEquipment(item)}。`);
  }
  else if (action.startsWith('gear:equip:')) {
    const id = action.slice('gear:equip:'.length); const state = getEquipmentState();
    const item = state.items.find((entry) => entry.id === id);
    if (item) {
      state.equipped[item.slot] = item.id; saveEquipmentState(state);
      if (item.slot === 'weapon') game.events.emit('weapon:select', document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon ?? 'sword');
      showGearMenu(`已装备「${item.name}」：${item.description}。`);
    }
  } else if (action.startsWith('gear:unequip:')) {
    const slot = action.slice('gear:unequip:'.length) as EquipmentSlot; const state = getEquipmentState();
    state.equipped[slot] = null; saveEquipmentState(state);
    if (slot === 'weapon') game.events.emit('weapon:select', document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon ?? 'sword');
    showGearMenu(slot === 'weapon' ? '武器已卸下。' : '护甲已卸下。');
  } else if (action === 'trainer:rules') {
    dialogText.textContent = '技能系统计划采用本职业 1 点、跨职业 2 点的学习成本。技能学习界面还没开放；之后你可以用混合技能拼出自己的打法。';
    renderDialogOptions([{ label: '明白了', action: 'close' }]);
  } else if (action === 'character:manage') {
    openCharacterPage('skills');
  } else if (action === 'character:attributes') {
    openCharacterPage('overview');
  } else if (action === 'character:open') {
    openCharacterPage();
  } else if (action.startsWith('attribute:')) {
    const attribute = action.slice('attribute:'.length) as keyof CharacterAttributes;
    const progress = getCharacterProgress();
    if (progress.statPoints < 1 || !(attribute in progress.attributes)) showAttributeMenu('没有可分配的属性点。击败副本敌人获得经验，升级后会得到属性点。');
    else {
      progress.statPoints--;
      progress.attributes[attribute]++;
      saveCharacterProgress(progress);
      showAttributeMenu(`分配成功：${{ power: '力量', focus: '专注', agility: '敏捷' }[attribute]}提升至 ${progress.attributes[attribute]}。`);
    }
  } else if (action === 'character:active-info') {
    showCharacterSkillMenu('主动技能：按 Q 释放风刃，对周围敌人造成伤害，冷却约 5 秒。空格冲刺保留为移动技能。');
  } else if (action === 'character:toggle-passive') {
    try { localStorage.setItem(PLAYER_PASSIVE_KEY, String(!hasSwiftStep())); } catch { /* The change remains available for this visit. */ }
    game.events.emit('character-skills:changed'); showCharacterSkillMenu();
  } else if (action.startsWith('character:auto:')) {
    const skill = action.split(':')[2] as AutoSkillId;
    try { localStorage.setItem(PLAYER_AUTO_KEY, skill); } catch { /* The change remains available for this visit. */ }
    game.events.emit('character-skills:changed'); showCharacterSkillMenu(`${AUTO_SKILLS[skill].name}已设为自动技能：${AUTO_SKILLS[skill].description}`);
  } else if (action === 'pet:books') {
    dialogText.textContent = '副本敌人有概率掉落宠物技能书。捡起后会永久收录；回营地找我，可以从已学技能中配置最多三种。';
    renderDialogOptions([{ label: '管理灵狐技能', action: 'pet:manage' }, { label: '知道了', action: 'close' }]);
  } else if (action === 'pet:manage') {
    showPetSkillMenu();
  } else if (action.startsWith('pet:toggle:')) {
    const id = action.split(':')[2] as PetSkillId;
    const owned = getOwnedPetSkills();
    if (!owned.includes(id)) {
      showPetSkillMenu(`还没有找到「${PET_SKILL_BOOKS[id].name}」技能书。进入副本击败敌人，有机会拾取新书。`); return;
    }
    const equipped = getEquippedPetSkills();
    if (equipped.includes(id)) equipped.splice(equipped.indexOf(id), 1);
    else if (equipped.length >= 3) {
      showPetSkillMenu('灵狐最多同时装备三种技能。先取消一个已装备技能，再选择新的技能。'); return;
    } else equipped.push(id);
    savePetSkills(EQUIPPED_SKILLS_KEY, equipped);
    game.events.emit('pet-skills:changed');
    showPetSkillMenu();
  } else if (action === 'embark') {
    dialog.classList.add('hidden'); document.querySelector<HTMLButtonElement>('#embark')!.click();
  } else if (action === 'close') dialog.classList.add('hidden');
}

function showPetSkillMenu(message?: string) {
  const owned = getOwnedPetSkills();
  const equipped = getEquippedPetSkills();
  dialogText.textContent = message ?? `已装备 ${equipped.length} / 3 种技能。点击技能可装备或卸下；技能书会永久收录。`;
  const options = (Object.keys(PET_SKILL_BOOKS) as PetSkillId[]).map((id) => {
    const info = PET_SKILL_BOOKS[id]; const isOwned = owned.includes(id); const isEquipped = equipped.includes(id);
    return { label: `${isOwned ? (isEquipped ? '✓ 已装备 · ' : '＋ 可装备 · ') : '🔒 未解锁 · '}${info.name}`, action: `pet:toggle:${id}`, hint: isOwned ? (isEquipped ? '卸下' : '装备') : '技能书掉落' };
  });
  options.push({ label: '返回对话', action: 'open:petkeeper', hint: '←' });
  renderDialogOptions(options);
}

function showCharacterSkillMenu(message?: string) {
  const passiveOn = hasSwiftStep(); const selectedAuto = getAutoSkill();
  dialogText.textContent = message ?? '人物技能分为主动、被动和自动。主动技能由你释放，被动常驻生效，自动技能按战况自行触发。';
  renderDialogOptions([
    { label: '分配属性点', action: 'character:attributes', hint: '力量 · 专注 · 敏捷' },
    { label: '主动 · Q 风刃', action: 'character:active-info', hint: '范围攻击' },
    { label: `${passiveOn ? '✓ 已装备' : '＋ 未装备'} · 被动 迅捷步伐`, action: 'character:toggle-passive', hint: '移动速度 +12%' },
    ...(['hunter_shot', 'battle_focus', 'shockwave'] as AutoSkillId[]).map((id) => ({
      label: `${selectedAuto === id ? '✓ 当前自动' : '○ 设为自动'} · ${AUTO_SKILLS[id].name}`,
      action: `character:auto:${id}`,
      hint: id === 'hunter_shot' ? '单体攻击' : id === 'battle_focus' ? '攻击增益' : '群体攻击',
    })),
    { label: '返回对话', action: 'open:trainer', hint: '←' },
  ]);
}

function showAttributeMenu(message?: string) {
  const progress = getCharacterProgress();
  const { power, focus, agility } = progress.attributes;
  dialogText.textContent = message ?? `等级 Lv.${progress.level} · 经验 ${progress.xp}/${xpToNextLevel(progress.level)} · 可用属性点 ${progress.statPoints}。每 2 点力量让剑/枪伤害 +1；每 2 点专注让法杖伤害 +1；每点敏捷让移动速度 +2%，最高 +30%。`;
  const options: DialogChoice[] = progress.statPoints > 0 ? [
    { label: `力量 · ${power}`, action: 'attribute:power', hint: '剑 / 枪每 2 点伤害 +1' },
    { label: `专注 · ${focus}`, action: 'attribute:focus', hint: '法杖每 2 点伤害 +1' },
    { label: `敏捷 · ${agility}`, action: 'attribute:agility', hint: `移速 +${Math.min(30, agility * 2)}%` },
  ] : [{ label: '尚无属性点，继续探索升级即可获得。', action: 'close', hint: '了解' }];
  options.push({ label: '返回训练师', action: 'open:trainer', hint: '←' });
  renderDialogOptions(options);
}

function openCharacterPage(tab: 'overview' | 'skills' | 'equipment' = 'overview') {
  dialog.classList.add('hidden');
  characterPageTab = tab;
  renderCharacterPage();
  characterPage.classList.remove('hidden');
}

function renderCharacterPage(message?: string) {
  const progress = getCharacterProgress();
  const needed = xpToNextLevel(progress.level);
  const attrs = progress.attributes;
  const messageHtml = message ? '<p class="profile-message">' + message + '</p>' : '';
  document.querySelector<HTMLElement>('#character-summary')!.innerHTML = `<div class="profile-level"><strong>Lv. ${progress.level}</strong><span>${progress.xp} / ${needed} XP</span></div><div class="profile-xp"><i style="width:${Math.min(100, progress.xp / needed * 100)}%"></i></div><div class="profile-statline"><span>未分配属性点 <b>${progress.statPoints}</b></span><span>力量 <b>${attrs.power}</b></span><span>专注 <b>${attrs.focus}</b></span><span>敏捷 <b>${attrs.agility}</b></span></div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-character-tab]').forEach((button) => button.classList.toggle('active', button.dataset.characterTab === characterPageTab));
  if (characterPageTab === 'overview') {
    const equippedWeapon = getEquippedItem('weapon'); const equippedArmor = getEquippedItem('armor');
    const weaponName = { sword: '单手剑', spear: '长枪', staff: '法杖' }[document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon ?? 'sword'];
    const spentAttributePoints = attrs.power + attrs.focus + attrs.agility;
    const attributeRows: [keyof CharacterAttributes, string, number, string][] = [
      ['power', '力量', attrs.power, '剑 / 枪每 2 点伤害 +1'],
      ['focus', '专注', attrs.focus, '法杖每 2 点伤害 +1'],
      ['agility', '敏捷', attrs.agility, `移动速度 +${Math.min(30, attrs.agility * 2)}%（上限 30%）`],
    ];
    const attributeCards = attributeRows.map(([id,name,value,hint]) => '<article class="attribute-card"><div><strong>' + name + '</strong><b>' + value + '</b></div><small>' + hint + '</small><button data-character-action="attribute:' + id + '" ' + (progress.statPoints < 1 ? 'disabled' : '') + '>分配 1 点</button></article>').join('');
    const previewSlots = '<div class="preview-slot"><small>武器</small><strong>' + (equippedWeapon?.name ?? '空') + '</strong><i>⚔</i></div><div class="preview-slot"><small>护甲</small><strong>' + (equippedArmor?.name ?? '空') + '</strong><i>◇</i></div>';
    characterContent.innerHTML = '<div class="profile-section"><div class="character-preview"><div class="preview-equipment"><span class="eyebrow">EQUIPMENT</span>' + previewSlots + '</div><div class="character-placeholder"><span class="eyebrow">CHARACTER PREVIEW</span><div class="empty-character-art"></div><strong>角色形象待加入</strong><small>立绘资源制作完成后会显示在这里</small></div><div class="preview-attributes"><span class="eyebrow">BATTLE STATS</span><h3>' + weaponName + ' · 战斗属性</h3><button class="attribute-reset" data-character-action="reset-attributes" ' + (spentAttributePoints === 0 ? 'disabled' : '') + '>重置属性 · 返还 ' + spentAttributePoints + ' 点</button>' + attributeCards + '</div></div>' + messageHtml + '<p class="profile-note">可用属性点：' + progress.statPoints + '。击败副本敌人获得经验，升级后会获得属性点。</p></div>';
  } else if (characterPageTab === 'skills') {
    const passiveOn = hasSwiftStep(); const selectedAuto = getAutoSkill();
    const autoRows = (['hunter_shot','battle_focus','shockwave'] as AutoSkillId[]).map((id) => '<article class="profile-row"><div><strong>' + AUTO_SKILLS[id].name + '</strong><small>' + AUTO_SKILLS[id].description + '</small></div><button data-character-action="auto:' + id + '">' + (selectedAuto === id ? '当前技能' : '设为自动') + '</button></article>').join('');
    characterContent.innerHTML = '<div class="profile-section"><span class="eyebrow">ACTIVE SKILL</span><h3>主动技能</h3><article class="profile-row"><div><strong>Q · 风刃</strong><small>按 Q 释放，对周围敌人造成范围伤害，冷却约 5 秒。</small></div><span class="skill-state">已学会</span></article></div>' +
      '<div class="profile-section"><span class="eyebrow">PASSIVE SKILL</span><h3>被动技能</h3><article class="profile-row"><div><strong>迅捷步伐</strong><small>移动速度提高 12%。</small></div><button data-character-action="passive">' + (passiveOn ? '已装备 · 点击卸下' : '点击装备') + '</button></article></div>' +
      '<div class="profile-section"><span class="eyebrow">AUTO SKILL</span><h3>自动技能 · 选择一种</h3>' + autoRows + '</div>';
  } else {
    const state = getEquipmentState();
    const equippedWeapon = getEquippedItem('weapon'); const equippedArmor = getEquippedItem('armor');
    const weaponNames: Record<string,string> = { sword:'单手剑', spear:'长枪', staff:'法杖' };
      const weaponCards = (['sword','spear','staff'] as const).map((id) => '<button data-character-action="weapon:' + id + '" class="' + (document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon === id ? 'chosen' : '') + '">' + weaponNames[id] + '<small>' + (id === 'sword' ? '快速近战' : id === 'spear' ? '直线穿刺' : '远程法球') + '</small></button>').join('');
      const gearRows = state.items.map((item) => {
        const equipped = state.equipped[item.slot] === item.id; const cost = item.upgradeLevel + 1;
        const rarityMark = item.rarity === 'epic' ? '✦ ' : item.rarity === 'rare' ? '◆ ' : '';
        const upgradeButton = equipped && item.upgradeLevel < 5 ? '<button data-character-action="gear-upgrade:' + item.id + '">强化 · ' + cost + ' 晶片</button>' : '';
        return '<article class="profile-row gear-row"><div><strong>' + rarityMark + item.name + (equipped ? ' · 已装备' : '') + '</strong><small>' + describeEquipment(item) + '</small></div><div class="gear-actions"><button data-character-action="gear-equip:' + item.id + '">' + (equipped ? '已装备' : '装备') + '</button>' + upgradeButton + '</div></article>';
      }).join('');
      const gearMessage = message ? '<p class="profile-message">' + message + '</p>' : '';
      const emptyGearMessage = '<p class="profile-note">背包暂时没有掉落装备，进入副本击败敌人寻找战利品。</p>';
      characterContent.innerHTML = '<div class="profile-section"><span class="eyebrow">WEAPON STYLE</span><h3>出战武器</h3><div class="profile-weapons">' + weaponCards + '</div></div>' +
      '<div class="profile-section"><div class="profile-section-heading"><div><span class="eyebrow">EQUIPMENT</span><h3>装备与强化</h3></div><small>首领晶片：' + getCoreCount() + '</small></div>' + gearMessage +
      '<div class="equipped-slots"><article>武器槽<strong>' + (equippedWeapon ? equippedWeapon.name + ' +' + equippedWeapon.upgradeLevel : '未装备') + '</strong><small>' + (equippedWeapon ? describeEquipment(equippedWeapon) : '从下方背包装备武器') + '</small></article><article>护甲槽<strong>' + (equippedArmor ? equippedArmor.name + ' +' + equippedArmor.upgradeLevel : '未装备') + '</strong><small>' + (equippedArmor ? describeEquipment(equippedArmor) : '从下方背包装备护甲') + '</small></article></div>' +
      (state.items.length ? '<div class="gear-list">' + gearRows + '</div>' : emptyGearMessage) + '</div>';
  }
}

function handleCharacterPageAction(action: string) {
  if (action === 'reset-attributes') {
    if (!window.confirm('确定重置属性吗？已分配的属性点会全部返还。')) return;
    const progress = getCharacterProgress();
    const returned = progress.attributes.power + progress.attributes.focus + progress.attributes.agility;
    progress.statPoints += returned;
    progress.attributes = { power: 0, focus: 0, agility: 0 };
    saveCharacterProgress(progress);
    renderCharacterPage('属性已重置，返还了 ' + returned + ' 点属性点。');
  } else if (action.startsWith('attribute:')) {
    const key = action.slice(10) as keyof CharacterAttributes;
    const progress = getCharacterProgress();
    if (progress.statPoints > 0 && key in progress.attributes) { progress.statPoints--; progress.attributes[key]++; saveCharacterProgress(progress); }
    renderCharacterPage(progress.statPoints >= 0 ? `已更新属性。${progress.statPoints} 点属性点可用。` : undefined);
  } else if (action === 'passive') {
    try { localStorage.setItem(PLAYER_PASSIVE_KEY, String(!hasSwiftStep())); } catch { /* Setting applies for this session. */ }
    game.events.emit('character-skills:changed'); renderCharacterPage();
  } else if (action.startsWith('auto:')) {
    const id = action.slice(5) as AutoSkillId;
    try { localStorage.setItem(PLAYER_AUTO_KEY, id); } catch { /* Setting applies for this session. */ }
    game.events.emit('character-skills:changed'); renderCharacterPage(`${AUTO_SKILLS[id].name}已设为自动技能。`);
  } else if (action.startsWith('weapon:')) {
    selectWeapon(action.slice(7)); renderCharacterPage('出战武器已切换。');
  } else if (action.startsWith('gear-equip:')) {
    const id = action.slice('gear-equip:'.length); const state = getEquipmentState(); const item = state.items.find((entry) => entry.id === id);
    if (item) { state.equipped[item.slot] = item.id; saveEquipmentState(state); if (item.slot === 'weapon') game.events.emit('weapon:select', document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon ?? 'sword'); renderCharacterPage(`${item.name}已装备。`); }
  } else if (action.startsWith('gear-upgrade:')) {
    const id = action.slice('gear-upgrade:'.length); const state = getEquipmentState(); const item = state.items.find((entry) => entry.id === id);
    if (!item || state.equipped[item.slot] !== id || item.upgradeLevel >= 5) { renderCharacterPage('只能强化已装备物品，最高强化至 +5。'); return; }
    const cost = item.upgradeLevel + 1; const cores = getCoreCount();
    if (cores < cost) { renderCharacterPage(`晶片不足：需要 ${cost} 枚，目前有 ${cores} 枚。`); return; }
    setCoreCount(cores - cost); item.upgradeLevel++; if (item.slot === 'weapon') item.attackBonus++; else item.defense++;
    item.description = describeEquipment(item); saveEquipmentState(state);
    game.events.emit('weapon:select', document.querySelector<HTMLButtonElement>('[data-weapon].selected')?.dataset.weapon ?? 'sword');
    renderCharacterPage(`${item.name}强化至 +${item.upgradeLevel}。`);
  }
}

function refreshWorldUI() {
  const save = loadWorldSave();
  const summary = document.querySelector<HTMLElement>('#world-summary');
  const continueLabel = document.querySelector<HTMLElement>('#continue-stage-label');
  const embark = document.querySelector<HTMLButtonElement>('#embark');
  if (summary) summary.textContent = save ? `已探索 ${save.explored.length} 格 · 种子 ${save.seed}` : '尚未生成世界';
  if (continueLabel) continueLabel.textContent = save ? '回到上次位置 →' : '进入世界 →';
  if (embark) embark.firstChild!.textContent = save ? '继续探索 ' : '开始探索 ';
}

function startWorld(resume = false) {
  hubScreen.classList.add('hidden'); combatScreen.classList.remove('hidden'); dialog.classList.add('hidden');
  characterPage.classList.add('hidden');
  if (resume) game.events.emit('world:resume'); else game.events.emit('world:begin');
}

document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach((button) => {
  button.addEventListener('click', () => {
    selectWeapon(button.dataset.weapon ?? 'sword');
  });
});
document.querySelectorAll<HTMLButtonElement>('[data-npc]').forEach((button) => {
  button.addEventListener('click', () => openNpc(button.dataset.npc as NpcId));
});
document.querySelector<HTMLButtonElement>('#open-character-page')!.addEventListener('click', () => openCharacterPage());
document.querySelector<HTMLButtonElement>('#close-character-page')!.addEventListener('click', () => characterPage.classList.add('hidden'));
characterPage.addEventListener('click', (event) => {
  if (event.target === characterPage) characterPage.classList.add('hidden');
  const target = event.target as HTMLElement;
  const tab = target.closest<HTMLButtonElement>('[data-character-tab]');
  if (tab) { characterPageTab = tab.dataset.characterTab as typeof characterPageTab; renderCharacterPage(); return; }
  const action = target.closest<HTMLButtonElement>('[data-character-action]')?.dataset.characterAction;
  if (action) handleCharacterPageAction(action);
});
document.querySelector<HTMLButtonElement>('#close-dialog')!.addEventListener('click', () => dialog.classList.add('hidden'));
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.classList.add('hidden'); });
document.querySelector<HTMLButtonElement>('#embark')!.addEventListener('click', () => {
  startWorld(Boolean(loadWorldSave()));
});
document.querySelector<HTMLButtonElement>('#new-expedition')!.addEventListener('click', () => {
  if (loadWorldSave() && !window.confirm('生成新世界会覆盖当前世界进度，确定继续吗？')) return;
  startWorld(false);
});
document.querySelector<HTMLButtonElement>('#leave-world')!.addEventListener('click', () => {
  game.events.emit('world:leave');
  game.events.emit('expedition:return');
});
game.events.on('expedition:return', () => {
  combatScreen.classList.add('hidden'); hubScreen.classList.remove('hidden'); refreshWorldUI();
});
refreshWorldUI();
