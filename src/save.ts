/**
 * セーブデータ。localStorage は private ブラウズや容量超過で必ず失敗しうるので、
 * 読み書きは全部 try/catch で包み、失敗しても遊べる状態を返す。
 */

export type SkinId = 'cat' | 'dog' | 'robo' | 'usa' | 'pen' | 'kuma';

/** 式ごとの習熟度。m=0..5、ms=平均解答時間、miss=誤答回数、seen=出題回数 */
export interface FactStat {
  m: number;
  ms: number;
  miss: number;
  seen: number;
}

/** デイリーチャレンジ。date はローカル時間の YYYY-MM-DD */
export interface Daily {
  date: string;
  streak: number;
  done: boolean;
}

/** その日に遊んだ時間（秒）。日付が変わると 0 に戻る */
export interface PlayTime {
  date: string;
  sec: number;
}

export interface Profile {
  name: string;
  skin: SkinId;
  /** ぼうしのアイテムID。'' はかぶらない */
  hat: string;
  coins: number;
  /** "1-3" → 星の数 (1..3) */
  stars: Record<string, number>;
  /** "7+5" → 習熟度 */
  facts: Record<string, FactStat>;
  /** ガチャで手に入れたアイテムID */
  unlocked: string[];
  daily: Daily;
  play: PlayTime;
}

export interface Settings {
  sound: boolean;
  slow: boolean;
  leftHanded: boolean;
  /** 1日に遊べる時間（分）。0 は制限なし */
  dailyLimitMin: number;
}

export interface SaveData {
  v: 1;
  players: Profile[];
  active: number;
  settings: Settings;
}

const KEY = 'tj.save.v1';

function freshProfile(): Profile {
  return {
    name: '',
    skin: 'cat',
    hat: '',
    coins: 0,
    stars: {},
    facts: {},
    unlocked: [],
    daily: { date: '', streak: 0, done: false },
    play: { date: '', sec: 0 },
  };
}

/** ローカル時間の YYYY-MM-DD。UTC で切ると日付が1日ずれる */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return today(d);
}

/**
 * 日付が変わっていたらデイリーと遊んだ時間を繰り越す。
 * 昨日やっていれば連続記録を保ち、1日でも空いたら 0 に戻す。
 */
export function refreshDaily(p: Profile): void {
  const now = today();
  if (p.daily.date === now && p.play.date === now) return;

  if (p.daily.date !== now) {
    p.daily = {
      date: now,
      // 未プレイの初日は「昨日やっていない」ので 0 のままでよい
      streak: p.daily.date === yesterday() && p.daily.done ? p.daily.streak : 0,
      done: false,
    };
  }
  if (p.play.date !== now) p.play = { date: now, sec: 0 };
  persist();
}

/** 遊んだ時間を足す。日付をまたいだ場合は今日ぶんから数えなおす */
export function addPlayTime(sec: number): void {
  if (sec <= 0) return;
  const p = profile();
  const now = today();
  if (p.play.date !== now) p.play = { date: now, sec: 0 };
  p.play.sec += Math.round(sec);
  persist();
}

/** 今日の上限に達したか（上限なしなら常に false） */
export function overDailyLimit(): boolean {
  const limit = save.settings.dailyLimitMin;
  if (!limit) return false;
  const p = profile();
  return p.play.date === today() && p.play.sec >= limit * 60;
}

function freshSave(): SaveData {
  return {
    v: 1,
    players: [freshProfile()],
    active: 0,
    settings: { sound: true, slow: false, leftHanded: false, dailyLimitMin: 0 },
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
    // 古いセーブに新しいフィールドが無くても壊れないよう、既定値の上に重ねる。
    // ネストしたオブジェクトは浅いマージだと欠けるので個別に埋める。
    const blank = freshProfile();
    return {
      v: 1,
      players: parsed.players.map((p) => ({
        ...blank,
        ...p,
        daily: { ...blank.daily, ...(p?.daily ?? {}) },
        play: { ...blank.play, ...(p?.play ?? {}) },
        stars: p?.stars ?? {},
        facts: p?.facts ?? {},
        unlocked: Array.isArray(p?.unlocked) ? p.unlocked : [],
      })),
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
