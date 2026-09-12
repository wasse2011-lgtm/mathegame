/**
 * ぴょんぴょん ハードル。ミニゲームで唯一、拍のあるもの。
 *
 * ほかの3つは「絵を見て、ボタンを押す」で、数は最後まで記号のまま出てくる。
 * ここだけは **数を回数として体験させる**。
 *
 * ## 大きいほうから数える（count-on）
 *
 * `8 + 5 = ?` は、まず **どちらの数から かぞえるか** を子どもに選ばせる。
 * 選んだ数が頭の上に乗り（8）、ハードルは **のこりの数だけ**（5本）流れてくる。
 * 跳ぶたびに頭の上が 9・10・11・12・13 と増えて、止まった数が そのまま答えになる。
 *
 * 1から数えなおす形（ハードルを a+b 本ならべる）にしていたころは、走りは長いのに
 * やっているのは「1から13まで数える」で、たし算になっていなかった。
 * 小さいほう（5）を選んでも走れるが、そのぶんハードルは8本になる。
 * 「大きいほうから数えたほうが はやい」を、口で言わずに 本数で分からせる。
 *
 * **ゆずれない一点: ミスしてもカウントは進む。**
 * つまずいてもハードルは通過し、`counted` は増える。落とすのは そのハードルの
 * コイン1枚だけ。README の「腕前ではなく計算だけで越えられる」と同じ線で、
 * 運動が苦手な子でも「止まった数 ＝ こたえ」には必ず最後まで届く。
 * 下の update() の、カウントを進める分岐が 跳べたかどうかを読んでいないことが
 * その保証。
 *
 * ## 当たり判定（跳んだ「つもり」では越えられない）
 *
 * 越えたことにする条件は **横木より足が上にあること**（clearsAt）で、
 * 「空中にいるかどうか」ではない。地面をはなれた瞬間や、降りきる直前は
 * まだ横木の高さに届いていないので、ぶつかる。
 *
 * あわせて、着地してすぐには跳べない（LAND_LAG）。前は 空中のタップを
 * ぜんぶ先行入力として受け、着地したフレームで即 跳びなおしていたので、
 * **連打しているあいだ ずっと空中**になり、一度もぶつからなかった。
 * 先行入力は着地の直前（INPUT_BUFFER）だけ受ける。
 *
 * 結果、連打の跳躍は AIRTIME + LAND_LAG ごとの決まった拍になり、
 * 越えていられる時間（clearWindow）はそれより短い。
 * つまり **連打では必ず取りこぼす**（CI の G) が数字で見張っている）。
 * 拍に合わせて跳べば ぜんぶ取れる（どの拍も AIRTIME + LAND_LAG より長い）。
 *
 * 10こめは「10」のアーチだが、**これも跳ぶ**。くぐるだけの ごほうびの拍にして
 * いたころは、10 をまたぐところだけ手が止まり、繰り上がりの山がいちばん
 * 軽い場所になっていた。色は tenframe.ts と同じ約束（きいろ＝10へわたす玉／
 * みどり＝のこる玉）なので、さくらんぼ わけ と同じ話を、走りながらすることになる。
 *
 * ## 入りの演出（どちらを えらんだかを、絵で見せる）
 *
 * ボタンを押した直後に、`8` と `5` の札が盤面に出て、
 *   ・えらんだ `8` は **キャラの頭の上のふきだしに飛びこむ**（そこから数えはじめる）
 *   ・えらばなかった `5` は **5本のハードルに割れて** 右へ流れていく（それが道になる）
 * という 1.5秒 を置く。ハードルはそのぶん おくらせて積むので、走りだす前に
 * 「頭の上の数」と「ハードルの本数」がどこから来たのかが一度で分かる。
 *
 * 押した瞬間にいきなり走りだしていたころは、頭の上に急に 8 が出て、ハードルが
 * 何本来るのかも分からないまま拍が始まっていた。えらんだことの意味
 * （＝このゲームの主題）が、いちばん伝わらない場所になっていた。
 * 視差効果を減らす設定では演出ごと飛ばす（数と本数は変わらない）。
 *
 * ## 走りおわりの式（おぼえて帰る場所）
 *
 * 1式ぶん跳びおわったら、走りを伏せて `8 ＋ 5 ＝ 13` の札を大きく出す。
 * 自分の足で出した数が式の形になって残る、ここが「おぼえる」拍。
 * 以前は #mini-goal の `?` が 13 に変わるだけで、1.2秒後には次の式に進んでいた。
 *
 * 記録（★・図鑑・習熟度）は一切動かさない。出るのはコインだけ。
 * それはこのファイルの外（minigame.ts）の仕事で、ここは数えて返すところまで。
 */

import { sfx } from './audio';
import type { Fact } from './curriculum';
import { drawChar, type Look } from './sprites';

// ------------------------------------------------------------------ レーン

export type LaneKind = 'base' | 'need' | 'rest' | 'gate';

export interface LaneItem {
  /** 何こめか。1 から始まる。これが頭の上に出る数になる */
  n: number;
  kind: LaneKind;
}

/**
 * 式1つぶんの道すじ。**えらんだ数の つぎから、答えまで**。
 *
 * 8+5 で 8 をえらぶと 9〜13 の5本。**本数は えらばなかったほうの数**になる。
 * えらんだ瞬間に、その関係は絵でも出す（下の「入りの演出」）。
 * 色の切れめは `cherry()` の分解とぴったり重なる（8+5 なら need=2・rest=3）。
 *   9     … need（10へ わたす玉。きいろ）
 *   10    … gate（10のもん。need の最後の1こが、そのままアーチになる）
 *   11〜13… rest（のこる玉。みどり）
 * 答えが 10 に届かない式（3+2 など）は、話の分かれめが無いので base（青）1色。
 * cherry() を呼ばずに出せるので、くりあがらない式にもそのまま使える。
 */
export function laneFrom(start: number, total: number): LaneItem[] {
  const lane: LaneItem[] = [];
  for (let n = start + 1; n <= total; n++) {
    const kind: LaneKind =
      n === 10 ? 'gate' : n > 10 ? 'rest' : total >= 10 ? 'need' : 'base';
    lane.push({ n, kind });
  }
  return lane;
}

/** エンドレスの道すじ。10本ごとにアーチが来て、そこが「1たば」の区切りになる */
export function endlessLane(from: number, count: number): LaneItem[] {
  const lane: LaneItem[] = [];
  for (let i = 0; i < count; i++) {
    const n = from + i;
    lane.push({ n, kind: n % 10 === 0 ? 'gate' : 'base' });
  }
  return lane;
}

// ------------------------------------------------------------------ 拍

/** 跳んでいる時間 */
export const AIRTIME = 0.68;

/**
 * 着地してから つぎに跳べるようになるまで（秒）。
 *
 * ここが 0 だったころは、空中で押しておけば着地したフレームでそのまま跳びなおし、
 * 連打しているかぎり ずっと空中にいられた（＝ぶつかりようがなかった）。
 * ひと呼吸おくと、連打の跳躍は AIRTIME + LAND_LAG ごとの決まった拍になる。
 */
export const LAND_LAG = 0.14;
/** ぶつかったあと、体勢を立てなおすまで。連打の勢いを1回ここで切る */
export const TRIP_LAG = 0.26;
/** 先行入力を受けつける、着地までの残り時間 */
const INPUT_BUFFER = 0.22;

/** いちばん高いところ（足の高さ・s 倍する前） */
const APEX = 42;
/** ハードルの横木の てっぺん */
const BAR = 22;
/**
 * 越えたことにする足の高さ。横木より 4 だけ低く取ってある（そのぶんの なさけ）。
 * ここを 0 にすると「地面をはなれていれば越えたことになる」＝当たり判定が無いのと同じ。
 */
const CLEAR = 18;
/** 越えられる高さを、いちばん高いところに対する割合で持つ */
export const CLEAR_RATIO = CLEAR / APEX;

const CADENCE_MAX = 1.35;
const CADENCE_MIN = 0.95;
/** ゆっくり設定のときの倍率 */
const SLOW_RATE = 1.35;

/**
 * 跳んでからの秒 t での 足の高さ。いちばん高いところを 1 とした割合。
 *
 * 位置を毎フレーム積分せずに ここから直に出すので、**画面に見えている高さと、
 * 越えられたかの判定が ぜったいに食いちがわない**（CI からも同じ式を見られる）。
 */
export function hopHeight(t: number): number {
  if (t <= 0 || t >= AIRTIME) return 0;
  const u = t / AIRTIME;
  return 4 * u * (1 - u);
}

/** その時点で 横木より上にいるか */
export function clearsAt(t: number): boolean {
  return hopHeight(t) >= CLEAR_RATIO;
}

/**
 * 1回の跳躍のうち、横木を越えていられる時間（秒）。
 * 4u(1-u) = r を解くと はばは √(1-r)。連打の拍（AIRTIME + LAND_LAG）より短い。
 */
export function clearWindow(): number {
  return AIRTIME * Math.sqrt(1 - CLEAR_RATIO);
}

/**
 * i 本めのハードルと、その次との間隔（秒）。式モードで使う。
 *
 * **CADENCE_MIN は AIRTIME + LAND_LAG より必ず長くしてある。**
 * 詰めすぎると、着地して跳べるようになる前に次が来て、原理的に跳べなくなる。
 * 速さは遊びの張りのためであって、数を読ませなくするためではないので、
 * ここは 0.95 で頭打ちにしてある（CI で単調性と下限を検査している）。
 */
export function cadenceAt(i: number, total: number, slow: boolean): number {
  const span = Math.max(total - 1, 1);
  const k = Math.min(Math.max(i / span, 0), 1);
  const base = CADENCE_MAX + (CADENCE_MIN - CADENCE_MAX) * k;
  return slow ? base * SLOW_RATE : base;
}

/** エンドレスで、何本ごとに1段 速くなるか（10のもんの区切りと同じ） */
const ENDLESS_STEP = 10;
/** 1段あたり詰める秒数。100本めで ちょうど ENDLESS_MIN に着く幅にしてある */
const ENDLESS_TIGHTEN = 0.046;
/**
 * エンドレスでいちばん速いときの拍。
 *
 * 跳んでから つぎに跳べるようになるまでが AIRTIME + LAND_LAG ＝ 0.82 秒。
 * それに対して 0.90 秒なので、**1本も休めない**。ここが「ギリギリ こえられる」の帯。
 * AIRTIME + LAND_LAG より下げてはいけない（原理的に跳べなくなる。CI が見張っている）。
 */
const ENDLESS_MIN = 0.9;

/**
 * エンドレスの拍。**10本ごとに1段ずつ速くなり、100本で いちばん速くなる。**
 *
 * 以前は 60本かけて 0.95 秒までなめらかに詰めるだけだったので、
 * そこから先は何本走っても同じ速さで、100本を超えたあたりから
 * 「上手くなったから進んでいる」のか「ただ長いだけ」なのかが分からなかった。
 * 区切りを10本に合わせてあるので、速くなる瞬間が かならず 10のもんの直後に来る。
 */
export function endlessCadence(i: number, slow: boolean): number {
  const step = Math.floor(Math.max(i, 0) / ENDLESS_STEP);
  const base = Math.max(CADENCE_MAX - step * ENDLESS_TIGHTEN, ENDLESS_MIN);
  return slow ? base * SLOW_RATE : base;
}

// ------------------------------------------------------------------ 入りの演出

/**
 * えらんだ数が頭に入り、のこりがハードルに割れるまでの間（秒）。
 *
 * ハードルはこのぶん おくらせて積む（pushLane の lead）。演出だけ足して
 * 積むのを おくらせないと、数が頭に入る前に1本めが来て、順番が逆になる。
 */
export const INTRO = 1.5;
/** その中で、えらんだ数が あたまに届く時点（0〜1） */
const INTRO_HEAD = 0.44;
/** えらばなかった数が ハードルに割れる時点 */
const INTRO_BREAK = 0.54;
/** 破片1つが 右のはしへ飛ぶのにかける時間（INTRO に対する割合） */
const INTRO_FLY = 0.3;

/**
 * 1式ぶん跳びおわったあと、こたえの式を出しておく時間（秒）。
 *
 * 1.2秒だったころは、`?` が 13 に変わった次の瞬間には
 * 「どちらから かぞえる？」に切りかわっていた。おぼえて帰る場所が無かった。
 */
const REVEAL_HOLD = 2.4;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 出だしが速く、着くところで ゆるむ */
const ease = (u: number): number => 1 - (1 - u) ** 3;

// ------------------------------------------------------------------ 見た目

const INK = '#26313d';
/** きいろ＝10へ わたす玉（style.css の --amber と同じ） */
const KIIRO = '#ffc53d';
const KIIRO_DARK = '#d99a10';
/** みどり＝のこる玉（--good と同じ） */
const MIDORI = '#35b273';
const MIDORI_DARK = '#26895a';
/**
 * もとの数。10マスの絵の `.tf-dot.a`（--blue）と同じ色にしてある。
 * ここにワールドの色を使うと、W1 が緑なので「みどり＝のこる玉」と読めてしまう。
 * 色の3つは意味を持っているので、飾りの色を混ぜてはいけない。
 */
const BLUE = '#4aa3dd';
const BLUE_DARK = '#2f7fb5';
const COIN = '#ffd257';

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ 外との約束

export interface HurdleResult {
  /** きれいに跳べた数。コインの枚数になる */
  clean: number;
  /** 跳んだハードルの数。式モードでは えらばなかったほうの数の合計になる */
  jumped: number;
  /** エンドレスで、これまでの最高を更新したか */
  best: boolean;
}

export interface HurdleHooks {
  /** 式が変わった／進んだ。minigame.ts が #mini-goal と #mini-pips を書く */
  onProgress: (at: number, total: number, fact: Fact | null) => void;
  /**
   * 「どちらの かずから かぞえる？」を聞く。
   * minigame.ts が2つのボタンを出し、押されたら pick() を呼びかえす。
   */
  onPick: (fact: Fact) => void;
  /** ひとこと。#mini-say へ */
  onSay: (text: string) => void;
  /** 式の答えが出そろった。`8 + 5 = 13` を見せる */
  onAnswer: (fact: Fact, sum: number) => void;
  /** 走りおわり */
  onDone: (r: HurdleResult) => void;
}

export type HurdleOpts =
  | { mode: 'facts'; facts: Fact[]; slow: boolean; look: Look }
  | { mode: 'endless'; best: number; slow: boolean; look: Look };

// ------------------------------------------------------------------ 中の状態

interface Hurdle extends LaneItem {
  /** 体に届く時刻（絶対秒）。x ではなく時刻で持つ理由は下の draw を見る */
  tHit: number;
  passed: boolean;
  clean: boolean;
  broken: boolean;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** エンドレスのハート。アーチを通るたび満タンに戻る */
const HEARTS = 3;
/** アーチの前後で、走りをほんの少し止めて見せる時間 */
const GATE_HOLD = 0.55;

export class HurdleGame {
  private g: CanvasRenderingContext2D | null;
  private raf = 0;
  private running = false;
  private last = 0;

  private W = 320;
  private H = 240;
  private s = 1;

  private opts: HurdleOpts | null = null;
  private hooks: HurdleHooks;

  // --- 走りの状態
  private t = 0;
  private lane: Hurdle[] = [];
  private at = 0;
  private counted = 0;
  private clean = 0;
  private jumped = 0;
  private tens = 0;
  /** いまの「10」の中で通った玉の色。HUD の10マスを、走った色のまま並べる */
  private ones: LaneKind[] = [];
  private hearts = HEARTS;
  private coins: Coin[] = [];
  private ended = false;
  private hold = 0;
  /** これまでに置いたハードルの数。拍はセッション全体で詰めていく */
  private placed = 0;
  /** 式モードで、セッション全体の本数の見こみ（拍を詰める速さの分母） */
  private ramp = 24;
  /** いまの式の答えを、もう見せたか */
  private revealed = false;
  /** 「どちらから かぞえる？」の返事待ち。走りは止めずに、レーンだけ積まない */
  private waiting = false;

  // --- 入りの演出（えらんだ数 → あたま、のこり → ハードル）
  /** 演出の長さ（秒）。0 なら演出なし（視差効果を減らす設定） */
  private introLen = 0;
  /** 演出の経過（秒） */
  private intro = 0;
  /** えらんだ数（あたまに入る）。こたえの札で「どちらから数えたか」にも使う */
  private introFrom = 0;
  /** ハードルに割れる数の内わけ。色は そのまま来るハードルの色になる */
  private introKinds: LaneKind[] = [];
  private introHeadDone = false;
  private introBroke = false;

  // --- こたえの札
  private card: { a: number; b: number; from: number; sum: number } | null = null;
  private cardT = 0;

  // --- 跳躍
  /** 足の高さ（0 が地面。上へ行くほどマイナス） */
  private py = 0;
  private air = false;
  /** 跳んでからの秒。高さも 当たり判定も この1つから出す */
  private airT = 0;
  /** 着地の ため。0 になるまで つぎは跳べない */
  private lag = 0;
  private queued = false;
  private hurt = 0;
  private squash = 1;
  private pop = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    hitArea: HTMLElement,
    hooks: HurdleHooks,
  ) {
    this.g = canvas.getContext('2d');
    this.hooks = hooks;

    // canvas ではなく画面ぜんたい（#screen-mini）で受ける。
    // canvas だけ・盤面だけにしていたころは、指を置ける帯が画面の3割ほどしかなく、
    // 「押したのに跳ばなかった」が いちばん多い つまずきだった。
    // ボタンの上（← ・レベルの帯・どちらから かぞえる？）だけは避ける。
    // document には付けない（クリア画面のボタンでも跳んでしまう）
    hitArea.addEventListener('pointerdown', (e) => {
      if (!this.running) return;
      const t = e.target;
      if (t instanceof Element && t.closest('button, a, input, select, textarea')) return;
      e.preventDefault();
      this.tap();
    });

    window.addEventListener('resize', this.onResize);
    if ('ResizeObserver' in window) {
      // canvas 自身ではなく親を見る。高さを % で持っているので、
      // canvas を観測しても変化が来ないことがある
      new ResizeObserver(this.onResize).observe(canvas.parentElement ?? canvas);
    }
  }

  // ---------------------------------------------------------------- 出入り

  start(opts: HurdleOpts): void {
    this.opts = opts;
    this.t = 0;
    this.at = 0;
    this.counted = 0;
    this.clean = 0;
    this.jumped = 0;
    this.tens = 0;
    this.ones = [];
    this.hearts = HEARTS;
    this.coins = [];
    this.lane = [];
    this.ended = false;
    this.hold = 0;
    this.placed = 0;
    this.revealed = false;
    this.py = 0;
    this.air = false;
    this.airT = 0;
    this.lag = 0;
    this.queued = false;
    this.hurt = 0;
    this.squash = 1;
    this.pop = 0;
    this.last = 0;
    this.waiting = false;
    this.introLen = 0;
    this.intro = 0;
    this.introFrom = 0;
    this.introKinds = [];
    this.introHeadDone = false;
    this.introBroke = false;
    this.card = null;
    this.cardT = 0;
    // 式モードの拍は、その回に出る本数ぜんぶを分母にして詰めていく。
    // 「大きいほうから数える」とハードルは小さいほうの数だけになるので、
    // 5式でも 15本くらいにしかならない。分母を固定にすると、最後まで
    // ゆっくりのまま終わってしまう
    // エンドレスは endlessCadence（本数そのもので決まる）なので、ここは使わない
    this.ramp =
      opts.mode === 'facts'
        ? Math.max(8, opts.facts.reduce((n, f) => n + Math.min(f.a, f.b), 0))
        : 0;

    this.resize();
    if (opts.mode === 'endless') {
      this.buildNext();
      this.hooks.onSay('タップで ぴょん！');
    } else {
      // 式モードは「どちらから かぞえる？」の返事が来てから積む
      this.askPick();
    }

    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 「どちらの かずから かぞえる？」を出す。返事は pick() で受ける */
  private askPick(): void {
    const o = this.opts;
    const f = this.currentFact();
    if (!o || o.mode !== 'facts' || !f) {
      this.finish();
      return;
    }
    this.waiting = true;
    this.counted = 0;
    this.tens = 0;
    this.ones = [];
    this.card = null;
    this.introLen = 0;
    this.introKinds = [];
    this.hooks.onProgress(this.at, o.facts.length, f);
    this.hooks.onPick(f);
  }

  /**
   * えらんだ数から走りだす。
   *
   * えらんだ数はそのまま頭の上に乗り、左上の10マスにも最初から並ぶ
   * （「8 は すでに 8こ ある」を、走る前に量として見せておく）。
   * 小さいほうをえらんでも走れる。そのぶんハードルが増えるだけで、止めはしない。
   *
   * すぐには走らせない。えらんだ数が頭に飛びこみ、のこりがハードルに割れる
   * 1.5秒（INTRO）を置いてから1本めが来る。演出のあいだも時計（this.t）は
   * 進めたままで、おくらせるのは積む位置だけ。拍そのものは1本も変わらない。
   */
  pick(start: number): void {
    const o = this.opts;
    const f = this.currentFact();
    if (!o || o.mode !== 'facts' || !f || !this.waiting) return;
    const total = f.a + f.b;
    const other = total - start;
    const lane = laneFrom(start, total);
    this.waiting = false;
    this.introFrom = start;
    this.introKinds = lane.map((it) => it.kind);
    this.introHeadDone = false;
    this.introBroke = false;
    this.intro = 0;
    this.introLen = reduced() ? 0 : INTRO;
    this.pushLane(lane, (i) => cadenceAt(i, this.ramp, o.slow), this.introLen);

    if (this.introLen <= 0) {
      // 演出なし。いままでどおり、えらんだ数がその場で頭に乗る
      this.headIn();
      this.sayCount(start, other);
      return;
    }
    this.hooks.onSay(`${start} を あたまに いれるよ`);
  }

  /** えらんだ数が あたまに入った。ここから数えはじめる */
  private headIn(): void {
    this.introHeadDone = true;
    const start = this.introFrom;
    this.counted = start;
    this.tens = Math.floor(start / 10);
    this.ones = Array.from({ length: start % 10 }, (): LaneKind => 'base');
    this.pop = 0.4;
  }

  /**
   * 「8 から 5かい ぴょん！」。
   * 小さいほうをえらんだときだけ、本数の差をそのまま口に出す（止めはしない）。
   */
  private sayCount(start: number, other: number): void {
    this.hooks.onSay(
      start >= other
        ? `${start} から ${other}かい ぴょん！`
        : `${start} から ${other}かい…　${other} から だと ${start}かいで すむよ`,
    );
  }

  /** 何度呼んでも安全。画面を離れるどの道でも必ず通す */
  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---------------------------------------------------------------- 組み立て

  private currentFact(): Fact | null {
    const o = this.opts;
    if (!o || o.mode !== 'facts') return null;
    return o.facts[this.at] ?? null;
  }

  /** エンドレスの つぎの10本を積む（式モードは pick() が積む） */
  private buildNext(): void {
    const o = this.opts;
    if (!o || o.mode !== 'endless') return;
    // つぎの10本を先に積んでおく。切れめを作らない
    const from = this.placed + 1;
    this.pushLane(endlessLane(from, ENDLESS_STEP), (i) => endlessCadence(i, o.slow));
  }

  /**
   * @param cadence 何本めと その次のあいだを何秒あけるか。
   *   式モードは1つの式の中ではなくセッション全体で詰めていく（式ごとに巻きもどすと、
   *   5式ぜんぶが同じ速さで始まって張りが出ない）。エンドレスは10本ごとに1段はやい。
   * @param lead 1本めを さらに何秒 先に置くか。入りの演出のぶん（INTRO）。
   */
  private pushLane(items: LaneItem[], cadence: (i: number) => number, lead = 0): void {
    // 1本めは、画面を横切る時間ぶん先に置く（出てくる前に通過しない）
    let tHit = Math.max(this.t + 1.6 + lead, this.lastHit() + cadence(this.placed));
    for (const it of items) {
      this.lane.push({ ...it, tHit, passed: false, clean: false, broken: false });
      this.placed++;
      tHit += cadence(this.placed);
      // アーチの前後は ひと呼吸おく。10のまとまりを見せる間
      if (it.kind === 'gate') tHit += GATE_HOLD;
    }
  }

  private lastHit(): number {
    let last = this.t;
    for (const h of this.lane) if (h.tHit > last) last = h.tHit;
    return last;
  }

  // ---------------------------------------------------------------- 入力

  /**
   * タップ。**連打では跳びつづけられない。**
   *
   * 空中のタップを いつでも先行入力として受けていたころは、押しつづけているあいだ
   * 着地したフレームで即 跳びなおしていた（＝ずっと空中にいて、ぶつかりようがない）。
   * 受けるのは着地の直前だけにして、早すぎるタップは捨てる。
   */
  private tap(): void {
    if (this.ended) return;
    if (this.air) {
      if (AIRTIME - this.airT <= INPUT_BUFFER) this.queued = true;
      return;
    }
    if (this.lag > 0) {
      // 着地の ため／つまずきの立てなおし。終わった瞬間に跳ぶ
      this.queued = true;
      return;
    }
    this.jump();
  }

  private jump(): void {
    this.air = true;
    this.airT = 0;
    this.py = 0;
    this.squash = 0.86;
    sfx.jump();
  }

  /** 横木を越えているか。**空中にいるかどうかではない**（それだと当たり判定が無いのと同じ） */
  private clears(): boolean {
    return this.air && clearsAt(this.airT);
  }

  /** ぶつかった。跳びかけていたら そこで落ちて、少しのあいだ跳べない */
  private stumble(): void {
    this.air = false;
    this.airT = 0;
    this.py = 0;
    this.queued = false;
    this.lag = TRIP_LAG;
  }

  private apex(): number {
    return APEX * this.s;
  }

  // ---------------------------------------------------------------- ループ

  private onResize = (): void => this.resize();

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // hidden のまま作られると 0 になる。前の大きさを保って、あとで測りなおす
    if (rect.width < 2 || rect.height < 2) return;
    this.W = Math.round(rect.width);
    this.H = Math.round(rect.height);
    this.s = Math.min(Math.max(Math.min(this.W / 240, this.H / 190), 0.7), 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame = (ts: number): void => {
    if (!this.running) return;
    if (!this.last) this.last = ts;
    // 裏に回ったぶんは切り捨てる。ハードルは時刻で持っているので、
    // ここで時間を落としても本数は1本も減らない（＝数が狂わない）
    const dt = Math.min((ts - this.last) / 1000, 1 / 20);
    this.last = ts;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private speed(): number {
    // 遅くするほど、画面に何本ならんでいるかが見える。
    // 拍（cadenceAt）は変えずにここだけ下げると、同じ難しさのまま列が見える
    return 92 * this.s;
  }

  private playerX(): number {
    return Math.max(46 * this.s, this.W * 0.26);
  }

  private update(dt: number): void {
    if (this.ended) return;
    this.t += dt;
    this.pop = Math.max(0, this.pop - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.squash += (1 - this.squash) * Math.min(1, dt * 12);
    if (this.card) this.cardT += dt;
    this.stepIntro(dt);

    // 着地の ため。ここが空くまで つぎは跳べない（連打で跳びっぱなしにさせない）
    if (this.lag > 0) {
      this.lag = Math.max(0, this.lag - dt);
      if (this.lag === 0 && this.queued) {
        this.queued = false;
        this.jump();
      }
    }

    // 跳躍。高さは積分せず、跳んでからの時間から直に出す（hopHeight）。
    // 見えている高さと、越えられたかの判定が 同じ式から出ることが大事
    if (this.air) {
      this.airT += dt;
      if (this.airT >= AIRTIME) {
        this.air = false;
        this.airT = 0;
        this.py = 0;
        this.squash = 1.14;
        this.lag = LAND_LAG;
      } else {
        this.py = -this.apex() * hopHeight(this.airT);
      }
    }

    // 通過の判定
    for (let i = 0; i < this.lane.length; i++) {
      const h = this.lane[i];
      if (h.passed || this.t < h.tHit) continue;

      // ---- ここがゆずれない一点 ----------------------------------------
      // カウントを進めるこの数行は、跳べたかどうかを読まない。越えても
      // ぶつかっても、ハードルは通過し、数は必ず進む。腕前が効くのは下の
      // コイン（clean）だけ。ここに条件を足すと、企画そのものが崩れる。
      h.passed = true;
      this.counted = h.n;
      this.pop = 0.34;
      if (h.kind === 'gate') {
        // 10 こたまった。ばらを1たばにまとめる
        this.tens++;
        this.ones = [];
      } else {
        this.ones.push(h.kind);
      }
      // ------------------------------------------------------------------

      this.jumped++;
      // 越えたことにするのは「横木より足が上」のときだけ。
      // 地面をはなれた瞬間や 降りきる直前は まだ届いていないので ぶつかる
      if (this.clears()) {
        h.clean = true;
        this.clean++;
        this.dropCoin(h);
        // 10のもんは くぐるのではなく跳ぶ。きれいに跳べたときだけ、
        // ハート満タンと べつの音で「区切りを こえた」を出す
        if (h.kind === 'gate') {
          this.hearts = HEARTS;
          sfx.beat();
        } else {
          sfx.coin();
        }
      } else {
        h.broken = true;
        this.hurt = 0.5;
        this.stumble();
        sfx.stumble();
        // 10のもんは 区切りなので、ぶつかってもハートは減らない。
        // 当たり判定を ほんとうに効かせたぶん、ここを ひと息つける場所にする
        // （きれいに跳べたときは、上のとおり満タンに戻る）
        if (this.opts?.mode === 'endless' && h.kind !== 'gate') this.hearts--;
      }
    }

    // 画面の外に出たものを捨てる
    const back = this.playerX() + 60 * this.s;
    this.lane = this.lane.filter((h) => (this.t - h.tHit) * this.speed() < back);

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.life -= dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vy += 210 * this.s * dt;
      if (c.life <= 0) this.coins.splice(i, 1);
    }

    if (this.opts?.mode === 'endless' && this.hearts <= 0) {
      this.finish();
      return;
    }

    const left = this.lane.reduce((n, h) => (h.passed ? n : n + 1), 0);

    if (this.opts?.mode === 'endless') {
      // 残りが少なくなったら つぎの10本を積む。走りは切らさない
      if (left < 6) this.buildNext();
      return;
    }

    // 返事待ち（どちらから かぞえる？）は、まだ1本も積んでいないだけ。
    // ここで答えを見せに行くと、選ぶ前に式が終わってしまう
    if (left > 0 || this.waiting) return;

    if (!this.revealed) {
      // ここで はじめて答えを見せる。子どもが自分の足で出した数が、
      // そのまま `?` の場所に入る。
      // 走りを伏せて式の札を出すのは、ここが「おぼえて帰る」唯一の拍だから
      this.revealed = true;
      this.hold = REVEAL_HOLD;
      const f = this.currentFact();
      if (f) {
        this.card = { a: f.a, b: f.b, from: this.introFrom, sum: f.a + f.b };
        this.cardT = 0;
        this.hooks.onAnswer(f, f.a + f.b);
        sfx.correct(this.at);
      }
      return;
    }

    this.hold -= dt;
    if (this.hold <= 0) this.advance();
  }

  /**
   * 入りの演出を1フレーム進める。
   *
   * 走りそのものは止めない（this.t は動きつづける）。ここでやるのは
   * 「いつ頭に入るか」「いつ割れるか」の 2つの合図だけ。
   */
  private stepIntro(dt: number): void {
    if (this.introLen <= 0 || this.intro >= this.introLen) return;
    this.intro += dt;
    const u = this.intro / this.introLen;
    if (!this.introHeadDone && u >= INTRO_HEAD) {
      this.headIn();
      sfx.beat();
    }
    if (!this.introBroke && u >= INTRO_BREAK) {
      this.introBroke = true;
      sfx.crack();
      this.sayCount(this.introFrom, this.introKinds.length);
    }
  }

  private advance(): void {
    const o = this.opts;
    if (!o || o.mode !== 'facts') return;
    this.at++;
    if (this.at >= o.facts.length) {
      this.finish();
      return;
    }
    this.hold = 0;
    this.revealed = false;
    // つぎの式も、まず「どちらから かぞえる？」から
    this.askPick();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    const o = this.opts;
    const best = o?.mode === 'endless' ? this.counted > o.best : false;
    this.stop();
    this.hooks.onDone({ clean: this.clean, jumped: this.jumped, best });
  }

  private dropCoin(h: Hurdle): void {
    if (reduced()) return;
    const x = this.playerX() + (h.tHit - this.t) * this.speed();
    const y = this.groundY() - 26 * this.s;
    this.coins.push({ x, y, vx: -40 * this.s, vy: -150 * this.s, life: 0.7 });
  }

  private groundY(): number {
    return this.H - 16 * this.s;
  }

  // ---------------------------------------------------------------- 描画

  private draw(): void {
    const g = this.g;
    if (!g) return;
    const { W, H, s } = this;
    g.clearRect(0, 0, W, H);

    const groundY = this.groundY();
    const px = this.playerX();

    // 地面
    g.strokeStyle = 'rgba(38,49,61,.18)';
    g.lineWidth = 3 * s;
    g.beginPath();
    g.moveTo(0, groundY + 2 * s);
    g.lineTo(W, groundY + 2 * s);
    g.stroke();

    // ハードル。x は持たず、時刻から毎フレーム出す。
    // こうしておくと、回転しても リサイズしても ずれる余地が無い
    for (const h of this.lane) {
      const x = px + (h.tHit - this.t) * this.speed();
      if (x < -70 * s || x > W + 70 * s) continue;
      if (h.kind === 'gate') this.drawGate(x, groundY, h);
      else this.drawHurdle(x, groundY, h);
    }

    // キャラ
    const size = 30 * s;
    const footY = groundY + this.py;
    const look = this.opts?.look;
    if (look) {
      drawChar(g, px, footY, size, look, {
        t: this.t * 1.6,
        air: this.air,
        hurt: this.hurt,
        squash: this.squash,
      });
    }

    // 頭の上の数。**このゲームの本体**なので、いちばん大きく出す
    this.drawCount();

    for (const c of this.coins) {
      g.globalAlpha = Math.max(0, Math.min(1, c.life / 0.7));
      g.fillStyle = COIN;
      g.strokeStyle = KIIRO_DARK;
      g.lineWidth = 1.5 * s;
      g.beginPath();
      g.arc(c.x, c.y, 5 * s, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.globalAlpha = 1;

    // 入りの演出と こたえの札は、走りの上に重ねる。
    // 10マス（drawTens）はそのさらに上。札のうしろで「13 の量」も見えている
    this.drawIntro();
    this.drawCard();
    this.drawTens();
    this.drawStatus();
  }

  /** ハードルの色。10マスの絵と同じ約束（青＝もとの数・きいろ＝10へ・みどり＝のこり） */
  private colorOf(kind: LaneKind): [string, string] {
    if (kind === 'need' || kind === 'gate') return [KIIRO, KIIRO_DARK];
    if (kind === 'rest') return [MIDORI, MIDORI_DARK];
    return [BLUE, BLUE_DARK];
  }

  /**
   * 頭の上のふきだしの まん中。
   * えらんだ数が飛びこむ先でもあるので、1か所で持って draw と共有する。
   */
  private headPoint(): { x: number; y: number } {
    const s = this.s;
    const footY = this.groundY() + this.py;
    return { x: this.playerX(), y: Math.max(footY - 40 * s, 26 * s) - 13 * s };
  }

  /** ふつうのハードル。つまずいたものは たおれる */
  private drawHurdle(x: number, groundY: number, h: Hurdle): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const [col, edge] = this.colorOf(h.kind);
    const hh = BAR * s;

    g.save();
    g.translate(x, groundY);
    if (h.broken) g.rotate(-0.9);
    g.fillStyle = col;
    g.strokeStyle = edge;
    g.lineWidth = 2 * s;
    // 支柱
    g.fillRect(-2 * s, -hh, 4 * s, hh);
    g.strokeRect(-2 * s, -hh, 4 * s, hh);
    // 横木
    g.fillRect(-9 * s, -hh, 18 * s, 6 * s);
    g.strokeRect(-9 * s, -hh, 18 * s, 6 * s);
    g.restore();
  }

  /**
   * 10のもん。**くぐるのではなく跳ぶ。**
   *
   * アーチの中に横木を1本わたしてある。ここを ただの門にしていたころは、
   * 10 をまたぐところだけ手が止まり、繰り上がりの山がいちばん軽い場所になっていた。
   */
  private drawGate(x: number, groundY: number, h: Hurdle): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const w = 34 * s;
    const hh = 46 * s;
    const done = h.passed;

    g.strokeStyle = done ? MIDORI_DARK : KIIRO_DARK;
    g.fillStyle = done ? 'rgba(53,178,115,.16)' : 'rgba(255,197,61,.2)';
    g.lineWidth = 4 * s;
    g.beginPath();
    g.moveTo(x - w / 2, groundY);
    g.lineTo(x - w / 2, groundY - hh + w / 2);
    g.arc(x, groundY - hh + w / 2, w / 2, Math.PI, 0);
    g.lineTo(x + w / 2, groundY);
    g.fill();
    g.stroke();

    g.fillStyle = done ? MIDORI_DARK : KIIRO_DARK;
    g.font = `900 ${13 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('10', x, groundY - hh + w / 2);

    // 門の中の横木。ほかのハードルと同じ高さに置く（跳ぶものだと形で分かる）
    const bar = BAR * s;
    g.save();
    g.translate(x, groundY);
    if (h.broken) g.rotate(-0.9);
    g.fillStyle = KIIRO;
    g.strokeStyle = KIIRO_DARK;
    g.lineWidth = 2 * s;
    g.fillRect(-2 * s, -bar, 4 * s, bar);
    g.strokeRect(-2 * s, -bar, 4 * s, bar);
    g.fillRect(-11 * s, -bar, 22 * s, 6 * s);
    g.strokeRect(-11 * s, -bar, 22 * s, 6 * s);
    g.restore();
  }

  /** 頭の上のふきだし。増えるたびに はずむ */
  private drawCount(): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const p = this.headPoint();
    const grow = reduced() ? 1 : 1 + this.pop * 0.8;
    // 返事待ちのあいだと、えらんだ数が まだ飛んでいる あいだは「？」。
    // ここに入る数を、じぶんで選ぶ場所だと見せておく
    const empty = this.waiting || (this.introLen > 0 && !this.introHeadDone);
    const text = empty ? '?' : String(this.counted);

    g.save();
    g.translate(p.x, p.y);
    g.scale(grow, grow);
    g.font = `900 ${20 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    const w = Math.max(g.measureText(text).width + 16 * s, 30 * s);
    const h = 26 * s;
    g.fillStyle = this.pop > 0.2 ? KIIRO : '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 2.5 * s;
    this.round(-w / 2, -h / 2, w, h, 8 * s);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }

  /**
   * 入りの演出。**えらんだ数は あたまへ、えらばなかった数は ハードルへ。**
   *
   * 札を2枚出して、片方をキャラの頭のふきだしへ飛ばし、もう片方を
   * ハードルの形に割って右へ流す。割れる数は これから来る本数そのもので、
   * 色も来るハードルと同じ（きいろ＝10へわたす・みどり＝のこり・青＝くりあがらない）。
   * 「5 をえらばなかったから ハードルが5本」を、字ではなく形で見せる場所。
   */
  private drawIntro(): void {
    const g = this.g;
    if (!g || this.introLen <= 0 || this.intro >= this.introLen) return;
    const s = this.s;
    const u = clamp01(this.intro / this.introLen);
    const groundY = this.groundY();

    // 札を置く高さ。頭より上、左上の10マスより下
    const cy = Math.max(groundY - 82 * s, 42 * s);
    const cx = Math.min(Math.max(this.W * 0.56, 96 * s), this.W - 52 * s);
    const gap = 34 * s;
    const rise = ease(clamp01(u / 0.16));

    // ＋ の記号。2枚が そろっているあいだだけ
    if (u < INTRO_HEAD) {
      g.save();
      g.globalAlpha = rise;
      g.fillStyle = INK;
      g.font = `900 ${17 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('+', cx, cy);
      g.restore();
    }

    // えらばなかった数 → ハードルに割れて 右へ
    const kinds = this.introKinds;
    const bx = cx + gap;
    if (u < INTRO_BREAK) {
      // 割れる直前だけ こまかくふるえる。「これから何かが起きる」の合図
      const near = clamp01((u - (INTRO_BREAK - 0.16)) / 0.16);
      const shake = Math.sin(this.intro * 60) * 2.5 * s * near;
      // 札の色は、割れて出てくるハードルの色。ここで飾りの色を混ぜると、
      // 「きいろ＝10へわたす玉」の約束が くりあがらない式でも黄色くなって崩れる
      const [col, edge] = this.colorOf(kinds[0] ?? 'base');
      this.drawChip(bx + shake, cy, String(kinds.length), col, edge, 0.55 + 0.45 * rise);
    } else {
      const n = kinds.length;
      const room = Math.max(1 - INTRO_BREAK - INTRO_FLY, 0);
      const step = n > 1 ? Math.min(0.035, room / (n - 1)) : 0;
      for (let i = 0; i < n; i++) {
        const k = clamp01((u - (INTRO_BREAK + i * step)) / INTRO_FLY);
        if (k <= 0 || k >= 1) continue;
        const e = ease(k);
        const tx = this.W + 24 * s + i * 15 * s;
        const ty = groundY - 12 * s;
        const x = bx + (tx - bx) * e;
        const y = cy + (ty - cy) * e - Math.sin(Math.PI * k) * 18 * s;
        this.drawFlyHurdle(x, y, kinds[i], 1 - 0.25 * k);
      }
    }

    // えらんだ数 → あたまのふきだしへ
    if (u < INTRO_HEAD) {
      const fly = clamp01((u - 0.16) / (INTRO_HEAD - 0.16));
      const head = this.headPoint();
      const ax = cx - gap;
      const e = ease(fly);
      const x = ax + (head.x - ax) * e;
      const y = cy + (head.y - cy) * e - Math.sin(Math.PI * fly) * 20 * s;
      this.drawChip(x, y, String(this.introFrom), BLUE, BLUE_DARK, (0.55 + 0.45 * rise) * (1 - 0.3 * fly));
    }
  }

  /** 数の札。入りの演出で飛ぶ、あの札 */
  private drawChip(x: number, y: number, text: string, col: string, edge: string, scale: number): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    g.font = `900 ${22 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    const w = Math.max(g.measureText(text).width + 18 * s, 32 * s);
    const h = 32 * s;
    g.fillStyle = col;
    g.strokeStyle = edge;
    g.lineWidth = 3 * s;
    this.round(-w / 2, -h / 2, w, h, 9 * s);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** 割れて飛んでいく ハードル1本。来る本物と同じ形・同じ色 */
  private drawFlyHurdle(x: number, y: number, kind: LaneKind, alpha: number): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const [col, edge] = this.colorOf(kind);
    g.save();
    g.globalAlpha = clamp01(alpha);
    g.translate(x, y);
    g.fillStyle = col;
    g.strokeStyle = edge;
    g.lineWidth = 2 * s;
    g.fillRect(-2 * s, -11 * s, 4 * s, 22 * s);
    g.strokeRect(-2 * s, -11 * s, 4 * s, 22 * s);
    g.fillRect(-9 * s, -11 * s, 18 * s, 6 * s);
    g.strokeRect(-9 * s, -11 * s, 18 * s, 6 * s);
    g.restore();
  }

  /**
   * こたえの札。**1式ぶん走りおわったあと、式そのものを大きく出す。**
   *
   * 走りを白く伏せるのは、この数秒だけは式だけを見てほしいから。
   * 伏せても左上の10マスは上に描くので、`13` が どれだけの量かは横に出たまま。
   */
  private drawCard(): void {
    const c = this.card;
    const g = this.g;
    if (!c || !g) return;
    const s = this.s;
    const k = reduced() ? 1 : clamp01(this.cardT / 0.22);
    const e = ease(k);
    // 次の式へ移るところで すっと消す
    const fade = clamp01(Math.max(this.hold, 0) / 0.3);

    g.save();
    g.globalAlpha = fade;
    // 角を丸めて少し内側に敷く。画面いっぱいに塗ると、canvas のふちが
    // そのまま白い四角の境目になって、演出ではなく描画の切れめに見える
    g.fillStyle = `rgba(255,253,247,${0.9 * e})`;
    this.round(4 * s, 4 * s, this.W - 8 * s, this.H - 8 * s, 14 * s);
    g.fill();

    const cx = this.W / 2;
    const cy = this.H * 0.5;
    const big = 30 * s;
    const mid = 22 * s;
    // こたえだけ、ひと呼吸おいて はずむ
    const popK = reduced() ? 0 : clamp01((this.cardT - 0.2) / 0.34);
    const sumGrow = 1 + Math.sin(Math.PI * popK) * 0.3;

    // どちらから数えたかを 1つだけ青くする（a と b が同じ数なら 左だけ）
    const fromA = c.from === c.a;
    const parts = [
      { t: String(c.a), size: big, col: fromA ? BLUE_DARK : INK, pop: false },
      { t: '+', size: mid, col: INK, pop: false },
      { t: String(c.b), size: big, col: !fromA && c.from === c.b ? BLUE_DARK : INK, pop: false },
      { t: '=', size: mid, col: INK, pop: false },
      { t: String(c.sum), size: big, col: MIDORI_DARK, pop: true },
    ];
    const font = (px: number): string => `900 ${px}px "Hiragino Maru Gothic ProN", sans-serif`;
    const gap = 7 * s;
    let total = gap * (parts.length - 1);
    for (const p of parts) {
      g.font = font(p.size);
      total += g.measureText(p.t).width;
    }

    g.save();
    g.translate(cx, cy);
    g.scale(0.8 + 0.2 * e, 0.8 + 0.2 * e);

    // 札。式より ひとまわり大きく取って、上下に ことばを置く
    const bw = total + 44 * s;
    const bh = 104 * s;
    g.fillStyle = '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 3.5 * s;
    this.round(-bw / 2, -bh / 2, bw, bh, 16 * s);
    g.fill();
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(38,49,61,.62)';
    g.font = `700 ${12 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.fillText('おぼえた！', 0, -bh / 2 + 17 * s);

    g.textAlign = 'left';
    let x = -total / 2;
    for (const p of parts) {
      g.font = font(p.size);
      const w = g.measureText(p.t).width;
      g.fillStyle = p.col;
      if (p.pop) {
        // こたえだけ はずませる。中心を動かさずに大きくする
        g.save();
        g.translate(x + w / 2, 0);
        g.scale(sumGrow, sumGrow);
        g.textAlign = 'center';
        g.fillText(p.t, 0, 0);
        g.restore();
      } else {
        g.fillText(p.t, x, 0);
      }
      x += w + gap;
    }

    g.textAlign = 'center';
    g.fillStyle = 'rgba(38,49,61,.62)';
    g.font = `700 ${12 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.fillText(`${c.from} から ${c.sum - c.from}かい ぴょん`, 0, bh / 2 - 17 * s);
    g.restore();
    g.restore();
  }

  /** 左上。10のたばと、いまのばら。数を量として見せておく場所 */
  private drawTens(): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const x0 = 9 * s;
    const y0 = 9 * s;
    const cell = 13 * s;

    // 10のたば。ただの棒だと「10 まとまっている」ことが読めないので、
    // 10本ぶんの区切りを入れる（ばらの玉 10 こと 同じものだと分かる形にする）
    const bw = 9 * s;
    const bh = cell * 2;
    let x = x0;
    for (let i = 0; i < Math.min(this.tens, 6); i++) {
      g.fillStyle = KIIRO;
      g.strokeStyle = KIIRO_DARK;
      g.lineWidth = 2 * s;
      g.fillRect(x, y0, bw, bh);
      g.strokeRect(x, y0, bw, bh);
      g.lineWidth = 1 * s;
      g.beginPath();
      for (let k = 1; k < 10; k++) {
        g.moveTo(x, y0 + (bh / 10) * k);
        g.lineTo(x + bw, y0 + (bh / 10) * k);
      }
      g.stroke();
      x += 13 * s;
    }
    if (this.tens > 6) {
      g.fillStyle = INK;
      g.font = `700 ${13 * s}px sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(`×${this.tens}`, x, y0 + cell);
      x += 26 * s;
    }

    // ばら。10マスの絵と同じ 5×2。**数を量として見せる場所**なので小さくしない
    const gx = x + (this.tens ? 8 * s : 0);
    for (let i = 0; i < 10; i++) {
      const cx = gx + (i % 5) * cell;
      const cy = y0 + Math.floor(i / 5) * cell;
      g.fillStyle = '#fff';
      g.strokeStyle = 'rgba(38,49,61,.28)';
      g.lineWidth = 1.5 * s;
      g.fillRect(cx, cy, cell, cell);
      g.strokeRect(cx, cy, cell, cell);
      const kind = this.ones[i];
      if (kind) {
        // 走ったときの色のまま置く。青＝もとの数、きいろ＝10へわたす、みどり＝のこり。
        // ここで色を1つにすると、10マスの絵と走りが別の話をしてしまう
        g.fillStyle = kind === 'need' ? KIIRO : kind === 'rest' ? MIDORI : BLUE;
        g.beginPath();
        g.arc(cx + cell / 2, cy + cell / 2, cell * 0.32, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** 右上。コインと、エンドレスならハート */
  private drawStatus(): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const x = this.W - 8 * s;
    const y = 10 * s;

    g.fillStyle = COIN;
    g.strokeStyle = KIIRO_DARK;
    g.lineWidth = 1.5 * s;
    g.beginPath();
    g.arc(x - 8 * s, y + 8 * s, 6 * s, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.font = `700 ${13 * s}px sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(String(this.clean), x - 18 * s, y + 8 * s);

    if (this.opts?.mode !== 'endless') return;
    for (let i = 0; i < HEARTS; i++) {
      const hx = x - 9 * s - i * 15 * s;
      const hy = y + 28 * s;
      g.fillStyle = i < this.hearts ? '#e4675c' : 'rgba(38,49,61,.15)';
      g.beginPath();
      g.moveTo(hx, hy + 5 * s);
      g.bezierCurveTo(hx - 9 * s, hy - 2 * s, hx - 2 * s, hy - 7 * s, hx, hy - 2 * s);
      g.bezierCurveTo(hx + 2 * s, hy - 7 * s, hx + 9 * s, hy - 2 * s, hx, hy + 5 * s);
      g.closePath();
      g.fill();
    }
  }

  private round(x: number, y: number, w: number, h: number, r: number): void {
    const g = this.g;
    if (!g) return;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
}
