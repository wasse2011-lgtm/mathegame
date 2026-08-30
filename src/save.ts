/**
 * セーブデータ。localStorage は private ブラウズや容量超過で必ず失敗しうるので、
 * 読み書きは全部 try/catch で包み、失敗しても遊べる状態を返す。
 */

export type SkinId = 'cat' | 'dog' | 'robo';

/** 式ごとの習熟度。m=0..5、ms=平均解答時間、miss=誤答回数、seen=出題回数 */
export interface FactStat {
  m: number;
  ms: number;
  miss: number;
  seen: number;
}

export interface Profile {
  name: string;
  skin: SkinId;
  coins: number;
  /** "1-3" → 星の数 (1..3) */
  stars: Record<string, number>;
  /** "7+5" → 習熟度 */
  facts: Record<string, FactStat>;
}

export interface Settings {
  sound: boolean;
  slow: boolean;
  leftHanded: boolean;
}

export interface SaveData {
  v: 1;
  players: Profile[];
  active: number;
  settings: Settings;
}

const KEY = 'tj.save.v1';

function freshProfile(): Profile {
  return { name: '', skin: 'cat', coins: 0, stars: {}, facts: {} };
}

function freshSave(): SaveData {
  return {
    v: 1,
    players: [freshProfile()],
    active: 0,
    settings: { sound: true, slow: false, leftHanded: false },
  };
}

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const base = freshSave();
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.players) || parsed.players.length === 0) {
      return base;
    }
    return {
      v: 1,
      players: parsed.players.map((p) => ({ ...freshProfile(), ...p })),
      active: Math.min(Math.max(parsed.active ?? 0, 0), parsed.players.length - 1),
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return freshSave();
  }
}

export const save: SaveData = read();

let pending = 0;

/** 書き込みはまとめる。ステージ中に毎フレーム保存しないための遅延。 */
export function persist(): void {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch {
      /* 容量超過やプライベートモードでは黙って諦める */
    }
  }, 120);
}

export function profile(): Profile {
  return save.players[save.active];
}

export function resetAll(): void {
  const fresh = freshSave();
  save.players = fresh.players;
  save.active = 0;
  save.settings = fresh.settings;
  persist();
}

/** ステージの星。ベストのみ更新する。 */
export function stageStars(worldId: number, stage: number): number {
  return profile().stars[`${worldId}-${stage}`] ?? 0;
}

export function setStageStars(worldId: number, stage: number, stars: number): void {
  const key = `${worldId}-${stage}`;
  const p = profile();
  if ((p.stars[key] ?? 0) < stars) p.stars[key] = stars;
  persist();
}

export function factStat(key: string): FactStat {
  const p = profile();
  let s = p.facts[key];
  if (!s) {
    s = { m: 0, ms: 0, miss: 0, seen: 0 };
    p.facts[key] = s;
  }
  return s;
}

/** 保存領域を消されにくくする（対応ブラウザのみ。失敗しても無視） */
export function requestPersistentStorage(): void {
  navigator.storage?.persist?.().catch(() => undefined);
}
