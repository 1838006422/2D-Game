// Gear carries over between defence runs: a run drops it, the camp spends cores
// to upgrade it, and the next run reads the same bag.
const EQUIPMENT_KEY = 'border-expedition-equipment';
const CORE_KEY = 'border-expedition-cores';

export type EquipmentSlot = 'weapon' | 'armor';
export type GearRarity = 'common' | 'rare' | 'epic';
export type WeaponType = 'sword' | 'spear' | 'staff';
export type EquipmentItem = {
  id: string; name: string; slot: EquipmentSlot; rarity: GearRarity;
  weaponType?: WeaponType; attackBonus: number; defense: number; upgradeLevel: number; description: string;
};
export type EquipmentState = { items: EquipmentItem[]; equipped: { weapon: string | null; armor: string | null } };

export function getEquipmentState(): EquipmentState {
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

export function saveEquipmentState(state: EquipmentState) {
  try { localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(state)); } catch { /* Loot remains usable for this visit. */ }
}

export function getEquippedItem(slot: EquipmentSlot): EquipmentItem | undefined {
  const state = getEquipmentState(); const id = state.equipped[slot];
  return id ? state.items.find((item) => item.id === id) : undefined;
}

/** Adds a freshly dropped item to the bag, wearing it when its slot is empty. */
export function grantEquipment(item: EquipmentItem) {
  const state = getEquipmentState();
  state.items.push(item);
  const autoEquipped = !state.equipped[item.slot];
  if (autoEquipped) state.equipped[item.slot] = item.id;
  saveEquipmentState(state);
  return autoEquipped;
}

export function getCoreCount() {
  try { return Math.max(0, Number(localStorage.getItem(CORE_KEY)) || 0); } catch { return 0; }
}

export function setCoreCount(value: number) {
  try { localStorage.setItem(CORE_KEY, String(Math.max(0, Math.floor(value)))); } catch { /* Spending stays available for this visit. */ }
}

export function addCoreCount(amount: number) {
  if (amount <= 0) return;
  setCoreCount(getCoreCount() + amount);
}

const WEAPON_DROPS: { type: WeaponType; name: string }[] = [
  { type: 'sword', name: '裂锋短剑' }, { type: 'spear', name: '巡猎长枪' }, { type: 'staff', name: '星火法杖' },
];

/** Rolls a new drop; `tier` is the threat level so late waves pay out better gear. */
export function createGear(slot: EquipmentSlot, tier = 0, guaranteed?: 'rare' | 'epic'): EquipmentItem {
  const roll = Math.random();
  const rarity: GearRarity = guaranteed ?? (roll > .94 ? 'epic' : roll > .66 ? 'rare' : 'common');
  const weapon = WEAPON_DROPS[Math.floor(Math.random() * WEAPON_DROPS.length)];
  const attackBonus = slot === 'weapon' ? (rarity === 'epic' ? 3 : rarity === 'rare' ? 2 : 1) + Math.floor(tier / 3) : 0;
  const defense = slot === 'armor' ? (rarity === 'epic' ? 3 : rarity === 'rare' ? 2 : 1) + Math.floor(tier / 4) : 0;
  const item: EquipmentItem = {
    id: `gear-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: slot === 'weapon' ? weapon.name : '边境守卫护甲', slot, rarity,
    weaponType: slot === 'weapon' ? weapon.type : undefined,
    attackBonus, defense, upgradeLevel: 0, description: '',
  };
  item.description = describeEquipment(item);
  return item;
}

export function describeEquipment(item: EquipmentItem) {
  if (item.slot === 'weapon') {
    const weaponName: Record<WeaponType, string> = { sword: '单手剑', spear: '长枪', staff: '法杖' };
    return `攻击伤害 +${item.attackBonus} · ${weaponName[item.weaponType ?? 'sword']}更顺手 · 强化 +${item.upgradeLevel}`;
  }
  return `受到的伤害减少 ${item.defense} · 强化 +${item.upgradeLevel}`;
}

export const RARITY_NAME: Record<GearRarity, string> = { common: '普通', rare: '精良', epic: '稀有' };
export const RARITY_COLOR: Record<GearRarity, number> = { common: 0xc0cad6, rare: 0x79d7ef, epic: 0xffcf75 };
