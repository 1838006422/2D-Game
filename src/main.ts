import Phaser from 'phaser';
import './style.css';

const W = 960;
const H = 540;
const COLORS = { floor: 0x171e28, grid: 0x202a37, wall: 0x354153, player: 0x91e1c4, pet: 0xa9e9dc, enemy: 0xe77d70, gold: 0xffc77d, ink: 0x10151d };

class CombatScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private pet!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private hp = 100;
  private room = 1;
  private kills = 0;
  private attackTimer = 0;
  private petTimer = 0;
  private dashReady = true;
  private dashTimer = 0;
  private invulnerable = 0;
  private attackHeld = false;
  private playerHpBar!: Phaser.GameObjects.Rectangle;
  private roomText!: Phaser.GameObjects.Text;
  private dashText!: Phaser.GameObjects.Text;
  private walls!: Phaser.Physics.Arcade.StaticGroup;

  constructor() { super('combat'); }

  create() {
    this.createTextures();
    this.drawRoom();
    this.walls = this.physics.add.staticGroup();
    this.addWall(W / 2, 28, W, 56); this.addWall(W / 2, H - 28, W, 56);
    this.addWall(28, H / 2, 56, H); this.addWall(W - 28, H / 2, 56, H);
    this.player = this.physics.add.sprite(W / 2, H / 2, 'player').setDepth(3).setCircle(14).setCollideWorldBounds(true);
    this.pet = this.physics.add.sprite(W / 2 - 36, H / 2 + 22, 'pet').setDepth(3).setCircle(9);
    this.enemies = this.physics.add.group({ runChildUpdate: false });
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.player, this.enemies, (_p, e) => this.touchEnemy(e as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.pet, this.enemies, (_p, e) => this.petHit(e as Phaser.Physics.Arcade.Sprite));
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.on('pointerdown', () => { this.attackHeld = true; });
    this.input.on('pointerup', () => { this.attackHeld = false; });
    this.input.on('gameout', () => { this.attackHeld = false; });
    this.playerHpBar = this.add.rectangle(0, 0, 36, 4, 0x83d7b1).setDepth(5).setOrigin(.5, .5);
    this.roomText = this.add.text(54, 48, '', { fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#aeb9ca', letterSpacing: 1 }).setDepth(8);
    this.dashText = this.add.text(W - 54, 48, '', { fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#ffc77d' }).setOrigin(1, 0).setDepth(8);
    this.spawnWave(); this.updateLabels();
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
    const speed = this.dashTimer > 0 ? 570 : 205;
    this.player.setVelocity(move.x * speed, move.y * speed);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.petTimer = Math.max(0, this.petTimer - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) && this.dashReady) this.dash();
    const pointer = this.input.activePointer;
    if (this.attackHeld && this.attackTimer <= 0) this.attack(pointer.worldX, pointer.worldY);
    this.movePet(); this.moveEnemies(dt);
    this.playerHpBar.setPosition(this.player.x, this.player.y - 23).setScale(Math.max(.05, this.hp / 100), 1);
    this.player.setAlpha(this.invulnerable > 0 && Math.floor(this.invulnerable / 70) % 2 === 0 ? .45 : 1);
    if (!this.dashReady && this.dashTimer <= 0) { this.dashReady = true; this.updateLabels(); }
    if (this.enemies.countActive() === 0 && !this.scene.isPaused()) this.roomCleared();
  }

  private attack(x: number, y: number) {
    this.attackTimer = 260;
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
    const hit = this.add.arc(this.player.x + Math.cos(angle) * 39, this.player.y + Math.sin(angle) * 39, 23, Phaser.Math.RadToDeg(angle - .8), Phaser.Math.RadToDeg(angle + .8), false, COLORS.gold, .28).setDepth(4);
    this.tweens.add({ targets: hit, alpha: 0, scale: 1.35, duration: 120, onComplete: () => hit.destroy() });
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const toward = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y) - angle));
      if (dist < 66 && toward < .9) this.damageEnemy(enemy, 1, angle);
    });
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
        this.tweens.add({ targets: this.pet, x: target.x, y: target.y, duration: 100, yoyo: true, onYoyo: () => this.damageEnemy(target, 1, 0) });
      }
    }
  }

  private moveEnemies(dt: number) {
    this.enemies.getChildren().forEach((obj) => {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      this.physics.moveToObject(enemy, this.player, 46 + this.room * 3);
      const bar = enemy.getData('bar') as Phaser.GameObjects.Rectangle;
      bar.setPosition(enemy.x, enemy.y - 19);
      const hitAt = enemy.getData('hitAt') as number;
      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) < 28 && this.time.now > hitAt) {
        this.damagePlayer(7); enemy.setData('hitAt', this.time.now + 850);
      }
    });
    void dt;
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, damage: number, angle: number) {
    if (!enemy.active) return;
    const hp = (enemy.getData('hp') as number) - damage; enemy.setData('hp', hp);
    const bar = enemy.getData('bar') as Phaser.GameObjects.Rectangle;
    bar.setScale(Math.max(.05, hp / (2 + Math.floor(this.room / 2))), 1);
    enemy.setTint(0xffffff); this.time.delayedCall(75, () => { if (enemy.active) enemy.clearTint(); });
    enemy.setVelocity(Math.cos(angle) * 170, Math.sin(angle) * 170);
    if (hp <= 0) { bar.destroy(); enemy.destroy(); this.kills++; this.updateLabels(); }
  }

  private petHit(_enemy: Phaser.Physics.Arcade.Sprite) { /* contact is handled by the pet's short lunge */ }

  private damagePlayer(damage: number) {
    if (this.invulnerable > 0) return;
    this.hp = Math.max(0, this.hp - damage);
    const fill = document.querySelector<HTMLElement>('#health'); const label = document.querySelector<HTMLElement>('#health-label');
    if (fill) fill.style.width = `${this.hp}%`; if (label) label.textContent = `${this.hp} / 100`;
    this.cameras.main.shake(90, .003);
    if (this.hp <= 0) this.showResult('远征中断', `你抵达了第 ${this.room} 间房，击败了 ${this.kills} 个敌人。`, false);
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
    this.showResult(`第 ${this.room} 间已清理`, '补给已送达。继续深入，敌人会更强。', true);
  }

  private showResult(title: string, body: string, canContinue: boolean) {
    const overlay = document.querySelector('#overlay')!; overlay.classList.remove('hidden');
    document.querySelector('#result-title')!.textContent = title; document.querySelector('#result-text')!.textContent = body;
    const button = document.querySelector<HTMLButtonElement>('#continue')!;
    button.innerHTML = canContinue ? '继续远征 <span>→</span>' : '重新开始 <span>↻</span>';
    button.onclick = () => {
      overlay.classList.add('hidden');
      if (canContinue) { this.room++; this.hp = Math.min(100, this.hp + 18); this.player.setPosition(W / 2, H / 2); this.pet.setPosition(W / 2 - 30, H / 2); this.scene.resume(); this.spawnWave(); }
      else { this.room = 1; this.hp = 100; this.scene.restart(); }
      const fill = document.querySelector<HTMLElement>('#health'); const label = document.querySelector<HTMLElement>('#health-label');
      if (fill) fill.style.width = `${this.hp}%`; if (label) label.textContent = `${this.hp} / 100`;
    };
  }

  private updateLabels() {
    this.roomText.setText(`ROOM ${String(this.room).padStart(2, '0')}     ${this.kills} / ${3 + Math.min(this.room, 3)} ENEMIES`);
    this.dashText.setText(this.dashReady ? 'SPACE  /  DASH READY' : 'DASH RECHARGING');
  }
}

new Phaser.Game({
  type: Phaser.AUTO, width: W, height: H, parent: 'game', backgroundColor: '#171e28',
  render: { antialias: true, pixelArt: false },
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [CombatScene],
});
