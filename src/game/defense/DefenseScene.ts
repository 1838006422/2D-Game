import Phaser from 'phaser';
import { MaterialId, materialName } from '../world/WorldMapData';
import {
  AIRDROP_INTERVAL, AIRDROP_LIFETIME, BASE_SPAWN_INTERVAL, BOONS, BUILDS, BUILD_ORDER, BoonId, BuildKind,
  CORE_CLEAR_RADIUS, CORE_HP, ENEMIES, EnemyKind, MAP_COLUMNS, MAP_HEIGHT, MAP_ROWS, MAP_WIDTH,
  MIN_SPAWN_INTERVAL, NODES, NodeKind, PET_LEASH, THREAT_INTERVAL, TILE,
} from './DefenseConfig';
import { DefenseWorld } from './DefenseWorld';

type BuildInstance = { kind: BuildKind; tileX: number; tileY: number; hp: number; object: Phaser.GameObjects.Rectangle; readyAt: number };
type NodeInstance = { kind: NodeKind; hp: number; object: Phaser.GameObjects.GameObject; x: number; y: number };
type Airdrop = { object: Phaser.GameObjects.Container; x: number; y: number; remain: number };

export const BEST_KEY = 'defense-best-run';
const PLAYER_SPEED = 210;
const ATTACK_COOLDOWN = 300;
const ATTACK_RANGE = 78;

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
  private builds: BuildInstance[] = [];
  private nodes: NodeInstance[] = [];
  private airdrops: Airdrop[] = [];
  private materials = new Map<MaterialId, number>();
  private selectedBuild: BuildKind = 'woodWall';
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private attackHeld = false;
  private attackReadyAt = 0;
  private elapsed = 0;
  private threat = 0;
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

  constructor() { super('defense'); }

  create() {
    this.createTextures();
    this.world = new DefenseWorld(Math.floor(Math.random() * 0x7fffffff));
    this.world.render(this);
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT).setRoundPixels(true);

    this.structures = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.createCore();
    this.createNodes();

    this.player = this.physics.add.sprite(MAP_WIDTH / 2, MAP_HEIGHT / 2 + 90, 'player').setDepth(3)
      .setCircle(14).setCollideWorldBounds(true);
    this.pet = this.physics.add.sprite(MAP_WIDTH / 2 - 50, MAP_HEIGHT / 2 + 90, 'pet').setDepth(3).setCircle(9);
    this.cameras.main.startFollow(this.player, true, .12, .12);

    this.physics.add.collider(this.player, this.structures);
    this.physics.add.collider(this.pet, this.structures);
    this.physics.add.collider(this.enemies, this.structures, (a, b) =>
      this.enemyHitsStructure(a as Phaser.Physics.Arcade.Sprite, b as Phaser.GameObjects.GameObject));

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN') as Record<string, Phaser.Input.Keyboard.Key>;
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
    this.hintText = this.add.text(480, 520, '左键攻击/采集 · 右键建造 · 4-7 切换建筑', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: '11px', color: '#8795a8' }).setOrigin(.5).setDepth(8).setScrollFactor(0);
    this.leashRing = this.add.circle(0, 0, PET_LEASH, 0xffd08b, .04).setStrokeStyle(2, 0xffd08b, .35).setDepth(1.4).setVisible(false);
    this.updateHud();
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
    this.threat = Math.floor(this.elapsed / (THREAT_INTERVAL * 1000));
    if (this.threat > this.lastThreatOffered) { this.lastThreatOffered = this.threat; this.offerBoons(); }

    this.movePlayer();
    if (this.attackHeld && this.time.now >= this.attackReadyAt) {
      this.attackReadyAt = this.time.now + ATTACK_COOLDOWN;
      this.attack();
    }
    this.updateEnemies(dt);
    this.updatePet();
    this.updateTowers();
    this.updateAirdrops(dt);
    this.handleBuildKeys();

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - this.threat * 190);
      this.spawnWave();
    }
    this.airdropTimer -= dt;
    if (this.airdropTimer <= 0) { this.airdropTimer = AIRDROP_INTERVAL * 1000; this.dropAirdrop(); }

    this.coreBar.setScale(Math.max(.02, this.coreHp / CORE_HP), 1);
    this.updateHud();
  }

  private movePlayer() {
    const left = this.keys.A.isDown || this.cursors.left.isDown;
    const right = this.keys.D.isDown || this.cursors.right.isDown;
    const up = this.keys.W.isDown || this.cursors.up.isDown;
    const down = this.keys.S.isDown || this.cursors.down.isDown;
    const move = new Phaser.Math.Vector2(Number(right) - Number(left), Number(down) - Number(up)).normalize();
    this.player.setVelocity(move.x * (PLAYER_SPEED + (this.boonLevels.get('speed') ?? 0) * 20), move.y * (PLAYER_SPEED + (this.boonLevels.get('speed') ?? 0) * 20));
    if (move.x !== 0) this.player.setFlipX(move.x < 0);
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
      this.damageEnemy(prey, 4 + petPower * 3);
      const bite = this.add.circle(this.pet.x, this.pet.y, 9, 0xffffff, .5).setDepth(4);
      this.tweens.add({ targets: bite, scale: 1.7, alpha: 0, duration: 180, onComplete: () => bite.destroy() });
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

  /** One swing hits both enemies and harvestable nodes inside its arc. */
  private attack() {
    const arc = this.add.circle(this.player.x, this.player.y, ATTACK_RANGE * .55, 0xffffff, .16).setDepth(1.8);
    this.tweens.add({ targets: arc, alpha: 0, scale: 1.35, duration: 180, onComplete: () => arc.destroy() });

    this.nodes.forEach((node, index) => {
      if (!node.object.active) return;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, node.x, node.y) > ATTACK_RANGE) return;
      node.hp -= 1;
      this.tweens.add({ targets: node.object, scaleX: 1.18, scaleY: .84, duration: 90, yoyo: true });
      if (node.hp <= 0) this.harvest(index);
    });

    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) > ATTACK_RANGE) return;
      this.damageEnemy(enemy, 7 + (this.boonLevels.get('damage') ?? 0) * 3);
    });
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
    const pressed = ['FOUR', 'FIVE', 'SIX', 'SEVEN'].findIndex((key) => Phaser.Input.Keyboard.JustDown(this.keys[key]));
    if (pressed >= 0 && slots[pressed]) {
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
    if (this.builds.some((build) => build.tileX === tileX && build.tileY === tileY)) {
      this.floatLabel(spot.x, spot.y, '已有建筑', '#8795a8'); return;
    }
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
    this.builds.push({ kind: this.selectedBuild, tileX, tileY, hp: def.hp, object, readyAt: 0 });
    this.tweens.add({ targets: object, scaleX: 1.16, scaleY: 1.16, duration: 110, yoyo: true });
    this.updateHud();
  }

  private spawnWave() {
    const count = 2 + Math.floor(this.threat * .9);
    for (let i = 0; i < count; i++) this.spawnEnemy(i === 0 && this.threat > 0 && this.threat % 3 === 0 ? 'brute' : 'grunt');
    if (this.threat >= 4 && Math.random() < .3) this.spawnEnemy('runner');
    if (this.threat >= 6 && Math.random() < .18) this.spawnEnemy('elite');
  }

  private spawnEnemy(kind: EnemyKind) {
    const def = ENEMIES[kind];
    // Spawn on the rim, far enough from the core to give the player time to react.
    let x = 0; let y = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      const edge = Math.floor(Math.random() * 4);
      const along = Math.random();
      if (edge === 0) { x = along * MAP_WIDTH; y = 24; }
      else if (edge === 1) { x = along * MAP_WIDTH; y = MAP_HEIGHT - 24; }
      else if (edge === 2) { x = 24; y = along * MAP_HEIGHT; }
      else { x = MAP_WIDTH - 24; y = along * MAP_HEIGHT; }
      if (this.world.isBuildable(Math.floor(x / TILE), Math.floor(y / TILE))) break;
    }
    const scale = 1 + this.threat * .06;
    const enemy = this.physics.add.sprite(x, y, 'enemy').setDepth(2.2).setCircle(def.radius)
      .setTint(def.color).setScale(scale)
      .setData({ kind, hp: Math.round(def.hp * (1 + this.threat * .28)), damage: def.damage, speed: def.speed, slowUntil: 0 });
    enemy.setCollideWorldBounds(true);
    this.enemies.add(enemy);
  }

  private updateEnemies(dt: number) {
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    this.enemies.getChildren().forEach((child) => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const slowed = (enemy.getData('slowUntil') as number) > this.time.now;
      const speed = (enemy.getData('speed') as number) * (slowed ? .5 : 1);
      // Head for the core; anything blocking is handled by the collider.
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, core.x, core.y);
      enemy.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, core.x, core.y) < 52) {
        const damage = (enemy.getData('damage') as number) * dt / 1000;
        this.coreHp = Math.max(0, this.coreHp - damage);
        if (this.coreHp <= 0) this.endRun();
      }
    });
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
      const shot = this.add.line(0, 0, spot.x, spot.y, target.x, target.y, def.color, .85).setLineWidth(3).setDepth(3);
      this.tweens.add({ targets: shot, alpha: 0, duration: 160, onComplete: () => shot.destroy() });
      this.damageEnemy(target, def.damage ?? 5);
      if (def.slow) target.setData('slowUntil', this.time.now + 1400);
    });
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, damage: number) {
    const hp = (enemy.getData('hp') as number) - damage;
    if (hp > 0) { enemy.setData('hp', hp); return; }
    this.kills++;
    this.addResource('stone', Math.random() < .35 ? 1 : 0);
    enemy.destroy();
  }

  private dropAirdrop() {
    // Land away from the core so collecting one always means leaving the base.
    let x = 0; let y = 0;
    const core = this.world.tileCenter(this.world.coreTile.x, this.world.coreTile.y);
    for (let attempt = 0; attempt < 40; attempt++) {
      x = 120 + Math.random() * (MAP_WIDTH - 240);
      y = 120 + Math.random() * (MAP_HEIGHT - 240);
      if (Phaser.Math.Distance.Between(x, y, core.x, core.y) > 420) break;
    }
    const container = this.add.container(x, y).setDepth(2.6);
    container.add(this.add.circle(0, 0, 26, 0xffd08b, .18).setStrokeStyle(3, 0xffd08b, .9));
    container.add(this.add.rectangle(0, 0, 18, 14, 0xffd08b, .95));
    const marker = this.add.circle(x, y - 120, 8, 0xffd08b, .9).setDepth(7);
    this.tweens.add({ targets: marker, y: y - 140, alpha: .4, duration: 700, yoyo: true, repeat: -1 });
    container.setData('marker', marker);
    this.tweens.add({ targets: container, scaleX: 1.08, scaleY: 1.08, duration: 700, yoyo: true, repeat: -1 });
    this.airdrops.push({ object: container, x, y, remain: AIRDROP_LIFETIME });
    this.floatLabel(x, y - 40, '空投降落', '#ffd08b');
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
    const loot: MaterialId[] = ['crystal', 'gold', 'iron', 'stone', 'wood'];
    const primary = loot[Math.min(loot.length - 1, 1 + Math.floor(this.threat / 2))];
    this.addResource(primary, 6 + this.threat * 2);
    this.addResource('crystal', 2 + Math.floor(this.threat / 2));
    this.floatLabel(drop.x, drop.y - 30, `空投：${materialName(primary)} ×${6 + this.threat * 2}${byPet ? '（灵狐取回）' : ''}`, '#ffd08b');
    const marker = drop.object.getData('marker') as Phaser.GameObjects.GameObject | undefined;
    marker?.destroy();
    drop.object.destroy();
    this.updateHud();
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
    this.hudText.setText(`存活 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}   威胁 ${this.threat + 1}   击杀 ${this.kills}   核心 ${Math.ceil(this.coreHp)}/${CORE_HP}\n${stock}${heldBoons ? `\n增益：${heldBoons}` : ''}`);
    const def = BUILDS[this.selectedBuild];
    const cost = Object.entries(def.cost).map(([id, amount]) => `${materialName(id as MaterialId)}×${amount}`).join(' ');
    this.buildText.setText(`建造：${def.name}（${cost}）   木墙[4] 石墙[5] 箭塔[6] 冰塔[7]`);
  }

  private endRun() {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const seconds = Math.floor(this.elapsed / 1000);
    const best = this.recordBest(seconds);
    this.scene.pause();
    this.game.events.emit('defense:ended', {
      seconds, threat: this.threat + 1, kills: this.kills, best,
    });
  }

  private recordBest(seconds: number) {
    try {
      const previous = Number(localStorage.getItem(BEST_KEY)) || 0;
      if (seconds > previous) localStorage.setItem(BEST_KEY, String(seconds));
      return Math.max(previous, seconds);
    } catch { return seconds; }
  }
}
