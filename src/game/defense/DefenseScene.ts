import Phaser from 'phaser';
import { MaterialId, materialName } from '../world/WorldMapData';
import {
  AIRDROP_INTERVAL, AIRDROP_LIFETIME, BASE_SPAWN_INTERVAL, BOONS, BOSS_DELAY_MAX, BOSS_DELAY_MIN,
  BOSS_LOOT_LIFETIME, BOSS_MIN_THREAT, BUILDS, BUILD_ORDER, BoonId, BuildKind, CORE_CLEAR_RADIUS, CORE_HP,
  CYCLE_DURATION, DAY_DURATION,
  ENEMIES, EnemyKind, MAP_COLUMNS, MAP_HEIGHT, MAP_ROWS, MAP_WIDTH, MIN_SPAWN_INTERVAL, NODES, NodeKind,
  PET_LEASH, TILE,
} from './DefenseConfig';
import { isBuildUnlocked, recordRunResult } from './DefenseMeta';
import { DefenseWorld } from './DefenseWorld';
import { actorTexture, queueTileImages, registerTiles } from '../world/WorldTiles';
import { addCoreCount, createGear, EquipmentItem, getEquippedItem, grantEquipment, WeaponType } from '../Equipment';
import {
  AutoSkillId, AUTO_SKILLS, CharacterAttributes, focusBonus, getAutoSkill, getCharacterProgress,
  getSelectedWeapon, grantExperience, hasSwiftStep, moveSpeedMultiplier, playerAttackBonus, setSelectedWeapon,
} from '../Character';
import { getEquippedPetSkills, grantSkillBook, PET_SKILL_BOOKS, PetSkillId, randomLockedBook } from '../PetSkills';

type BuildInstance = { kind: BuildKind; tileX: number; tileY: number; hp: number; level: number; object: Phaser.GameObjects.Rectangle; readyAt: number };
type NodeInstance = { kind: NodeKind; hp: number; object: Phaser.GameObjects.GameObject; x: number; y: number };
type Airdrop = { object: Phaser.GameObjects.Container; x: number; y: number; remain: number; kind: 'supply' | 'boss' };

export const BEST_KEY = 'defense-best-run';
const PLAYER_SPEED = 210;
const ATTACK_RANGE = 78;
/** Three weapon types, three ways to fight: arc, thrust line, ranged orb. */
const WEAPON_NAME: Record<WeaponType, string> = { sword: '单手剑', spear: '长枪', staff: '法杖' };
const WEAPON_COLOR: Record<WeaponType, string> = { sword: '#ffc77d', spear: '#94d9ef', staff: '#c8afff' };

/**
 * Defence waves reuse the adventure art: the kinds differ in stats, not in
 * silhouette, so grunts and runners borrow the stalker sprite.
 */
const ENEMY_ART: Record<EnemyKind, string> = { grunt: 'stalker', runner: 'stalker', brute: 'brute', elite: 'caster', boss: 'boss' };

/**
 * Endless survival defence: harvest the arena, build walls and towers around the
 * core, and hold out as waves escalate. Airdrops spawn away from the core so the
 * player has to leave the safety of the base for better gear.
 */
export class DefenseScene extends Phaser.Scene {
  private world!: DefenseWorld;
  private player!: Phaser.Physics.Arcade.Sprite;
  private pet!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private structures!: Phaser.Physics.Arcade.StaticGroup;
  private core!: Phaser.GameObjects.Container;
  private coreHp = CORE_HP;
  private playerHp = 140;
  private readonly playerMaxHp = 140;
  private playerInvulnerableUntil = 0;
  private playerDownUntil = 0;
  private builds: BuildInstance[] = [];
  private nodes: NodeInstance[] = [];
  private airdrops: Airdrop[] = [];
  private materials = new Map<MaterialId, number>();
  private selectedBuild: BuildKind = 'woodWall';
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private attackHeld = false;
  private attackReadyAt = 0;
  /** Weapon type picked in camp; a drop only boosts the type it was made for. */
  private weapon: WeaponType = 'sword';
  private weaponGear?: EquipmentItem;
  private armorGear?: EquipmentItem;
  private dashReadyAt = 0;
  private dashUntil = 0;
  /** A boss slam flings and stuns the player; the run still ends on the core. */
  private stunUntil = 0;
  private bossTimer = BOSS_DELAY_MIN;
  /** Attributes, skills and the fox loadout are read per run so camp edits apply. */
  private attributes: CharacterAttributes = { power: 0, focus: 0, agility: 0 };
  private swiftStep = true;
  private autoSkill: AutoSkillId = 'hunter_shot';
  private petSkills: PetSkillId[] = [];
  private activeSkillReadyAt = 0;
  private autoSkillReadyAt = 0;
  private autoBuffUntil = 0;
  private petBites = 0;
  private petShockReadyAt = 0;
  private petRescueReadyAt = 0;
  private xpEarned = 0;
  private levelsGained = 0;
  /** Last threat level that paid out a gear drop. */
  private gearThreat = 0;
  private elapsed = 0;
  private threat = 0;
  private phase: 'day' | 'night' = 'day';
  private spawnTimer = 2_000;
  private airdropTimer = AIRDROP_INTERVAL * 1000;
  private kills = 0;
  private finished = false;
  /** Stackable run modifiers picked from the boon choices. */
  private boonLevels = new Map<BoonId, number>();
  private lastThreatOffered = 0;
  private petStrikeAt = 0;
  private hudText!: Phaser.GameObjects.Text;
  private buildText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  /** Shown only while an airdrop is live: where the fox is willing to fetch. */
  private leashRing!: Phaser.GameObjects.Arc;
  private coreBar!: Phaser.GameObjects.Rectangle;
  private playerBar!: Phaser.GameObjects.Rectangle;
  private lightOverlay!: Phaser.GameObjects.Rectangle;
  private phaseText!: Phaser.GameObjects.Text;

  constructor() { super('defense'); }

  preload() {
    // Shared with the adventure scene: re-queuing is cheap and keeps the defence
    // mode dressed even when it starts without a combat run first.
    queueTileImages(this);
  }

  create() {
    this.resetRunState();
    registerTiles(this);
    this.createTextures();
    this.world = new DefenseWorld(Math.floor(Math.random() * 0x7fffffff));
    this.world.render(this);
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT).setRoundPixels(true);

    this.structures = this.physics.add.staticGroup();
    // Water is solid: nobody walks across a lake and nothing is built on it.
    const water = this.physics.add.staticGroup();
    this.world.waterBodies().forEach((body) => {
      water.add(this.add.rectangle(body.x + body.width / 2, body.y + body.height / 2, body.width, body.height, 0x6cc3ef, 0)
        .setVisible(false));
    });
    this.enemies = this.physics.add.group();
    this.createCore();
    this.createNodes();

    // Art sprites are drawn for the adventure camera, so they are trimmed a little
    // to sit at the same scale as the buildings around them.
    const playerArt = actorTexture('player');
    this.player = this.physics.add.sprite(MAP_WIDTH / 2, MAP_HEIGHT / 2 + 90, playerArt ?? 'player').setDepth(3)
      .setScale(playerArt ? .85 : 1).setCollideWorldBounds(true);
    this.actorCircle(this.player, 14, Boolean(playerArt));
    const petArt = actorTexture('pet');
    this.pet = this.physics.add.sprite(MAP_WIDTH / 2 - 50, MAP_HEIGHT / 2 + 90, petArt ?? 'pet').setDepth(3)
      .setScale(petArt ? .9 : 1);
    this.actorCircle(this.pet, 9, Boolean(petArt));
    this.refreshLoadout();
    this.cameras.main.startFollow(this.player, true, .12, .12);

    this.physics.add.collider(this.player, this.structures);
    this.physics.add.collider(this.pet, this.structures);
    this.physics.add.collider(this.player, water);
    this.physics.add.collider(this.pet, water);
    this.physics.add.collider(this.enemies, water);
    this.physics.add.collider(this.enemies, this.structures, (a, b) =>
      this.enemyHitsStructure(a as Phaser.Physics.Arcade.Sprite, b as Phaser.GameObjects.GameObject));

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,Q,R,F,SPACE,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.tryBuild(pointer.worldX, pointer.worldY);
      else this.attackHeld = true;
    });
    this.input.on('pointerup', () => { this.attackHeld = false; });
    this.input.on('gameout', () => { this.attackHeld = false; });

    this.hudText = this.add.text(16, 14, '', { fontFamily: 'DM Mono, monospace', fontSize: '12px', color: '#cbd5e1', backgroundColor: '#10151dcc', padding: { x: 9, y: 6 } }).setDepth(8).setScrollFactor(0);
    this.buildText = this.add.text(16, 46, '', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '12px', color: '#ffe0aa', backgroundColor: '#10151dcc', padding: { x: 9, y: 6 } }).setDepth(8).setScrollFactor(0);
    this.phaseText = this.add.text(944, 14, '', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '12px', color: '#ffe0aa', backgroundColor: '#10151dcc', padding: { x: 9, y: 6 } }).setOrigin(1, 0).setDepth(8).setScrollFactor(0);
    this.hintText = this.add.text(480, 520, '左键攻击/采集 · 右键建造/维修 · F 升级最近建筑 · 1-3 换武器 · 4-9 切换建筑 · Q 风刃 · 空格冲刺', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '11px', color: '#8795a8' }).setOrigin(.5).setDepth(8).setScrollFactor(0);
    this.leashRing = this.add.circle(0, 0, PET_LEASH, 0xffd08b, .04).setStrokeStyle(2, 0xffd08b, .35).setDepth(1.4).setVisible(false);
    this.lightOverlay = this.add.rectangle(480, 270, 960, 540, 0x071020, 0).setDepth(7).setScrollFactor(0);
    this.playerBar = this.add.rectangle(this.player.x, this.player.y - 30, 34, 4, 0x87e1c0).setDepth(4).setOrigin(.5);
    this.updateHud();
    // Phaser boots the only scene straight away, so the first pass parks itself
    // until the camp menu actually starts a run.
    if (!this.game.registry.get('defense:running')) this.scene.pause();
  }

  private resetRunState() {
    this.coreHp = CORE_HP; this.playerHp = this.playerMaxHp;
    this.playerInvulnerableUntil = 0; this.playerDownUntil = 0;
    this.builds = []; this.nodes = []; this.airdrops = []; this.materials = new Map();
    this.elapsed = 0; this.threat = 0; this.phase = 'day'; this.spawnTimer = 2_000;
    this.airdropTimer = AIRDROP_INTERVAL * 1000; this.bossTimer = BOSS_DELAY_MIN;
    this.kills = 0; this.finished = false; this.gearThreat = 0;
    this.boonLevels = new Map(); this.lastThreatOffered = 0;
  }

  /** Placeholder circles, replaced by `actor_` art when it is available. */
  private createTextures() {
    if (this.textures.exists('player') && this.textures.exists('enemy') && this.textures.exists('pet')) return;
    const make = (key: string, color: number, radius: number) => {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(color, 1); graphics.fillCircle(radius, radius, radius);
      graphics.lineStyle(2, 0xffffff, .7); graphics.strokeCircle(radius, radius, radius - 3);
      graphics.generateTexture(key, radius * 2, radius * 2); graphics.destroy();
    };
    make('player', 0x91e1c4, 16); make('enemy', 0xe77d70, 14); make('pet', 0xa9e9dc, 11);
  }

  /** Art actors are taller than the placeholder circles; keep the hitbox at the feet. */
  private actorCircle(sprite: Phaser.Physics.Arcade.Sprite, radius: number, usingArt: boolean) {
    if (!usingArt) { sprite.setCircle(radius); return; }
    sprite.setCircle(radius, Math.max(0, sprite.width / 2 - radius), Math.max(0, sprite.height * .72 - radius));
  }

  private createCore() {
    const spot = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    this.core = this.add.container(spot.x, spot.y).setDepth(2.4);
    this.core.add(this.add.circle(0, 0, 34, 0x1d3b52, .95).setStrokeStyle(3, 0x7fd4ff, .9));
    this.core.add(this.add.circle(0, 0, 20, 0x8fd0ff, .9));
    this.coreBar = this.add.rectangle(spot.x, spot.y - 48, 68, 7, 0x7fd4ff).setDepth(2.5);
    const body = this.add.circle(spot.x, spot.y, 30, 0x000000, 0);
    this.physics.add.existing(body, true);
    this.structures.add(body);
  }

  private createNodes() {
    this.world.nodes.forEach((node) => {
      const def = NODES[node.kind];
      const spot = this.world.tileCenter(node.x, node.y);
      const object = this.add.circle(spot.x, spot.y, def.radius, def.color, .98)
        .setStrokeStyle(2, 0x10151d, .45).setDepth(2.2);
      if (node.kind === 'tree') {
        this.add.circle(spot.x - 4, spot.y - def.radius * .5, def.radius * .55, 0x6fc184, .95).setDepth(2.3);
      }
      this.nodes.push({ kind: node.kind, hp: def.hp, object, x: spot.x, y: spot.y });
    });
  }

  update(_time: number, delta: number) {
    if (this.finished) return;
    const dt = Math.min(delta, 32);
    this.elapsed += dt;
    this.updateDayNight();
    this.revivePlayerIfReady();

    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) this.castActiveSkill();
    this.updateAutomaticSkill();
    this.tryCoreRescue();

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.dash();
    this.handleWeaponKeys();
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.repairNearestBuild();
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) this.upgradeNearestBuild();

    this.movePlayer();
    // Attacks aim where the pointer is; each weapon owns its own cooldown.
    if (this.attackHeld && !this.isStunned() && !this.isDowned() && this.time.now >= this.attackReadyAt) {
      const pointer = this.input.activePointer;
      this.attack(pointer.worldX, pointer.worldY);
    }
    this.updateEnemies(dt);
    this.updatePet();
    this.updateTowers();
    this.updateAirdrops(dt);
    this.handleBuildKeys();

    this.spawnTimer -= dt;
    if (this.phase === 'night' && this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - this.threat * 190);
      this.spawnWave();
    }
    this.airdropTimer -= dt;
    if (this.airdropTimer <= 0) { this.airdropTimer = AIRDROP_INTERVAL * 1000; this.dropAirdrop(); }

    // One wild boss at a time, and only once the run is worth hunting in.
    this.bossTimer -= this.phase === 'night' ? dt : 0;
    if (this.phase === 'night' && this.bossTimer <= 0) {
      this.bossTimer = Phaser.Math.Between(BOSS_DELAY_MIN, BOSS_DELAY_MAX);
      if (this.threat >= BOSS_MIN_THREAT && !this.livingEnemies().some((enemy) => enemy.getData('kind') === 'boss')) this.spawnBoss();
    }

    this.player.setAlpha(this.isStunned() && Math.floor(this.time.now / 90) % 2 === 0 ? .4 : 1);
    this.coreBar.setScale(Math.max(.02, this.coreHp / CORE_HP), 1);
    this.playerBar.setPosition(this.player.x, this.player.y - 30).setScale(Math.max(.02, this.playerHp / this.playerMaxHp), 1).setVisible(!this.isDowned());
    this.updateHud();
  }

  private movePlayer() {
    if (this.isDowned()) { this.player.setVelocity(0, 0); return; }
    const left = this.keys.A.isDown || this.cursors.left.isDown;
    const right = this.keys.D.isDown || this.cursors.right.isDown;
    const up = this.keys.W.isDown || this.cursors.up.isDown;
    const down = this.keys.S.isDown || this.cursors.down.isDown;
    // A dash owns the velocity while it lasts, so walking input is skipped.
    if (this.time.now < this.dashUntil) return;
    // Stunned by a boss: the player cannot walk it off.
    if (this.isStunned()) { this.player.setVelocity(0, 0); return; }
    const move = new Phaser.Math.Vector2(Number(right) - Number(left), Number(down) - Number(up)).normalize();
    const speed = (PLAYER_SPEED + (this.boonLevels.get('speed') ?? 0) * 20)
      * moveSpeedMultiplier(this.attributes, this.swiftStep);
    this.player.setVelocity(move.x * speed, move.y * speed);
    if (move.x !== 0) this.player.setFlipX(move.x < 0);
  }

  /** Day is for gathering and fortifying. At night the screen darkens and each
   * new assault raises the threat level before the first monsters arrive. */
  private updateDayNight() {
    const cycleSeconds = (this.elapsed / 1000) % CYCLE_DURATION;
    const nextPhase: 'day' | 'night' = cycleSeconds < DAY_DURATION ? 'day' : 'night';
    const transition = nextPhase !== this.phase;
    if (transition) {
      this.phase = nextPhase;
      if (nextPhase === 'night') {
        this.threat++;
        this.spawnTimer = 1_200;
        this.floatLabel(this.player.x, this.player.y - 52, `夜幕降临 · 威胁 ${this.threat}`, '#c8afff');
        this.offerBoons();
      } else {
        this.clearNightRaiders();
        this.playerHp = Math.min(this.playerMaxHp, this.playerHp + 35);
        this.coreHp = Math.min(CORE_HP, this.coreHp + 55);
        this.floatLabel(this.player.x, this.player.y - 52, '天亮了 · 核心与守望者获得整备', '#b6e88f');
      }
    }
    const phaseSeconds = nextPhase === 'day' ? cycleSeconds : cycleSeconds - DAY_DURATION;
    const transitionAlpha = Math.min(1, phaseSeconds / 8);
    const alpha = nextPhase === 'night' ? .08 + .28 * transitionAlpha : .36 * Math.max(0, 1 - phaseSeconds / 8);
    this.lightOverlay.setAlpha(alpha);
    const remaining = Math.ceil((nextPhase === 'day' ? DAY_DURATION : CYCLE_DURATION) - cycleSeconds);
    this.phaseText.setText(`${nextPhase === 'day' ? '☀ 白天 · 整备' : '☾ 夜晚 · 守夜'} ${remaining}s`);
  }

  private clearNightRaiders() {
    this.livingEnemies().forEach((enemy) => {
      if (enemy.getData('kind') === 'boss') return;
      (enemy.getData('hpBar') as Phaser.GameObjects.GameObject | undefined)?.destroy();
      enemy.destroy();
    });
  }

  private isDowned() { return this.playerDownUntil > this.time.now; }

  private revivePlayerIfReady() {
    if (this.playerDownUntil === 0 || this.isDowned()) return;
    this.playerDownUntil = 0;
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    this.playerHp = Math.ceil(this.playerMaxHp * .65);
    this.player.setPosition(core.x, core.y + 78).setVelocity(0, 0).setActive(true).setVisible(true).setAlpha(1);
    this.floatLabel(core.x, core.y - 68, '重新加入防守', '#b6e88f');
  }

  private damagePlayer(amount: number) {
    if (this.isDowned() || this.time.now < this.playerInvulnerableUntil) return;
    const mitigation = Math.min(.55, (this.armorGear?.defense ?? 0) * .07);
    const damage = Math.max(1, Math.ceil(amount * (1 - mitigation)));
    this.playerHp = Math.max(0, this.playerHp - damage);
    this.playerInvulnerableUntil = this.time.now + 480;
    this.player.setTint(0xff9a8e);
    this.time.delayedCall(120, () => this.player.clearTint());
    if (this.playerHp > 0) return;
    this.playerDownUntil = this.time.now + 2_800;
    this.player.setVelocity(0, 0).setAlpha(.28);
    this.coreHp = Math.max(0, this.coreHp - 85);
    this.floatLabel(this.player.x, this.player.y - 42, '守望者倒下 · 核心 -85', '#ff9c7a');
    if (this.coreHp <= 0) this.endRun();
  }

  /**
   * The fox is a helper, not a courier: it only fetches airdrops that landed
   * within its leash of the player, so far-out drops stay the player's risk.
   * Airdrops that are close enough outrank fighting, fighting outranks tagging along.
   */
  private updatePet() {
    const petPower = this.boonLevels.get('petPower') ?? 0;
    const petSpeed = 175 + petPower * 22;
    let targetX: number; let targetY: number;

    const drop = this.airdrops.find((entry) =>
      Phaser.Math.Distance.Between(this.player.x, this.player.y, entry.x, entry.y) <= PET_LEASH);
    let prey: Phaser.Physics.Arcade.Sprite | undefined;
    let nearest = 150;
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const distance = Phaser.Math.Distance.Between(this.pet.x, this.pet.y, enemy.x, enemy.y);
      if (distance < nearest) { nearest = distance; prey = enemy; }
    });

    if (drop) { targetX = drop.x; targetY = drop.y; }
    else if (prey) { targetX = prey.x; targetY = prey.y; }
    else { targetX = this.player.x - 46; targetY = this.player.y + 24; }

    const distance = Phaser.Math.Distance.Between(this.pet.x, this.pet.y, targetX, targetY);
    if (distance > 24) {
      const angle = Phaser.Math.Angle.Between(this.pet.x, this.pet.y, targetX, targetY);
      this.pet.setVelocity(Math.cos(angle) * petSpeed, Math.sin(angle) * petSpeed);
    } else this.pet.setVelocity(0, 0);

    if (prey && nearest < 40 && this.time.now >= this.petStrikeAt) {
      this.petStrikeAt = this.time.now + 780;
      this.petBite(prey, petPower);
      const bite = this.add.circle(this.pet.x, this.pet.y, 9, 0xffffff, .5).setDepth(4);
      this.tweens.add({ targets: bite, scale: 1.7, alpha: 0, duration: 180, onComplete: () => bite.destroy() });
    }

    // 震荡吼: a periodic roar that hurts and pushes back everything near the fox.
    if (this.petSkills.includes('shock') && this.time.now >= this.petShockReadyAt) {
      const nearby = this.livingEnemies()
        .filter((enemy) => Phaser.Math.Distance.Between(this.pet.x, this.pet.y, enemy.x, enemy.y) < 105);
      if (nearby.length > 0) {
        this.petShockReadyAt = this.time.now + 6500;
        const pulse = this.add.circle(this.pet.x, this.pet.y, 16, 0xb89aff, .24).setStrokeStyle(2, 0xd6c6ff, .9).setDepth(4);
        this.tweens.add({ targets: pulse, alpha: 0, scale: 5, duration: 360, onComplete: () => pulse.destroy() });
        nearby.forEach((enemy) => {
          const angle = Phaser.Math.Angle.Between(this.pet.x, this.pet.y, enemy.x, enemy.y);
          this.damageEnemy(enemy, 6, 'pet');
          this.knockback(enemy, angle, 26);
        });
      }
    }
    this.pet.setFlipX(targetX < this.pet.x);
  }

  /** Pauses the run and asks the hub overlay for a pick-one-of-three boon. */
  private offerBoons() {
    this.scene.pause();
    const choices = Phaser.Utils.Array.Shuffle([...BOONS]).slice(0, 3);
    this.game.events.emit('defense:boon', choices.map((boon) => boon.id));
    this.game.events.once('defense:boon:picked', (id: BoonId) => {
      this.applyBoon(id);
      if (!this.finished) this.scene.resume();
    });
  }

  private applyBoon(id: BoonId) {
    this.boonLevels.set(id, (this.boonLevels.get(id) ?? 0) + 1);
    if (id === 'coreRepair') {
      this.coreHp = Math.min(CORE_HP, this.coreHp + 250);
      const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
      this.floatLabel(core.x, core.y - 60, '核心 +250', '#7fd4ff');
    }
    const boon = BOONS.find((entry) => entry.id === id)!;
    const count = this.boonLevels.get(id) ?? 1;
    this.floatLabel(this.player.x, this.player.y - 40, `${boon.name} ×${count}`, '#ffe0aa');
    this.updateHud();
  }

  /** Left click: harvest whatever is in reach, then swing the chosen weapon. */
  private attack(x: number, y: number) {
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
    this.harvestNearby();
    if (this.weapon === 'sword') this.swingSword(angle);
    else if (this.weapon === 'spear') this.thrustSpear(angle);
    else this.fireStaffOrb(angle);
  }

  /** Gathering is not a weapon move, so nodes are hit in any direction. */
  private harvestNearby() {
    this.nodes.forEach((node, index) => {
      if (!node.object.active) return;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, node.x, node.y) > ATTACK_RANGE) return;
      node.hp -= 1;
      this.tweens.add({ targets: node.object, scaleX: 1.18, scaleY: .84, duration: 90, yoyo: true });
      if (node.hp <= 0) this.harvest(index);
    });
  }

  /** 单手剑: the fastest swing, a short arc that hits everything in front. */
  private swingSword(angle: number) {
    this.attackReadyAt = this.time.now + 260;
    const range = 70;
    const arc = this.add.arc(this.player.x + Math.cos(angle) * 34, this.player.y + Math.sin(angle) * 34, 30,
      Phaser.Math.RadToDeg(angle - .88), Phaser.Math.RadToDeg(angle + .88), false, 0xffe0aa, .3).setDepth(1.8);
    this.tweens.add({ targets: arc, alpha: 0, scale: 1.3, duration: 140, onComplete: () => arc.destroy() });
    this.livingEnemies().forEach((enemy) => {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const toward = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (distance > range || Math.abs(Phaser.Math.Angle.Wrap(toward - angle)) > .95) return;
      this.damageEnemy(enemy, 5 + this.damageBoon());
      this.knockback(enemy, toward, 12);
    });
  }

  /** 长枪: slow, long, and it pierces everything along the line. */
  private thrustSpear(angle: number) {
    this.attackReadyAt = this.time.now + 560;
    const range = 178;
    const thrust = this.add.line(0, 0, this.player.x, this.player.y,
      this.player.x + Math.cos(angle) * range, this.player.y + Math.sin(angle) * range, 0x94d9ef, .9)
      .setOrigin(0).setLineWidth(7).setDepth(4);
    this.tweens.add({ targets: thrust, alpha: 0, duration: 180, onComplete: () => thrust.destroy() });
    this.livingEnemies().forEach((enemy) => {
      const dx = enemy.x - this.player.x; const dy = enemy.y - this.player.y;
      const forward = dx * Math.cos(angle) + dy * Math.sin(angle);
      const side = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle));
      if (forward < 16 || forward > range || side > 22) return;
      this.damageEnemy(enemy, 9 + this.damageBoon());
      this.knockback(enemy, angle, 18);
    });
  }

  /** 法杖: a travelling orb, the only weapon that reaches across the arena. */
  private fireStaffOrb(angle: number) {
    this.attackReadyAt = this.time.now + 470;
    const range = 430;
    const orb = this.add.circle(this.player.x + Math.cos(angle) * 20, this.player.y + Math.sin(angle) * 20, 9, 0xb89aff)
      .setStrokeStyle(2, 0xe1d7ff).setDepth(4);
    let impacted = false;
    this.tweens.add({
      targets: orb, x: this.player.x + Math.cos(angle) * range, y: this.player.y + Math.sin(angle) * range,
      duration: 460, onUpdate: () => {
        if (impacted || !orb.active) return;
        const target = this.livingEnemies()
          .find((enemy) => Phaser.Math.Distance.Between(orb.x, orb.y, enemy.x, enemy.y) < 24);
        if (!target) return;
        impacted = true;
        this.damageEnemy(target, 8 + this.damageBoon());
        this.knockback(target, angle, 10);
        // Hide the orb now and let onComplete destroy it: removing a tween from
        // inside its own update callback is not safe.
        orb.setActive(false).setVisible(false);
      }, onComplete: () => orb.destroy(),
    });
  }

  private damageBoon() { return (this.boonLevels.get('damage') ?? 0) * 3; }

  /** 1/2/3 swap the weapon mid-run; the choice is remembered for the next run. */
  private handleWeaponKeys() {
    const weapons: WeaponType[] = ['sword', 'spear', 'staff'];
    const pressed = ['ONE', 'TWO', 'THREE'].findIndex((key) => Phaser.Input.Keyboard.JustDown(this.keys[key]));
    if (pressed < 0) return;
    this.setWeapon(weapons[pressed]);
  }

  private setWeapon(weapon: WeaponType) {
    if (this.weapon === weapon) return;
    this.weapon = weapon;
    setSelectedWeapon(weapon);
    this.floatLabel(this.player.x, this.player.y - 34, WEAPON_NAME[weapon], WEAPON_COLOR[weapon]);
    this.updateHud();
  }

  /** Space: a short burst of speed, because the arena is bigger than a wave. */
  private dash() {
    if (this.time.now < this.dashReadyAt) return;
    this.dashReadyAt = this.time.now + 1800;
    this.dashUntil = this.time.now + 170;
    const velocity = this.player.body!.velocity as Phaser.Math.Vector2;
    const move = velocity.lengthSq() > 0 ? velocity.clone().normalize() : new Phaser.Math.Vector2(1, 0);
    this.player.setVelocity(move.x * 620, move.y * 620);
    const trail = this.add.circle(this.player.x, this.player.y, 16, 0x91e1c4, .35).setDepth(2);
    this.tweens.add({ targets: trail, alpha: 0, scale: 2, duration: 240, onComplete: () => trail.destroy() });
  }

  private harvest(index: number) {
    const node = this.nodes[index];
    if (!node.object.active) return;
    const def = NODES[node.kind];
    const yieldBonus = 1 + (this.boonLevels.get('harvest') ?? 0) * .5;
    this.addResource(def.yield, Math.round(def.amount * yieldBonus));
    this.floatLabel(node.x, node.y, `+${def.amount} ${materialName(def.yield)}`, '#b6e88f');
    const ring = this.add.circle(node.x, node.y, def.radius, def.color, .5).setDepth(2.1);
    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
    node.object.destroy();
  }

  private handleBuildKeys() {
    const slots: BuildKind[] = BUILD_ORDER;
    const pressed = ['FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'].findIndex((key) => Phaser.Input.Keyboard.JustDown(this.keys[key]));
    if (pressed >= 0 && slots[pressed]) {
      if (!isBuildUnlocked(slots[pressed])) {
        this.floatLabel(this.player.x, this.player.y - 36, '蓝图尚未解锁', '#ff9c7a'); return;
      }
      this.selectedBuild = slots[pressed];
      this.updateHud();
    }
  }

  private tryBuild(worldX: number, worldY: number) {
    const tileX = Math.floor(worldX / TILE);
    const tileY = Math.floor(worldY / TILE);
    if (!this.world.inBounds(tileX, tileY) || !this.world.isBuildable(tileX, tileY)) {
      this.floatLabel(worldX, worldY, '这里不能建造', '#ff9c7a'); return;
    }
    const spot = this.world.tileCenter(tileX, tileY);
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, spot.x, spot.y) > 150) {
      this.floatLabel(spot.x, spot.y, '太远了', '#8795a8'); return;
    }
    const existing = this.builds.find((build) => build.tileX === tileX && build.tileY === tileY);
    if (existing) {
      this.repairBuild(existing); return;
    }
    if (!isBuildUnlocked(this.selectedBuild)) { this.floatLabel(spot.x, spot.y, '蓝图尚未解锁', '#ff9c7a'); return; }
    const def = BUILDS[this.selectedBuild];
    for (const [id, amount] of Object.entries(def.cost)) {
      if ((this.materials.get(id as MaterialId) ?? 0) < (amount ?? 0)) {
        this.floatLabel(spot.x, spot.y, `${materialName(id as MaterialId)}不足`, '#ff9c7a'); return;
      }
    }
    for (const [id, amount] of Object.entries(def.cost)) this.addResource(id as MaterialId, -(amount ?? 0));

    const object = this.add.rectangle(spot.x, spot.y, TILE - 4, TILE - 4, def.color, .97)
      .setStrokeStyle(2, 0x10151d, .45).setDepth(2.35);
    if (def.blocking) this.structures.add(object);
    this.builds.push({ kind: this.selectedBuild, tileX, tileY, hp: def.hp, level: 1, object, readyAt: 0 });
    this.tweens.add({ targets: object, scaleX: 1.16, scaleY: 1.16, duration: 110, yoyo: true });
    this.updateHud();
  }

  private nearestBuild(maxDistance = 110) {
    return this.builds.reduce<BuildInstance | undefined>((closest, build) => {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, build.object.x, build.object.y);
      if (distance > maxDistance) return closest;
      return !closest || distance < Phaser.Math.Distance.Between(this.player.x, this.player.y, closest.object.x, closest.object.y) ? build : closest;
    }, undefined);
  }

  private repairNearestBuild() {
    const build = this.nearestBuild();
    if (!build) { this.floatLabel(this.player.x, this.player.y - 34, '附近没有工事', '#8795a8'); return; }
    this.repairBuild(build);
  }

  private repairBuild(build: BuildInstance) {
    const def = BUILDS[build.kind];
    const maximum = def.hp * (1 + (build.level - 1) * .45);
    if (build.hp >= maximum) { this.floatLabel(build.object.x, build.object.y - 28, '工事状态完好', '#8795a8'); return; }
    const material: MaterialId = build.kind === 'woodWall' || build.kind === 'arrowTower' || build.kind === 'thornWall' ? 'wood' : 'stone';
    if ((this.materials.get(material) ?? 0) < 2) { this.floatLabel(build.object.x, build.object.y - 28, `${materialName(material)}不足`, '#ff9c7a'); return; }
    this.addResource(material, -2);
    build.hp = Math.min(maximum, build.hp + Math.ceil(maximum * .35));
    this.floatLabel(build.object.x, build.object.y - 28, `维修 +${Math.ceil(maximum * .35)}`, '#b6e88f');
    this.updateHud();
  }

  private upgradeNearestBuild() {
    const build = this.nearestBuild();
    if (!build) { this.floatLabel(this.player.x, this.player.y - 34, '靠近工事后按 F 升级', '#8795a8'); return; }
    if (build.level >= 3) { this.floatLabel(build.object.x, build.object.y - 28, '已是最高等级', '#8795a8'); return; }
    const def = BUILDS[build.kind];
    const factor = build.level;
    for (const [id, amount] of Object.entries(def.cost)) {
      if ((this.materials.get(id as MaterialId) ?? 0) < Math.max(1, Math.ceil((amount ?? 0) * .5 * factor))) {
        this.floatLabel(build.object.x, build.object.y - 28, `${materialName(id as MaterialId)}不足`, '#ff9c7a'); return;
      }
    }
    for (const [id, amount] of Object.entries(def.cost)) this.addResource(id as MaterialId, -Math.max(1, Math.ceil((amount ?? 0) * .5 * factor)));
    build.level++;
    build.hp = def.hp * (1 + (build.level - 1) * .45);
    build.object.setScale(1 + (build.level - 1) * .08).setStrokeStyle(2 + build.level, 0xffe0aa, .65);
    this.floatLabel(build.object.x, build.object.y - 28, `${def.name} 升至 ${build.level} 级`, '#ffe0aa');
    this.updateHud();
  }

  private spawnWave() {
    // Gear keeps pace with the run: every third threat level pays out a piece,
    // alternating between the weapon and the armour slot.
    if (this.threat > 0 && this.threat % 3 === 0 && this.threat !== this.gearThreat) {
      this.gearThreat = this.threat;
      this.grantGear(this.threat % 6 === 0 ? 'armor' : 'weapon');
    }
    const count = 2 + Math.floor(this.threat * .9);
    for (let i = 0; i < count; i++) this.spawnEnemy(i === 0 && this.threat > 0 && this.threat % 3 === 0 ? 'brute' : 'grunt');
    if (this.threat >= 4 && Math.random() < .3) this.spawnEnemy('runner');
    if (this.threat >= 6 && Math.random() < .18) this.spawnEnemy('elite');
  }

  private spawnEnemy(kind: EnemyKind) {
    const def = ENEMIES[kind];
    // Spawn on land the core can be reached from, and far enough out to give the
    // player time to react: a shore across a lake would never reach the fight.
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    const first = this.world.randomLandTile();
    let spot = this.world.tileCenter(first.x, first.y);
    for (let attempt = 0; attempt < 40; attempt++) {
      const tile = this.world.randomLandTile();
      const candidate = this.world.tileCenter(tile.x, tile.y);
      if (Phaser.Math.Distance.Between(candidate.x, candidate.y, core.x, core.y) < 460) continue;
      spot = candidate; break;
    }
    const x = spot.x; const y = spot.y;
    const scale = 1 + this.threat * .06;
    const art = actorTexture(ENEMY_ART[kind]);
    const enemy = this.physics.add.sprite(x, y, art ?? 'enemy').setDepth(2.2);
    // Art sprites are drawn taller than the placeholder circles, so they are scaled
    // back to roughly the silhouette the circle had.
    const baseScale = art ? (def.radius * 2.2) / enemy.height : 1;
    enemy.setScale(baseScale * scale)
      .setTint(art ? 0xffffff : def.color)
      .setData({ kind, hp: Math.round(def.hp * (1 + this.threat * .28)), damage: def.damage, speed: def.speed,
        slowUntil: 0, usesArt: Boolean(art), lastX: x, lastY: y, detourUntil: 0, detourSide: 1 });
    this.actorCircle(enemy, def.radius, Boolean(art));
    enemy.setCollideWorldBounds(true);
    this.enemies.add(enemy);
  }

  /**
   * Wild bosses spawn far from the core and wander: they are an optional hunt
   * that pays out books and gear, never part of the wave pressure.
   */
  private spawnBoss() {
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    const first = this.world.randomLandTile();
    let spot = this.world.tileCenter(first.x, first.y);
    for (let attempt = 0; attempt < 40; attempt++) {
      const tile = this.world.randomLandTile();
      const candidate = this.world.tileCenter(tile.x, tile.y);
      if (Phaser.Math.Distance.Between(candidate.x, candidate.y, core.x, core.y) < 520) continue;
      spot = candidate; break;
    }
    const x = spot.x; const y = spot.y;
    const def = ENEMIES.boss;
    const art = actorTexture('boss');
    const boss = this.physics.add.sprite(x, y, art ?? 'enemy').setDepth(2.2);
    const baseScale = art ? (def.radius * 2.2) / boss.height : 1;
    const hp = Math.round(def.hp * (1 + this.threat * .35));
    boss.setScale(baseScale).setTint(art ? 0xffffff : def.color)
      .setData({ kind: 'boss', hp, maxHp: hp, damage: def.damage, speed: def.speed, slowUntil: 0,
        usesArt: Boolean(art), attackAt: 0, aggro: false, wanderAt: 0, wanderX: x, wanderY: y });
    this.actorCircle(boss, def.radius, Boolean(art));
    boss.setCollideWorldBounds(true);
    // A boss carries its own health bar: it has to be readable across the arena.
    boss.setData('hpBar', this.add.rectangle(x - def.radius, y - def.radius - 16, def.radius * 2, 6, 0xff7ad9)
      .setOrigin(0, .5).setDepth(5));
    this.enemies.add(boss);
    this.floatLabel(x, y - 58, '野外首领出现', '#ff7ad9');
    this.updateHud();
  }

  private updateEnemies(dt: number) {
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      // Bosses keep to themselves: they roam, and only fight what comes close.
      if ((enemy.getData('kind') as EnemyKind) === 'boss') { this.updateBoss(enemy); return; }
      const slowed = (enemy.getData('slowUntil') as number) > this.time.now;
      const speed = (enemy.getData('speed') as number) * (slowed ? .5 : 1);
      // Head for the core. Water and walls are solid, so a body that stops moving
      // picks a side and walks around the obstacle instead of grinding on it.
      let angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, core.x, core.y);
      if ((enemy.getData('detourUntil') as number) > this.time.now) angle += (enemy.getData('detourSide') as number) * .95;
      enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      const moved = Phaser.Math.Distance.Between(enemy.x, enemy.y,
        enemy.getData('lastX') as number, enemy.getData('lastY') as number);
      if (moved < speed * dt / 1000 * .4 && (enemy.getData('detourUntil') as number) <= this.time.now) {
        enemy.setData('detourUntil', this.time.now + 1400);
        enemy.setData('detourSide', Math.random() < .5 ? -1 : 1);
      }
      enemy.setData('lastX', enemy.x);
      enemy.setData('lastY', enemy.y);
      // Actors are drawn facing right, so flip them towards the core they walk at.
      if (enemy.getData('usesArt')) enemy.setFlipX(core.x < enemy.x);

      if (!this.isDowned() && Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) < 34) {
        if (this.time.now >= (enemy.getData('attackAt') as number ?? 0)) {
          enemy.setData('attackAt', this.time.now + 820);
          this.damagePlayer(enemy.getData('damage') as number);
        }
      }

      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, core.x, core.y) < 52) {
        // Armour has no player to cover here, so it shields the core instead:
        // every point of defence cuts 8% of the damage, up to half.
        const mitigation = Math.min(.5, (this.armorGear?.defense ?? 0) * .08);
        const damage = (enemy.getData('damage') as number) * dt / 1000 * (1 - mitigation);
        this.coreHp = Math.max(0, this.coreHp - damage);
        if (this.coreHp <= 0) this.endRun();
      }
    });
  }

  /** Roams until the player walks into its range, then charges them. */
  private updateBoss(boss: Phaser.Physics.Arcade.Sprite) {
    const def = ENEMIES.boss;
    const range = def.aggroRange ?? 240;
    const distance = Phaser.Math.Distance.Between(boss.x, boss.y, this.player.x, this.player.y);
    if (!boss.getData('aggro') && distance < range) {
      boss.setData('aggro', true);
      this.floatLabel(boss.x, boss.y - 58, '首领被惊动', '#ff9c7a');
    } else if (boss.getData('aggro') && distance > range * 2) {
      // Losing interest keeps it a hunt you can walk away from.
      boss.setData('aggro', false);
    }
    const slowed = (boss.getData('slowUntil') as number) > this.time.now;
    const speed = def.speed * (slowed ? .5 : 1);
    if (boss.getData('aggro')) {
      const angle = Phaser.Math.Angle.Between(boss.x, boss.y, this.player.x, this.player.y);
      boss.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      if (boss.getData('usesArt')) boss.setFlipX(this.player.x < boss.x);
      if (distance < def.radius + 26) this.bossStrike(boss);
    } else {
      // Water blocks it too, so wander targets are always tiles of real ground.
      if (this.time.now >= (boss.getData('wanderAt') as number)) {
        boss.setData('wanderAt', this.time.now + 3200);
        const tile = this.world.randomLandTile();
        const target = this.world.tileCenter(tile.x, tile.y);
        boss.setData('wanderX', target.x);
        boss.setData('wanderY', target.y);
      }
      const angle = Phaser.Math.Angle.Between(boss.x, boss.y,
        boss.getData('wanderX') as number, boss.getData('wanderY') as number);
      boss.setVelocity(Math.cos(angle) * speed * .4, Math.sin(angle) * speed * .4);
    }
    const bar = boss.getData('hpBar') as Phaser.GameObjects.Rectangle | undefined;
    if (bar) bar.setPosition(boss.x - def.radius, boss.y - def.radius - 16);
  }

  /** A slam flings the player and stuns for a moment; it never kills outright. */
  private bossStrike(boss: Phaser.Physics.Arcade.Sprite) {
    if (this.time.now < (boss.getData('attackAt') as number)) return;
    boss.setData('attackAt', this.time.now + (ENEMIES.boss.attackCooldown ?? 1600));
    const angle = Phaser.Math.Angle.Between(boss.x, boss.y, this.player.x, this.player.y);
    this.player.setPosition(this.player.x + Math.cos(angle) * 44, this.player.y + Math.sin(angle) * 44);
    this.stunUntil = this.time.now + 800;
    this.damagePlayer(ENEMIES.boss.damage);
    const slam = this.add.circle(this.player.x, this.player.y, 20, 0xff7ad9, .3)
      .setStrokeStyle(2, 0xffb3e8, .9).setDepth(4);
    this.tweens.add({ targets: slam, alpha: 0, scale: 2.4, duration: 300, onComplete: () => slam.destroy() });
    this.floatLabel(this.player.x, this.player.y - 44, '被首领撞飞', '#ff9c7a');
  }

  private enemyHitsStructure(enemy: Phaser.Physics.Arcade.Sprite, object: Phaser.GameObjects.GameObject) {
    const build = this.builds.find((entry) => entry.object === object);
    if (!build || !enemy.active) return;
    // The contact callback fires every frame, so attacks need their own cooldown.
    if (this.time.now < (enemy.getData('attackAt') as number ?? 0)) return;
    enemy.setData('attackAt', this.time.now + 750);
    build.hp -= 12;
    this.tweens.add({ targets: build.object, alpha: .45, duration: 70, yoyo: true });
    if (build.hp > 0) return;
    if (BUILDS[build.kind].blocking) this.structures.remove(build.object, true, true);
    else build.object.destroy();
    this.builds = this.builds.filter((entry) => entry !== build);
  }

  private updateTowers() {
    this.builds.forEach((build) => {
      const def = BUILDS[build.kind];
      if (!def.range || this.time.now < build.readyAt) return;
      const spot = this.world.tileCenter(build.tileX, build.tileY);
      let target: Phaser.Physics.Arcade.Sprite | undefined;
      let nearest = def.range;
      this.enemies.getChildren().forEach((child) => {
        const enemy = child as Phaser.Physics.Arcade.Sprite;
        if (!enemy.active) return;
        const distance = Phaser.Math.Distance.Between(spot.x, spot.y, enemy.x, enemy.y);
        if (distance < nearest) { nearest = distance; target = enemy; }
      });
      if (!target) return;
      const rateBonus = 1 + (this.boonLevels.get('towerRate') ?? 0) * .25;
      build.readyAt = this.time.now + (def.cooldown ?? 800) / rateBonus;
      // Line geometry is absolute, but its origin defaults to the centre of the
      // bounding box, which would shift the whole beam off the tower.
      const shot = this.add.line(0, 0, spot.x, spot.y, target.x, target.y, def.color, .85)
        .setOrigin(0).setLineWidth(3).setDepth(3);
      this.tweens.add({ targets: shot, alpha: 0, duration: 160, onComplete: () => shot.destroy() });
      this.damageEnemy(target, (def.damage ?? 5) + focusBonus(this.attributes) + (build.level - 1) * 4, 'tower');
      if (def.slow) target.setData('slowUntil', this.time.now + 1400);
    });
  }

  /**
   * Player hits carry the gear and attribute bonuses, and the fox mark turns the
   * next player hit into a heavier one. Kills pay experience and can drop a book.
   */
  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, damage: number, source: 'player' | 'pet' | 'tower' = 'player') {
    let actual = damage;
    if (source === 'player') {
      // A drop only boosts the weapon type it was forged for.
      if (this.weaponGear?.weaponType === this.weapon) actual += this.weaponGear.attackBonus;
      // Staff hits scale with focus; every other weapon scales with power.
      actual += this.weapon === 'staff' ? focusBonus(this.attributes) : playerAttackBonus(this.attributes);
      const markedUntil = (enemy.getData('markedUntil') as number | undefined) ?? 0;
      if (markedUntil > this.time.now) { actual += 4; enemy.setData('markedUntil', 0); }
      if (this.time.now < this.autoBuffUntil) actual = Math.ceil(actual * 1.3);
    }
    const hp = (enemy.getData('hp') as number) - actual;
    if (hp > 0) {
      enemy.setData('hp', hp);
      const bar = enemy.getData('hpBar') as Phaser.GameObjects.Rectangle | undefined;
      if (bar) bar.setScale(Math.max(.02, hp / (enemy.getData('maxHp') as number)), 1);
      return;
    }
    (enemy.getData('hpBar') as Phaser.GameObjects.GameObject | undefined)?.destroy();
    this.kills++;
    const kind = enemy.getData('kind') as EnemyKind;
    const xp = ENEMIES[kind].xp;
    const { levelsGained } = grantExperience(xp);
    this.xpEarned += xp;
    this.levelsGained += levelsGained;
    if (levelsGained) this.floatLabel(enemy.x, enemy.y - 34, `升级 Lv.${getCharacterProgress().level} · 属性点 +${levelsGained}`, '#ffe09b');
    // 寻迹嗅觉 raises the odds of finding a skill book.
    if (Math.random() < (this.petSkills.includes('scavenger') ? .05 : .02)) this.findSkillBook(enemy.x, enemy.y);
    this.addResource('stone', Math.random() < .35 ? 1 : 0);
    // A boss leaves a chest behind instead of paying out on the spot.
    if (kind === 'boss') {
      this.spawnBossLoot(enemy.x, enemy.y);
      this.floatLabel(enemy.x, enemy.y - 64, '首领已被击倒', '#ff7ad9');
    }
    enemy.destroy();
  }

  private dropAirdrop() {
    // Land away from the core so collecting one always means leaving the base,
    // but on walkable ground: a crate in a lake could never be picked up.
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    const first = this.world.randomLandTile();
    let spot = this.world.tileCenter(first.x, first.y);
    for (let attempt = 0; attempt < 40; attempt++) {
      const tile = this.world.randomLandTile();
      const candidate = this.world.tileCenter(tile.x, tile.y);
      if (Phaser.Math.Distance.Between(candidate.x, candidate.y, core.x, core.y) < 420) continue;
      spot = candidate; break;
    }
    const x = spot.x; const y = spot.y;
    const container = this.add.container(x, y).setDepth(2.6);
    container.add(this.add.circle(0, 0, 26, 0xffd08b, .18).setStrokeStyle(3, 0xffd08b, .9));
    container.add(this.add.rectangle(0, 0, 18, 14, 0xffd08b, .95));
    const marker = this.add.circle(x, y - 120, 8, 0xffd08b, .9).setDepth(7);
    this.tweens.add({ targets: marker, y: y - 140, alpha: .4, duration: 700, yoyo: true, repeat: -1 });
    container.setData('marker', marker);
    this.tweens.add({ targets: container, scaleX: 1.08, scaleY: 1.08, duration: 700, yoyo: true, repeat: -1 });
    this.airdrops.push({ object: container, x, y, remain: AIRDROP_LIFETIME, kind: 'supply' });
    this.floatLabel(x, y - 40, '空投降落', '#ffd08b');
  }

  /** Bosses leave a chest: whatever it holds is only yours once you walk over. */
  private spawnBossLoot(x: number, y: number) {
    const container = this.add.container(x, y).setDepth(2.6);
    container.add(this.add.circle(0, 0, 30, 0xff7ad9, .18).setStrokeStyle(3, 0xff7ad9, .9));
    container.add(this.add.rectangle(0, 0, 22, 18, 0xff7ad9, .95));
    const marker = this.add.circle(x, y - 120, 8, 0xff7ad9, .9).setDepth(7);
    this.tweens.add({ targets: marker, y: y - 140, alpha: .4, duration: 700, yoyo: true, repeat: -1 });
    container.setData('marker', marker);
    this.tweens.add({ targets: container, scaleX: 1.1, scaleY: 1.1, duration: 620, yoyo: true, repeat: -1 });
    this.airdrops.push({ object: container, x, y, remain: BOSS_LOOT_LIFETIME, kind: 'boss' });
  }

  private updateAirdrops(dt: number) {
    // The ring teaches the rule by showing where the fox will fetch on its own.
    this.leashRing.setVisible(this.airdrops.length > 0);
    if (this.airdrops.length > 0) this.leashRing.setPosition(this.player.x, this.player.y);
    this.airdrops = this.airdrops.filter((drop) => {
      drop.remain -= dt / 1000;
      const playerClose = Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.x, drop.y) < 40;
      const petClose = Phaser.Math.Distance.Between(this.pet.x, this.pet.y, drop.x, drop.y) < 34;
      if (playerClose || petClose) {
        this.collectAirdrop(drop, petClose && !playerClose); return false;
      }
      if (drop.remain > 0) return true;
      const marker = drop.object.getData('marker') as Phaser.GameObjects.GameObject | undefined;
      marker?.destroy();
      drop.object.destroy();
      return false;
    });
  }

  private collectAirdrop(drop: Airdrop, byPet = false) {
    const marker = drop.object.getData('marker') as Phaser.GameObjects.GameObject | undefined;
    marker?.destroy();
    drop.object.destroy();
    if (drop.kind === 'boss') this.collectBossLoot(drop, byPet);
    else this.collectSupply(drop, byPet);
    this.updateHud();
  }

  /** A normal airdrop pays materials, scaled by how deep the run is. */
  private collectSupply(drop: Airdrop, byPet: boolean) {
    const loot: MaterialId[] = ['crystal', 'gold', 'iron', 'stone', 'wood'];
    const primary = loot[Math.min(loot.length - 1, 1 + Math.floor(this.threat / 2))];
    this.addResource(primary, 6 + this.threat * 2);
    this.addResource('crystal', 2 + Math.floor(this.threat / 2));
    this.floatLabel(drop.x, drop.y - 30, `空投：${materialName(primary)} ×${6 + this.threat * 2}${byPet ? '（灵狐取回）' : ''}`, '#ffd08b');
  }

  /** Boss loot: a book while any is missing, otherwise epic gear, plus cores. */
  private collectBossLoot(drop: Airdrop, byPet: boolean) {
    const tail = byPet ? '（灵狐取回）' : '';
    const book = randomLockedBook();
    if (book) {
      grantSkillBook(book);
      this.petSkills = getEquippedPetSkills();
      this.floatLabel(drop.x, drop.y - 30, `技能书：${PET_SKILL_BOOKS[book].name}${tail}`, '#d6c6ff');
    } else {
      const item = createGear(Math.random() < .5 ? 'weapon' : 'armor', this.threat + 3, 'epic');
      grantEquipment(item);
      this.weaponGear = getEquippedItem('weapon');
      this.armorGear = getEquippedItem('armor');
      this.floatLabel(drop.x, drop.y - 30, `${item.name}${tail}`, '#ffd08b');
    }
    this.addResource('gold', 8 + this.threat * 2);
    this.addResource('crystal', 4 + this.threat);
    const cores = 3 + Math.floor(this.threat / 2);
    addCoreCount(cores);
    this.floatLabel(drop.x, drop.y - 56, `晶片 +${cores}${tail}`, '#7fd4ff');
  }

  /** Drops a piece of gear mid-run; an empty slot is worn straight away. */
  private grantGear(slot: 'weapon' | 'armor') {
    const item = createGear(slot, this.threat, this.threat >= 6 ? 'rare' : undefined);
    const autoEquipped = grantEquipment(item);
    this.weaponGear = getEquippedItem('weapon');
    this.armorGear = getEquippedItem('armor');
    this.floatLabel(this.player.x, this.player.y - 46,
      autoEquipped ? `获得${item.name} · 已装备` : `获得${item.name}`, '#ffd08b');
  }

  private addResource(id: MaterialId, amount: number) {
    if (!amount) return;
    const next = Math.max(0, (this.materials.get(id) ?? 0) + amount);
    if (next === 0) this.materials.delete(id); else this.materials.set(id, next);
  }

  private floatLabel(x: number, y: number, label: string, color: string) {
    const text = this.add.text(x, y, label, { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '12px', color }).setOrigin(.5).setDepth(6);
    this.tweens.add({ targets: text, y: y - 30, alpha: 0, duration: 620, onComplete: () => text.destroy() });
  }

  private updateHud() {
    const seconds = Math.floor(this.elapsed / 1000);
    const stock = [...this.materials].map(([id, count]) => `${materialName(id)} ${count}`).join('   ') || '暂无材料';
    const heldBoons = [...this.boonLevels].map(([id, count]) => `${BOONS.find((boon) => boon.id === id)!.name}×${count}`).join(' · ');
    const progress = getCharacterProgress();
    const skillCooldown = Math.max(0, Math.ceil((this.activeSkillReadyAt - this.time.now) / 1000));
    const gearBonus = this.weaponGear?.weaponType === this.weapon ? this.weaponGear.attackBonus : 0;
    const mitigation = Math.min(.55, (this.armorGear?.defense ?? 0) * .07);
    const character = `Lv.${progress.level}  力${this.attributes.power} 专${this.attributes.focus} 敏${this.attributes.agility}`
      + `   ${WEAPON_NAME[this.weapon]}${gearBonus ? ` +${gearBonus}` : ''}`
      + `   护甲${mitigation ? ` -${Math.round(mitigation * 100)}%` : ' 无'}`
      + `   Q 风刃${skillCooldown ? ` ${skillCooldown}s` : ' 可用'}   自动 ${AUTO_SKILLS[this.autoSkill].name}`
      + `   灵狐 ${this.petSkills.map((id) => PET_SKILL_BOOKS[id].name).join('/') || '无'}`;
    const boss = this.livingEnemies().find((enemy) => enemy.getData('kind') === 'boss');
    const bossLine = boss ? `\n野外首领 ${Math.ceil((boss.getData('hp') as number) / (boss.getData('maxHp') as number) * 100)}%`
      + `${boss.getData('aggro') ? ' · 交战中' : ' · 游荡中'}` : '';
    const playerState = this.isDowned() ? `倒地 ${Math.ceil((this.playerDownUntil - this.time.now) / 1000)}s` : `${Math.ceil(this.playerHp)}/${this.playerMaxHp}`;
    this.hudText.setText(`存活 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}   威胁 ${this.threat}   击杀 ${this.kills}   核心 ${Math.ceil(this.coreHp)}/${CORE_HP}   守望者 ${playerState}\n${stock}\n${character}${heldBoons ? `\n增益：${heldBoons}` : ''}${bossLine}`);
    const def = BUILDS[this.selectedBuild];
    const cost = Object.entries(def.cost).map(([id, amount]) => `${materialName(id as MaterialId)}×${amount}`).join(' ');
    const lock = isBuildUnlocked(this.selectedBuild) ? '' : ' · 未解锁';
    this.buildText.setText(`建造：${def.name}（${cost}）${lock}   [4]木 [5]石 [6]箭 [7]冰 [8]荆棘 [9]炮塔`);
  }

  private endRun() {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const seconds = Math.floor(this.elapsed / 1000);
    const best = this.recordBest(seconds);
    // Cores are the upgrade currency: a longer run and more kills pay more.
    const cores = 1 + this.threat + Math.floor(this.kills / 8);
    addCoreCount(cores);
    const metaResult = recordRunResult(this.kills, seconds);
    this.scene.pause();
    this.game.events.emit('defense:ended', {
      seconds, threat: this.threat, kills: this.kills, best, cores,
      xp: this.xpEarned, levels: this.levelsGained,
      unlocked: metaResult.unlocked.map((kind) => BUILDS[kind].name), totalKills: metaResult.meta.totalKills,
    });
  }

  /** Reads the camp loadout: gear, attributes, skills and the fox's books. */
  private refreshLoadout() {
    this.weaponGear = getEquippedItem('weapon');
    this.armorGear = getEquippedItem('armor');
    this.weapon = getSelectedWeapon();
    this.attributes = getCharacterProgress().attributes;
    this.swiftStep = hasSwiftStep();
    this.autoSkill = getAutoSkill();
    this.petSkills = getEquippedPetSkills();
    this.activeSkillReadyAt = 0; this.autoSkillReadyAt = 0; this.autoBuffUntil = 0;
    this.petBites = 0; this.petShockReadyAt = 0; this.petRescueReadyAt = 0;
    this.xpEarned = 0; this.levelsGained = 0;
  }

  private livingEnemies() {
    return this.enemies.getChildren()
      .filter((child) => (child as Phaser.Physics.Arcade.Sprite).active) as Phaser.Physics.Arcade.Sprite[];
  }

  private isStunned() { return this.time.now < this.stunUntil; }

  /** Q · 风刃: the attack skill, a short burst around the player. */
  private castActiveSkill() {
    if (this.time.now < this.activeSkillReadyAt) return;
    this.activeSkillReadyAt = this.time.now + 5200;
    const radius = 105;
    const slash = this.add.circle(this.player.x, this.player.y, 18, 0x91e1c4, .2).setStrokeStyle(3, 0xb8ffe4, .9).setDepth(4);
    this.tweens.add({ targets: slash, alpha: 0, scale: radius / 18, duration: 300, onComplete: () => slash.destroy() });
    this.livingEnemies().forEach((enemy) => {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) > radius) return;
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      this.damageEnemy(enemy, 6);
      this.knockback(enemy, angle, 22);
    });
  }

  /** Auto skills fire on their own: a single target bolt, an attack buff, or a burst. */
  private updateAutomaticSkill() {
    const living = this.livingEnemies();
    if (!living.length || this.time.now < this.autoSkillReadyAt) return;
    const nearest = [...living].sort((a, b) =>
      Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y)
      - Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y))[0];
    const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, nearest.x, nearest.y);
    if (this.autoSkill === 'hunter_shot') {
      if (distance > 420) return;
      this.autoSkillReadyAt = this.time.now + 3600;
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, nearest.x, nearest.y);
      const bolt = this.add.circle(this.player.x, this.player.y, 5, 0x8ce4dc).setStrokeStyle(2, 0xd4fff6).setDepth(4);
      this.tweens.add({ targets: bolt, x: nearest.x, y: nearest.y, duration: 230, onComplete: () => {
        if (nearest.active) { this.damageEnemy(nearest, 4); this.knockback(nearest, angle, 14); }
        bolt.destroy();
      } });
    } else if (this.autoSkill === 'battle_focus') {
      if (distance > 220) return;
      this.autoSkillReadyAt = this.time.now + 8500; this.autoBuffUntil = this.time.now + 4300;
      const aura = this.add.circle(this.player.x, this.player.y, 22, 0xffc77d, .18).setStrokeStyle(2, 0xffd996, .9).setDepth(4);
      this.tweens.add({ targets: aura, alpha: 0, scale: 2.6, duration: 460, onComplete: () => aura.destroy() });
      this.floatLabel(this.player.x, this.player.y - 42, '战斗专注', '#ffd996');
    } else {
      const nearby = living.filter((enemy) => Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) < 125);
      if (nearby.length < 2) return;
      this.autoSkillReadyAt = this.time.now + 6500;
      const wave = this.add.circle(this.player.x, this.player.y, 16, 0xff9b79, .2).setStrokeStyle(3, 0xffbc96, .9).setDepth(4);
      this.tweens.add({ targets: wave, alpha: 0, scale: 7, duration: 370, onComplete: () => wave.destroy() });
      nearby.forEach((enemy) => {
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        this.damageEnemy(enemy, 5);
        this.knockback(enemy, angle, 26);
      });
    }
  }

  /** 追猎印记 marks every fourth bite so the player's next hit lands harder. */
  private petBite(enemy: Phaser.Physics.Arcade.Sprite, petPower: number) {
    this.petBites++;
    if (this.petSkills.includes('mark') && this.petBites % 4 === 0) {
      enemy.setData('markedUntil', this.time.now + 4200);
      this.floatLabel(enemy.x, enemy.y - 28, '追猎印记', '#ffd08b');
    }
    this.damageEnemy(enemy, (this.petSkills.includes('ferocity') ? 8 : 4) + petPower * 3, 'pet');
  }

  /** 守护灵息: the player never takes hits here, so the fox mends the core instead. */
  private tryCoreRescue() {
    if (!this.petSkills.includes('breath')) return;
    if (this.coreHp > CORE_HP * .5 || this.time.now < this.petRescueReadyAt) return;
    this.petRescueReadyAt = this.time.now + 12_000;
    const healed = Math.min(CORE_HP, this.coreHp + 80);
    this.floatLabel(this.player.x, this.player.y - 52, `守护灵息 · 核心 +${Math.round(healed - this.coreHp)}`, '#a9e9dc');
    this.coreHp = healed;
  }

  /** A rare drop: the fox learns a new skill book on the spot. */
  private findSkillBook(x: number, y: number) {
    const id = randomLockedBook();
    if (!id) return;
    grantSkillBook(id);
    this.petSkills = getEquippedPetSkills();
    this.floatLabel(x, y - 30, `技能书：${PET_SKILL_BOOKS[id].name}`, '#d6c6ff');
  }

  /** Enemies re-steer every frame, so knockback is a nudge that reads as impact. */
  private knockback(enemy: Phaser.Physics.Arcade.Sprite, angle: number, distance: number) {
    if (!enemy.active) return;
    enemy.setPosition(enemy.x + Math.cos(angle) * distance, enemy.y + Math.sin(angle) * distance);
  }

  private recordBest(seconds: number) {
    try {
      const previous = Number(localStorage.getItem(BEST_KEY)) || 0;
      if (seconds > previous) localStorage.setItem(BEST_KEY, String(seconds));
      return Math.max(previous, seconds);
    } catch { return seconds; }
  }
}
