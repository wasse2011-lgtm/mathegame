/**
 * はなび。ホームの空に上がる、コインの小さい使いみち（ねだん・1日の数は treats.ts）。
 *
 * 1回 押すと 3発。ひゅーっと上がって、まる・ハート・ほし の どれかの形に ひらく。
 * 上がっているあいだだけ 空を少し暗くして、ひらいた色を見えやすくする
 * （ホームの空は明るい水色なので、そのままだと はなびの色が 空に とける）。
 *
 * 絵はホームの上に重ねた1枚の canvas に描く。さわれない（pointer-events: none）ので、
 * 上がっているあいだも ボタンは ふつうに押せる。見た目だけで、記録は何も動かさない。
 */

import { sfx } from './audio';

type Shape = 'round' | 'heart' | 'star';

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** ここまで上がったら ひらく */
  top: number;
  color: string;
  shape: Shape;
  /** 打ち上げまでの待ち（秒） */
  wait: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

const COLORS = ['#ff6b8f', '#ffd257', '#69db7c', '#4dabf7', '#b197fc', '#ff9f43'];

/** ひらいてから消えるまで（秒） */
const SPARK_LIFE = 1.5;

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Hanabi {
  private g: CanvasRenderingContext2D | null;
  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private raf = 0;
  private last = 0;
  private W = 0;
  private H = 0;
  /** 空の暗さ（0..1）。上がっているあいだ 1 に向かい、おわると 0 に戻る */
  private dusk = 0;
  /** ひらいた瞬間に呼ぶ（広場の なかまを跳ねさせる） */
  onBurst: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d');
  }

  /** いま上がっているか（上がっているあいだに また押されても 重ねて打つ） */
  get busy(): boolean {
    return this.rockets.length > 0 || this.sparks.length > 0;
  }

  /**
   * 3発 打ち上げる。fromX/fromY は 打ち上げる場所（画面の座標）。
   * 空の まんなかあたりへ 少しずつ ずらして上げる。
   */
  launch(fromX: number, fromY: number): void {
    this.resize();
    const { W, H } = this;
    const shapes: Shape[] = ['round', 'heart', 'star'];
    // 形は毎回ならびを変える。同じ順だと 2回めから先が読める
    shapes.sort(() => Math.random() - 0.5);
    for (let i = 0; i < 3; i++) {
      const tx = W * (0.22 + i * 0.28 + (Math.random() - 0.5) * 0.08);
      const top = H * (0.14 + Math.random() * 0.2);
      const t = 1.05;
      this.rockets.push({
        x: fromX,
        y: fromY,
        vx: (tx - fromX) / t,
        vy: -(fromY - top) / t,
        top,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: shapes[i],
        wait: i * 0.42,
      });
    }
    if (!this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** 画面を離れるとき。のこっている はなびは そのまま消す */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.rockets = [];
    this.sparks = [];
    this.dusk = 0;
    this.g?.clearRect(0, 0, this.W, this.H);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private burst(r: Rocket): void {
    const n = reduced() ? 22 : 44;
    const speed = Math.min(this.W, this.H) * 0.42;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const [dx, dy] = shapeDir(r.shape, a);
      const k = 0.92 + Math.random() * 0.16;
      this.sparks.push({
        x: r.x,
        y: r.y,
        vx: dx * speed * k,
        vy: dy * speed * k,
        life: SPARK_LIFE,
        max: SPARK_LIFE,
        // ところどころ 白と金を まぜて きらきらさせる
        color: i % 7 === 0 ? '#ffffff' : i % 5 === 0 ? '#ffe9a8' : r.color,
        size: 2.2 + Math.random() * 1.4,
      });
    }
    sfx.boom();
    this.onBurst?.();
  }

  private frame = (ts: number): void => {
    const g = this.g;
    if (!g) return;
    const dt = Math.min(this.last ? (ts - this.last) / 1000 : 1 / 60, 1 / 20);
    this.last = ts;
    const { W, H } = this;

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      if (r.wait > 0) {
        r.wait -= dt;
        if (r.wait <= 0) sfx.whistle();
        continue;
      }
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      if (r.y <= r.top) {
        this.rockets.splice(i, 1);
        this.burst(r);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      // ひらいた形を しばらく保ってから、ゆっくり たれる
      const drag = Math.max(0, 1 - dt * 2.2);
      s.vx *= drag;
      s.vy = s.vy * drag + 60 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    const on = this.busy;
    this.dusk += ((on ? 1 : 0) - this.dusk) * Math.min(1, dt * (on ? 3 : 2));

    g.clearRect(0, 0, W, H);
    if (this.dusk > 0.01) {
      const sky = g.createLinearGradient(0, 0, 0, H * 0.75);
      sky.addColorStop(0, `rgba(18,28,70,${0.42 * this.dusk})`);
      sky.addColorStop(1, 'rgba(18,28,70,0)');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H * 0.75);
    }

    for (const r of this.rockets) {
      if (r.wait > 0) continue;
      // のぼっていく光と、しっぽ
      g.strokeStyle = 'rgba(255,236,170,.75)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(r.x, r.y);
      g.lineTo(r.x - r.vx * 0.06, r.y - r.vy * 0.06);
      g.stroke();
      g.fillStyle = '#fff6d6';
      g.beginPath();
      g.arc(r.x, r.y, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    for (const s of this.sparks) {
      const k = s.life / s.max;
      // 消えぎわは またたく
      g.globalAlpha = k < 0.35 ? k / 0.35 * (0.6 + Math.random() * 0.4) : 1;
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(s.x, s.y, s.size * (0.6 + k * 0.4), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (on || this.dusk > 0.01) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.raf = 0;
      g.clearRect(0, 0, W, H);
    }
  };
}

/** ひらく向き。a は まわりの角度。形の ふちに 粒が並ぶように 速さを変える */
function shapeDir(shape: Shape, a: number): [number, number] {
  switch (shape) {
    case 'heart': {
      // ハートの曲線（よく知られた式）を 大きさ 1 くらいに ちぢめる
      const x = 16 * Math.sin(a) ** 3;
      const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
      return [x / 17, y / 17];
    }
    case 'star': {
      // 5つの とんがり。とがった先ほど 遠くへ とばす
      const r = 0.55 + 0.45 * Math.abs(Math.cos((a * 5) / 2));
      return [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r];
    }
    default:
      return [Math.cos(a), Math.sin(a)];
  }
}
