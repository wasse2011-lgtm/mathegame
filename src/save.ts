/**
 * セーブデータ。localStorage は private ブラウズや容量超過で必ず失敗しうるので、
 * 読み書きは全部 try/catch で包み、失敗しても遊べる状態を返す。
 *
 * きろく（セーブデータ）は 3枠。きょうだいで 1台を使いまわしても、
 * 星もコインも図鑑も混ざらない。枠は「名前が入っているか」で使用中を判断する。
 */

import { COIN_SCALE } from './rewards';

export type SkinId = 'cat' | 'dog' | 'robo' | 'usa' | 'pen' | 'kuma';

/** きろくの枠の数 */
export const SLOTS = 3;

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
  /** 最後に遊んだ日（YYYY-MM-DD）。きろくを選ぶ画面で出す */
  seen: string;
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
  /**
   * コインのレート版。2 になる前のセーブは 1問1枚で貯めたものなので、
   * 読みこむときに COIN_SCALE を掛けて、買えるものの数を合わせる。
   */
  econ: number;
}

export const ECON_REV = 2;

/** 保存先のキー。ここを直接書かず、必ずこの定数を使う */
export const SAVE_KEY = 'tj.save.v1';
const KEY = SAVE_KEY;

/**
 * localStorage が使えるか。file:// で開いたときやプライベートモードでは書けないので、
 * 「遊べるが記録が残らない」ことを画面で伝えるために持っておく。
 */
export const storageWorks = ((): boolean => {
  try {
    const probe = `${SAVE_KEY}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
})();

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
    seen: '',
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
  p.seen = now;
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
    players: Array.from({ length: SLOTS }, freshProfile),
    active: 0,
    settings: { sound: true, slow: false, leftHanded: false, dailyLimitMin: 0 },
    econ: ECON_REV,
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
    const scale = parsed.econ === ECON_REV ? 1 : COIN_SCALE;
    const players = parsed.players.map((p) => ({
      ...blank,
      ...p,
      coins: Math.round((p?.coins ?? 0) * scale),
      daily: { ...blank.daily, ...(p?.daily ?? {}) },
      play: { ...blank.play, ...(p?.play ?? {}) },
      stars: p?.stars ?? {},
      facts: p?.facts ?? {},
      unlocked: Array.isArray(p?.unlocked) ? p.unlocked : [],
    }));
    // 枠の数は増える方向にしか変えない。減らすと、増やしたあとで戻したときに
    // 3人目のきろくが黙って消える
    while (players.length < SLOTS) players.push(freshProfile());

    return {
      v: 1,
      players,
      active: Math.min(Math.max(parsed.active ?? 0, 0), players.length - 1),
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      econ: ECON_REV,
    };
  } catch {
    return freshSave();
  }
}

export const save: SaveData = read();

let pending = 0;
let frozen = false;

/**
 * 外からセーブを差し替えたあと、リロードするまで書き戻さないようにする。
 * これがないと、読みこんだ直後のリロードで pagehide のフラッシュが走り、
 * メモリ上の「古いほう」で上書きしてしまう。
 */
export function freezeSave(): void {
  frozen = true;
  if (pending) {
    clearTimeout(pending);
    pending = 0;
  }
}

function write(): void {
  if (frozen) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める */
  }
}

/** 書き込みはまとめる。ステージ中に毎フレーム保存しないための遅延。 */
export function persist(): void {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    write();
  }, 120);
}

/**
 * 遅延を待たずに今すぐ書く。
 * iOS はアプリを裏に回した時点でタイマーを止めるので、これがないと
 * 「クリアした直後にアプリを閉じた」ぶんが丸ごと消える。
 */
export function flushSave(): void {
  if (pending) {
    clearTimeout(pending);
    pending = 0;
  }
  write();
}

export function profile(): Profile {
  return save.players[save.active];
}

export function resetAll(): void {
  const fresh = freshSave();
  save.players = fresh.players;
  save.active = 0;
  save.settings = fresh.settings;
  save.econ = fresh.econ;
  persist();
}

// ------------------------------------------------------------------ きろく（セーブ枠）

/** 3枠ぶんのきろく。名前が空の枠は「まだ使っていない」 */
export function slots(): Profile[] {
  return save.players.slice(0, SLOTS);
}

export function isEmptySlot(p: Profile): boolean {
  return p.name === '';
}

/** 使っているきろくの数 */
export function usedSlots(): number {
  return slots().filter((p) => !isEmptySlot(p)).length;
}

/** きろくを切りかえる。名前が空の枠を選んだ場合は、そのまま「はじめる」に入る */
export function selectSlot(i: number): void {
  if (i < 0 || i >= save.players.length) return;
  save.active = i;
  persist();
}

/** きろくを消す。枠は残し、中身だけまっさらにする */
export function clearSlot(i: number): void {
  if (i < 0 || i >= save.players.length) return;
  save.players[i] = freshProfile();
  // いま遊んでいるきろくを消したら、残っているきろくに移る。
  // 空の枠を選んだままにすると、ホームがいきなり「はじめる」に戻る
  if (save.active === i) {
    const next = save.players.findIndex((p) => p.name !== '');
    if (next >= 0) save.active = next;
  }
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

const EMPTY_FACT: Readonly<FactStat> = { m: 0, ms: 0, miss: 0, seen: 0 };

/**
 * 読むだけ。まだ出していない式のレコードを作らない。
 * （出題のたびに全部の式を作ってしまうと、W6〜W8 では数百件のゼロだけの
 *   レコードが保存され、「一度でも出した式かどうか」が分からなくなる）
 */
export function peekFact(key: string): Readonly<FactStat> {
  return profile().facts[key] ?? EMPTY_FACT;
}

/** 書き込み用。ここで初めてレコードを作る */
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
