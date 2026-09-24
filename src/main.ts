import Phaser from 'phaser';
import './style.css';

const W = 960;
const H = 540;
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
type ExpeditionProgress = { highestUnlocked: number; continueStage: number };
type RoomKind = 'combat' | 'treasure' | 'rest' | 'boss';
type DungeonNode = { id: number; x: number; y: number; type: RoomKind; discovered: boolean; visited: boolean; cleared: boolean };
type DungeonSave = { stage: number; seed: number; currentRoom: number; hp: number; completed: boolean; nodes: DungeonNode[]; edges: [number, number][] };

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
  const branchTypes = (['treasure', 'rest', 'combat'] as RoomKind[]).sort(() => Math.random() - .5);
  const positions = [[0, 1], [1, 0], [1, 2], [2, 1], [3, 1]];
  const nodes = positions.map(([x, y], id): DungeonNode => ({
    id, x, y, type: id === 0 ? 'combat' : id === 4 ? 'boss' : branchTypes[id - 1],
    discovered: id === 0, visited: false, cleared: false,
  }));
  return { stage, seed: Math.floor(Math.random() * 0x7fffffff), currentRoom: 0, hp: 100, completed: false,
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
  private characterHudTimer = 0;
  private checkpointTimer = 0;
  private skillBookDrops!: Phaser.Physics.Arcade.Group;
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
  private dashText!: Phaser.GameObjects.Text;
  private walls!: Phaser.Physics.Arcade.StaticGroup;

  constructor() { super('combat'); }

  create() {
    this.game.events.on('expedition:begin', this.beginExpedition, this);
    this.game.events.on('expedition:resume', this.resumeExpedition, this);
    this.game.events.on('weapon:select', this.handleWeaponSelection, this);
    this.game.events.on('pet-skills:changed', this.handlePetSkillsChanged, this);
    this.game.events.on('character-skills:changed', this.handleCharacterSkillsChanged, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('expedition:begin', this.beginExpedition, this);
      this.game.events.off('expedition:resume', this.resumeExpedition, this);
      this.game.events.off('weapon:select', this.handleWeaponSelection, this);
      this.game.events.off('pet-skills:changed', this.handlePetSkillsChanged, this);
      this.game.events.off('character-skills:changed', this.handleCharacterSkillsChanged, this);
    });
    this.createTextures();
    this.drawRoom();
    this.walls = this.physics.add.staticGroup();
    this.addWall(W / 2, 28, W, 56); this.addWall(W / 2, H - 28, W, 56);
    this.addWall(28, H / 2, 56, H); this.addWall(W - 28, H / 2, 56, H);
    this.player = this.physics.add.sprite(W / 2, H / 2, 'player').setDepth(3).setCircle(14).setCollideWorldBounds(true);
    this.pet = this.physics.add.sprite(W / 2 - 36, H / 2 + 22, 'pet').setDepth(3).setCircle(9);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.skillBookDrops = this.physics.add.group();
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.player, this.enemies, (_p, e) => this.touchEnemy(e as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.pet, this.enemies, (_p, e) => this.petHit(e as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.skillBookDrops, (_p, book) => this.pickUpSkillBook(book as Phaser.GameObjects.Arc));
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,Q,SPACE,ONE,TWO,THREE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.on('pointerdown', () => { this.attackHeld = true; });
    this.input.on('pointerup', () => { this.attackHeld = false; });
    this.input.on('gameout', () => { this.attackHeld = false; });
    this.playerHpBar = this.add.rectangle(0, 0, 36, 4, 0x83d7b1).setDepth(5).setOrigin(.5, .5);
    this.roomText = this.add.text(54, 48, '', { fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#aeb9ca', letterSpacing: 1 }).setDepth(8);
    this.roomNameText = this.add.text(W / 2, 48, '', { fontFamily: 'Manrope, sans-serif', fontSize: '12px', color: '#e5c58f', fontStyle: 'bold' }).setOrigin(.5, 0).setDepth(8);
    this.dashText = this.add.text(W - 54, 48, '', { fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#ffc77d' }).setOrigin(1, 0).setDepth(8);
    this.mapLayer = this.add.container(W - 238, 76).setDepth(8);
    this.dungeon = generateDungeon(1); this.updateLabels(); this.drawMiniMap();
    this.scene.pause();
  }

  private beginExpedition(startStage = 1) {
    this.clearExpeditionEntities();
    const progress = getExpeditionProgress();
    this.room = Phaser.Math.Clamp(Math.floor(startStage), 1, progress.highestUnlocked);
    this.dungeon = generateDungeon(this.room); this.hp = 100; this.kills = 0;
    saveDungeon(this.dungeon);
    progress.continueStage = this.room; saveExpeditionProgress(progress);
    this.resetCombatState();
    this.enterDungeonRoom(0);
    this.scale.refresh();
  }

  private resumeExpedition() {
    this.clearExpeditionEntities();
    const saved = loadDungeonSave();
    if (!saved || saved.completed) { this.beginExpedition(getExpeditionProgress().continueStage); return; }
    this.dungeon = saved; this.room = saved.stage; this.hp = Phaser.Math.Clamp(saved.hp, 1, 100);
    this.kills = saved.nodes.filter((node) => node.cleared && node.type === 'combat').length;
    this.resetCombatState();
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    if (!node) { this.beginExpedition(getExpeditionProgress().continueStage); return; }
    this.revealNeighbors(node.id); this.drawMiniMap(); this.updateLabels(); this.updateHealthHud();
    if (node.cleared) this.showResult(`${this.roomTitle(node)}已清理`, '已恢复远征地图。选择一条相连路线继续探索。', true);
    else this.startRoomEncounter(node);
    this.scale.refresh();
  }

  private clearExpeditionEntities() {
    this.tweens.killAll();
    this.skillBookDrops.getChildren().forEach((book) => (book.getData('glyph') as Phaser.GameObjects.Text | undefined)?.destroy());
    this.skillBookDrops.clear(true, true);
    this.pendingSkillBooks.clear();
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      (enemy.getData('bar') as Phaser.GameObjects.Rectangle | undefined)?.destroy();
      (enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined)?.destroy();
      enemy.destroy();
    });
  }

  private resetCombatState() {
    this.attackTimer = 0; this.petTimer = 0; this.petBites = 0; this.petRescueReadyAt = 0; this.petHudTimer = 0; this.petShockTimer = 0;
    this.petSkills = getEquippedPetSkills();
    this.autoSkill = getAutoSkill(); this.swiftStep = hasSwiftStep(); this.activeSkillReadyAt = 0; this.autoSkillReadyAt = 0; this.autoBuffUntil = 0; this.characterHudTimer = 0; this.checkpointTimer = 0;
    this.dashReady = true; this.dashTimer = 0; this.invulnerable = 0;
    this.player.setPosition(W / 2, H / 2).setVelocity(0, 0).setAlpha(1);
    this.pet.setPosition(W / 2 - 36, H / 2 + 22).setVelocity(0, 0);
    this.updateHealthHud(); this.updatePetSkillHud(); this.updateCharacterSkillHud();
  }

  private enterDungeonRoom(roomId: number) {
    const node = this.dungeon.nodes[roomId];
    if (!node) return;
    this.dungeon.currentRoom = roomId; node.visited = true; node.discovered = true;
    this.revealNeighbors(roomId); this.drawMiniMap(); this.updateLabels();
    this.player.setPosition(W / 2, H / 2).setVelocity(0, 0);
    this.pet.setPosition(W / 2 - 36, H / 2 + 22).setVelocity(0, 0);
    this.roomNameText.setText(this.roomTitle(node));
    this.saveCurrentCheckpoint();
    if (node.cleared) {
      this.showResult(`${this.roomTitle(node)}已探索`, '这个房间已经清理过了。可以返回岔路，或继续前进。', true);
      return;
    }
    if (node.type === 'combat') { this.startRoomEncounter(node); return; }
    if (node.type === 'boss') { this.spawnBoss(); this.scene.resume(); return; }
    node.cleared = true;
    if (node.type === 'treasure') {
      this.hp = Math.min(100, this.hp + 18);
      this.tryDropPetSkillBook(W / 2, H / 2, true);
      this.updateHealthHud(); saveDungeon(this.dungeon);
      this.showResult('发现补给宝箱', '获得恢复补给；如果还有未学的宠物技能，宝箱也会提供一本技能书。', true);
    } else {
      this.hp = Math.min(100, this.hp + 28); this.updateHealthHud(); saveDungeon(this.dungeon);
      this.showResult('安全休息点', '在这里恢复了 28 点生命。选择路线继续探索。', true);
    }
  }

  private startRoomEncounter(node: DungeonNode) {
    if (node.type === 'boss') this.spawnBoss(); else this.spawnWave();
    this.roomNameText.setText(this.roomTitle(node)); this.scene.resume();
  }

  private spawnBoss() {
    const maxHp = 14 + Math.floor(this.room / 2);
    const enemy = this.physics.add.sprite(W / 2 + 210, H / 2, 'enemy').setDepth(2).setCircle(23).setScale(1.85)
      .setTint(0xb84f62).setData({ hp: maxHp, maxHp, hitAt: 0, moveSpeed: 34 + this.room * 2 });
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
    this.add.rectangle(W / 2, H / 2, W, H, COLORS.floor);
    const graphics = this.add.graphics().setDepth(0);
    graphics.lineStyle(1, COLORS.grid, .58);
    for (let x = 56; x < W; x += 40) graphics.lineBetween(x, 56, x, H - 56);
    for (let y = 56; y < H; y += 40) graphics.lineBetween(56, y, W - 56, y);
    graphics.lineStyle(1, 0x465366, .5); graphics.strokeRect(56, 56, W - 112, H - 112);
    this.add.text(68, 66, 'SECTOR 01  /  ABANDONED OUTPOST', { fontFamily: 'DM Mono, monospace', fontSize: '9px', color: '#647187', letterSpacing: 1 }).setDepth(1);
  }

  private addWall(x: number, y: number, width: number, height: number) {
    const wall = this.add.rectangle(x, y, width, height, COLORS.wall).setDepth(4);
    this.physics.add.existing(wall, true);
    this.walls.add(wall);
    this.add.rectangle(x, y - height / 2 + 3, width, 4, 0x59677c).setDepth(5).setAlpha(.42);
  }

  private spawnWave() {
    const count = 3 + Math.min(this.room, 3);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Phaser.Math.FloatBetween(-.25, .25);
      const radius = Phaser.Math.Between(145, 205);
      const x = Phaser.Math.Clamp(W / 2 + Math.cos(angle) * radius, 90, W - 90);
      const y = Phaser.Math.Clamp(H / 2 + Math.sin(angle) * radius * .72, 95, H - 95);
      const enemy = this.physics.add.sprite(x, y, 'enemy').setDepth(2).setCircle(12).setData({ hp: 2 + Math.floor(this.room / 2), hitAt: 0 });
      enemy.setCollideWorldBounds(true); this.enemies.add(enemy);
      const bar = this.add.rectangle(x, y - 19, 27, 3, 0x664b50).setDepth(3);
      enemy.setData('bar', bar);
    }
    this.kills = 0; this.updateLabels();
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 32);
    const left = this.keys.A.isDown || this.cursors.left.isDown;
    const right = this.keys.D.isDown || this.cursors.right.isDown;
    const up = this.keys.W.isDown || this.cursors.up.isDown;
    const down = this.keys.S.isDown || this.cursors.down.isDown;
    const move = new Phaser.Math.Vector2(Number(right) - Number(left), Number(down) - Number(up)).normalize();
    const speed = this.dashTimer > 0 ? 570 : 205 * (this.swiftStep ? 1.12 : 1);
    this.player.setVelocity(move.x * speed, move.y * speed);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.petTimer = Math.max(0, this.petTimer - dt);
    this.petShockTimer = Math.max(0, this.petShockTimer - dt);
    this.petHudTimer = Math.max(0, this.petHudTimer - dt);
    this.characterHudTimer = Math.max(0, this.characterHudTimer - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashReady) this.dash();
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) this.castActiveSkill();
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) this.setWeapon('sword');
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) this.setWeapon('spear');
    if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) this.setWeapon('staff');
    this.checkpointTimer = Math.max(0, this.checkpointTimer - dt);
    if (this.checkpointTimer <= 0) { this.checkpointTimer = 2500; this.saveCurrentCheckpoint(); }
    const pointer = this.input.activePointer;
    if (this.attackHeld && this.attackTimer <= 0) this.attack(pointer.worldX, pointer.worldY);
    this.movePet(); this.moveEnemies(dt); this.updateAutomaticSkill();
    if (this.petHudTimer <= 0) { this.updatePetSkillHud(); this.petHudTimer = 250; }
    if (this.characterHudTimer <= 0) { this.updateCharacterSkillHud(); this.characterHudTimer = 250; }
    this.playerHpBar.setPosition(this.player.x, this.player.y - 23).setScale(Math.max(.05, this.hp / 100), 1);
    this.player.setAlpha(this.invulnerable > 0 && Math.floor(this.invulnerable / 70) % 2 === 0 ? .45 : 1);
    if (!this.dashReady && this.dashTimer <= 0) { this.dashReady = true; this.updateLabels(); }
    if (this.enemies.countActive() === 0 && !this.scene.isPaused()) this.roomCleared();
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
    const slash = this.add.circle(this.player.x, this.player.y, 18, 0x91e1c4, .2).setStrokeStyle(3, 0xb8ffe4, .9).setDepth(4);
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
      const bolt = this.add.circle(this.player.x, this.player.y, 5, 0x8ce4dc).setStrokeStyle(2, 0xd4fff6).setDepth(4);
      this.tweens.add({ targets: bolt, x: nearest.x, y: nearest.y, duration: 230, onComplete: () => {
        if (nearest.active) this.damageEnemy(nearest, 2, angle, 90);
        bolt.destroy();
      } });
    } else if (this.autoSkill === 'battle_focus') {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, nearest.x, nearest.y) > 220) return;
      this.autoSkillReadyAt = this.time.now + 8500; this.autoBuffUntil = this.time.now + 4300;
      const aura = this.add.circle(this.player.x, this.player.y, 22, 0xffc77d, .18).setStrokeStyle(2, 0xffd996, .9).setDepth(4);
      this.tweens.add({ targets: aura, alpha: 0, scale: 2.6, duration: 460, onComplete: () => aura.destroy() });
    } else {
      const nearby = living.filter((enemy) => Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < 125);
      if (nearby.length < 2) return;
      this.autoSkillReadyAt = this.time.now + 6500;
      const wave = this.add.circle(this.player.x, this.player.y, 16, 0xff9b79, .2).setStrokeStyle(3, 0xffbc96, .9).setDepth(4);
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
    const hit = this.add.arc(this.player.x + Math.cos(angle) * 39, this.player.y + Math.sin(angle) * 39, 28,
      Phaser.Math.RadToDeg(angle - .82), Phaser.Math.RadToDeg(angle + .82), false, COLORS.gold, .32).setDepth(4);
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
    const thrust = this.add.line(0, 0, this.player.x, this.player.y, endX, endY, 0x94d9ef, .9).setLineWidth(7).setDepth(4);
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
    const orb = this.add.circle(startX, startY, 9, 0xb89aff).setStrokeStyle(2, 0xe1d7ff).setDepth(4);
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
    if (label) { label.textContent = `当前武器：${names[weapon]}`; label.style.color = colors[weapon]; }
  }

  private dash() {
    const pointer = this.input.activePointer;
    let dir = new Phaser.Math.Vector2(pointer.worldX - this.player.x, pointer.worldY - this.player.y).normalize();
    if (dir.lengthSq() === 0) dir.set(1, 0);
    this.player.setVelocity(dir.x * 570, dir.y * 570); this.dashTimer = 180; this.dashReady = false;
    this.invulnerable = 320; this.updateLabels();
    const trail = this.add.circle(this.player.x, this.player.y, 16, COLORS.player, .35).setDepth(2);
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
        const pulse = this.add.circle(this.pet.x, this.pet.y, 16, 0xb89aff, .24).setStrokeStyle(2, 0xd6c6ff, .9).setDepth(4);
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
      this.physics.moveToObject(enemy, this.player, (enemy.getData('moveSpeed') as number | undefined) ?? 46 + this.room * 3);
      const bar = enemy.getData('bar') as Phaser.GameObjects.Rectangle;
      const boss = Boolean(enemy.getData('maxHp'));
      bar.setPosition(enemy.x, enemy.y - (boss ? 34 : 19));
      const markedUntil = (enemy.getData('markedUntil') as number | undefined) ?? 0;
      const markRing = enemy.getData('markRing') as Phaser.GameObjects.Arc | undefined;
      if (markRing?.active && markedUntil > this.time.now) markRing.setPosition(enemy.x, enemy.y);
      else if (markRing?.active) { markRing.destroy(); enemy.setData('markRing', undefined); enemy.setData('markedUntil', 0); }
      const hitAt = enemy.getData('hitAt') as number;
      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) < 28 && this.time.now > hitAt) {
        this.damagePlayer(7); enemy.setData('hitAt', this.time.now + 850);
      }
    });
    void dt;
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
    if (source === 'player' && this.time.now < this.autoBuffUntil) actualDamage = Math.ceil(actualDamage * 1.3);
    const hp = (enemy.getData('hp') as number) - actualDamage; enemy.setData('hp', hp);
    const bar = enemy.getData('bar') as Phaser.GameObjects.Rectangle;
    const maxHp = (enemy.getData('maxHp') as number | undefined) ?? (2 + Math.floor(this.room / 2));
    bar.setScale(Math.max(.05, hp / maxHp), 1);
    enemy.setTint(0xffffff); this.time.delayedCall(75, () => { if (enemy.active) enemy.clearTint(); });
    enemy.setVelocity(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
    if (hp <= 0) {
      this.tryDropPetSkillBook(enemy.x, enemy.y);
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
    this.hp = Math.max(0, this.hp - damage);
    if (this.petSkills.includes('breath') && this.hp > 0 && this.hp <= 50 && this.time.now >= this.petRescueReadyAt) {
      this.hp = Math.min(100, this.hp + 14);
      this.petRescueReadyAt = this.time.now + 12000;
      const pulse = this.add.circle(this.player.x, this.player.y, 17, COLORS.pet, .25).setDepth(4);
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
  }

  private saveCurrentCheckpoint() {
    const progress = getExpeditionProgress();
    progress.continueStage = this.dungeon?.completed ? Math.min(progress.highestUnlocked, this.dungeon.stage + 1) : this.room;
    saveExpeditionProgress(progress);
    if (this.dungeon) { this.dungeon.hp = this.hp; saveDungeon(this.dungeon); }
  }

  private touchEnemy(enemy: Phaser.Physics.Arcade.Sprite) {
    if (!enemy.active || this.invulnerable > 0) return;
    const direction = new Phaser.Math.Vector2(enemy.x - this.player.x, enemy.y - this.player.y).normalize();
    enemy.setVelocity(direction.x * 190, direction.y * 190);
    this.damagePlayer(7);
    this.invulnerable = 430;
  }

  private roomCleared() {
    this.scene.pause();
    const node = this.dungeon.nodes[this.dungeon.currentRoom];
    if (node) node.cleared = true;
    const progress = getExpeditionProgress();
    if (node?.type === 'boss') {
      this.dungeon.completed = true;
      progress.highestUnlocked = Math.max(progress.highestUnlocked, this.room + 1);
      progress.continueStage = Math.min(progress.highestUnlocked, this.room + 1);
    }
    saveExpeditionProgress(progress); this.saveCurrentCheckpoint(); this.drawMiniMap();
    const books = this.skillBookDrops.countActive();
    const result = books > 0 ? `发现 ${books} 本宠物技能书，离开房间时会一并收好。` : node?.type === 'boss' ? '首领已击败，新的远征区域已经开放。' : '房间已清理。查看地图并选择下一条路线。';
    this.showResult(node?.type === 'boss' ? '首领讨伐成功' : `${this.roomTitle(node!)}已清理`, result, true);
  }

  private showResult(title: string, body: string, canContinue: boolean) {
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

type NpcId = 'quartermaster' | 'trainer' | 'petkeeper' | 'guide';
type DialogChoice = { label: string; action: string; hint?: string };
const npcProfiles: Record<NpcId, { role: string; name: string; avatar: string; text: string; options: DialogChoice[] }> = {
  quartermaster: { role: 'OUTPOST QUARTERMASTER', name: '军需官·老霍', avatar: '⚒', text: '出发前先挑趁手的家伙。武器不绑职业，拿什么、怎么打，由你自己决定。', options: [
    { label: '装备单手剑', action: 'weapon:sword', hint: '快速近战' }, { label: '装备长枪', action: 'weapon:spear', hint: '直线穿刺' }, { label: '装备法杖', action: 'weapon:staff', hint: '远程法球' }, { label: '我再看看', action: 'close' },
  ] },
  trainer: { role: 'VETERAN TRAINER', name: '老兵教官·岑', avatar: '✦', text: '职业是专长，不是牢笼。练熟自己的本领，也可以花更多训练点向别的流派学招。', options: [
    { label: '配置人物技能', action: 'character:manage', hint: '主动 · 被动 · 自动' }, { label: '了解跨职业学习', action: 'trainer:rules', hint: '训练规则' }, { label: '回到营地', action: 'close' },
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

function handleDialogAction(action: string) {
  if (action.startsWith('weapon:')) {
    const weapon = action.split(':')[1];
    selectWeapon(weapon);
    const names: Record<string, string> = { sword: '单手剑', spear: '长枪', staff: '法杖' };
    dialogText.textContent = `好眼光，${names[weapon]}已经为你备好。你可以在副本里随时切换武器。`;
    renderDialogOptions([{ label: '继续挑选武器', action: 'open:quartermaster' }, { label: '回到营地', action: 'close' }]);
  } else if (action.startsWith('open:')) openNpc(action.split(':')[1] as NpcId);
  else if (action === 'trainer:rules') {
    dialogText.textContent = '技能系统计划采用本职业 1 点、跨职业 2 点的学习成本。技能学习界面还没开放；之后你可以用混合技能拼出自己的打法。';
    renderDialogOptions([{ label: '明白了', action: 'close' }]);
  } else if (action === 'character:manage') {
    showCharacterSkillMenu();
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

function refreshProgressUI() {
  const progress = getExpeditionProgress();
  const savedDungeon = loadDungeonSave();
  document.querySelector<HTMLElement>('#progress-summary')!.textContent = `已解锁到 ${formatStage(progress.highestUnlocked)}`;
  const checkpointLabel = savedDungeon && !savedDungeon.completed && savedDungeon.stage === progress.continueStage
    ? `${formatStage(progress.continueStage)} · 房间 ${savedDungeon.currentRoom + 1}/5 →`
    : `${formatStage(progress.continueStage)} →`;
  document.querySelector<HTMLElement>('#continue-stage-label')!.textContent = checkpointLabel;
  const select = document.querySelector<HTMLSelectElement>('#stage-select')!;
  select.replaceChildren();
  for (let stage = 1; stage <= progress.highestUnlocked; stage++) {
    const option = document.createElement('option'); option.value = String(stage); option.textContent = formatStage(stage); select.append(option);
  }
  select.value = String(Math.min(progress.continueStage, progress.highestUnlocked));
}

function startExpeditionAt(stage: number, resume = false) {
  hubScreen.classList.add('hidden'); combatScreen.classList.remove('hidden'); dialog.classList.add('hidden');
  if (resume) game.events.emit('expedition:resume'); else game.events.emit('expedition:begin', stage);
}

document.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach((button) => {
  button.addEventListener('click', () => {
    selectWeapon(button.dataset.weapon ?? 'sword');
  });
});
document.querySelectorAll<HTMLButtonElement>('[data-npc]').forEach((button) => {
  button.addEventListener('click', () => openNpc(button.dataset.npc as NpcId));
});
document.querySelector<HTMLButtonElement>('#close-dialog')!.addEventListener('click', () => dialog.classList.add('hidden'));
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.classList.add('hidden'); });
document.querySelector<HTMLButtonElement>('#embark')!.addEventListener('click', () => {
  const progress = getExpeditionProgress(); const saved = loadDungeonSave();
  const canResume = Boolean(saved && !saved.completed && saved.stage === progress.continueStage);
  startExpeditionAt(progress.continueStage, canResume);
});
document.querySelector<HTMLButtonElement>('#new-expedition')!.addEventListener('click', () => startExpeditionAt(1));
document.querySelector<HTMLButtonElement>('#start-selected-stage')!.addEventListener('click', () => {
  startExpeditionAt(Number(document.querySelector<HTMLSelectElement>('#stage-select')!.value) || 1);
});
game.events.on('expedition:return', () => {
  combatScreen.classList.add('hidden'); hubScreen.classList.remove('hidden'); refreshProgressUI();
});
refreshProgressUI();
