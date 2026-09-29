// The fox and its skill books are shared kit: books drop during runs, and the
// loadout picked in camp is what the fox actually uses in the field.
const OWNED_KEY = 'border-expedition-pet-skills';
const EQUIPPED_KEY = 'border-expedition-pet-loadout';

export type PetSkillId = 'mark' | 'breath' | 'shock' | 'ferocity' | 'scavenger';

export const PET_SKILL_BOOKS: Record<PetSkillId, { name: string; description: string; default: boolean }> = {
  mark: { name: '追猎印记', description: '每四次扑击标记敌人，玩家的下一次攻击造成额外伤害。', default: true },
  breath: { name: '守护灵息', description: '核心生命低于一半时治疗核心，冷却 12 秒。', default: true },
  shock: { name: '震荡吼', description: '每 6.5 秒对灵狐周围的敌人造成伤害并击退。', default: false },
  ferocity: { name: '猎手本能', description: '灵狐的扑击伤害提高。', default: false },
  scavenger: { name: '寻迹嗅觉', description: '提高宠物技能书的发现概率。', default: false },
};

export const MAX_EQUIPPED_SKILLS = 3;

function load(key: string, fallback: PetSkillId[]): PetSkillId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(parsed)) return parsed.filter((id): id is PetSkillId => id in PET_SKILL_BOOKS);
  } catch { /* Use the prototype defaults when storage is unavailable. */ }
  return fallback;
}

function save(key: string, skills: PetSkillId[]) {
  try { localStorage.setItem(key, JSON.stringify(skills)); } catch { /* The loadout stays for this visit. */ }
}

export function getOwnedPetSkills(): PetSkillId[] {
  const saved = load(OWNED_KEY, []);
  return (Object.keys(PET_SKILL_BOOKS) as PetSkillId[]).filter((id) => PET_SKILL_BOOKS[id].default || saved.includes(id));
}

export function getEquippedPetSkills(): PetSkillId[] {
  return load(EQUIPPED_KEY, ['mark', 'breath'])
    .filter((id) => getOwnedPetSkills().includes(id)).slice(0, MAX_EQUIPPED_SKILLS);
}

/** Records a found skill book; returns false when it was already collected. */
export function grantSkillBook(id: PetSkillId) {
  const owned = getOwnedPetSkills();
  if (owned.includes(id)) return false;
  const stored = load(OWNED_KEY, []).filter((entry) => entry !== id);
  stored.push(id);
  save(OWNED_KEY, stored);
  // A newly found book is worn straight away when there is a free slot.
  const equipped = getEquippedPetSkills();
  if (equipped.length < MAX_EQUIPPED_SKILLS) save(EQUIPPED_KEY, [...equipped, id]);
  return true;
}

/** Equips or removes a book; returns a message describing what happened. */
export function togglePetSkill(id: PetSkillId) {
  if (!getOwnedPetSkills().includes(id)) return `还没有找到「${PET_SKILL_BOOKS[id].name}」技能书。`;
  const equipped = getEquippedPetSkills();
  if (equipped.includes(id)) {
    save(EQUIPPED_KEY, equipped.filter((entry) => entry !== id));
    return `已卸下「${PET_SKILL_BOOKS[id].name}」。`;
  }
  if (equipped.length >= MAX_EQUIPPED_SKILLS) return `灵狐最多同时装备 ${MAX_EQUIPPED_SKILLS} 种技能，先卸下一个。`;
  save(EQUIPPED_KEY, [...equipped, id]);
  return `已装备「${PET_SKILL_BOOKS[id].name}」。`;
}

/** Picks a book the player does not own yet, or undefined when the set is complete. */
export function randomLockedBook(): PetSkillId | undefined {
  const owned = getOwnedPetSkills();
  const locked = (Object.keys(PET_SKILL_BOOKS) as PetSkillId[]).filter((id) => !owned.includes(id));
  return locked.length ? locked[Math.floor(Math.random() * locked.length)] : undefined;
}
