/**
 * ペットの絵。キャラと同じく画像を持たず、すべて Canvas で描く。
 *
 * 40ぴきぶんの絵をひとつずつ手で描くと保守できないので、
 * 「からだの形」＋「はね・しっぽ・つの…」の組み合わせで作る。
 * かたち別に頭の位置だけ返し、顔は共通の routine が描く。
 */

import type { PetArt } from './pets';
import { roundRect } from './sprites';

const INK = '#2b3440';

interface Head {
  x: number;
  y: number;
  r: number;
}

/** 見た目だけのシルエット（まだ仲間になっていない子） */
const SHADOW: PetArt = { shape: 'round', body: '#cbd5dd', shade: '#b2bfca' };

/**
 * でんせつの子（art.legend）を描く大きさの倍率。
 * 牧場・広場・走っているときに、ほかの子と並んで「格」が違って見える大きさ。
 * これより大きくすると、走るときに主人公（36*s うしろ）と重なりはじめる。
 * アイコンは枠の大きさが決まっているので、ここでは大きくしない（paintPetIcon）。
 */
export const LEGEND_SCALE = 1.22;

/** '#rrggbb' に 透明度を付ける */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** 4本の とがりの きらきら */
function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.closePath();
  g.fill();
}

/** 5つの かどの ほし */
function star5(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function tone(art: PetArt, silhouette: boolean, key: 'body' | 'shade'): string {
  if (silhouette) return SHADOW[key] as string;
  return art[key];
}

// ---------------------------------------------------------------- パーツ

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** 目・口。かたちに関係なく、頭の位置さえ決まれば描ける */
function drawFace(g: CanvasRenderingContext2D, h: Head, art: PetArt, t: number): void {
  const kind = art.face ?? 'dot';
  const blink = Math.sin(t * 1.7) > 0.985 ? 0.22 : 1;
  const dx = h.r * 0.42;
  const ey = h.y - h.r * 0.06;

  if (art.patch) {
    // ぱんだの 目のまわり。黒い上に黒い目は見えないので、白目を敷いてから描く
    g.fillStyle = art.shade;
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.ellipse(h.x + dir * dx, ey + h.r * 0.04, h.r * 0.25, h.r * 0.3, dir * -0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#fff';
    circle(g, h.x - dx, ey, h.r * 0.13);
    circle(g, h.x + dx, ey, h.r * 0.13);
    g.fillStyle = INK;
    circle(g, h.x - dx, ey + h.r * 0.02, h.r * 0.08 * blink);
    circle(g, h.x + dx, ey + h.r * 0.02, h.r * 0.08 * blink);
  } else if (kind === 'big') {
    g.fillStyle = '#fff';
    circle(g, h.x - dx, ey, h.r * 0.32);
    circle(g, h.x + dx, ey, h.r * 0.32);
    g.fillStyle = INK;
    circle(g, h.x - dx, ey + h.r * 0.03, h.r * 0.16 * blink + h.r * 0.02);
    circle(g, h.x + dx, ey + h.r * 0.03, h.r * 0.16 * blink + h.r * 0.02);
  } else {
    g.fillStyle = INK;
    ellipse(g, h.x - dx, ey, h.r * 0.13, h.r * 0.17 * blink);
    ellipse(g, h.x + dx, ey, h.r * 0.13, h.r * 0.17 * blink);
    // でんせつの子は 目に 光を入れる。点の目のままだと ほかの子と同じ顔に見える
    if (art.legend && blink === 1) {
      g.fillStyle = '#fff';
      circle(g, h.x - dx + h.r * 0.04, ey - h.r * 0.07, h.r * 0.055);
      circle(g, h.x + dx + h.r * 0.04, ey - h.r * 0.07, h.r * 0.055);
    }
  }

  // ちいさな口
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, h.r * 0.11);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(h.x, ey + h.r * 0.34, h.r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();

  // ほっぺ
  g.fillStyle = 'rgba(255,138,128,.4)';
  circle(g, h.x - h.r * 0.72, ey + h.r * 0.3, h.r * 0.14);
  circle(g, h.x + h.r * 0.72, ey + h.r * 0.3, h.r * 0.14);
}

function drawWing(g: CanvasRenderingContext2D, art: PetArt, cx: number, cy: number, s: number, t: number, silhouette: boolean): void {
  if (!art.wing) return;
  const flap = Math.sin(t * (art.wing === 'bug' ? 22 : 7)) * 0.4;
  const shade = tone(art, silhouette, 'shade');

  const one = (dir: 1 | -1): void => {
    g.save();
    g.translate(cx + dir * s * 0.24, cy);
    g.rotate(dir * (0.5 + flap));
    switch (art.wing) {
      case 'bug':
        g.fillStyle = silhouette ? 'rgba(190,205,215,.75)' : 'rgba(255,255,255,.62)';
        ellipse(g, 0, -s * 0.18, s * 0.16, s * 0.3);
        break;
      case 'butterfly':
        g.fillStyle = silhouette ? SHADOW.body : art.body;
        ellipse(g, 0, -s * 0.2, s * 0.24, s * 0.3);
        g.fillStyle = silhouette ? SHADOW.shade : art.shade;
        ellipse(g, 0, -s * 0.02, s * 0.16, s * 0.18);
        break;
      case 'fire':
        if (art.legend && !silhouette) {
          // ゆらめく外がわの ほのお
          g.fillStyle = 'rgba(255,98,40,.8)';
          ellipse(g, 0, -s * 0.24, s * (0.25 + Math.sin(t * 13 + dir) * 0.02), s * (0.43 + Math.sin(t * 11) * 0.03));
        }
        g.fillStyle = silhouette ? SHADOW.shade : '#ffb347';
        ellipse(g, 0, -s * 0.2, s * 0.2, s * 0.36);
        g.fillStyle = silhouette ? SHADOW.body : '#ffe08a';
        ellipse(g, 0, -s * 0.18, s * 0.11, s * 0.24);
        break;
      case 'bird':
      case 'big':
      default: {
        const big = art.wing === 'big';
        g.fillStyle = silhouette ? SHADOW.shade : big ? shade : '#ffffff';
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(-s * 0.1, -s * (big ? 0.62 : 0.5), s * (big ? 0.3 : 0.22), -s * (big ? 0.5 : 0.4));
        g.quadraticCurveTo(s * 0.2, -s * 0.1, 0, 0);
        g.closePath();
        g.fill();
        if (art.legend && !silhouette) {
          // でんせつの子の はね。ふちを 光の色で なぞり、中に 羽（ほね）の すじを入れる。
          // まっ白な ペガサスの はねが、白い からだに とけて見えなくなるのも これで防ぐ
          g.strokeStyle = alpha(art.legend, 0.95);
          g.lineWidth = Math.max(1, s * 0.028);
          g.lineJoin = 'round';
          g.stroke();
          g.strokeStyle = big ? alpha('#000000', 0.18) : alpha(art.legend, 0.7);
          g.lineCap = 'round';
          g.beginPath();
          for (const k of [0.35, 0.65]) {
            g.moveTo(s * 0.02, -s * 0.04);
            g.lineTo(s * (big ? 0.3 : 0.22) * k + s * 0.02, -s * (big ? 0.5 : 0.4) * (0.4 + k * 0.6));
          }
          g.stroke();
        }
        break;
      }
    }
    g.restore();
  };

  one(-1);
  one(1);
}

function drawTail(g: CanvasRenderingContext2D, art: PetArt, x: number, y: number, s: number, t: number, silhouette: boolean): void {
  if (!art.tail) return;
  const body = tone(art, silhouette, 'body');
  const shade = tone(art, silhouette, 'shade');
  const wag = Math.sin(t * 5) * s * 0.05;

  switch (art.tail) {
    case 'short':
      g.fillStyle = shade;
      circle(g, x, y + wag, s * 0.08);
      break;
    case 'long':
      g.strokeStyle = shade;
      g.lineWidth = s * 0.1;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + s * 0.06, y);
      g.quadraticCurveTo(x - s * 0.22, y - s * 0.08 + wag, x - s * 0.3, y - s * 0.28 + wag);
      g.stroke();
      break;
    case 'fluffy':
      g.fillStyle = shade;
      ellipse(g, x - s * 0.06, y - s * 0.12 + wag, s * 0.17, s * 0.26);
      if (art.mane && !silhouette) {
        // たてがみと おそろいの すじ（ユニコーンは にじいろの しっぽ）
        stripes(g, art.mane, x - s * 0.06, y - s * 0.12 + wag, s * 0.17, s * 0.26);
        break;
      }
      g.fillStyle = body;
      ellipse(g, x - s * 0.04, y - s * 0.16 + wag, s * 0.1, s * 0.16);
      break;
    case 'fire':
      if (art.legend && !silhouette) {
        // フェニックスの おばね。3本の ほのおが おうぎに ひらいて ゆれる
        for (const [a, len] of [[-0.75, 0.42], [-0.35, 0.5], [0.05, 0.4]] as const) {
          g.save();
          g.translate(x, y);
          g.rotate(a + Math.sin(t * 5 + a * 3) * 0.08);
          g.fillStyle = 'rgba(255,98,40,.85)';
          ellipse(g, -s * len * 0.5, 0, s * len * 0.5, s * 0.08);
          g.fillStyle = '#ffd05a';
          ellipse(g, -s * len * 0.42, 0, s * len * 0.34, s * 0.035);
          g.restore();
        }
      }
      g.fillStyle = silhouette ? SHADOW.shade : '#ff9c3c';
      ellipse(g, x - s * 0.04, y - s * 0.1 + wag, s * 0.14, s * 0.26);
      g.fillStyle = silhouette ? SHADOW.body : '#ffe08a';
      ellipse(g, x - s * 0.02, y - s * 0.12 + wag, s * 0.07, s * 0.16);
      break;
    case 'glow':
      g.fillStyle = silhouette ? SHADOW.shade : `rgba(255,226,120,${0.5 + Math.sin(t * 4) * 0.4})`;
      circle(g, x, y, s * 0.14);
      g.fillStyle = silhouette ? SHADOW.body : '#fff6c8';
      circle(g, x, y, s * 0.07);
      break;
    default:
      break;
  }
}

/** だ円の中を、色の すじで ななめに ぬり分ける（にじいろの しっぽ） */
function stripes(g: CanvasRenderingContext2D, colors: string[], x: number, y: number, rx: number, ry: number): void {
  g.save();
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.clip();
  const band = (ry * 2) / colors.length;
  colors.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    const top = y - ry + band * i;
    g.moveTo(x - rx, top + band * 0.5);
    g.lineTo(x + rx, top - band * 0.5);
    g.lineTo(x + rx, top + band * 0.6);
    g.lineTo(x - rx, top + band * 1.6);
    g.closePath();
    g.fill();
  });
  g.restore();
}

function drawEar(g: CanvasRenderingContext2D, art: PetArt, h: Head, s: number, silhouette: boolean): void {
  const shade = tone(art, silhouette, 'shade');
  const body = tone(art, silhouette, 'body');
  g.fillStyle = shade;
  switch (art.ear) {
    case 'cat':
      g.beginPath();
      g.moveTo(h.x - h.r * 0.8, h.y - h.r * 0.5);
      g.lineTo(h.x - h.r * 0.82, h.y - h.r * 1.3);
      g.lineTo(h.x - h.r * 0.12, h.y - h.r * 0.82);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(h.x + h.r * 0.8, h.y - h.r * 0.5);
      g.lineTo(h.x + h.r * 0.82, h.y - h.r * 1.3);
      g.lineTo(h.x + h.r * 0.12, h.y - h.r * 0.82);
      g.closePath();
      g.fill();
      break;
    case 'round':
      circle(g, h.x - h.r * 0.72, h.y - h.r * 0.78, h.r * 0.34);
      circle(g, h.x + h.r * 0.72, h.y - h.r * 0.78, h.r * 0.34);
      break;
    case 'floppy':
      g.save();
      g.translate(h.x, h.y);
      g.rotate(-0.4);
      ellipse(g, -h.r * 0.85, -h.r * 0.35, h.r * 0.24, h.r * 0.42);
      g.restore();
      g.save();
      g.translate(h.x, h.y);
      g.rotate(0.4);
      ellipse(g, h.r * 0.85, -h.r * 0.35, h.r * 0.24, h.r * 0.42);
      g.restore();
      break;
    case 'antenna':
      g.strokeStyle = shade;
      g.lineWidth = Math.max(1.2, s * 0.035);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(h.x - h.r * 0.35, h.y - h.r * 0.8);
      g.lineTo(h.x - h.r * 0.7, h.y - h.r * 1.5);
      g.moveTo(h.x + h.r * 0.35, h.y - h.r * 0.8);
      g.lineTo(h.x + h.r * 0.7, h.y - h.r * 1.5);
      g.stroke();
      circle(g, h.x - h.r * 0.7, h.y - h.r * 1.5, h.r * 0.13);
      circle(g, h.x + h.r * 0.7, h.y - h.r * 1.5, h.r * 0.13);
      break;
    case 'crest':
      g.fillStyle = silhouette ? SHADOW.shade : '#e4675c';
      g.beginPath();
      g.moveTo(h.x - h.r * 0.34, h.y - h.r * 0.9);
      g.quadraticCurveTo(h.x - h.r * 0.1, h.y - h.r * 1.6, h.x + h.r * 0.16, h.y - h.r * 0.92);
      g.closePath();
      g.fill();
      break;
    case 'mane':
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(h.x - h.r * 0.2, h.y - h.r * 1.05);
      g.quadraticCurveTo(h.x - h.r * 1.5, h.y - h.r * 0.5, h.x - h.r * 1.15, h.y + h.r * 0.5);
      g.quadraticCurveTo(h.x - h.r * 0.5, h.y - h.r * 0.2, h.x - h.r * 0.4, h.y - h.r * 0.95);
      g.closePath();
      g.fill();
      if (art.mane && !silhouette) {
        // 色の すじを、たてがみの そとがわ → うちがわへ 並べる。はみ出しは たてがみの形で切る
        g.save();
        g.clip();
        g.lineCap = 'round';
        g.lineWidth = (h.r * 0.62) / art.mane.length;
        const n = art.mane.length;
        art.mane.forEach((c, i) => {
          const u = (i + 0.5) / n;
          const lx = (a: number, b: number) => h.x - h.r * (a + (b - a) * u);
          const ly = (a: number, b: number) => h.y - h.r * (a + (b - a) * u);
          g.strokeStyle = c;
          g.beginPath();
          g.moveTo(lx(0.2, 0.4), ly(1.05, 0.95));
          g.quadraticCurveTo(lx(1.5, 0.5), ly(0.5, 0.2), h.x - h.r * 1.15, h.y + h.r * 0.5);
          g.stroke();
        });
        g.restore();
      }
      g.fillStyle = body;
      circle(g, h.x - h.r * 0.62, h.y - h.r * 0.95, h.r * 0.2);
      break;
    case 'horn':
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(h.x - h.r * 0.5, h.y - h.r * 0.85);
      g.lineTo(h.x - h.r * 0.62, h.y - h.r * 1.35);
      g.lineTo(h.x - h.r * 0.18, h.y - h.r * 0.95);
      g.closePath();
      g.fill();
      break;
    case 'long':
      // うさぎの ながい みみ。そとは からだの色、なかは shade（もも色）
      for (const dir of [-1, 1]) {
        g.save();
        g.translate(h.x + dir * h.r * 0.4, h.y - h.r * 0.72);
        g.rotate(dir * 0.16);
        g.fillStyle = body;
        ellipse(g, 0, -h.r * 0.6, h.r * 0.24, h.r * 0.64);
        g.fillStyle = shade;
        ellipse(g, 0, -h.r * 0.56, h.r * 0.12, h.r * 0.44);
        g.restore();
      }
      break;
    default:
      break;
  }
}

/** 1本角（ドラゴン・ユニコーン・カブトムシ） */
function drawHorn(g: CanvasRenderingContext2D, art: PetArt, h: Head, silhouette: boolean): void {
  if (!art.horn) return;
  g.fillStyle = silhouette ? SHADOW.shade : '#ffe6a8';
  g.strokeStyle = silhouette ? SHADOW.shade : '#d9a93c';
  g.lineWidth = Math.max(1, h.r * 0.1);
  g.beginPath();
  g.moveTo(h.x - h.r * 0.2, h.y - h.r * 0.95);
  g.lineTo(h.x, h.y - h.r * 1.85);
  g.lineTo(h.x + h.r * 0.2, h.y - h.r * 0.95);
  g.closePath();
  g.fill();
  g.stroke();
  if (art.legend && !silhouette) {
    // ねじれた 金の つの。ななめの すじを 3本、先に 光を1つ
    g.save();
    g.clip();
    g.strokeStyle = '#d9a93c';
    g.lineWidth = Math.max(1, h.r * 0.09);
    g.beginPath();
    for (let i = 1; i <= 3; i++) {
      const y = h.y - h.r * (0.95 + i * 0.22);
      g.moveTo(h.x - h.r * 0.25, y + h.r * 0.1);
      g.lineTo(h.x + h.r * 0.25, y - h.r * 0.1);
    }
    g.stroke();
    g.restore();
    g.fillStyle = '#fff';
    sparkle(g, h.x, h.y - h.r * 1.85, h.r * 0.22);
  }
}

/** クワガタのはさみ */
function drawPincer(g: CanvasRenderingContext2D, art: PetArt, h: Head, silhouette: boolean): void {
  if (!art.pincer) return;
  g.strokeStyle = tone(art, silhouette, 'shade');
  g.lineWidth = Math.max(1.4, h.r * 0.22);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(h.x - h.r * 0.5, h.y - h.r * 0.7);
  g.quadraticCurveTo(h.x - h.r * 1.5, h.y - h.r * 1.5, h.x - h.r * 0.6, h.y - h.r * 1.7);
  g.moveTo(h.x + h.r * 0.5, h.y - h.r * 0.7);
  g.quadraticCurveTo(h.x + h.r * 1.5, h.y - h.r * 1.5, h.x + h.r * 0.6, h.y - h.r * 1.7);
  g.stroke();
}

function drawBeak(g: CanvasRenderingContext2D, art: PetArt, h: Head, silhouette: boolean): void {
  if (!art.beak) return;
  g.fillStyle = silhouette ? SHADOW.shade : '#f3a52e';
  if (art.beak === 'duck') {
    ellipse(g, h.x, h.y + h.r * 0.5, h.r * 0.4, h.r * 0.16);
  } else {
    g.beginPath();
    g.moveTo(h.x - h.r * 0.16, h.y + h.r * 0.3);
    g.lineTo(h.x + h.r * 0.16, h.y + h.r * 0.3);
    g.lineTo(h.x, h.y + h.r * 0.58);
    g.closePath();
    g.fill();
  }
}

function drawLegs(g: CanvasRenderingContext2D, art: PetArt, cx: number, footY: number, s: number, t: number, silhouette: boolean): void {
  const n = art.legs ?? 0;
  if (!n) return;
  g.strokeStyle = tone(art, silhouette, 'shade');
  g.lineWidth = Math.max(1.4, s * 0.055);
  g.lineCap = 'round';
  g.beginPath();
  const span = s * 0.6;
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const x = cx - span / 2 + span * k;
    const wig = Math.sin(t * 10 + i) * s * 0.05;
    g.moveTo(x, footY - s * 0.16);
    g.lineTo(x + wig, footY);
  }
  g.stroke();
}

function drawSpikes(g: CanvasRenderingContext2D, art: PetArt, cx: number, cy: number, r: number, silhouette: boolean): void {
  if (!art.spike) return;
  g.strokeStyle = tone(art, silhouette, 'shade');
  g.lineWidth = Math.max(1.2, r * 0.13);
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    g.moveTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
    g.lineTo(cx + Math.cos(a) * r * 1.22, cy + Math.sin(a) * r * 1.22);
  }
  g.stroke();
}

// ---------------------------------------------------------------- からだ

function drawBody(
  g: CanvasRenderingContext2D,
  art: PetArt,
  cx: number,
  footY: number,
  s: number,
  t: number,
  silhouette: boolean,
): Head {
  const body = tone(art, silhouette, 'body');
  const shade = tone(art, silhouette, 'shade');
  g.fillStyle = body;

  switch (art.shape) {
    case 'blob': {
      // ぷるぷる。上下にすこし伸び縮みする
      const w = s * 0.46 * (1 + Math.sin(t * 4) * 0.05);
      const h = s * 0.4 * (1 - Math.sin(t * 4) * 0.06);
      g.beginPath();
      g.moveTo(cx - w, footY);
      g.quadraticCurveTo(cx - w, footY - h * 2.1, cx, footY - h * 2.1);
      g.quadraticCurveTo(cx + w, footY - h * 2.1, cx + w, footY);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.45)';
      ellipse(g, cx - w * 0.4, footY - h * 1.4, w * 0.16, h * 0.28);
      return { x: cx, y: footY - h * 1.05, r: s * 0.26 };
    }
    case 'round': {
      const r = s * 0.36;
      circle(g, cx, footY - r, r);
      if (art.belly) {
        g.fillStyle = silhouette ? SHADOW.body : '#fdfaf3';
        ellipse(g, cx, footY - r * 0.62, r * 0.55, r * 0.42);
      }
      return { x: cx, y: footY - r * 1.1, r: r * 0.82 };
    }
    case 'egg': {
      const rx = s * 0.3;
      const ry = s * 0.4;
      ellipse(g, cx, footY - ry, rx, ry);
      if (art.belly) {
        // おなかは 目より下まで。顔にかかると、白い中に目が浮いて見える
        g.fillStyle = silhouette ? SHADOW.body : '#fdfaf3';
        ellipse(g, cx, footY - ry * 0.6, rx * 0.66, ry * 0.52);
      }
      return { x: cx, y: footY - ry * 1.2, r: rx * 0.9 };
    }
    case 'bird': {
      const rx = s * 0.3;
      const ry = s * 0.34;
      ellipse(g, cx, footY - ry, rx, ry);
      if (art.belly) {
        g.fillStyle = silhouette ? SHADOW.body : '#fffdf6';
        ellipse(g, cx, footY - ry * 0.75, rx * 0.55, ry * 0.5);
      }
      // 頭はからだの上に少しだけ重ねる
      const hr = s * 0.24;
      g.fillStyle = body;
      circle(g, cx, footY - ry * 1.6, hr);
      // あし
      g.strokeStyle = silhouette ? SHADOW.shade : '#f3a52e';
      g.lineWidth = Math.max(1.2, s * 0.045);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx - s * 0.1, footY - s * 0.06);
      g.lineTo(cx - s * 0.1, footY);
      g.moveTo(cx + s * 0.1, footY - s * 0.06);
      g.lineTo(cx + s * 0.1, footY);
      g.stroke();
      return { x: cx, y: footY - ry * 1.6, r: hr };
    }
    case 'bug': {
      const rx = s * 0.34;
      const ry = s * 0.24;
      const cy = footY - s * 0.26;
      ellipse(g, cx, cy, rx, ry);
      if (art.spots) {
        g.fillStyle = silhouette ? SHADOW.shade : art.spots;
        circle(g, cx - rx * 0.42, cy - ry * 0.2, rx * 0.14);
        circle(g, cx + rx * 0.36, cy + ry * 0.16, rx * 0.13);
        circle(g, cx + rx * 0.1, cy - ry * 0.5, rx * 0.11);
      }
      if (art.stripe) {
        // よこじま。からだの だ円から はみ出さないよう clip する
        g.save();
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = silhouette ? SHADOW.shade : art.stripe;
        g.fillRect(cx - rx, cy - ry * 0.42, rx * 2, ry * 0.3);
        g.fillRect(cx - rx, cy + ry * 0.22, rx * 2, ry * 0.3);
        g.restore();
      }
      // せなかの すじ
      g.strokeStyle = shade;
      g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath();
      g.moveTo(cx, cy - ry * 0.9);
      g.lineTo(cx, cy + ry * 0.9);
      g.stroke();
      const hr = s * 0.17;
      g.fillStyle = shade;
      circle(g, cx, cy - ry - hr * 0.5, hr);
      return { x: cx, y: cy - ry - hr * 0.5, r: hr };
    }
    case 'worm': {
      const r = s * 0.17;
      const cy = footY - r;
      for (let i = 2; i >= 0; i--) {
        g.fillStyle = i === 0 ? body : shade;
        circle(g, cx - i * r * 1.35, cy + Math.sin(t * 6 + i) * s * 0.03, r * (i === 0 ? 1.05 : 0.92));
      }
      return { x: cx, y: cy, r: r * 0.95 };
    }
    case 'ghost': {
      const w = s * 0.32;
      const top = footY - s * 0.72;
      g.beginPath();
      g.moveTo(cx - w, footY - s * 0.1);
      g.lineTo(cx - w, top + w);
      g.arc(cx, top + w, w, Math.PI, 0);
      g.lineTo(cx + w, footY - s * 0.1);
      // すそを ゆらす
      for (let i = 0; i < 3; i++) {
        const x0 = cx + w - ((i * 2 + 1) * w) / 3;
        const x1 = cx + w - ((i * 2 + 2) * w) / 3;
        g.quadraticCurveTo(x0, footY + s * 0.06 + Math.sin(t * 5 + i) * s * 0.02, x1, footY - s * 0.1);
      }
      g.closePath();
      g.fill();
      return { x: cx, y: top + w * 1.1, r: w * 0.86 };
    }
    case 'jelly': {
      const w = s * 0.3;
      const cy = footY - s * 0.45;
      g.beginPath();
      g.moveTo(cx - w, cy);
      g.quadraticCurveTo(cx - w, cy - w * 1.7, cx, cy - w * 1.7);
      g.quadraticCurveTo(cx + w, cy - w * 1.7, cx + w, cy);
      g.closePath();
      g.fill();
      if (art.spots) {
        // たこの あたまの ぽつぽつ。顔（まんなか）には かけない
        g.fillStyle = silhouette ? SHADOW.shade : art.spots;
        circle(g, cx - w * 0.66, cy - w * 1.0, w * 0.1);
        circle(g, cx + w * 0.64, cy - w * 0.96, w * 0.11);
        circle(g, cx - w * 0.2, cy - w * 1.42, w * 0.09);
      }
      g.strokeStyle = shade;
      g.lineWidth = Math.max(1.2, s * 0.04);
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = cx - w * 0.7 + (w * 1.4 * i) / 3;
        g.moveTo(x, cy);
        g.quadraticCurveTo(x + Math.sin(t * 4 + i) * s * 0.05, cy + s * 0.16, x, cy + s * 0.3);
      }
      g.stroke();
      return { x: cx, y: cy - w * 0.75, r: w * 0.8 };
    }
    case 'snail': {
      const r = s * 0.2;
      const cy = footY - r * 0.7;
      // からだ
      g.beginPath();
      g.moveTo(cx - s * 0.36, footY);
      g.quadraticCurveTo(cx - s * 0.4, cy - r * 0.6, cx - s * 0.1, cy - r * 0.75);
      g.quadraticCurveTo(cx + s * 0.3, cy - r * 0.6, cx + s * 0.34, footY);
      g.closePath();
      g.fill();
      // から
      const sx = cx - s * 0.04;
      const sy = cy - r * 0.5;
      g.fillStyle = silhouette ? SHADOW.shade : art.shell ?? shade;
      circle(g, sx, sy, r * 1.15);
      g.strokeStyle = silhouette ? SHADOW.body : 'rgba(0,0,0,.22)';
      g.lineWidth = Math.max(1.2, s * 0.035);
      g.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 3;
        const rr = r * 1.05 * (1 - i / 26);
        const px = sx + Math.cos(a) * rr;
        const py = sy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
      return { x: cx + s * 0.24, y: cy - r * 0.5, r: r * 0.62 };
    }
    case 'fish': {
      // さかな・くじら。よこ長の からだ、うしろ（左）に おびれ、まえ（右）に顔。
      // くじら（しおふき）は ひとまわり大きく描く。同じ大きさだと きんぎょと見分けにくい
      const big = art.spout ? 1.25 : 1;
      const rx = s * 0.34 * big;
      const ry = s * 0.24 * big;
      const cy = footY - s * 0.3 * big;
      const sw = Math.sin(t * 6) * s * 0.04;
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(cx - rx * 0.75, cy);
      g.lineTo(cx - rx * 1.32, cy - ry * 0.95 + sw);
      g.quadraticCurveTo(cx - rx * 1.08, cy + sw * 0.5, cx - rx * 1.32, cy + ry * 0.95 + sw);
      g.closePath();
      g.fill();
      // せびれ
      g.beginPath();
      g.moveTo(cx - rx * 0.35, cy - ry * 0.8);
      g.quadraticCurveTo(cx - rx * 0.1, cy - ry * 1.55, cx + rx * 0.25, cy - ry * 0.88);
      g.closePath();
      g.fill();
      g.fillStyle = body;
      ellipse(g, cx, cy, rx, ry);
      if (art.belly) {
        g.fillStyle = silhouette ? SHADOW.body : 'rgba(255,255,255,.7)';
        ellipse(g, cx + rx * 0.05, cy + ry * 0.5, rx * 0.72, ry * 0.36);
      }
      if (art.stars && !silhouette) {
        // せなかの ほしもよう。夜空を およいできた くじら
        g.fillStyle = art.stars;
        star5(g, cx - rx * 0.35, cy - ry * 0.45, s * 0.055);
        star5(g, cx + rx * 0.05, cy - ry * 0.62, s * 0.045);
        star5(g, cx - rx * 0.62, cy - ry * 0.05, s * 0.04);
      }
      if (art.spout && !silhouette) {
        // しおふき。ぽこぽこ のぼって消える
        const k = (t * 1.1) % 1;
        const sx = cx + rx * 0.1;
        const sy = cy - ry * 0.95;
        g.fillStyle = `rgba(170,220,255,${(0.95 - k * 0.6).toFixed(2)})`;
        for (const dir of [-1, 0, 1]) {
          circle(g, sx + dir * s * 0.13 * k, sy - s * (0.08 + k * 0.22) + Math.abs(dir) * s * 0.05 * k, s * (0.06 - k * 0.02));
        }
      }
      return { x: cx + rx * 0.42, y: cy - ry * 0.08, r: ry * 0.78 };
    }
    case 'star': {
      // 5本の うで。とがった先は太い線で なぞって丸める（つつくと いたそうに見えないように）
      const r = s * 0.4;
      const cy = footY - r * 0.92;
      const wob = Math.sin(t * 3) * 0.06;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2 + wob;
        const rad = i % 2 ? r * 0.55 : r;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = body;
      g.lineWidth = s * 0.09;
      g.lineJoin = 'round';
      g.stroke();
      if (art.spots) {
        g.fillStyle = silhouette ? SHADOW.shade : art.spots;
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 * i) / 5 - Math.PI / 2 + wob;
          circle(g, cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74, s * 0.035);
        }
      }
      return { x: cx, y: cy + r * 0.06, r: r * 0.5 };
    }
    case 'beast':
    default: {
      // どうぶつ型（とかげ・ドラゴン・うま）。からだ＋まえに頭
      const rx = s * 0.32;
      const ry = s * 0.22;
      const cy = footY - s * 0.3;
      if (art.ridge) {
        // せなかの とげ（ドラゴン）。からだより奥に描いて、ねもとを からだで かくす
        g.fillStyle = silhouette ? SHADOW.shade : art.ridge;
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (1.08 + i * 0.11);
          const bx = cx - s * 0.04 + Math.cos(a) * rx * 0.85;
          const by = cy + Math.sin(a) * ry * 0.85;
          const tx = cx - s * 0.04 + Math.cos(a) * rx * 1.3;
          const ty = cy + Math.sin(a) * ry * 1.85;
          const nx = -Math.sin(a) * s * 0.06;
          const ny = Math.cos(a) * s * 0.06;
          g.beginPath();
          g.moveTo(bx - nx, by - ny);
          g.lineTo(tx, ty);
          g.lineTo(bx + nx, by + ny);
          g.closePath();
          g.fill();
        }
        g.fillStyle = body;
      }
      ellipse(g, cx - s * 0.04, cy, rx, ry);
      if (art.belly) {
        g.fillStyle = silhouette ? SHADOW.body : 'rgba(255,255,255,.55)';
        ellipse(g, cx - s * 0.04, cy + ry * 0.35, rx * 0.6, ry * 0.42);
      }
      const hr = s * 0.2;
      g.fillStyle = body;
      circle(g, cx + s * 0.26, cy - s * 0.16, hr);
      // くび
      roundRect(g, cx + s * 0.06, cy - s * 0.2, s * 0.2, s * 0.24, s * 0.08);
      g.fill();
      return { x: cx + s * 0.26, y: cy - s * 0.16, r: hr };
    }
  }
}

// ---------------------------------------------------------------- 本体

export interface PetDrawOpts {
  /** まだ仲間になっていない子。灰色のかげで描く */
  silhouette?: boolean;
  /** 上下のゆれを止める（アイコン用） */
  still?: boolean;
  /** でんせつの子も 大きくしない（枠の決まったアイコン用） */
  fit?: boolean;
}

/**
 * でんせつの子の 後光。からだより奥に描く。
 *
 * ふつうの子と同じ描きかたで大きさだけ変えても、子どもには「ちょっと大きい子」にしか
 * 見えない。ゆっくり回る光の すじ ＋ ふくらむ光 で、そこに いるだけで特別だと分かるようにする。
 * 半径は からだの 0.8 倍まで。走っているときは主人公が 36*s うしろにいるので、
 * これより広げると 主人公まで光に のまれる。
 */
function drawLegendHalo(
  g: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  s: number,
  t: number,
  reach = 1,
): void {
  const pulse = 1 + Math.sin(t * 3) * 0.05;
  const R = s * 0.8 * pulse * reach;

  // 光の すじ。12本を ゆっくり回す
  g.save();
  const rays = g.createRadialGradient(cx, cy, s * 0.12, cx, cy, R);
  rays.addColorStop(0, alpha(color, 0.55));
  rays.addColorStop(1, alpha(color, 0));
  g.fillStyle = rays;
  g.beginPath();
  const n = 12;
  const spin = t * 0.5;
  for (let i = 0; i < n; i++) {
    const a = spin + (Math.PI * 2 * i) / n;
    const w = Math.PI / n / 1.6;
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a - w, a + w);
    g.closePath();
  }
  g.fill();

  // まんなかの ふくらむ光
  const gr = s * 0.6 * pulse * reach;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, gr);
  glow.addColorStop(0, 'rgba(255,255,255,.7)');
  glow.addColorStop(0.45, alpha(color, 0.42));
  glow.addColorStop(1, alpha(color, 0));
  g.fillStyle = glow;
  circle(g, cx, cy, gr);
  g.restore();
}

/** でんせつの子の まわりを まわる きらきら。からだより手前に描く */
function drawLegendSparkles(g: CanvasRenderingContext2D, color: string, cx: number, cy: number, s: number, t: number): void {
  g.save();
  for (let i = 0; i < 5; i++) {
    const a = t * 0.9 + (Math.PI * 2 * i) / 5;
    // よこ長の わ。奥（上半分）の きらきらは 小さく うすくして、からだの まわりを回って見せる
    const depth = (Math.sin(a) + 1) / 2;
    const x = cx + Math.cos(a) * s * 0.62;
    const y = cy + Math.sin(a) * s * 0.2 - s * 0.05;
    const tw = 0.55 + 0.45 * Math.sin(t * 6 + i * 1.7);
    g.globalAlpha = (0.35 + depth * 0.65) * tw;
    g.fillStyle = i % 2 ? '#ffffff' : color;
    sparkle(g, x, y, s * (0.05 + depth * 0.05) * (0.7 + tw * 0.3));
  }
  g.restore();
}

/**
 * ペットを描く。footY は地面の線。
 * 空をとぶ子（art.fly）は地面から少し浮いた高さに出る。
 */
export function drawPet(
  g: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  size: number,
  art: PetArt,
  t: number,
  opts: PetDrawOpts = {},
): void {
  const sil = Boolean(opts.silhouette);
  const legend = !sil && art.legend ? art.legend : '';
  const s = legend && !opts.fit ? size * LEGEND_SCALE : size;
  const bob = opts.still
    ? 0
    : art.fly
      ? Math.sin(t * 3.4) * s * 0.07 + s * 0.3
      : Math.abs(Math.sin(t * 6)) * s * 0.07;
  const y = footY - bob;

  g.save();

  // ふんわりした光は いちばん奥。からだの輪郭の外まで にじませる
  if (art.aura && !sil) {
    const ay = y - s * 0.36;
    const r = s * (0.58 + Math.sin(t * 4) * 0.04);
    const grad = g.createRadialGradient(cx, ay, 0, cx, ay, r);
    grad.addColorStop(0, art.aura);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    circle(g, cx, ay, r);
  }

  // でんせつの子の 後光は さらに奥。アイコンでは 枠の中で消えきる長さにする
  // （そのままだと 光の すじが 枠の四角で切れて、白い画面の上で 箱に見える）
  if (legend) drawLegendHalo(g, legend, cx, y - s * 0.38, s, t, opts.fit ? 0.72 : 1);

  // はねは からだの うしろ
  drawWing(g, art, cx, y - s * 0.34, s, t, sil);
  drawTail(g, art, cx - s * 0.3, y - s * 0.22, s, t, sil);
  drawLegs(g, art, cx, y, s, t, sil);

  const head = drawBody(g, art, cx, y, s, t, sil);

  drawSpikes(g, art, head.x, y - s * 0.36, s * 0.36, sil);
  drawEar(g, art, head, s, sil);
  drawHorn(g, art, head, sil);
  drawPincer(g, art, head, sil);
  drawBeak(g, art, head, sil);

  if (sil) {
    // シルエットは顔を描かず「？」だけ
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${s * 0.36}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.fillText('？', head.x, head.y);
  } else {
    drawFace(g, head, art, t);
  }

  if (legend) drawLegendSparkles(g, legend, cx, y - s * 0.38, s, t);

  g.restore();
}

/** ずかん・牧場のアイコン用 */
export function paintPetIcon(
  canvas: HTMLCanvasElement,
  art: PetArt,
  size = 56,
  opts: PetDrawOpts = {},
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  // つの・アンテナが切れないよう、下に寄せて少し小さめに描く。
  // でんせつの子も 枠からはみ出さないよう、ここでは大きくしない（光で 格の違いを出す）
  drawPet(g, size / 2, size * 0.88, size * 0.72, art, 0.5, { ...opts, still: true, fit: true });
}
