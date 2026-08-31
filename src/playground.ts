/**
 * ぴょんぴょん広場（タイトルの草の上）。
 *
 * 前は、いま着ているキャラが1ぴきその場で走っているだけだった。
 * ここを「さわれる場所」にする。じぶんの子と集めたなかまが跳ねまわり、
 * さわると鳴いて、跳んで、回って、また跳ねかたが変わる。
 * タイトルは毎回いちばん最初に見る画面なので、ここが動くと戻ってきたくなる。
 */

import { sfx } from './audio';
import { drawPet } from './petart';
import { voiceOf, type PetDef } from './pets';
import { roundRect } from './sprites';

type Action = 'jump' | 'spin' | 'heart' | 'shout' | 'dance';

const ACTIONS: Action[] = ['jump', 'spin', 'heart', 'shout', 'dance'];

/** ふきだしに出す短い言葉。長い説明はここには入れない（読めない） */
const VOICE_TEXT: Record<ReturnType<typeof voiceOf>, string> = {
  bird: 'ぴよっ',
  bug: 'ジジッ',
  beast: 'ガオー',
  blob: 'ぷるん',
  ghost: 'ふわ〜',
  small: 'きゅっ',
};

const HERO_TEXT = ['いくぞー！', 'やっほー！', 'たのしい！', 'えいっ'];

export interface Actor {
  /** null なら いま着ているキャラ（かいぬし） */
  pet: PetDef | null;
  /** 横位置（0..1） */
  u: number;
  dir: 1 | -1;
  /** ぴょんぴょんの位相 */
  phase: number;
  rate: number;
  lift: number;
  squash: number;
  action: Action | null;
  aT: number;
  spin: number;
  size: number;
  hopBoost: number;
  /** 画面上の位置。当たり判定に使う（描くたびに更新する） */
  x: number;
  y: number;
}

interface Puff {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; kind: 'star' | 'heart' | 'note'; color: string;
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** さわられたときの反応をひとつ決める。同じものが続かないようにする */
export function pickAction(prev: Action | null): Action {
  const next = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  return next === prev ? ACTIONS[(ACTIONS.indexOf(next) + 1) % ACTIONS.length] : next;
}

export class Playground {
  private g: CanvasRenderingContext2D | null;
  private actors: Actor[] = [];
  private puffs: Puff[] = [];
  private raf = 0;
  private last = 0;
  private t = 0;
  private W = 300;
  private H = 116;
  private running = false;
  /** かいぬしを描くための関数。sprites の currentLook をそのまま渡す */
  private drawHero: (g: CanvasRenderingContext2D, x: number, y: number, size: number, t: number, squash: number, air: boolean) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    drawHero: Playground['drawHero'],
  ) {
    this.g = canvas.getContext('2d');
    this.drawHero = drawHero;

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.poke(e.clientX - rect.left, e.clientY - rect.top);
    });

    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
  }

  // ---------------------------------------------------------------- 出入り

  /**
   * 出すなかまを入れかえる。すでに居る子はその場に残す
   * （ペットを変えるたびに全員がワープすると、見ていてうるさい）
   */
  setCast(pets: (PetDef | null)[]): void {
    this.actors = pets.map((pet, i) => {
      const old = this.actors.find((a) => (a.pet?.id ?? '') === (pet?.id ?? ''));
      return old ?? this.makeActor(pet, i, pets.length);
    });
    this.layout();
  }

  private makeActor(pet: PetDef | null, i: number, n: number): Actor {
    return {
      pet,
      u: n > 1 ? 0.12 + (i / (n - 1)) * 0.76 : 0.5,
      dir: i % 2 ? 1 : -1,
      phase: Math.random() * Math.PI,
      rate: 3.4 + Math.random() * 1.6,
      lift: 0.34 + Math.random() * 0.16,
      squash: 1,
      action: null,
      aT: 0,
      spin: 0,
      size: 32,
      hopBoost: 1,
      x: 0,
      y: 0,
    };
  }

  /** 混みすぎないように、大きさを頭数で決める */
  private layout(): void {
    const n = Math.max(this.actors.length, 1);
    const size = Math.min(this.H * 0.42, (this.W / n) * 0.74, 44);
    for (const a of this.actors) {
      // かいぬしは ペットより ひとまわり大きい
      a.size = Math.max(20, size) * (a.pet ? 0.86 : 1.15);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---------------------------------------------------------------- さわる

  /** ロゴなど、外からまとめて跳ばせたいとき */
  cheerAll(): void {
    this.actors.forEach((a, i) => {
      window.setTimeout(() => this.act(a, 'jump'), i * 90);
    });
  }

  private poke(px: number, py: number): void {
    let hit: Actor | null = null;
    let best = Infinity;
    for (const a of this.actors) {
      const dx = Math.abs(px - a.x);
      const dy = Math.abs(py - (a.y - a.size * 0.5));
      // 指はおおざっぱなので、当たり判定は見た目より少し広くとる
      if (dx > a.size * 0.95 || dy > a.size * 0.95) continue;
      const d = dx + dy;
      if (d < best) {
        best = d;
        hit = a;
      }
    }

    if (hit) {
      this.act(hit, pickAction(hit.action));
      return;
    }

    // 空ぶりでも何か起きる。草がふわっと舞って、みんなが小さく跳ねる
    this.burst(px, py, 4, 'star', '#ffe08a');
    for (const a of this.actors) {
      a.phase = 0;
      a.rate = 4.6;
    }
  }

  private act(a: Actor, action: Action): void {
    a.action = action;
    a.aT = 0;
    a.spin = 0;
    // さわられるたびに向きと跳ねかたが変わる
    a.dir = Math.random() < 0.5 ? -1 : 1;
    a.rate = 3.6 + Math.random() * 2.2;
    a.lift = 0.34 + Math.random() * 0.2;
    sfx.voice(a.pet ? voiceOf(a.pet.art) : 'small');

    if (action === 'heart') this.burst(a.x, a.y - a.size, 5, 'heart', '#ff8aa0');
    if (action === 'spin') this.burst(a.x, a.y - a.size, 7, 'star', '#ffd257');
    if (action === 'dance') this.burst(a.x, a.y - a.size, 4, 'note', '#7fd1ff');
    if (action === 'jump') this.burst(a.x, a.y, 6, 'star', '#c9f0a8');
  }

  private burst(x: number, y: number, n: number, kind: Puff['kind'], color: string): void {
    for (let i = 0; i < n; i++) {
      this.puffs.push({
        x, y,
        vx: (Math.random() - 0.5) * 90,
        vy: -40 - Math.random() * 90,
        life: 0.9, max: 0.9, kind, color,
      });
    }
  }

  // ---------------------------------------------------------------- ループ

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.W = Math.round(rect.width);
    this.H = Math.round(rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  private frame = (ts: number): void => {
    if (!this.running) return;
    if (!this.last) this.last = ts;
    const dt = Math.min((ts - this.last) / 1000, 1 / 20);
    this.last = ts;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    this.t += dt;
    const still = reduced();

    for (const a of this.actors) {
      if (a.action) {
        a.aT += dt;
        const dur = a.action === 'spin' ? 0.7 : a.action === 'shout' ? 1.1 : 1.2;
        if (a.action === 'spin') a.spin = Math.min(1, a.aT / 0.7) * Math.PI * 2;
        if (a.aT >= dur) {
          a.action = null;
          a.spin = 0;
        }
      }

      a.hopBoost = a.action === 'jump' ? 2.1 : a.action === 'spin' ? 1.5 : 1;
      const before = Math.sin(a.phase);
      // 動きを減らす設定のときは地面に降ろしておく。さわられたときだけ動く
      if (still && !a.action) a.phase = 0;
      else a.phase += a.rate * dt * (a.action === 'jump' ? 1.4 : 1);
      // 着地の瞬間だけ、ぐにゃっとつぶす
      if (before > 0 && Math.sin(a.phase) <= 0) a.squash = 0.8;
      a.squash += (1 - a.squash) * Math.min(1, dt * 10);

      // 跳んでいるあいだだけ横に進む。歩かず、跳ねて移動する
      const air = Math.abs(Math.sin(a.phase));
      if (a.action !== 'dance') a.u += a.dir * air * dt * 0.11;
      if (a.u < 0.08) { a.u = 0.08; a.dir = 1; }
      if (a.u > 0.92) { a.u = 0.92; a.dir = -1; }
    }

    // かさなって見えないよう、近づきすぎた子はそっと押しあう
    const span = Math.max(this.W - 32, 1);
    for (let i = 0; i < this.actors.length; i++) {
      for (let j = i + 1; j < this.actors.length; j++) {
        const a = this.actors[i];
        const b = this.actors[j];
        const min = (Math.max(a.size, b.size) * 0.9) / span;
        const d = b.u - a.u;
        const gap = Math.abs(d);
        if (gap >= min) continue;
        const push = ((min - gap) / 2) * (d >= 0 ? 1 : -1);
        a.u = Math.min(Math.max(a.u - push, 0.06), 0.94);
        b.u = Math.min(Math.max(b.u + push, 0.06), 0.94);
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const q = this.puffs[i];
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 90 * dt;
      if (q.life <= 0) this.puffs.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- 描画

  private draw(): void {
    const g = this.g;
    if (!g) return;
    const { W, H } = this;
    g.clearRect(0, 0, W, H);

    const groundY = H - Math.max(10, H * 0.12);
    this.drawTufts(groundY);

    for (const a of this.actors) {
      const air = Math.abs(Math.sin(a.phase)) * a.hopBoost;
      const wiggle = a.action === 'dance' ? Math.sin(this.t * 14) * a.size * 0.28 : 0;
      a.x = 16 + a.u * (W - 32) + wiggle;
      a.y = groundY - air * a.size * a.lift;

      // かげ（高いほど小さく薄く）
      const lift = Math.min(1, (groundY - a.y) / (a.size * 0.7));
      g.fillStyle = `rgba(40,70,45,${0.2 * (1 - lift * 0.6)})`;
      g.beginPath();
      g.ellipse(a.x, groundY + 2, a.size * 0.4 * (1 - lift * 0.3), a.size * 0.12, 0, 0, Math.PI * 2);
      g.fill();

      g.save();
      if (a.spin) {
        g.translate(a.x, a.y - a.size * 0.5);
        g.rotate(a.spin);
        g.translate(-a.x, -(a.y - a.size * 0.5));
      }
      const happy = a.action === 'heart' ? 1 + Math.sin(this.t * 16) * 0.1 : 1;
      if (a.pet) {
        drawPet(g, a.x, a.y, a.size, a.pet.art, this.t + a.phase);
      } else {
        this.drawHero(g, a.x, a.y, a.size, this.t + a.phase, a.squash * happy, air > 0.2);
      }
      g.restore();

      if (a.action === 'shout') {
        const text = a.pet ? VOICE_TEXT[voiceOf(a.pet.art)] : HERO_TEXT[Math.floor(a.x) % HERO_TEXT.length];
        this.drawBubble(a.x, a.y - a.size * 1.15, text, a.size);
      }
    }

    for (const q of this.puffs) {
      g.globalAlpha = Math.max(0, q.life / q.max);
      g.fillStyle = q.color;
      if (q.kind === 'heart') this.heart(q.x, q.y, 6);
      else if (q.kind === 'note') this.note(q.x, q.y, 7);
      else this.sparkle(q.x, q.y, 5);
    }
    g.globalAlpha = 1;
  }

  /** 下地は CSS の草。その上に葉っぱだけ生やす */
  private drawTufts(groundY: number): void {
    const g = this.g;
    if (!g) return;
    g.strokeStyle = 'rgba(93,168,79,.5)';
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      const x = ((i * 47) % Math.max(this.W - 24, 40)) + 14;
      const h = 5 + ((i * 13) % 5);
      g.moveTo(x, groundY + 6);
      g.lineTo(x - 3, groundY + 6 - h);
      g.moveTo(x, groundY + 6);
      g.lineTo(x + 1, groundY + 6 - h - 2);
      g.moveTo(x, groundY + 6);
      g.lineTo(x + 4, groundY + 6 - h);
    }
    g.stroke();
  }

  private drawBubble(x: number, y: number, text: string, size: number): void {
    const g = this.g;
    if (!g) return;
    g.font = `700 ${Math.max(11, size * 0.36)}px "Hiragino Maru Gothic ProN", sans-serif`;
    const w = g.measureText(text).width + size * 0.42;
    const h = size * 0.6;
    const bx = Math.min(Math.max(x - w / 2, 2), this.W - w - 2);
    // 高く跳んでいる子のふきだしが、画面の上に出て しっぽだけ残らないようにする
    y = Math.max(y, h + 4);
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(38,49,61,.18)';
    g.lineWidth = 2;
    roundRect(g, bx, y - h, w, h, h * 0.42);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x - size * 0.12, y - 1);
    g.lineTo(x + size * 0.1, y - 1);
    g.lineTo(x, y + size * 0.16);
    g.closePath();
    g.fill();
    g.fillStyle = '#26313d';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, bx + w / 2, y - h / 2);
  }

  private sparkle(x: number, y: number, r: number): void {
    const g = this.g;
    if (!g) return;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const rad = i % 2 ? r * 0.38 : r;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  private heart(x: number, y: number, r: number): void {
    const g = this.g;
    if (!g) return;
    g.beginPath();
    g.moveTo(x, y + r * 0.9);
    g.bezierCurveTo(x - r * 1.5, y - r * 0.3, x - r * 0.4, y - r * 1.2, x, y - r * 0.35);
    g.bezierCurveTo(x + r * 0.4, y - r * 1.2, x + r * 1.5, y - r * 0.3, x, y + r * 0.9);
    g.closePath();
    g.fill();
  }

  private note(x: number, y: number, r: number): void {
    const g = this.g;
    if (!g) return;
    g.beginPath();
    g.ellipse(x - r * 0.3, y + r * 0.4, r * 0.42, r * 0.32, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x + r * 0.02, y - r * 0.8, r * 0.2, r * 1.3);
  }
}
