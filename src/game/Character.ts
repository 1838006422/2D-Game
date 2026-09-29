// Character progression is not tied to one mode: defence runs earn the XP, the
// camp spends the points, and the attributes change how a run actually plays.
import { WeaponType } from './Equipment';

const CHARACTER_PROGRESS_KEY = 'border-expedition-character-progress';
const PASSIVE_KEY = 'border-expedition-player-passive';
const AUTO_KEY = 'border-expedition-player-auto';
const WEAPON_KEY = 'border-expedition-weapon';

export type CharacterAttributes = { power: number; focus: number; agility: number };
export type CharacterProgress = { level: number; xp: number; statPoints: number; attributes: CharacterAttributes };
export type AutoSkillId = 'hunter_shot' | 'battle_focus' | 'shockwave';

export const ATTRIBUTE_INFO: Record<keyof CharacterAttributes, { name: string; hint: string }> = {
  power: { name: '力量', hint: '每 2 点让玩家攻击伤害 +1' },
  focus: { name: '专注', hint: '每 2 点让防御塔伤害 +1' },
  agility: { name: '敏捷', hint: '每点让移动速度 +2%，上限 30%' },
};

export const AUTO_SKILLS: Record<AutoSkillId, { name: string; description: string; hint: string }> = {
  hunter_shot: { name: '追击弹', description: '自动攻击最近的敌人，造成单体伤害。', hint: '单体攻击' },
  battle_focus: { name: '战斗专注', description: '附近出现敌人时自动强化攻击，持续 4 秒。', hint: '攻击增益' },
  shockwave: { name: '震荡波', description: '附近至少有两名敌人时自动发动群体攻击。', hint: '群体攻击' },
};

let progressCache: CharacterProgress | null = null;

export function getCharacterProgress(): CharacterProgress {
  if (progressCache) return progressCache;
  try {
    const value = JSON.parse(localStorage.getItem(CHARACTER_PROGRESS_KEY) ?? 'null') as Partial<CharacterProgress> | null;
    if (value && Number.isInteger(value.level) && Number.isInteger(value.xp) && Number.isInteger(value.statPoints) && value.attributes) {
      progressCache = {
        level: Math.max(1, Math.min(99, value.level!)), xp: Math.max(0, value.xp!),
        statPoints: Math.max(0, value.statPoints!),
        attributes: {
          power: Math.max(0, Number(value.attributes.power) || 0),
          focus: Math.max(0, Number(value.attributes.focus) || 0),
          agility: Math.max(0, Number(value.attributes.agility) || 0),
        },
      };
      return progressCache;
    }
  } catch { /* Fall back to a level-one profile when stored data is unusable. */ }
  progressCache = { level: 1, xp: 0, statPoints: 0, attributes: { power: 0, focus: 0, agility: 0 } };
  return progressCache;
}

export function saveCharacterProgress(progress: CharacterProgress) {
  progressCache = progress;
  try { localStorage.setItem(CHARACTER_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Progress stays live for this visit. */ }
}

export function xpToNextLevel(level: number) { return 100 + (level - 1) * 60; }

/** Adds XP and levels up; one attribute point is granted per level. */
export function grantExperience(amount: number) {
  const progress = getCharacterProgress();
  progress.xp += Math.max(0, Math.floor(amount));
  let levelsGained = 0;
  while (progress.level < 99 && progress.xp >= xpToNextLevel(progress.level)) {
    progress.xp -= xpToNextLevel(progress.level);
    progress.level++;
    progress.statPoints++;
    levelsGained++;
  }
  saveCharacterProgress(progress);
  return { progress, levelsGained };
}

export function spendAttributePoint(attribute: keyof CharacterAttributes) {
  const progress = getCharacterProgress();
  if (progress.statPoints < 1 || !(attribute in progress.attributes)) return false;
  progress.statPoints--;
  progress.attributes[attribute]++;
  saveCharacterProgress(progress);
  return true;
}

/** Returns every spent point to the pool; used by the profile reset button. */
export function resetAttributes() {
  const progress = getCharacterProgress();
  const spent = progress.attributes.power + progress.attributes.focus + progress.attributes.agility;
  if (!spent) return 0;
  progress.statPoints += spent;
  progress.attributes = { power: 0, focus: 0, agility: 0 };
  saveCharacterProgress(progress);
  return spent;
}

export function playerAttackBonus(attributes: CharacterAttributes) { return Math.floor(attributes.power / 2); }

/** Focus is the ranged stat: it raises staff hits and tower shots alike. */
export function focusBonus(attributes: CharacterAttributes) { return Math.floor(attributes.focus / 2); }

export function moveSpeedMultiplier(attributes: CharacterAttributes, swiftStep: boolean) {
  return (1 + Math.min(.3, attributes.agility * .02)) * (swiftStep ? 1.12 : 1);
}

export function getAutoSkill(): AutoSkillId {
  try {
    const value = localStorage.getItem(AUTO_KEY);
    if (value && value in AUTO_SKILLS) return value as AutoSkillId;
  } catch { /* Use the default auto skill. */ }
  return 'hunter_shot';
}

export function setAutoSkill(id: AutoSkillId) {
  try { localStorage.setItem(AUTO_KEY, id); } catch { /* The choice stays for this visit. */ }
}

/** Passive "迅捷步伐": a flat 12% movement bonus. */
export function hasSwiftStep(): boolean {
  try { return localStorage.getItem(PASSIVE_KEY) !== 'false'; } catch { return true; }
}

export function toggleSwiftStep() {
  const next = !hasSwiftStep();
  try { localStorage.setItem(PASSIVE_KEY, String(next)); } catch { /* The change stays for this visit. */ }
  return next;
}

/** The weapon the player carries: gear only boosts the weapon type it is made for. */
export function getSelectedWeapon(): WeaponType {
  try {
    const value = localStorage.getItem(WEAPON_KEY);
    if (value === 'sword' || value === 'spear' || value === 'staff') return value;
  } catch { /* Use the default weapon. */ }
  return 'sword';
}

export function setSelectedWeapon(weapon: WeaponType) {
  try { localStorage.setItem(WEAPON_KEY, weapon); } catch { /* The choice stays for this visit. */ }
}
