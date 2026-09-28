import Phaser from 'phaser';
import { Poi, PoiKind, WorldMapData, WORLD_HEIGHT } from './WorldMapData';

export const POI_INTERACT_RANGE = 74;
const POI_DISCOVER_RANGE = 340;

type PoiStyle = { label: string; body: number; accent: number };
const POI_STYLE: Record<PoiKind, PoiStyle> = {
  camp: { label: '废弃营地', body: 0x8a6f4a, accent: 0xe0b060 },
  shrine: { label: '石碑', body: 0x8f9bb3, accent: 0xa9e1ff },
  merchant: { label: '流浪商人', body: 0x6f8f7a, accent: 0xffd08b },
  mine: { label: '矿洞入口', body: 0x50483c, accent: 0xc0a060 },
  boss: { label: '守卫巢穴', body: 0x6b3a44, accent: 0xff8a6a },
};

export function poiLabel(kind: PoiKind) { return POI_STYLE[kind].label; }
export function poiColor(kind: PoiKind) { return POI_STYLE[kind].accent; }

/**
 * Landmarks are few enough to keep alive for the whole session instead of being
 * streamed with the chunks, so digging or moving never makes one flicker away.
 */
export class WorldPoiLayer {
  private views = new Map<number, Phaser.GameObjects.Container>();
  private glows: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly data: WorldMapData) {}

  build() {
    this.data.getPois().forEach((poi) => this.createView(poi));
  }

  /** Marks nearby landmarks as discovered and returns the one the player can use. */
  update(playerX: number, playerY: number): Poi | undefined {
    let nearest: Poi | undefined;
    let nearestDistance = POI_INTERACT_RANGE;
    for (const poi of this.data.getPois()) {
      const spot = this.data.surfaceWorld(poi.tileX, poi.tileY);
      const distance = Phaser.Math.Distance.Between(playerX, playerY, spot.x, spot.y);
      if (!poi.discovered && distance < POI_DISCOVER_RANGE) { poi.discovered = true; this.refresh(poi); }
      // Locked dens are still reported so the scene can explain why they are inert.
      if (poi.cleared) continue;
      if (distance < nearestDistance) { nearest = poi; nearestDistance = distance; }
    }
    return nearest;
  }

  markCleared(poi: Poi) {
    poi.cleared = true;
    this.refresh(poi);
  }

  destroy() {
    this.scene.tweens.killTweensOf(this.glows);
    this.views.forEach((view) => view.destroy());
    this.views.clear();
    this.glows = [];
  }

  private createView(poi: Poi) {
    const style = POI_STYLE[poi.kind];
    const spot = this.data.surfaceWorld(poi.tileX, poi.tileY);
    const depth = 2.4 + Phaser.Math.Clamp(spot.y / WORLD_HEIGHT, 0, 1) * .2;
    const view = this.scene.add.container(spot.x, spot.y).setDepth(depth);
    view.add(this.scene.add.ellipse(0, 3, 42, 17, 0x05080b, .38));

    let beaconY = -34;
    if (poi.kind === 'camp') {
      view.add(this.scene.add.triangle(0, -12, -21, 12, 21, 12, 0, -27, style.body));
      view.add(this.scene.add.rectangle(0, -16, 5, 11, 0x6b543a));
      view.add(this.scene.add.rectangle(-14, 3, 13, 10, 0x7a6242).setStrokeStyle(1, 0x4a3a26, .8));
      view.add(this.scene.add.rectangle(13, 4, 9, 8, 0x5d4a32));
    } else if (poi.kind === 'boss') {
      // A spiked den reads as a threat rather than another ruin.
      view.add(this.scene.add.ellipse(0, 4, 54, 21, 0x2a1420, .5));
      view.add(this.scene.add.triangle(0, -16, -23, 12, 23, 12, 0, -36, style.body));
      view.add(this.scene.add.triangle(0, -28, -13, 4, 13, 4, 0, -54, 0x8a4a58));
      view.add(this.scene.add.circle(0, -56, 6, style.accent, .95));
      beaconY = -52;
    } else {
      view.add(this.scene.add.rectangle(0, -16, 15, 34, style.body).setStrokeStyle(1, 0x5c6678, .7));
      view.add(this.scene.add.circle(0, -36, 7, style.accent, .95));
    }

    // A soft beacon makes landmarks readable from a distance.
    const glow = this.scene.add.circle(0, beaconY, 10, style.accent, .22);
    view.add(glow);
    this.glows.push(glow);
    this.scene.tweens.add({ targets: glow, alpha: .55, scale: 1.3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.views.set(poi.id, view);
    this.refresh(poi);
  }

  private refresh(poi: Poi) {
    const view = this.views.get(poi.id);
    if (!view) return;
    if (poi.cleared) { view.setAlpha(.48); return; }
    // Locked dens stay dim until the previous guardian falls.
    view.setAlpha(this.data.isPoiUnlocked(poi) ? 1 : .32);
  }
}
