import { BUILD_ORDER, BUILD_UNLOCK, BuildKind, PET_LEVEL_KILLS, PET_MAX_LEVEL } from './DefenseConfig';

const META_KEY = 'defense-meta-v1';

/** Progress that survives between runs: the persistent half of the roguelite loop. */
export type DefenseMeta = { totalKills: number; runs: number; bestSeconds: number };

export function getDefenseMeta(): DefenseMeta {
  try {
    const value = JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as Partial<DefenseMeta> | null;
    if (value && typeof value === 'object') {
      return {
        totalKills: Math.max(0, Math.floor(Number(value.totalKills) || 0)),
        runs: Math.max(0, Math.floor(Number(value.runs) || 0)),
        bestSeconds: Math.max(0, Math.floor(Number(value.bestSeconds) || 0)),
      };
    }
  } catch { /* Fresh accounts start from zero when storage is unavailable. */ }
  return { totalKills: 0, runs: 0, bestSeconds: 0 };
}

function saveMeta(meta: DefenseMeta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* This visit keeps its progress in memory. */ }
}

export function isBuildUnlocked(kind: BuildKind, meta = getDefenseMeta()) {
  const requirement = BUILD_UNLOCK[kind];
  return requirement === undefined || meta.totalKills >= requirement;
}

export function unlockedBuilds(meta = getDefenseMeta()) {
  return BUILD_ORDER.filter((kind) => isBuildUnlocked(kind, meta));
}

export function petLevel(meta = getDefenseMeta()) {
  return Math.min(PET_MAX_LEVEL, 1 + Math.floor(meta.totalKills / PET_LEVEL_KILLS));
}

/**
 * Closes out a run: banks kills, bumps the run count and records the best time.
 * Returns the blueprints this very run unlocked, so the result screen can brag.
 */
export function recordRunResult(kills: number, seconds: number): { meta: DefenseMeta; unlocked: BuildKind[] } {
  const before = getDefenseMeta();
  const meta: DefenseMeta = {
    totalKills: before.totalKills + kills,
    runs: before.runs + 1,
    bestSeconds: Math.max(before.bestSeconds, seconds),
  };
  saveMeta(meta);
  const unlocked = BUILD_ORDER.filter((kind) => {
    const requirement = BUILD_UNLOCK[kind];
    return requirement !== undefined && before.totalKills < requirement && meta.totalKills >= requirement;
  });
  return { meta, unlocked };
}

/** Human readable progress line for the hub and the result screen. */
export function describeMetaProgress(meta = getDefenseMeta()) {
  const next = BUILD_ORDER.find((kind) => !isBuildUnlocked(kind, meta));
  if (!next) return `灵狐 Lv.${petLevel(meta)} · 全部蓝图已解锁 · 累计击杀 ${meta.totalKills}`;
  const requirement = BUILD_UNLOCK[next]!;
  return `灵狐 Lv.${petLevel(meta)} · 累计击杀 ${meta.totalKills} · 下一蓝图：${next === 'thornWall' ? '荆棘墙' : '炮塔'} 还差 ${requirement - meta.totalKills} 杀`;
}
