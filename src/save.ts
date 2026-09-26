/**
 * セーブデータ。localStorage は private ブラウズや容量超過で必ず失敗しうるので、
 * 読み書きは全部 try/catch で包み、失敗しても遊べる状態を返す。
 *
 * きろく（セーブデータ）は 3枠。きょうだいで 1台を使いまわしても、
 * 星もコインも図鑑も混ざらない。枠は「名前が入っているか」で使用中を判断する。
 */

import type { Tier } from './curriculum';
import { COIN_SCALE } from './rewards';
import { DEFAULT_WEAPON } from './weapons';

export type SkinId =
  | 'cat'
  | 'dog'
  | 'robo'
  | 'usa'
  | 'pen'
  | 'kuma'
  | 'fox'
  | 'panda'
  | 'sheep'
  | 'tora'
  | 'azarashi'
  | 'dora'
  | 'hero'
  | 'kaiju'
  | 'magi'
  | 'yousei';

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
  /**
   * おうちのかたが「きょうだけ」足した時間（秒）。1日にあそべる時間に上乗せする。
   * sec と同じく、日付が変わると 0 に戻る（あしたまで持ちこさない）
   */
  extra: number;
  /**
   * おしまいの画面で おうちのかたが「このまま スタート画面へ」を えらび、
   * きょうの制限を外したか。sec・extra と同じく 日付が変わると消える
   * （あしたは また いつもの長さ）。外していない日は キーごと持たない
   */
  free?: boolean;
}

/**
 * ミニゲームの「きょうの ごほうび」。
 *
 * ミニゲームは何回でも遊べるが、まとまったコインが出るのは1日1回だけにしてある。
 * ここを無制限にすると、いちばん短いミニゲームを回すのがコインの最適解になり、
 * 本編を走る理由が消える（ステージの周回に REPLAY_RATE を置いたのと同じ理由）。
 */
export interface MiniDay {
  date: string;
  /** きょう すでに ごほうびを もらったミニゲームの id */
  done: string[];
}

/**
 * おやつ・はなび（コインで買って その場で使いきるもの）を、きょう いくつ使ったか。
 *
 * 1日の数に上限を置いている（treats.ts の TREATS_PER_DAY）。安くて すぐ反応が返るので、
 * 上限が無いと 1回の 気まぐれで たまごの ぶんまで 使いきってしまう。
 * 日付が変わっていたら 0 から数えなおす（書きこみは使ったときだけ）。
 */
export interface TreatDay {
  date: string;
  snack: number;
  hanabi: number;
}

export interface Profile {
  name: string;
  skin: SkinId;
  /** ぼうしのアイテムID。'' はかぶらない */
  hat: string;
  /** アクセサリーのアイテムID。'' はつけない */
  acc: string;
  /** からだの色のアイテムID。'' はキャラ本来の色 */
  color: string;
  /**
   * 持っている ぶきのアイテムID。
   * ぼうし・アクセとちがって「なし」にはできない（キャラと同じ扱い）。
   * さいごの1問の フィニッシュで必ず1本つかうので、空だと何も起きなくなる。
   */
  weapon: string;
  /** はしる あと（走るとき足もとに残るもの）のアイテムID。'' は なし */
  trail: string;
  coins: number;
  /** "1-3" → 星の数 (1..3)。ハードは "1-3h"、ベリーハードは "1-3vh"（starKey） */
  stars: Record<string, number>;
  /** "7+5" → 習熟度 */
  facts: Record<string, FactStat>;
  /** ガチャで手に入れたアイテムID */
  unlocked: string[];
  /** ペットID → 手に入れた数。1 で仲間、2回目からは なかよし度が上がる */
  pets: Record<string, number>;
  /** つれて歩くペットID。'' はひとり */
  pet: string;
  /** ぼくじょうに置いた あそびどうぐのID（toys.ts）。買った順 */
  toys: string[];
  /** きょう使った おやつ・はなびの数 */
  treat: TreatDay;
  daily: Daily;
  play: PlayTime;
  mini: MiniDay;
  /**
   * ずかんを最後に見てから、あたらしく「おぼえた」になった式。
   * ずかんを開くと空になる（開くまで残る）。「見にいく理由」を作るための印で、
   * 習熟度そのものではないので、消えても記録は減らない。
   */
  zukanNew: string[];
  /** ずかんの ごほうびを もらった回数（ZUKAN_STEP まいごとに1回） */
  zukanGot: number;
  /**
   * ミニゲーム「ぴょんぴょん ハードル」のエンドレスで、いちばん多く跳んだ数。
   *
   * **習熟度ではない**ので、★・ずかん・おうちのかたの画面には出さない。
   * ミニゲームの中だけの記録（ミニゲームは記録を動かさない、という線は守る）。
   */
  hurdleBest: number;
  /** 最後に遊んだ日（YYYY-MM-DD）。きろくを選ぶ画面で出す */
  seen: string;
  /** かかっているタイマー（いまから ○分）。null は なし */
  timer: SessionTimer | null;
}

export interface Settings {
  sound: boolean;
  slow: boolean;
  leftHanded: boolean;
  /** 1日に遊べる時間（分）。0 は制限なし */
  dailyLimitMin: number;
}

/**
 * タイマー（いまから ○分）。おうちのかたが 端末を わたすときに かける。
 *
 * 1日にあそべる時間と同じく **きろくごと**に持つ（かけたときの きろくのもの）。
 * 前は端末に1つで、1人の時間が おわると きょうだいも あそべなかった。
 * おしまいの画面から ほかの きろくへ移れるように、きろくに付けた。
 * 時間は「さわっているあいだ」ではなく、かけた瞬間からの実時間で減る
 * （裏に回しても、アプリを閉じても、ほかの きろくで遊んでいても減る）。
 *
 * 終わる時刻を持たずに「のこり」と「最後に減らした時刻」を持つのは、
 * 端末の時計を戻されても のこりが増えないようにするため（tickSession）。
 */
export interface SessionTimer {
  /** seenAt の時点での のこり（ミリ秒） */
  leftMs: number;
  /** 輪の割合に使う長さ（ミリ秒）。延長すると のびる */
  totalMs: number;
  /** leftMs を最後に減らした時刻（Date.now()） */
  seenAt: number;
  /** かけた日（YYYY-MM-DD）。終わったまま日付が変わったら、自動で外す */
  day: string;
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
    acc: '',
    color: '',
    weapon: DEFAULT_WEAPON,
    trail: '',
    coins: 0,
    stars: {},
    facts: {},
    unlocked: [],
    pets: {},
    pet: '',
    toys: [],
    treat: { date: '', snack: 0, hanabi: 0 },
    daily: { date: '', streak: 0, done: false },
    play: { date: '', sec: 0, extra: 0 },
    mini: { date: '', done: [] },
    zukanNew: [],
    zukanGot: 0,
    hurdleBest: 0,
    seen: '',
    timer: null,
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
  if (p.play.date !== now) p.play = { date: now, sec: 0, extra: 0 };
  persist();
}

/**
 * 遊んだ時間を足す。日付をまたいだ場合は今日ぶんから数えなおす。
 *
 * 呼ぶのは playclock.ts の時計だけで、1秒ごとに来る。ここで persist() すると
 * 毎秒セーブ全体を書くことになるので、書きこみは時計の側でまとめる
 * （裏に回したときは main.ts の flushSave が吐き出す）。
 */
export function addPlayTime(sec: number): void {
  if (sec <= 0) return;
  const p = profile();
  const now = today();
  if (p.play.date !== now) p.play = { date: now, sec: 0, extra: 0 };
  p.play.sec += Math.round(sec);
  p.seen = now;
}

/**
 * そのミニゲームの「きょうの ごほうび」を、もう受け取ったか。
 * 日付が変わっていれば、書きこみを待たずに false（＝また もらえる）にする。
 */
export function miniDoneToday(id: string): boolean {
  const p = profile();
  return p.mini.date === today() && p.mini.done.includes(id);
}

/** きょうの ごほうびを受け取った印をつける */
export function markMiniDone(id: string): void {
  const p = profile();
  const now = today();
  if (p.mini.date !== now) p.mini = { date: now, done: [] };
  if (!p.mini.done.includes(id)) p.mini.done.push(id);
  persist();
}

// ------------------------------------------------------------------ 1日にあそべる時間

/** きょう遊んだ秒数 */
export function playedToday(p: Profile = profile()): number {
  return p.play.date === today() ? p.play.sec : 0;
}

/** おうちのかたが きょうの制限を外したか（おしまいの画面の「このまま スタート画面へ」） */
export function freeToday(p: Profile = profile()): boolean {
  return p.play.date === today() && p.play.free === true;
}

/** きょうの制限を外す／もどす。設定の分数そのものは変えない（あしたには元に戻る） */
export function setFreeToday(on: boolean, p: Profile = profile()): void {
  const now = today();
  if (p.play.date !== now) p.play = { date: now, sec: 0, extra: 0 };
  if (on) p.play.free = true;
  else delete p.play.free;
  persist();
}

/** きょう遊べる秒数（おうちのかたが足したぶんを含む）。0 は制限なし（きょうだけ外した日も） */
export function allowanceToday(p: Profile = profile()): number {
  const limit = save.settings.dailyLimitMin;
  if (!limit || freeToday(p)) return 0;
  const extra = p.play.date === today() ? p.play.extra : 0;
  return limit * 60 + extra;
}

/** きょう のこりの秒数。制限なしなら Infinity */
export function remainingToday(p: Profile = profile()): number {
  const all = allowanceToday(p);
  return all ? Math.max(0, all - playedToday(p)) : Infinity;
}

/** 今日の上限に達したか（上限なしなら常に false） */
export function overDailyLimit(p: Profile = profile()): boolean {
  return remainingToday(p) <= 0;
}

/**
 * きょうだけ遊べる時間を足す（マイナスで取り消し。0 より下にはしない）。
 * 設定の分数そのものは変えない。あしたになれば元の長さに戻る。
 *
 * 足すときは「いまから ○分」にする。上限を こえて ステージの終わりを待った
 * ぶん（最長 3分）が あると、そのまま足すと ＋5分 のつもりが のこり 2分 になる。
 */
export function extendToday(sec: number, p: Profile = profile()): void {
  const now = today();
  if (p.play.date !== now) p.play = { date: now, sec: 0, extra: 0 };
  // 外している日は allowanceToday が 0 なので、こえたぶんを数えない
  const overrun = sec > 0 && save.settings.dailyLimitMin > 0 && !freeToday(p)
    ? Math.max(0, playedToday(p) - allowanceToday(p))
    : 0;
  p.play.extra = Math.max(0, p.play.extra + overrun + Math.round(sec));
  persist();
}

// ------------------------------------------------------------------ タイマー（いまから ○分）

/**
 * のこりを 実時間で減らす。1秒ごと（と起動したとき）に呼ぶ。
 *
 * 減らすのは「前に見た時刻から進んだぶん」だけ。時計が戻っていたら 0 として扱い、
 * 基準の時刻だけ取りなおす（のこりは増えない）。アプリを閉じているあいだの
 * ぶんも、つぎに開いたときに ここで まとめて引かれる。
 * いま遊んでいない きろくの タイマーも 同じように減らす（実時間なので）。
 */
export function tickSession(now: number = Date.now()): void {
  for (const p of save.players) {
    const t = p.timer;
    if (!t) continue;
    t.leftMs = Math.max(0, t.leftMs - Math.max(0, now - t.seenAt));
    t.seenAt = now;
    // 終わったまま日付が変わったら外す。おうちのかたが外し忘れても、
    // つぎの日に開いたら ずっと「おしまい」のまま、にはしない
    if (t.leftMs <= 0 && t.day !== today(new Date(now))) p.timer = null;
  }
}

/** タイマーの のこり（秒）。かかっていなければ Infinity */
export function sessionLeft(now: number = Date.now(), p: Profile = profile()): number {
  const t = p.timer;
  if (!t) return Infinity;
  return Math.max(0, t.leftMs - Math.max(0, now - t.seenAt)) / 1000;
}

/** タイマーが かかっていて、もう 0 になっているか */
export function sessionOver(now: number = Date.now(), p: Profile = profile()): boolean {
  return p.timer !== null && sessionLeft(now, p) <= 0;
}

/** いまから min 分のタイマーをかける（かかっていれば かけなおす） */
export function startSession(min: number, now: number = Date.now()): void {
  const ms = Math.round(min * 60_000);
  profile().timer = { leftMs: ms, totalMs: ms, seenAt: now, day: today(new Date(now)) };
  persist();
}

/**
 * タイマーを のばす。終わったあとに のばしたときは、のばした長さを
 * 「まるまる1本」として輪を満タンから見せる（前の長さに足すと、
 * 10分もらったのに 輪が半分以下の きいろ から始まって 分かりにくい）。
 */
export function extendSession(min: number, now: number = Date.now()): void {
  const t = profile().timer;
  if (!t) return;
  tickSession(now);
  const ms = Math.round(min * 60_000);
  if (t.leftMs <= 0) {
    t.totalMs = ms;
  } else {
    t.totalMs += ms;
  }
  t.leftMs += ms;
  t.day = today(new Date(now));
  persist();
}

/** タイマーを外す */
export function clearSession(): void {
  profile().timer = null;
  persist();
}

/**
 * どこかに 時間の制限が かかっているか（1日の時間 か、どれかの きろくの タイマー）。
 * このあいだは 新しい きろくを作るのに関門を通す。時間は きろくごとなので、
 * 素通りだと「新しい きろくを作れば また遊べる」になる
 */
export function limitsOn(): boolean {
  return save.settings.dailyLimitMin > 0 || save.players.some((p) => p.timer !== null);
}

export type LimitKind = 'daily' | 'session';

/** 子どもに見せる のこり。1日の時間と タイマーの、先に終わるほう */
export interface LimitView {
  kind: LimitKind;
  /** のこり（秒） */
  remain: number;
  /** 輪が満タンのときの長さ（秒） */
  total: number;
}

/** いま効いている制限。どちらも無ければ null */
export function limitView(now: number = Date.now()): LimitView | null {
  let view: LimitView | null = null;
  const all = allowanceToday();
  if (all) view = { kind: 'daily', remain: remainingToday(), total: all };
  const t = profile().timer;
  if (t) {
    const remain = sessionLeft(now);
    // 同じなら タイマーを見せる（わたしたときに かけた ほうが、子どもに身近）
    if (!view || remain <= view.remain) view = { kind: 'session', remain, total: t.totalMs / 1000 };
  }
  return view;
}

/** もう遊べないか（1日の時間を使いきった か タイマーが終わった） */
export function timeUp(now: number = Date.now(), p: Profile = profile()): boolean {
  return overDailyLimit(p) || sessionOver(now, p);
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

/** 読みこんだタイマーを確かめる。形がおかしければ「なし」に落とす */
function readTimer(t: unknown): SessionTimer | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Partial<SessionTimer>;
  const nums = [o.leftMs, o.totalMs, o.seenAt];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    leftMs: Math.max(0, Number(o.leftMs)),
    totalMs: Math.max(1, Number(o.totalMs)),
    seenAt: Number(o.seenAt),
    day: typeof o.day === 'string' ? o.day : today(),
  };
}

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    // timer は 前の版の「端末に1つ」の タイマー（いまは きろくごと）
    const parsed = JSON.parse(raw) as Partial<SaveData> & { timer?: unknown };
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
      // extra（きょうだけ足した時間）は後から足した。古いセーブには無い
      play: {
        ...blank.play,
        ...(p?.play ?? {}),
        extra: Number.isFinite(p?.play?.extra) ? Number(p?.play?.extra) : 0,
      },
      // ミニゲームは後から足した。配列がこわれていても遊べるように、型ごと確かめる
      mini: {
        date: typeof p?.mini?.date === 'string' ? p.mini.date : '',
        done: Array.isArray(p?.mini?.done) ? p.mini.done : [],
      },
      stars: p?.stars ?? {},
      facts: p?.facts ?? {},
      unlocked: Array.isArray(p?.unlocked) ? p.unlocked : [],
      // ぶきは後から足した。古いセーブには無いので、1本目に落とす。
      // '' は きせかえで「なし」をえらんだ印なので、そのまま残す
      // （'' を1本目に戻すと、「なし」にしても 開きなおすたびに ロケットパンチに戻る）
      weapon: typeof p?.weapon === 'string' ? p.weapon : blank.weapon,
      // ずかんの合図とごほうびは後から足した。古いセーブには無い
      zukanNew: Array.isArray(p?.zukanNew) ? p.zukanNew : [],
      zukanGot: Number.isFinite(p?.zukanGot) ? Number(p?.zukanGot) : 0,
      // ハードルのきろくは後から足した。古いセーブには無い
      hurdleBest: Number.isFinite(p?.hurdleBest) ? Number(p?.hurdleBest) : 0,
      // ペットは後から足した。古いセーブには無いので必ず既定値に落とす
      pets: p?.pets && typeof p.pets === 'object' ? p.pets : {},
      // タイマーは後から足した。古いセーブには無い
      timer: readTimer(p?.timer),
      // はしる あと・あそびどうぐ・おやつと はなびは後から足した。古いセーブには無い
      trail: typeof p?.trail === 'string' ? p.trail : '',
      toys: Array.isArray(p?.toys) ? p.toys.filter((x): x is string => typeof x === 'string') : [],
      treat: {
        date: typeof p?.treat?.date === 'string' ? p.treat.date : '',
        snack: Number.isFinite(p?.treat?.snack) ? Number(p?.treat?.snack) : 0,
        hanabi: Number.isFinite(p?.treat?.hanabi) ? Number(p?.treat?.hanabi) : 0,
      },
    }));
    // 枠の数は増える方向にしか変えない。減らすと、増やしたあとで戻したときに
    // 3人目のきろくが黙って消える
    while (players.length < SLOTS) players.push(freshProfile());

    const active = Math.min(Math.max(parsed.active ?? 0, 0), players.length - 1);
    // 前の版は タイマーが端末に1つだった。そのとき遊んでいた きろくに移す
    const old = readTimer(parsed.timer);
    if (old && !players[active].timer) players[active].timer = old;

    return {
      v: 1,
      players,
      active,
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
  // きょう遊んだ時間と タイマーだけは残す。ここまで消すと「けす → 同じ枠で なまえを
  // 入れなおす」で 時間が まるごと戻ってしまう（関門を通らない抜け道になる）
  const { play, timer } = save.players[i];
  save.players[i] = freshProfile();
  save.players[i].play = play;
  save.players[i].timer = timer;
  // いま遊んでいるきろくを消したら、残っているきろくに移る。
  // 空の枠を選んだままにすると、ホームがいきなり「はじめる」に戻る
  if (save.active === i) {
    const next = save.players.findIndex((p) => p.name !== '');
    if (next >= 0) save.active = next;
  }
  persist();
}

/**
 * ★の保存キー。ふつうは "1-3"、ハードは "1-3h"、ベリーハードは "1-3vh"。
 *
 * ふつうのキーは むかしのまま（うしろに付けるだけ）。前に付けると、
 * 旧セーブの ★ がぜんぶ読めなくなる。
 */
export function starKey(worldId: number, stage: number, tier: Tier = 0): string {
  return `${worldId}-${stage}${tier === 2 ? 'vh' : tier === 1 ? 'h' : ''}`;
}

/** ステージの星。ベストのみ更新する。 */
export function stageStars(worldId: number, stage: number, tier: Tier = 0): number {
  return profile().stars[starKey(worldId, stage, tier)] ?? 0;
}

export function setStageStars(worldId: number, stage: number, stars: number, tier: Tier = 0): void {
  const key = starKey(worldId, stage, tier);
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
