/**
 * ぴょんぴょん ハードル。ミニゲームで唯一、拍のあるもの。
 *
 * ほかの3つは「絵を見て、ボタンを押す」で、数は最後まで記号のまま出てくる。
 * ここだけは **数を回数として体験させる**。`8 + 5 = ?` の答えは伏せておき、
 * ハードルを ちょうど a+b 本ならべる。跳ぶたびに頭の上の数が増えて、
 * 最後に止まった数が そのまま答えになる。数え足し（count-on）を体でやる形。
 *
 * **ゆずれない一点: ミスしてもカウントは進む。**
 * つまずいてもハードルは通過し、`counted` は増える。落とすのは そのハードルの
 * コイン1枚だけ。README の「腕前ではなく計算だけで越えられる」と同じ線で、
 * 運動が苦手な子でも「跳んだ数 ＝ a+b」には必ず最後まで届く。
 * 下の update() の、カウントを進める分岐が `air` を読んでいないことがその保証。
 *
 * 10こめは ハードルではなく「10」のアーチにしてある。色は tenframe.ts と同じ
 * 約束（きいろ＝10へわたす玉／みどり＝のこる玉）なので、さくらんぼ わけ と
 * 同じ話を、走りながらすることになる。
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
 * 式1つぶんの道すじ。**本数はかならず a+b 本**（ここが企画の主張そのもの）。
 *
 * 色の切れめは `cherry()` の分解とぴったり重なる。
 * 8+5 なら base=8・need=2・rest=3 で、
 *   1〜8  … base（もとの数）
 *   9     … need（10へ わたす玉。きいろ）
 *   10    … gate（10のもん。need の最後の1こが、そのままアーチになる）
 *   11〜13… rest（のこる玉。みどり）
 * になる。cherry() を呼ばずに max(a,b) だけで同じ切れめが出せるので、
 * くりあがらない式（8+2=10 など）にもそのまま使える。
 */
export function laneFor(f: Fact): LaneItem[] {
  const total = f.a + f.b;
  const base = Math.max(f.a, f.b);
  const lane: LaneItem[] = [];
  for (let n = 1; n <= total; n++) {
    const kind: LaneKind = n === 10 ? 'gate' : n > 10 ? 'rest' : n <= base ? 'base' : 'need';
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

/** 跳んでいる時間。判定はこの長さぶんの猶予になる */
export const AIRTIME = 0.68;

const CADENCE_MAX = 1.35;
const CADENCE_MIN = 0.95;
/** エンドレスで いちばん速くなるまでの本数 */
const ENDLESS_RAMP = 60;
/** ゆっくり設定のときの倍率 */
const SLOW_RATE = 1.35;

/**
 * i 本めのハードルと、その次との間隔（秒）。
 *
 * **CADENCE_MIN は AIRTIME より必ず長くしてある。**
 * 詰めすぎると、前のハードルの滞空が終わる前に次が来て、原理的に跳べなくなる。
 * 速さは遊びの張りのためであって、数を読ませなくするためではないので、
 * ここは 0.95 で頭打ちにしてある（CI で単調性と下限を検査している）。
 */
export function cadenceAt(i: number, total: number, slow: boolean): number {
  const span = Math.max(total - 1, 1);
  const k = Math.min(Math.max(i / span, 0), 1);
  const base = CADENCE_MAX + (CADENCE_MIN - CADENCE_MAX) * k;
  return slow ? base * SLOW_RATE : base;
}

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
  /** 通った数。式モードでは かならず 式の答えの合計になる */
  jumped: number;
  /** エンドレスで、これまでの最高を更新したか */
  best: boolean;
}

export interface HurdleHooks {
  /** 式が変わった／進んだ。minigame.ts が #mini-goal と #mini-pips を書く */
  onProgress: (at: number, total: number, fact: Fact | null) => void;
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
/** つまずいた直後、これだけの間にタップすれば「跳べた」ことにする */
const GRACE = 0.12;
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
  /** いまの式の答えを、もう見せたか */
  private revealed = false;

  // --- 跳躍
  private py = 0;
  private vy = 0;
  private air = false;
  private queued = false;
  private hurt = 0;
  private squash = 1;
  private pop = 0;
  private tripAt = -99;
  private tripIdx = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    hitArea: HTMLElement,
    hooks: HurdleHooks,
  ) {
    this.g = canvas.getContext('2d');
    this.hooks = hooks;

    // canvas ではなく親（#mini-body）で受ける。「画面のどこでも」に余白も含めたい。
    // document には付けない（← やクリア画面のボタンでも跳んでしまう）
    hitArea.addEventListener('pointerdown', (e) => {
      if (!this.running) return;
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
    this.vy = 0;
    this.air = false;
    this.queued = false;
    this.hurt = 0;
    this.squash = 1;
    this.pop = 0;
    this.tripAt = -99;
    this.tripIdx = -1;
    this.last = 0;

    this.resize();
    this.buildNext();
    this.hooks.onSay('タップで ぴょん！');

    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
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

  /** つぎの式（エンドレスなら つぎの10本）をレーンに積む */
  private buildNext(): void {
    const o = this.opts;
    if (!o) return;

    if (o.mode === 'endless') {
      // つぎの10本を先に積んでおく。切れめを作らない
      const from = this.placed + 1;
      this.pushLane(endlessLane(from, 10), o.slow, ENDLESS_RAMP);
      return;
    }

    const f = o.facts[this.at];
    if (!f) {
      this.finish();
      return;
    }
    const items = laneFor(f);
    // 拍は1つの式の中ではなく、セッション全体で詰めていく。
    // 式ごとに巻きもどすと、5式ぜんぶが同じ速さで始まって張りが出ない
    this.pushLane(items, o.slow, o.facts.length * 12);
    this.hooks.onProgress(this.at, o.facts.length, f);
  }

  private pushLane(items: LaneItem[], slow: boolean, ramp: number): void {
    // 1本めは、画面を横切る時間ぶん先に置く（出てくる前に通過しない）
    let tHit = Math.max(this.t + 1.6, this.lastHit() + cadenceAt(this.placed, ramp, slow));
    for (const it of items) {
      this.lane.push({ ...it, tHit, passed: false, clean: false, broken: false });
      this.placed++;
      tHit += cadenceAt(this.placed, ramp, slow);
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

  private tap(): void {
    if (this.ended) return;

    // つまずいた直後の取り消し。いちばん くやしい失敗をここで消す
    if (this.t - this.tripAt <= GRACE && this.tripIdx >= 0) {
      const h = this.lane[this.tripIdx];
      if (h && !h.clean) {
        h.clean = true;
        h.broken = false;
        this.clean++;
        this.hurt = 0;
        if (this.hearts < HEARTS) this.hearts++;
        this.dropCoin(h);
        sfx.coin();
      }
      this.tripAt = -99;
      this.tripIdx = -1;
    }

    if (this.air) {
      // 先行入力。いちばん速い拍だと、地面にいる時間が 0.3 秒を切る
      this.queued = true;
      return;
    }
    this.jump();
  }

  private jump(): void {
    this.air = true;
    this.vy = this.jumpV();
    this.squash = 0.86;
    sfx.jump();
  }

  private apex(): number {
    return 42 * this.s;
  }

  private gravity(): number {
    const half = AIRTIME / 2;
    return (2 * this.apex()) / (half * half);
  }

  private jumpV(): number {
    return -this.gravity() * (AIRTIME / 2);
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

    // 跳躍
    if (this.air) {
      this.vy += this.gravity() * dt;
      this.py += this.vy * dt;
      if (this.py >= 0) {
        this.py = 0;
        this.vy = 0;
        this.air = false;
        this.squash = 1.14;
        if (this.queued) {
          this.queued = false;
          this.jump();
        }
      }
    }

    // 通過の判定
    for (let i = 0; i < this.lane.length; i++) {
      const h = this.lane[i];
      if (h.passed || this.t < h.tHit) continue;

      // ---- ここがゆずれない一点 ----------------------------------------
      // カウントを進めるこの3行は `this.air` を読まない。跳べたかどうかに
      // かかわらず、ハードルは通過し、数は必ず進む。腕前が効くのは下の
      // コイン（clean）だけ。ここに条件を足すと、企画そのものが崩れる。
      h.passed = true;
      this.counted = h.n;
      this.pop = 0.34;
      if (h.kind !== 'gate') this.ones.push(h.kind);
      // ------------------------------------------------------------------

      if (h.kind === 'gate') {
        // アーチは くぐるもの。絶対につまずかない、ごほうびの拍
        h.clean = true;
        this.clean++;
        this.jumped++;
        this.tens++;
        this.ones = [];
        this.hearts = HEARTS;
        this.dropCoin(h);
        sfx.beat();
        continue;
      }

      this.jumped++;
      if (this.air) {
        h.clean = true;
        this.clean++;
        this.dropCoin(h);
        sfx.coin();
      } else {
        h.broken = true;
        this.hurt = 0.5;
        this.tripAt = this.t;
        this.tripIdx = i;
        sfx.stumble();
        if (this.opts?.mode === 'endless') this.hearts--;
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

    if (left > 0) return;

    if (!this.revealed) {
      // ここで はじめて答えを見せる。子どもが自分の足で出した数が、
      // そのまま `?` の場所に入る
      this.revealed = true;
      this.hold = 1.2;
      const f = this.currentFact();
      if (f) {
        this.hooks.onAnswer(f, f.a + f.b);
        sfx.correct(this.at);
      }
      return;
    }

    this.hold -= dt;
    if (this.hold <= 0) this.advance();
  }

  private advance(): void {
    const o = this.opts;
    if (!o || o.mode !== 'facts') return;
    this.at++;
    if (this.at >= o.facts.length) {
      this.finish();
      return;
    }
    this.counted = 0;
    this.tens = 0;
    this.ones = [];
    this.hold = 0;
    this.revealed = false;
    this.buildNext();
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
    this.drawCount(px, footY - size - 10 * s);

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

    this.drawTens();
    this.drawStatus();
  }

  /** ふつうのハードル。つまずいたものは たおれる */
  private drawHurdle(x: number, groundY: number, h: Hurdle): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const col = h.kind === 'need' ? KIIRO : h.kind === 'rest' ? MIDORI : BLUE;
    const edge = h.kind === 'need' ? KIIRO_DARK : h.kind === 'rest' ? MIDORI_DARK : BLUE_DARK;
    const hh = 22 * s;

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

  /** 10のもん。くぐるもので、つまずかない */
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
  }

  /** 頭の上のふきだし。増えるたびに はずむ */
  private drawCount(x: number, y: number): void {
    const g = this.g;
    if (!g) return;
    const s = this.s;
    const grow = reduced() ? 1 : 1 + this.pop * 0.8;
    const text = String(this.counted);

    g.save();
    g.translate(x, Math.max(y, 26 * s));
    g.scale(grow, grow);
    g.font = `900 ${20 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    const w = Math.max(g.measureText(text).width + 16 * s, 30 * s);
    const h = 26 * s;
    g.fillStyle = this.pop > 0.2 ? KIIRO : '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 2.5 * s;
    this.round(-w / 2, -h, w, h, 8 * s);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, -h / 2);
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
