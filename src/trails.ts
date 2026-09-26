/**
 * はしる あと。走っているあいだ、足もとに ほし・ハート・にじ… が残る きせかえ。
 *
 * きせかえの ほかの品（キャラ・ぼうし・アクセ・いろ・ぶき）は、走っているあいだは
 * 小さな キャラの からだの上にしか出ない。ここは **走った うしろの 地面と空** に出る
 * 唯一の品で、走っているかぎり ずっと見えている。
 *
 * 問題を読む じゃまを しないように、3つだけ守る。
 *   ・足もとの高さから出す（式は画面の上、こたえは下の ボタン。そのあいだに入れない）
 *   ・すぐ消える（1秒ほど）
 *   ・止まっているあいだ（にがて たいじ・フィニッシュ・ヒントで止めている）は出さない
 *
 * 5連続からの金の つぶ（runner.ts の drawTrail）は コンボの合図なので、こことは別に残す。
 * 見た目だけで、強さには一切影響しない（items.ts と同じ）。
 */

export interface TrailDef {
  id: string;
  label: string;
  /** きせかえで えらんだときに出す ひとこと */
  note: string;
}

export const TRAILS: TrailDef[] = [
  { id: 'tr-paw', label: 'にくきゅう', note: 'はしった ところに あしあとが つく' },
  { id: 'tr-star', label: 'ほし', note: 'きらきら ほしが こぼれる' },
  { id: 'tr-heart', label: 'ハート', note: 'ハートが ふわふわ のぼる' },
  { id: 'tr-bubble', label: 'シャボンだま', note: 'あわが ぷかぷか うかぶ' },
  { id: 'tr-petal', label: 'はなびら', note: 'はなびらが ひらひら まう' },
  { id: 'tr-note', label: 'おんぷ', note: 'おんぷが はずむ' },
  { id: 'tr-fire', label: 'ほのお', note: 'あしもとから ほのおが でる' },
  { id: 'tr-rainbow', label: 'にじ', note: 'にじの みちが のびる' },
];

export function trailDef(id: string): TrailDef | null {
  return TRAILS.find((x) => x.id === id) ?? null;
}

type Shape = 'paw' | 'star' | 'heart' | 'bubble' | 'petal' | 'note' | 'fire';

const SHAPE: Record<string, Shape> = {
  'tr-paw': 'paw',
  'tr-star': 'star',
  'tr-heart': 'heart',
  'tr-bubble': 'bubble',
  'tr-petal': 'petal',
  'tr-note': 'note',
  'tr-fire': 'fire',
};

const RAINBOW = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'];
const NOTE_COLORS = ['#4dabf7', '#ff8fb1', '#69c07a', '#ffa94d'];
const PETAL_COLORS = ['#ffb3c7', '#ffc9d9', '#ffd6e3'];

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  /** 色えらび・ゆれの位相に使う */
  seed: number;
}

interface RibbonPt {
  x: number;
  y: number;
  age: number;
}

/** 1こ ずつの ながさ（秒） */
const LIFE: Record<Shape, number> = {
  paw: 1.1,
  star: 0.7,
  heart: 0.85,
  bubble: 0.95,
  petal: 0.95,
  note: 0.8,
  fire: 0.38,
};

/** 出す間隔（秒）。にくきゅう だけは 時間ではなく 進んだ きょりで出す */
const EVERY: Record<Shape, number> = {
  paw: 0,
  star: 0.075,
  heart: 0.12,
  bubble: 0.13,
  petal: 0.09,
  note: 0.14,
  fire: 0.035,
};

/** にじが どこまで のびるか（秒）。これより古い点は捨てる */
const RIBBON_AGE = 0.55;

export interface TrailFeet {
  /** 足もとの位置（画面ピクセル） */
  x: number;
  y: number;
  /** 世界が左へ流れる速さ（px/秒）。止まっていれば 0 */
  speed: number;
  /** 大きさの倍率（runner の s） */
  s: number;
  /** 空中か。にくきゅう は 地面に ついているときだけ押す */
  air: boolean;
  /** いま出すか。false でも 出ているぶんは 流れて消える */
  on: boolean;
}

/** 走るあとを出して、動かして、描く。ランナーと きせかえの見本が1つずつ持つ */
export class TrailFx {
  private id = '';
  private bits: Bit[] = [];
  private ribbon: RibbonPt[] = [];
  private acc = 0;
  private dist = 0;
  private step = 0;

  /** 身につけている あとを入れかえる（出ているぶんは消す） */
  set(id: string): void {
    if (id === this.id) return;
    this.id = id;
    this.clear();
  }

  clear(): void {
    this.bits = [];
    this.ribbon = [];
    this.acc = 0;
    this.dist = 0;
  }

  update(dt: number, f: TrailFeet): void {
    const shape = SHAPE[this.id];
    const drift = f.speed * dt;

    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.bits.splice(i, 1);
        continue;
      }
      b.x += b.vx * dt - drift;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      if (shape === 'petal') b.vy += 18 * f.s * dt;
    }

    if (this.id === 'tr-rainbow') {
      for (let i = this.ribbon.length - 1; i >= 0; i--) {
        const p = this.ribbon[i];
        p.age += dt;
        p.x -= drift;
        if (p.age > RIBBON_AGE) this.ribbon.splice(i, 1);
      }
      if (f.on && f.speed > 0) this.ribbon.push({ x: f.x - 6 * f.s, y: f.y - 11 * f.s, age: 0 });
      return;
    }
    if (!shape || !f.on || f.speed <= 0) return;

    if (shape === 'paw') {
      // あしあとは「押した場所に残る」もの。時間で出すと 速さで間が変わって見える
      this.dist += drift;
      const gap = 15 * f.s;
      if (this.dist >= gap) {
        this.dist %= gap;
        if (!f.air) {
          this.step = 1 - this.step;
          this.push(shape, f, f.x - 4 * f.s, f.y + (this.step ? -1.6 : 1.6) * f.s);
        }
      }
      return;
    }

    this.acc += dt;
    while (this.acc >= EVERY[shape]) {
      this.acc -= EVERY[shape];
      const y = f.y - (shape === 'fire' ? 3 : 6 + Math.random() * 12) * f.s;
      // キャラ（±17）の せなかの すぐうしろから出す。ランナーでは その うしろに
      // ペット（中心が 36 うしろ）がいるので、そのすきまから出て ペットの上を流れていく
      this.push(shape, f, f.x - (17 + Math.random() * 5) * f.s, y);
    }
  }

  private push(shape: Shape, f: TrailFeet, x: number, y: number): void {
    const s = f.s;
    const up: Record<Shape, number> = { paw: 0, star: -26, heart: -34, bubble: -28, petal: -6, note: -40, fire: -46 };
    this.bits.push({
      x,
      y,
      vx: shape === 'paw' ? 0 : (Math.random() - 0.5) * 16 * s,
      vy: (up[shape] - Math.random() * 14) * s,
      life: LIFE[shape],
      max: LIFE[shape],
      size: (shape === 'fire' ? 3.4 : shape === 'paw' ? 3 : 2.6 + Math.random() * 1.4) * s,
      rot: shape === 'petal' || shape === 'star' ? Math.random() * Math.PI : 0,
      vr: shape === 'petal' ? 5 : shape === 'star' ? 3 : 0,
      seed: Math.random(),
    });
    // 出しすぎない。重い端末で たまっていかないように
    if (this.bits.length > 60) this.bits.shift();
  }

  /**
   * 描く。layer は重ね順。
   *   back  … 地面に つくもの（にくきゅう）と にじ。キャラと ペットの うしろに描く
   *   front … 宙に うかぶもの。ランナーでは ペットが キャラの すぐうしろを走っていて、
   *           うしろに描くと ほとんど ペットに かくれる。キャラと ペットを描いたあとに描く
   */
  draw(g: CanvasRenderingContext2D, s: number, layer: 'back' | 'front'): void {
    if (this.id === 'tr-rainbow') {
      if (layer === 'back') drawRibbon(g, this.ribbon.map((p) => ({ x: p.x, y: p.y, a: 1 - p.age / RIBBON_AGE })), s);
      return;
    }
    const shape = SHAPE[this.id];
    if (!shape || (shape === 'paw') !== (layer === 'back')) return;
    for (const b of this.bits) drawBit(g, shape, b, Math.min(1, (b.life / b.max) * 1.6));
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- 絵

function drawRibbon(g: CanvasRenderingContext2D, pts: { x: number; y: number; a: number }[], s: number): void {
  if (pts.length < 2) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 2.2 * s;
  RAINBOW.forEach((color, band) => {
    const off = (band - (RAINBOW.length - 1) / 2) * 2 * s;
    g.strokeStyle = color;
    // 古いほうほど うすく。1本の線で描くと 色がそろわないので、区切って描く
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      g.globalAlpha = Math.max(0, Math.min(a.a, b.a)) * 0.85;
      g.beginPath();
      g.moveTo(a.x, a.y + off);
      g.lineTo(b.x, b.y + off);
      g.stroke();
    }
  });
  g.restore();
}

function drawBit(g: CanvasRenderingContext2D, shape: Shape, b: Bit, alpha: number): void {
  g.globalAlpha = alpha;
  const r = b.size;
  switch (shape) {
    case 'paw': {
      // まるい肉球1つと、進む向き（右）に 扇に並ぶ ゆびの4つ
      g.fillStyle = 'rgba(110,72,50,.55)';
      const x = b.x;
      const y = b.y;
      g.beginPath();
      g.ellipse(x, y, r * 0.7, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      for (const a of [-1.05, -0.36, 0.36, 1.05]) {
        g.beginPath();
        g.arc(x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2, r * 0.3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'star':
      g.fillStyle = b.seed < 0.5 ? '#ffd257' : '#fff1a8';
      star(g, b.x, b.y, r * 1.2, b.rot);
      break;
    case 'heart':
      g.fillStyle = b.seed < 0.5 ? '#ff8fb1' : '#ff6b8f';
      heart(g, b.x + Math.sin(b.life * 7 + b.seed * 6) * r * 0.5, b.y, r * 1.1);
      break;
    case 'bubble': {
      const x = b.x + Math.sin(b.life * 6 + b.seed * 6) * r * 0.6;
      g.fillStyle = 'rgba(190,235,255,.35)';
      g.strokeStyle = 'rgba(110,190,235,.9)';
      g.lineWidth = Math.max(1, r * 0.28);
      g.beginPath();
      g.arc(x, b.y, r * 1.25, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      g.arc(x - r * 0.45, b.y - r * 0.45, r * 0.32, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'petal': {
      g.fillStyle = PETAL_COLORS[Math.floor(b.seed * PETAL_COLORS.length)];
      g.save();
      g.translate(b.x + Math.sin(b.life * 5 + b.seed * 6) * r, b.y);
      g.rotate(b.rot);
      g.beginPath();
      g.ellipse(0, 0, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    }
    case 'note': {
      g.fillStyle = NOTE_COLORS[Math.floor(b.seed * NOTE_COLORS.length)];
      const x = b.x;
      const y = b.y;
      g.beginPath();
      g.ellipse(x - r * 0.35, y + r * 0.55, r * 0.62, r * 0.45, -0.4, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + r * 0.12, y - r * 1.1, r * 0.26, r * 1.7);
      g.beginPath();
      g.moveTo(x + r * 0.38, y - r * 1.1);
      g.quadraticCurveTo(x + r * 1.2, y - r * 0.7, x + r * 0.9, y - r * 0.1);
      g.lineTo(x + r * 0.38, y - r * 0.55);
      g.closePath();
      g.fill();
      break;
    }
    case 'fire': {
      // 生まれたては 黄色、消えぎわは 赤。上へ のびながら 小さくなる
      const k = b.life / b.max;
      const w = r * (0.5 + k * 0.6);
      g.fillStyle = k > 0.66 ? '#ffe066' : k > 0.33 ? '#ffa94d' : '#ff6b6b';
      g.beginPath();
      g.moveTo(b.x, b.y - w * 2.1);
      g.bezierCurveTo(b.x + w * 1.1, b.y - w * 0.8, b.x + w, b.y + w * 0.8, b.x, b.y + w * 0.9);
      g.bezierCurveTo(b.x - w, b.y + w * 0.8, b.x - w * 1.1, b.y - w * 0.8, b.x, b.y - w * 2.1);
      g.fill();
      break;
    }
  }
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function heart(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.5, y - r * 0.3, x - r * 0.4, y - r * 1.2, x, y - r * 0.35);
  g.bezierCurveTo(x + r * 0.4, y - r * 1.2, x + r * 1.5, y - r * 0.3, x, y + r * 0.9);
  g.closePath();
  g.fill();
}

/**
 * きせかえの マス用の絵。キャラは描かず、あとそのものを大きく見せる
 * （ぶきの マスと同じ。小さいマスでキャラと一緒に描くと、何が付くのか読めない）。
 * 左下から右へ、ぴょんと跳んだ弧に沿って並べる。毎回同じ絵になるよう、乱数は使わない。
 */
export function paintTrailIcon(canvas: HTMLCanvasElement, id: string, size = 56): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);

  const s = size / 34;
  const arc = (u: number) => ({ x: size * (0.14 + u * 0.72), y: size * (0.72 - Math.sin(u * Math.PI) * 0.32) });

  if (id === 'tr-rainbow') {
    const pts = Array.from({ length: 13 }, (_, i) => ({ ...arc(i / 12), a: 0.35 + (i / 12) * 0.65 }));
    drawRibbon(g, pts, s * 1.25);
    return;
  }
  const shape = SHAPE[id];
  if (!shape) return;

  // マスの絵は 走っているときより ずっと大きく描く（56px の中で形が読めるように）
  if (shape === 'paw') {
    // 地面に 4つ、左右かわりばんこに
    for (let i = 0; i < 4; i++) {
      const b = bitAt(size * (0.17 + i * 0.21), size * (0.6 + (i % 2 ? -0.1 : 0.1)), s * 3.6, 0);
      drawBit(g, 'paw', b, 0.55 + i * 0.15);
    }
    g.globalAlpha = 1;
    return;
  }

  const seeds = [0.2, 0.7, 0.4, 0.9, 0.1, 0.6];
  for (let i = 0; i < 5; i++) {
    const p = arc(i / 4);
    const b = bitAt(p.x, p.y, s * (shape === 'fire' ? 3.6 : 3.4) * (0.75 + i * 0.07), seeds[i]);
    b.rot = i * 0.7;
    if (shape === 'fire') b.life = b.max * (0.4 + i * 0.15);
    drawBit(g, shape, b, 0.6 + i * 0.1);
  }
  g.globalAlpha = 1;
}

function bitAt(x: number, y: number, size: number, seed: number): Bit {
  return { x, y, vx: 0, vy: 0, life: 1, max: 1, size, rot: 0, vr: 0, seed };
}
