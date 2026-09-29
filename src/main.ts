import Phaser from 'phaser';
import './style.css';
import { BEST_KEY, DefenseScene } from './game/defense/DefenseScene';
import { BOONS, BoonId } from './game/defense/DefenseConfig';
import { describeMetaProgress, getDefenseMeta } from './game/defense/DefenseMeta';
import { loadTileManifest } from './game/world/WorldTiles';
import {
  describeEquipment, EquipmentItem, EquipmentSlot, getCoreCount, getEquippedItem, getEquipmentState,
  RARITY_NAME, saveEquipmentState, setCoreCount, WeaponType,
} from './game/Equipment';
import {
  ATTRIBUTE_INFO, AUTO_SKILLS, AutoSkillId, CharacterAttributes, getAutoSkill, getCharacterProgress,
  getSelectedWeapon, hasSwiftStep, resetAttributes, setAutoSkill, setSelectedWeapon, spendAttributePoint,
  toggleSwiftStep, xpToNextLevel,
} from './game/Character';
import {
  getEquippedPetSkills, getOwnedPetSkills, MAX_EQUIPPED_SKILLS, PET_SKILL_BOOKS, PetSkillId, togglePetSkill,
} from './game/PetSkills';

const W = 960;
const H = 540;

type DefenseResult = {
  seconds: number; threat: number; kills: number; best: number; cores: number; xp: number; levels: number;
  unlocked?: string[]; totalKills?: number;
};
type CharacterTab = 'overview' | 'skills' | 'equipment';

/** The three weapon types the player can carry into a run. */
const WEAPON_INFO: Record<WeaponType, { name: string; hint: string }> = {
  sword: { name: '单手剑', hint: '扇形近战，出手最快，范围 70' },
  spear: { name: '长枪', hint: '直线突刺并穿透一排敌人，范围 178，出手较慢' },
  staff: { name: '法杖', hint: '远程法球，射程 430，伤害吃专注加成' },
};

let game!: Phaser.Game;
let characterTab: CharacterTab = 'overview';

// The tile manifest is probed before boot so missing art never triggers 404 loads.
function bootGame() {
  game = new Phaser.Game({
    type: Phaser.AUTO, width: W, height: H, parent: 'game', backgroundColor: '#171e28',
    render: { antialias: true, pixelArt: false },
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [DefenseScene],
  });
  // Listeners have to be attached here: the game does not exist while this module
  // is still evaluating, so top level bindings would throw.
  game.events.on('defense:ended', (result: DefenseResult) => showDefenseResult(result));
  game.events.on('defense:boon', (choices: string[]) => showBoonChoice(choices as BoonId[]));
  // The scene parks itself on boot; the loop is parked too so the hidden canvas
  // costs nothing until a run starts.
  game.loop.sleep();
}
void loadTileManifest().then(bootGame);

const menuScreen = document.querySelector<HTMLElement>('#menu-screen')!;
const gameScreen = document.querySelector<HTMLElement>('#game-screen')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const resultTitle = document.querySelector<HTMLElement>('#result-title')!;
const resultText = document.querySelector<HTMLElement>('#result-text')!;
const routeOptions = document.querySelector<HTMLElement>('#route-options')!;
const againButton = document.querySelector<HTMLButtonElement>('#continue')!;
const backButton = document.querySelector<HTMLButtonElement>('#return-hub')!;
const loadoutSummary = document.querySelector<HTMLElement>('#loadout-summary')!;
const characterPage = document.querySelector<HTMLElement>('#character-page')!;
const characterSummary = document.querySelector<HTMLElement>('#character-summary')!;
const characterContent = document.querySelector<HTMLElement>('#character-content')!;
const petPage = document.querySelector<HTMLElement>('#pet-page')!;
const petSkillList = document.querySelector<HTMLElement>('#pet-skill-list')!;
const petPageHint = document.querySelector<HTMLElement>('#pet-page-hint')!;

function clock(totalSeconds: number) {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

function startDefense() {
  menuScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  overlay.classList.add('hidden');
  // The scale listeners and the loop are parked while the canvas is hidden, so the
  // ScaleManager never measures a zero-sized parent and loops on resize.
  game.scale.startListeners(); game.scale.refresh(); game.loop.wake();
  // Tells the scene this boot is a real run, not the automatic first one.
  game.registry.set('defense:running', true);
  // Stopping first guarantees a fresh arena even when a run was already parked.
  game.scene.stop('defense');
  game.scene.start('defense');
}

function backToMenu() {
  game.scene.stop('defense');
  game.scale.stopListeners();
  gameScreen.classList.add('hidden'); menuScreen.classList.remove('hidden');
  game.loop.sleep();
  refreshMenu();
}

function showDefenseResult(result: DefenseResult) {
  routeOptions.replaceChildren(); routeOptions.classList.add('hidden');
  resultTitle.textContent = '核心被摧毁';
  const levelUp = result.levels ? `　升级 ×${result.levels}` : '';
  const unlocked = result.unlocked?.length ? `　解锁：${result.unlocked.join('、')}` : '';
  resultText.textContent = `存活 ${clock(result.seconds)}　威胁 ${result.threat}　击杀 ${result.kills}`
    + `　晶片 +${result.cores}　经验 +${result.xp}${levelUp}　最佳 ${clock(result.best)}${unlocked}`;
  againButton.classList.remove('hidden');
  againButton.textContent = '再来一局';
  againButton.onclick = () => { overlay.classList.add('hidden'); game.scene.stop('defense'); game.scene.start('defense'); };
  backButton.textContent = '返回营地';
  backButton.onclick = () => { overlay.classList.add('hidden'); backToMenu(); };
  overlay.classList.remove('hidden');
}

function showBoonChoice(choices: BoonId[]) {
  resultTitle.textContent = '威胁升级 · 选择一项增益';
  resultText.textContent = '选完后继续防守。同类增益可以重复叠加。';
  againButton.classList.add('hidden');
  backButton.classList.add('hidden');
  routeOptions.replaceChildren();
  routeOptions.classList.remove('hidden');
  choices.forEach((id) => {
    const boon = BOONS.find((entry) => entry.id === id)!;
    const button = document.createElement('button');
    button.textContent = `${boon.name} — ${boon.description}`;
    button.onclick = () => {
      overlay.classList.add('hidden');
      game.events.emit('defense:boon:picked', id);
    };
    routeOptions.append(button);
  });
  overlay.classList.remove('hidden');
}

function refreshMenu(message?: string) {
  const best = loadBest();
  const summary = document.querySelector<HTMLElement>('#best-score')!;
  const meta = getDefenseMeta();
  summary.textContent = `${best ? `最佳存活 ${clock(best)} · ` : ''}${describeMetaProgress(meta)}`;
  renderLoadout(message);
}

/** Camp summary: level, gear and the currency used to upgrade it. */
function renderLoadout(message?: string) {
  const state = getEquipmentState();
  const progress = getCharacterProgress();
  const weapon = state.items.find((item) => item.id === state.equipped.weapon);
  const armor = state.items.find((item) => item.id === state.equipped.armor);
  const skills = getEquippedPetSkills().map((id) => PET_SKILL_BOOKS[id].name).join(' / ') || '无';
  loadoutSummary.replaceChildren();
  const rows: [string, string][] = [
    ['等级', `Lv.${progress.level} · ${progress.xp}/${xpToNextLevel(progress.level)} XP · 属性点 ${progress.statPoints}`],
    ['武器类型', `${WEAPON_INFO[getSelectedWeapon()].name}`
      + ` · ${weapon?.weaponType === getSelectedWeapon() ? `加成 +${weapon.attackBonus}` : '当前装备类型不匹配'}`],
    ['武器', weapon ? `${RARITY_NAME[weapon.rarity]} · ${weapon.name} · ${weapon.description}` : '未装备'],
    ['护甲', armor ? `${RARITY_NAME[armor.rarity]} · ${armor.name} · ${armor.description}` : '未装备'],
    ['灵狐', skills],
    ['晶片', `${getCoreCount()} 枚`],
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'loadout-row';
    const name = document.createElement('span');
    name.className = 'loadout-label';
    name.textContent = label;
    const text = document.createElement('span');
    text.className = 'muted';
    text.textContent = value;
    row.append(name, text);
    loadoutSummary.append(row);
  });
  if (message) {
    const note = document.createElement('div');
    note.className = 'loadout-note';
    note.textContent = message;
    loadoutSummary.append(note);
  }
}

/** Shared gear list: used by the equipment tab of the character page. */
function renderGear(container: HTMLElement, message?: string) {
  const state = getEquipmentState();
  const cores = getCoreCount();
  container.replaceChildren();
  container.className = 'gear-panel';

  const header = document.createElement('div');
  header.className = 'gear-header';
  header.innerHTML = `<span class="eyebrow">LOADOUT · 晶片 ${cores}</span><span class="muted">${message ?? '每 3 级威胁掉落一件装备，结算按击杀给晶片'}</span>`;
  container.append(header);

  (['weapon', 'armor'] as EquipmentSlot[]).forEach((slot) => {
    const item = state.items.find((entry) => entry.id === state.equipped[slot]);
    const row = document.createElement('div');
    row.className = 'gear-row';
    const label = document.createElement('span');
    label.className = 'gear-slot';
    label.textContent = slot === 'weapon' ? '武器' : '护甲';
    const name = document.createElement('span');
    name.className = 'gear-name';
    name.textContent = item ? `${RARITY_NAME[item.rarity]} · ${item.name}` : '未装备';
    const desc = document.createElement('span');
    desc.className = 'muted';
    desc.textContent = item ? item.description : '空槽位，下一件掉落会自动穿上';
    row.append(label, name, desc);
    if (item) {
      const upgrade = document.createElement('button');
      upgrade.className = 'gear-button';
      const cost = item.upgradeLevel + 1;
      upgrade.textContent = item.upgradeLevel >= 5 ? '已满级 +5' : `强化 +${cost}`;
      upgrade.disabled = item.upgradeLevel >= 5 || cores < cost;
      upgrade.title = item.upgradeLevel >= 5 ? '已经强化到上限' : `消耗 ${cost} 枚晶片`;
      upgrade.onclick = () => upgradeItem(item);
      row.append(upgrade);
    }
    container.append(row);
  });

  const bag = document.createElement('div');
  bag.className = 'gear-bag';
  if (state.items.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = '背包空空，打完几波就有掉落。';
    bag.append(empty);
  }
  state.items.forEach((item) => {
    const equipped = state.equipped[item.slot] === item.id;
    const button = document.createElement('button');
    button.className = `gear-chip${equipped ? ' selected' : ''}`;
    button.textContent = `${equipped ? '✓ ' : ''}${RARITY_NAME[item.rarity]} · ${item.name} · ${item.description}`;
    button.onclick = () => equipped ? unequip(item.slot) : equip(item.id);
    bag.append(button);
  });
  container.append(bag);
}

function equip(id: string) {
  const state = getEquipmentState();
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  state.equipped[item.slot] = item.id;
  saveEquipmentState(state);
  afterGearChange(`已装备「${item.name}」：${item.description}。`);
}

function unequip(slot: EquipmentSlot) {
  const state = getEquipmentState();
  state.equipped[slot] = null;
  saveEquipmentState(state);
  afterGearChange(slot === 'weapon' ? '武器已卸下。' : '护甲已卸下。');
}

function upgradeItem(item: EquipmentItem) {
  const state = getEquipmentState();
  const target = state.items.find((entry) => entry.id === item.id);
  if (!target || state.equipped[target.slot] !== target.id) return;
  const cost = target.upgradeLevel + 1;
  const cores = getCoreCount();
  if (target.upgradeLevel >= 5 || cores < cost) return;
  setCoreCount(cores - cost);
  target.upgradeLevel++;
  if (target.slot === 'weapon') target.attackBonus++; else target.defense++;
  target.description = describeEquipment(target);
  saveEquipmentState(state);
  afterGearChange(`强化成功：${target.name}达到 +${target.upgradeLevel}，${target.description}。`);
}

/** Gear edits are visible in the camp summary and, when open, the equipment tab. */
function afterGearChange(message: string) {
  refreshMenu(message);
  if (!characterPage.classList.contains('hidden')) renderCharacterPage(message);
}

function openCharacterPage(tab: CharacterTab = 'overview') {
  characterTab = tab;
  renderCharacterPage();
  characterPage.classList.remove('hidden');
}

function renderCharacterPage(message?: string) {
  const progress = getCharacterProgress();
  const needed = xpToNextLevel(progress.level);
  const attrs = progress.attributes;
  characterSummary.innerHTML = `<div class="profile-level"><strong>Lv. ${progress.level}</strong>`
    + `<span>${progress.xp} / ${needed} XP</span></div>`
    + `<div class="profile-xp"><i style="width:${Math.min(100, progress.xp / needed * 100)}%"></i></div>`
    + `<div class="profile-statline"><span>未分配属性点 <b>${progress.statPoints}</b></span>`
    + `<span>力量 <b>${attrs.power}</b></span><span>专注 <b>${attrs.focus}</b></span><span>敏捷 <b>${attrs.agility}</b></span></div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-character-tab]').forEach((button) =>
    button.classList.toggle('active', button.dataset.characterTab === characterTab));
  characterContent.replaceChildren();
  if (characterTab === 'overview') renderProfileOverview(message);
  else if (characterTab === 'skills') renderProfileSkills(message);
  else renderProfileEquipment(message);
}

/** Attributes, what they do, and the points that are still unspent. */
function renderProfileOverview(message?: string) {
  const progress = getCharacterProgress();
  const attrs = progress.attributes;
  const spent = attrs.power + attrs.focus + attrs.agility;
  const section = document.createElement('div');
  section.className = 'profile-section';

  const preview = document.createElement('div');
  preview.className = 'character-preview';
  preview.innerHTML = '<img src="/tiles/actor/player.png" alt="角色形象" />'
    + '<div><span class="eyebrow">CHARACTER</span><strong>边境守望者</strong>'
    + `<small>Lv.${progress.level} · 属性点 ${progress.statPoints}</small></div>`;
  section.append(preview);

  const heading = document.createElement('h3');
  heading.textContent = '战斗属性';
  const reset = document.createElement('button');
  reset.className = 'gear-button';
  reset.textContent = `重置属性 · 返还 ${spent} 点`;
  reset.disabled = spent === 0;
  reset.dataset.characterAction = 'reset-attributes';
  section.append(heading, reset);

  (Object.keys(ATTRIBUTE_INFO) as (keyof CharacterAttributes)[]).forEach((id) => {
    const info = ATTRIBUTE_INFO[id];
    const card = document.createElement('article');
    card.className = 'attribute-card';
    const title = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = info.name;
    const value = document.createElement('b');
    value.textContent = String(attrs[id]);
    title.append(name, value);
    const hint = document.createElement('small');
    hint.textContent = info.hint;
    const button = document.createElement('button');
    button.dataset.characterAction = `attribute:${id}`;
    button.textContent = '分配 1 点';
    button.disabled = progress.statPoints < 1;
    card.append(title, hint, button);
    section.append(card);
  });

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = message ?? '击杀敌人获得经验，升级会得到属性点。力量提升剑与枪的伤害，专注提升法杖与防御塔的伤害，敏捷提升移动速度。';
  section.append(note);
  characterContent.append(section);

  // Weapon type: gear only adds its bonus to the type it was forged for.
  const weaponSection = document.createElement('div');
  weaponSection.className = 'profile-section';
  const weaponHeading = document.createElement('h3');
  weaponHeading.textContent = '武器类型';
  weaponSection.append(weaponHeading);
  const selectedWeapon = getSelectedWeapon();
  const gear = getEquippedItem('weapon');
  (['sword', 'spear', 'staff'] as WeaponType[]).forEach((type) => {
    const info = WEAPON_INFO[type];
    const matches = gear?.weaponType === type;
    const row = document.createElement('article');
    row.className = `profile-row${selectedWeapon === type ? ' selected' : ''}`;
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = matches ? `${info.name} · 装备加成 +${gear!.attackBonus}` : `${info.name} · 当前装备不匹配`;
    const hint = document.createElement('small');
    hint.textContent = info.hint;
    text.append(name, hint);
    const button = document.createElement('button');
    button.dataset.characterAction = `weapon:${type}`;
    button.textContent = selectedWeapon === type ? '使用中' : '选择';
    row.append(text, button);
    weaponSection.append(row);
  });
  characterContent.append(weaponSection);
}

/** Active (Q), passive, and the one auto skill that fires on its own. */
function renderProfileSkills(message?: string) {
  const passiveOn = hasSwiftStep();
  const selected = getAutoSkill();
  const wrap = document.createElement('div');

  const active = document.createElement('div');
  active.className = 'profile-section';
  active.innerHTML = '<span class="eyebrow">ACTIVE SKILL</span><h3>主动技能</h3>'
    + '<article class="profile-row"><div><strong>Q · 风刃</strong>'
    + '<small>按 Q 释放，对周围敌人造成范围伤害，冷却约 5 秒。</small></div>'
    + '<span class="skill-state">已学会</span></article>';
  wrap.append(active);

  const passiveSection = document.createElement('div');
  passiveSection.className = 'profile-section';
  passiveSection.innerHTML = '<span class="eyebrow">PASSIVE SKILL</span><h3>被动技能</h3>'
    + '<article class="profile-row"><div><strong>迅捷步伐</strong><small>移动速度提高 12%。</small></div></article>';
  const passiveRow = passiveSection.querySelector('article')!;
  const passiveButton = document.createElement('button');
  passiveButton.dataset.characterAction = 'passive';
  passiveButton.textContent = passiveOn ? '已装备 · 点击卸下' : '点击装备';
  passiveRow.append(passiveButton);
  wrap.append(passiveSection);

  const autoSection = document.createElement('div');
  autoSection.className = 'profile-section';
  autoSection.innerHTML = '<span class="eyebrow">AUTO SKILL</span><h3>自动技能 · 选择一种</h3>';
  (Object.keys(AUTO_SKILLS) as AutoSkillId[]).forEach((id) => {
    const info = AUTO_SKILLS[id];
    const row = document.createElement('article');
    row.className = 'profile-row';
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = info.name;
    const desc = document.createElement('small');
    desc.textContent = info.description;
    text.append(name, desc);
    const button = document.createElement('button');
    button.dataset.characterAction = `auto:${id}`;
    button.textContent = selected === id ? '当前技能' : '设为自动';
    row.append(text, button);
    autoSection.append(row);
  });
  wrap.append(autoSection);

  if (message) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = message;
    wrap.append(note);
  }
  characterContent.append(wrap);
}

/** The bag itself: worn gear, spare gear, and upgrades paid for in cores. */
function renderProfileEquipment(message?: string) {
  const panel = document.createElement('div');
  renderGear(panel, message);
  characterContent.append(panel);
}

function openPetPage() {
  renderPetSkills();
  petPage.classList.remove('hidden');
}

function renderPetSkills(message?: string) {
  const owned = getOwnedPetSkills();
  const equipped = getEquippedPetSkills();
  petPageHint.textContent = message ?? `已装备 ${equipped.length} / ${MAX_EQUIPPED_SKILLS} 种技能。`
    + '技能书在防守中掉落，捡到后永久收录。';
  petSkillList.replaceChildren();
  (Object.keys(PET_SKILL_BOOKS) as PetSkillId[]).forEach((id) => {
    const info = PET_SKILL_BOOKS[id];
    const isOwned = owned.includes(id);
    const isEquipped = equipped.includes(id);
    const row = document.createElement('article');
    row.className = `profile-row${isEquipped ? ' selected' : ''}`;
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = `${isOwned ? (isEquipped ? '✓ ' : '＋ ') : '🔒 '}${info.name}`;
    const desc = document.createElement('small');
    desc.textContent = info.description;
    text.append(name, desc);
    const button = document.createElement('button');
    button.dataset.petSkill = id;
    button.textContent = isOwned ? (isEquipped ? '卸下' : '装备') : '未解锁';
    button.disabled = !isOwned;
    row.append(text, button);
    petSkillList.append(row);
  });
}

// The expedition mode is gone, so its saves are dropped instead of left behind.
// Character and pet keys are still in use and must survive.
const RETIRED_KEYS = [
  'border-expedition-progress', 'border-expedition-dungeon', 'border-exploration-world-v2',
  'border-expedition-materials',
];
function retireOldSaves() {
  try { RETIRED_KEYS.forEach((key) => localStorage.removeItem(key)); } catch { /* Storage may be unavailable. */ }
}

document.querySelector<HTMLButtonElement>('#start-defense')!.addEventListener('click', startDefense);
document.querySelector<HTMLButtonElement>('#leave-run')!.addEventListener('click', () => {
  game.scene.stop('defense');
  backToMenu();
});
document.querySelector<HTMLButtonElement>('#open-character-page')!.addEventListener('click', () => openCharacterPage());
document.querySelector<HTMLButtonElement>('#close-character-page')!.addEventListener('click', () => characterPage.classList.add('hidden'));
document.querySelector<HTMLButtonElement>('#open-pet-page')!.addEventListener('click', () => openPetPage());
document.querySelector<HTMLButtonElement>('#close-pet-page')!.addEventListener('click', () => petPage.classList.add('hidden'));

document.querySelectorAll<HTMLButtonElement>('[data-character-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    characterTab = button.dataset.characterTab as CharacterTab;
    renderCharacterPage();
  });
});

characterContent.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-character-action]');
  if (!button) return;
  const action = button.dataset.characterAction!;
  if (action.startsWith('attribute:')) {
    const attribute = action.slice('attribute:'.length) as keyof CharacterAttributes;
    if (!spendAttributePoint(attribute)) {
      renderCharacterPage('没有可分配的属性点，升级后会获得。'); return;
    }
    renderCharacterPage(`${ATTRIBUTE_INFO[attribute].name}提升至 ${getCharacterProgress().attributes[attribute]}。`);
  } else if (action === 'reset-attributes') {
    const returned = resetAttributes();
    renderCharacterPage(returned ? `已重置属性，返还 ${returned} 点。` : '还没有分配过属性点。');
  } else if (action === 'passive') {
    const next = toggleSwiftStep();
    renderCharacterPage(next ? '迅捷步伐已装备，移动速度 +12%。' : '迅捷步伐已卸下。');
  } else if (action.startsWith('auto:')) {
    const id = action.slice('auto:'.length) as AutoSkillId;
    setAutoSkill(id);
    renderCharacterPage(`${AUTO_SKILLS[id].name}已设为自动技能：${AUTO_SKILLS[id].description}`);
  } else if (action.startsWith('weapon:')) {
    const weapon = action.slice('weapon:'.length) as WeaponType;
    setSelectedWeapon(weapon);
    renderCharacterPage(`${WEAPON_INFO[weapon].name}已选用：${WEAPON_INFO[weapon].hint}。`);
    refreshMenu();
  }
});

petSkillList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pet-skill]');
  if (!button) return;
  renderPetSkills(togglePetSkill(button.dataset.petSkill as PetSkillId));
});

retireOldSaves();
refreshMenu();
