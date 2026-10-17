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

/** ほのおの ひとふさ。ねもと（x, y）は まるく、さきは a の向きへ とがる */
function flame(g: CanvasRenderingContext2D, x: number, y: number, len: number, w: number, a: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.beginPath();
  g.moveTo(0, -w);
  g.quadraticCurveTo(len * 0.45, -w * 1.05, len, 0);
  g.quadraticCurveTo(len * 0.45, w * 1.05, 0, w);
  g.arc(0, 0, w, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * ねもとが ふとく、さきが ほそい 線（しっぽ・ひげ）。2次ベジェを こまかく 切って、
 * 1本ずつ 線の太さを へらして なぞる
 */
function taper(
  g: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  w0: number, w2: number,
): void {
  const n = 12;
  g.lineCap = 'round';
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const qx = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * x1 + u * u * x2;
    const qy = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * y1 + u * u * y2;
    g.lineWidth = Math.max(1, w0 + (w2 - w0) * u);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(qx, qy);
    g.stroke();
    px = qx;
    py = qy;
  }
}

/** うろこ／はねの もよう。下むきの 小さな 半円を、1だんごとに 半分ずらして ならべる */
function scallops(g: CanvasRenderingContext2D, color: string, x0: number, y0: number, cols: number, rows: number, r: number): void {
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, r * 0.4);
  g.lineCap = 'round';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = x0 + (i + (j % 2) * 0.5) * r * 2;
      const y = y0 + j * r * 1.25;
      g.beginPath();
      g.arc(x, y, r, 0.12 * Math.PI, 0.88 * Math.PI);
      g.stroke();
    }
  }
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
  } else if (kind === 'brave') {
    // 点の目を ひとまわり大きく、光を入れて、上に ふとい まゆ。
    // まゆの 内がわを 下げると きりっと 見える（口は にっこりのまま。こわくしない）
    g.fillStyle = INK;
    ellipse(g, h.x - dx, ey, h.r * 0.15, h.r * 0.19 * blink);
    ellipse(g, h.x + dx, ey, h.r * 0.15, h.r * 0.19 * blink);
    if (blink === 1) {
      g.fillStyle = '#fff';
      circle(g, h.x - dx + h.r * 0.05, ey - h.r * 0.07, h.r * 0.06);
      circle(g, h.x + dx + h.r * 0.05, ey - h.r * 0.07, h.r * 0.06);
    }
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.2, h.r * 0.12);
    g.lineCap = 'round';
    g.beginPath();
    for (const dir of [-1, 1]) {
      g.moveTo(h.x + dir * h.r * 0.2, ey - h.r * 0.27);
      g.lineTo(h.x + dir * h.r * 0.62, ey - h.r * 0.4);
    }
    g.stroke();
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
  // 大きな つばさ（grand）は ゆっくり、小さく はばたく。ほかと同じ はやさだと せわしなく見える
  const flap = art.wing === 'grand' ? Math.sin(t * 3.5) * 0.18 : Math.sin(t * (art.wing === 'bug' ? 22 : 7)) * 0.4;
  const shade = tone(art, silhouette, 'shade');
  const body = tone(art, silhouette, 'body');

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
      case 'grand': {
        // ゴッドの とりの 大きな つばさ。ながい かざきりばね 5まいを 上から よこへ おうぎに ならべ
        // （さきは かざりばねと おそろいの色）、その上に みじかい はねを 2だん かさねる。
        // よこへ ひらくのは 0.55s まで。これより 右へ出すと 走るときに主人公に かかる
        const tips = art.plumes ?? [art.shade];
        for (let i = 4; i >= 0; i--) {
          const len = s * (0.5 - i * 0.04);
          g.save();
          g.rotate(dir * (-0.15 + i * 0.3));
          g.fillStyle = shade;
          ellipse(g, 0, -len * 0.52, s * 0.07, len * 0.52);
          if (!silhouette) {
            g.fillStyle = tips[i % tips.length];
            ellipse(g, 0, -len * 0.84, s * 0.05, len * 0.17);
          }
          g.restore();
        }
        g.fillStyle = body;
        for (let i = 3; i >= 0; i--) {
          g.save();
          g.rotate(dir * (-0.05 + i * 0.36));
          ellipse(g, 0, -s * 0.16, s * 0.065, s * 0.17);
          g.restore();
        }
        g.fillStyle = silhouette ? SHADOW.body : '#ffe9b8';
        for (let i = 2; i >= 0; i--) {
          g.save();
          g.rotate(dir * (0.1 + i * 0.42));
          ellipse(g, 0, -s * 0.07, s * 0.055, s * 0.085);
          g.restore();
        }
        break;
      }
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
    case 'king': {
      // ゴッドの りゅうの しっぽ。ねもとが ふとく、うしろへ のびてから 上へ まき上がり、
      // さきに ほのおの ふさ。ほそい 1本線の ドラゴンの しっぽと ならべて ちがいが 分かる太さ
      const sway = Math.sin(t * 3) * s * 0.03;
      const ex = x - s * 0.22 + sway;
      const ey = y - s * 0.4;
      g.strokeStyle = shade;
      taper(g, x + s * 0.1, y, x - s * 0.34, y + s * 0.04, ex, ey, s * 0.15, s * 0.05);
      const fire = silhouette ? [SHADOW.shade, SHADOW.body] : art.fireMane ?? ['#ff9c3c', '#ffe08a'];
      fire.forEach((c, i) => {
        const k = 1 - i * 0.3;
        g.fillStyle = c;
        for (const [da, len] of [[-0.5, 0.16], [0, 0.2], [0.5, 0.15]] as const) {
          const fl = len * (1 + Math.sin(t * 12 + da * 5) * 0.08);
          flame(g, ex, ey, s * fl * k, s * 0.05 * k, -Math.PI / 2 - 0.35 + da);
        }
      });
      break;
    }
    case 'plume': {
      // ゴッドの とりの ながい かざりばね。5本が うしろ下へ おうぎに ながれて ゆれ、
      // さきに 目玉もよう（色の はね → 金の わ → こんの 目）。
      // ねもとは からだの うしろ。左へ 0.66s より先へは 出さない（アイコンの わくで 切れる）。
      // 左上は つばさが いるので、まよこ 〜 ななめ下に ならべる
      const cols = art.plumes ?? [art.shade];
      const bx = x + s * 0.2;
      const by = y - s * 0.04;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.74 + i * 0.065) + Math.sin(t * 2.6 + i * 0.9) * 0.05;
        const len = s * (0.46 - Math.abs(i - 2) * 0.03);
        const ex = bx + Math.cos(a) * len;
        const ey = by + Math.sin(a) * len;
        g.strokeStyle = shade;
        g.lineWidth = Math.max(1, s * 0.03);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(bx, by);
        g.quadraticCurveTo(bx + Math.cos(a) * len * 0.5, by + Math.sin(a) * len * 0.5 + s * 0.07, ex, ey);
        g.stroke();
        g.save();
        g.translate(ex, ey);
        g.rotate(a);
        g.fillStyle = silhouette ? SHADOW.shade : cols[i % cols.length];
        ellipse(g, 0, 0, s * 0.095, s * 0.06);
        if (!silhouette) {
          g.fillStyle = '#ffe9a0';
          ellipse(g, s * 0.012, 0, s * 0.052, s * 0.036);
          g.fillStyle = '#3d4b9a';
          circle(g, s * 0.016, 0, s * 0.022);
        }
        g.restore();
      }
      break;
    }
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
    case 'plume3': {
      // ゴッドの とりの 3本の かんむりばね。ほそい じくの さきに しずく形の はね。
      // まんなかを いちばん高くして、おうかんの うしろから 上へ のぞかせる
      const cols = art.plumes ?? [art.shade];
      for (const [i, a, len] of [[0, -0.45, 0.8], [1, 0, 1.0], [2, 0.45, 0.8]] as const) {
        const bx = h.x;
        const by = h.y - h.r * 0.8;
        const tx = bx + Math.sin(a) * h.r * len;
        const ty = by - Math.cos(a) * h.r * len;
        g.strokeStyle = shade;
        g.lineWidth = Math.max(1, h.r * 0.09);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(tx, ty);
        g.stroke();
        g.save();
        g.translate(tx, ty);
        g.rotate(a);
        g.fillStyle = silhouette ? SHADOW.shade : cols[(i * 2) % cols.length];
        ellipse(g, 0, -h.r * 0.1, h.r * 0.15, h.r * 0.24);
        if (!silhouette) {
          g.fillStyle = '#ffe9a0';
          circle(g, 0, -h.r * 0.08, h.r * 0.07);
        }
        g.restore();
      }
      break;
    }
    default:
      break;
  }
}

/**
 * ゴッドの りゅうの えだわかれした つの（art.antler）。うしろへ そって のび、とちゅうで 上へ 1本 わかれる。
 * おくの つのを 先に、すこし 左へ ずらして くらく描くと、2本 ならんで 生えているのが 分かる
 */
function drawAntler(g: CanvasRenderingContext2D, art: PetArt, h: Head, silhouette: boolean): void {
  if (!art.antler) return;
  const one = (ox: number, k: number, dark: boolean): void => {
    const bx = h.x - h.r * 0.35 + ox;
    const by = h.y - h.r * 0.7;
    const beam = (): void => {
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - h.r * 0.2, by - h.r * 0.9 * k, bx - h.r * 1.0 * k, by - h.r * 1.25 * k);
      g.moveTo(bx - h.r * 0.22 * k, by - h.r * 0.6 * k);
      g.quadraticCurveTo(bx - h.r * 0.1 * k, by - h.r * 1.05 * k, bx + h.r * 0.12 * k, by - h.r * 1.35 * k);
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // ふちを こく なぞってから 中を ぬる。光の 後光の上でも 線が とけない
    if (!silhouette) {
      g.lineWidth = Math.max(2.4, h.r * 0.36 * k);
      g.strokeStyle = 'rgba(120,40,20,.55)';
      beam();
      g.stroke();
    }
    g.lineWidth = Math.max(1.4, h.r * 0.26 * k);
    g.strokeStyle = silhouette ? SHADOW.shade : art.antler as string;
    beam();
    g.stroke();
    if (dark && !silhouette) {
      g.strokeStyle = 'rgba(0,0,0,.2)';
      beam();
      g.stroke();
    }
  };
  one(-h.r * 0.4, 0.85, true);
  one(0, 1, false);
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

/**
 * ゴッドの りゅうの ごつい からだ（art.bulk）。
 *
 * でんせつの ドラゴンと 同じ わく（LEGEND_SCALE）の中で「つよそう」に見せるため、
 * むねを あつく、あしを ふとく（まえあしに つめ）、あたまに はなづらを 足す。
 * うしろへ のびる ひげと、くびの うしろの ほのおの たてがみは、からだより 奥に 描いて
 * ねもとを かくす。右（顔の向き）へは 0.55s までしか 出さない（走るときに 主人公に かかる）
 */
function drawBulkBeast(
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
  const cy = footY - s * 0.3;
  const step = Math.sin(t * 6) * s * 0.02;
  const hx = cx + s * 0.27;
  const hy = cy - s * 0.2;
  const hr = s * 0.19;

  // ほのおの たてがみ。あたまの うしろから せなかへ 4ふさ。そと → うちの色を かさねて ゆらす
  if (art.fireMane) {
    const fire = silhouette ? [SHADOW.shade] : art.fireMane;
    // ねもとは あたまの ふちの すこし 内がわ。もっと 内に 置くと あたまに かくれて 見えない
    const roots = [
      [hx - s * 0.12, hy - s * 0.13, 0.24],
      [hx - s * 0.19, hy - s * 0.02, 0.24],
      [hx - s * 0.22, hy + s * 0.1, 0.2],
      [cx - s * 0.04, cy - s * 0.14, 0.16],
    ] as const;
    fire.forEach((c, i) => {
      const k = 1 - i * 0.28;
      g.fillStyle = c;
      roots.forEach(([fx, fy, len], j) => {
        const fl = len * (1 + Math.sin(t * 11 + j * 1.7) * 0.1);
        flame(g, fx, fy, s * fl * k, s * 0.065 * k, -Math.PI / 2 - 0.75 + Math.sin(t * 4 + j) * 0.08);
      });
    });
  }

  // せなかの とげ
  if (art.ridge) {
    g.fillStyle = silhouette ? SHADOW.shade : art.ridge;
    for (let i = 0; i < 4; i++) {
      const bx = cx - s * (0.32 - i * 0.09);
      const by = cy - s * (0.12 + Math.sin((i / 3) * Math.PI) * 0.06);
      g.beginPath();
      g.moveTo(bx - s * 0.05, by + s * 0.04);
      g.lineTo(bx - s * 0.02, by - s * 0.13);
      g.lineTo(bx + s * 0.05, by + s * 0.04);
      g.closePath();
      g.fill();
    }
  }

  // おくの あし（こい色）
  g.fillStyle = shade;
  roundRect(g, cx - s * 0.33 - step, footY - s * 0.2, s * 0.12, s * 0.2, s * 0.05);
  g.fill();
  roundRect(g, cx + s * 0.04 + step, footY - s * 0.24, s * 0.12, s * 0.24, s * 0.05);
  g.fill();

  // からだ と うしろあしの もも
  g.fillStyle = body;
  ellipse(g, cx - s * 0.08, cy, s * 0.29, s * 0.19);
  ellipse(g, cx - s * 0.2, footY - s * 0.19, s * 0.13, s * 0.14);
  roundRect(g, cx - s * 0.27 + step, footY - s * 0.2, s * 0.13, s * 0.2, s * 0.05);
  g.fill();
  if (art.scales && !silhouette) {
    // うろこ。からだの うしろ半分だけ（むねは よろいの だんだんに する）
    g.save();
    g.beginPath();
    g.ellipse(cx - s * 0.08, cy, s * 0.29, s * 0.19, 0, 0, Math.PI * 2);
    g.clip();
    scallops(g, alpha(art.scales, 0.75), cx - s * 0.3, cy - s * 0.1, 4, 3, s * 0.035);
    g.restore();
  }

  // くび と あつい むね
  roundRect(g, cx + s * 0.1, cy - s * 0.3, s * 0.2, s * 0.28, s * 0.09);
  g.fill();
  ellipse(g, cx + s * 0.1, cy - s * 0.04, s * 0.2, s * 0.21);
  if (art.belly) {
    // むねの よろい。うすい色の 上に よこの すじを 4本
    const bc = silhouette ? SHADOW.body : '#fff1b8';
    g.fillStyle = bc;
    ellipse(g, cx + s * 0.13, cy, s * 0.12, s * 0.17);
    if (!silhouette) {
      g.save();
      g.beginPath();
      g.ellipse(cx + s * 0.13, cy, s * 0.12, s * 0.17, 0, 0, Math.PI * 2);
      g.clip();
      g.strokeStyle = alpha(art.scales ?? '#c98a12', 0.6);
      g.lineWidth = Math.max(1, s * 0.018);
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const ly = cy - s * 0.1 + i * s * 0.065;
        g.moveTo(cx - s * 0.02, ly);
        g.quadraticCurveTo(cx + s * 0.13, ly + s * 0.03, cx + s * 0.28, ly);
      }
      g.stroke();
      g.restore();
    }
  }

  // ふとい まえあし と つめ
  g.fillStyle = body;
  roundRect(g, cx + s * 0.12 - step, footY - s * 0.25, s * 0.14, s * 0.25, s * 0.06);
  g.fill();
  if (!silhouette) {
    g.fillStyle = '#fffaf0';
    for (const fx of [cx + s * 0.12 - step, cx - s * 0.27 + step]) {
      for (let i = 0; i < 3; i++) {
        const x = fx + s * (0.03 + i * 0.04);
        g.beginPath();
        g.moveTo(x - s * 0.017, footY - s * 0.005);
        g.lineTo(x, footY - s * 0.05);
        g.lineTo(x + s * 0.017, footY - s * 0.005);
        g.closePath();
        g.fill();
      }
    }
  }

  // あたま と はなづら
  g.fillStyle = body;
  circle(g, hx, hy, hr);
  ellipse(g, hx + s * 0.15, hy + s * 0.05, s * 0.13, s * 0.095);
  if (!silhouette) {
    g.fillStyle = shade;
    circle(g, hx + s * 0.24, hy + s * 0.02, s * 0.017);
  }

  // ひげ。はなさきの 下から 出て、あごの 下を とおって うしろへ なびく。
  // あたまの 上を とおすと おうかん・つのと かさなって 読めない
  if (art.barbel) {
    for (const [k, ph] of [[1, 1.6], [0, 0]] as const) {
      const wave = Math.sin(t * 3 + ph) * s * 0.035;
      // おくの 1本は すこし くらく
      g.strokeStyle = silhouette ? SHADOW.shade : k ? alpha(art.barbel, 0.7) : art.barbel;
      taper(
        g,
        hx + s * (0.22 - k * 0.03), hy + s * (0.1 - k * 0.02),
        hx + s * (0.02 - k * 0.04), hy + s * (0.26 - k * 0.02),
        hx - s * (0.28 + k * 0.04), hy + s * (0.13 - k * 0.08) + wave,
        s * 0.04, s * 0.014,
      );
    }
  }
  return { x: hx, y: hy, r: hr };
}

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
      if (art.scales && !silhouette) {
        // むねの はねの もよう（ほうおう）。うろこ形を 3だん
        scallops(g, art.scales, cx - rx * 0.42, footY - ry * 1.05, 4, 3, s * 0.04);
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
      if (art.fluke) {
        // ゴッドの くじらの おびれ。しっぽを うしろから 上へ もち上げて、
        // 2まいの 大きな はを 左右に ひろげる（よこの 三角の おびれの そらくじらと 形で 分ける）
        const sway = Math.sin(t * 2.4) * 0.14;
        const fx = cx - rx * 0.98;
        const fy = cy - ry * 1.12;
        g.beginPath();
        g.moveTo(cx - rx * 0.55, cy - ry * 0.55);
        g.quadraticCurveTo(cx - rx * 1.08, cy - ry * 0.5, fx - s * 0.03, fy);
        g.lineTo(fx + s * 0.05, fy);
        g.quadraticCurveTo(cx - rx * 0.86, cy - ry * 0.1, cx - rx * 0.55, cy + ry * 0.3);
        g.closePath();
        g.fill();
        g.save();
        g.translate(fx + s * 0.01, fy);
        g.rotate(sway);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(0, s * 0.02);
          g.quadraticCurveTo(dir * s * 0.08, -s * 0.1, dir * s * 0.24, -s * 0.11);
          g.quadraticCurveTo(dir * s * 0.17, -s * 0.02, dir * s * 0.12, s * 0.04);
          g.quadraticCurveTo(dir * s * 0.05, s * 0.03, 0, s * 0.02);
          g.closePath();
          g.fill();
          if (!silhouette && art.galaxy) {
            // ふちを ぎんがの 色で なぞる。こんいろ 1色だと 夜空の 中で しずむ
            g.strokeStyle = alpha(art.galaxy[1 % art.galaxy.length], 0.85);
            g.lineWidth = Math.max(1, s * 0.016);
            g.lineJoin = 'round';
            g.stroke();
          }
        }
        if (!silhouette && art.galaxy) {
          // はの ふちで 光る つぶ
          g.fillStyle = '#ffffff';
          for (const dir of [-1, 1]) {
            g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 5 + dir);
            circle(g, dir * s * 0.2, -s * 0.09, s * 0.015);
          }
          g.globalAlpha = 1;
        }
        g.restore();
      } else {
        g.beginPath();
        g.moveTo(cx - rx * 0.75, cy);
        g.lineTo(cx - rx * 1.32, cy - ry * 0.95 + sw);
        g.quadraticCurveTo(cx - rx * 1.08, cy + sw * 0.5, cx - rx * 1.32, cy + ry * 0.95 + sw);
        g.closePath();
        g.fill();
      }
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
      if (art.galaxy && !silhouette) {
        // ゴッドの くじらの せなかで うずまく ぎんが。からだの だ円で きりぬき、
        // まんなかの 光 ＋ 2本の うで（つぶの ならび）を ゆっくり まわす。
        // 顔（右）には かからない ところに 置く
        g.save();
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        g.clip();
        const gx = cx - rx * 0.28;
        const gy = cy - ry * 0.12;
        const glow = g.createRadialGradient(gx, gy, 0, gx, gy, rx * 0.62);
        glow.addColorStop(0, 'rgba(255,244,255,.9)');
        glow.addColorStop(0.25, alpha(art.galaxy[0], 0.6));
        glow.addColorStop(1, alpha(art.galaxy[0], 0));
        g.fillStyle = glow;
        circle(g, gx, gy, rx * 0.62);
        const spin = t * 0.6;
        for (let arm = 0; arm < 2; arm++) {
          for (let i = 0; i < 16; i++) {
            const u = i / 15;
            const a = spin + arm * Math.PI + u * Math.PI * 1.5;
            const r = rx * (0.06 + u * 0.46);
            g.fillStyle = alpha(art.galaxy[(arm + (u > 0.5 ? 1 : 0)) % art.galaxy.length], 0.9 - u * 0.5);
            circle(g, gx + Math.cos(a) * r, gy + Math.sin(a) * r * 0.5, s * (0.032 - u * 0.018));
          }
        }
        // こまかい ほし。ばらばらに またたく
        g.fillStyle = '#ffffff';
        for (const [px, py, k] of [[-0.75, -0.3, 0], [-0.5, 0.35, 1.3], [-0.05, -0.45, 2.1], [0.15, 0.2, 3.4], [-0.9, 0.05, 4.2], [-0.3, -0.7, 5.1]] as const) {
          g.globalAlpha = 0.45 + 0.55 * Math.max(0, Math.sin(t * 3 + k));
          circle(g, cx + rx * px, cy + ry * py, s * 0.012);
        }
        g.globalAlpha = 1;
        g.restore();
      }
      if (art.stars && !silhouette) {
        // せなかの ほしもよう。夜空を およいできた くじら
        const pts = [
          [cx - rx * 0.62, cy - ry * 0.05, 0.04],
          [cx - rx * 0.35, cy - ry * 0.45, 0.055],
          [cx + rx * 0.05, cy - ry * 0.62, 0.045],
        ] as const;
        if (art.galaxy) {
          // ぎんがくじらは ほしを 線で つないで せいざにする
          g.strokeStyle = alpha(art.stars, 0.7);
          g.lineWidth = Math.max(1, s * 0.012);
          g.beginPath();
          pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
          g.stroke();
        }
        g.fillStyle = art.stars;
        for (const [px, py, r] of pts) star5(g, px, py, s * r);
      }
      if (art.spout && !silhouette) {
        // しおふき。ぽこぽこ のぼって消える。ぎんがくじらは しずくの かわりに ほしを ふく
        const k = (t * 1.1) % 1;
        const sx = cx + rx * 0.1;
        const sy = cy - ry * 0.95;
        const fade = (0.95 - k * 0.6).toFixed(2);
        g.fillStyle = `rgba(170,220,255,${fade})`;
        [-1, 0, 1].forEach((dir, i) => {
          const px = sx + dir * s * 0.13 * k;
          const py = sy - s * (0.08 + k * 0.22) + Math.abs(dir) * s * 0.05 * k;
          if (art.galaxy) {
            g.fillStyle = alpha(art.galaxy[i % art.galaxy.length], Number(fade));
            star5(g, px, py, s * (0.07 - k * 0.025));
          } else {
            circle(g, px, py, s * (0.06 - k * 0.02));
          }
        });
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
      if (art.bulk) return drawBulkBeast(g, art, cx, footY, s, t, silhouette);
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
/** ゴッドの子の にじいろ。後光の すじ・きらきら・光の わ に 順に使う */
const GOD_RAINBOW = ['#ff8fa3', '#ffd257', '#8fe3a0', '#8fc8ff', '#c9a0ff'];

function drawLegendHalo(
  g: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  s: number,
  t: number,
  reach = 1,
  god = false,
): void {
  const pulse = 1 + Math.sin(t * 3) * 0.05;
  const R = s * 0.8 * pulse * reach;

  // 光の すじ。12本を ゆっくり回す。ゴッドは 1本ずつ にじの色にして、すこし はやく回す
  g.save();
  const n = 12;
  const spin = t * (god ? 0.8 : 0.5);
  const fan = (a: number): void => {
    const w = Math.PI / n / 1.6;
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a - w, a + w);
    g.closePath();
  };
  if (god) {
    for (let i = 0; i < n; i++) {
      const c = GOD_RAINBOW[i % GOD_RAINBOW.length];
      const ray = g.createRadialGradient(cx, cy, s * 0.12, cx, cy, R);
      ray.addColorStop(0, alpha(c, 0.7));
      ray.addColorStop(1, alpha(c, 0));
      g.fillStyle = ray;
      g.beginPath();
      fan(spin + (Math.PI * 2 * i) / n);
      g.fill();
    }
  } else {
    const rays = g.createRadialGradient(cx, cy, s * 0.12, cx, cy, R);
    rays.addColorStop(0, alpha(color, 0.55));
    rays.addColorStop(1, alpha(color, 0));
    g.fillStyle = rays;
    g.beginPath();
    for (let i = 0; i < n; i++) fan(spin + (Math.PI * 2 * i) / n);
    g.fill();
  }

  // ゴッドは 光の わを 2重に。外の わは ゆっくり ふくらんで、色が めぐる
  if (god) {
    g.lineWidth = Math.max(1.5, s * 0.03);
    for (let k = 0; k < 2; k++) {
      const rr = R * (0.72 + k * 0.2) * (1 + Math.sin(t * 2 + k) * 0.03);
      g.strokeStyle = alpha(GOD_RAINBOW[(Math.floor(t * 2) + k * 2) % GOD_RAINBOW.length], 0.55 - k * 0.15);
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
    }
  }

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

/** でんせつの子の まわりを まわる きらきら。からだより手前に描く。ゴッドは 8つで にじいろ */
function drawLegendSparkles(
  g: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  s: number,
  t: number,
  god = false,
): void {
  g.save();
  const n = god ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = t * 0.9 + (Math.PI * 2 * i) / n;
    // よこ長の わ。奥（上半分）の きらきらは 小さく うすくして、からだの まわりを回って見せる
    const depth = (Math.sin(a) + 1) / 2;
    const x = cx + Math.cos(a) * s * 0.62;
    const y = cy + Math.sin(a) * s * 0.2 - s * 0.05;
    const tw = 0.55 + 0.45 * Math.sin(t * 6 + i * 1.7);
    g.globalAlpha = (0.35 + depth * 0.65) * tw;
    g.fillStyle = god ? GOD_RAINBOW[i % GOD_RAINBOW.length] : i % 2 ? '#ffffff' : color;
    sparkle(g, x, y, s * (0.05 + depth * 0.05) * (0.7 + tw * 0.3));
  }
  g.restore();
}

/**
 * ゴッドの子の あたまの 小さな おうかん。
 * でんせつと同じ大きさのままで「その上」だと分かる、いちばん読みやすい しるし
 */
function drawGodCrown(g: CanvasRenderingContext2D, h: Head, t: number): void {
  const w = h.r * 0.95;
  const ht = h.r * 0.55;
  const bx = h.x - w / 2;
  const by = h.y - h.r * 0.92 + Math.sin(t * 3) * h.r * 0.04;
  g.save();
  g.fillStyle = '#ffd24a';
  g.strokeStyle = '#c98a12';
  g.lineWidth = Math.max(1, h.r * 0.07);
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(bx, by - ht * 0.75);
  g.lineTo(bx + w * 0.25, by - ht * 0.35);
  g.lineTo(bx + w * 0.5, by - ht);
  g.lineTo(bx + w * 0.75, by - ht * 0.35);
  g.lineTo(bx + w, by - ht * 0.75);
  g.lineTo(bx + w, by);
  g.closePath();
  g.fill();
  g.stroke();
  // まんなかの 宝石は 色が めぐる
  g.fillStyle = GOD_RAINBOW[Math.floor(t * 2) % GOD_RAINBOW.length];
  circle(g, h.x, by - ht * 0.32, h.r * 0.11);
  g.restore();
}

/**
 * ゴッドの りゅうの 足もとの くも（art.cloud）。金の ふちの しろい くもで、
 * よこに すこし ながれて 見える。あしの さきに かぶせて「のっている」ように する
 */
function drawCloud(g: CanvasRenderingContext2D, cx: number, footY: number, s: number, t: number): void {
  const drift = Math.sin(t * 1.5) * s * 0.02;
  const puffs = [
    [-0.32, 0.0, 0.08],
    [-0.18, -0.03, 0.11],
    [0.0, -0.02, 0.12],
    [0.17, -0.03, 0.1],
    [0.31, 0.0, 0.08],
  ] as const;
  g.fillStyle = '#ffd257';
  for (const [dx, dy, r] of puffs) circle(g, cx + s * dx + drift, footY + s * dy, s * r + s * 0.018);
  g.fillStyle = '#fffaf0';
  for (const [dx, dy, r] of puffs) circle(g, cx + s * dx + drift, footY + s * dy, s * r);
  // うずの しるし
  g.strokeStyle = '#ffd257';
  g.lineWidth = Math.max(1, s * 0.018);
  g.lineCap = 'round';
  for (const dx of [-0.18, 0.17]) {
    g.beginPath();
    g.arc(cx + s * dx + drift, footY - s * 0.02, s * 0.04, Math.PI * 0.2, Math.PI * 1.6);
    g.stroke();
  }
}

/**
 * ゴッドの くじらの まわりを まわる わっかの ほしと みかづき（art.orbit）。
 * 2つは 反対がわに ならんで、よこ長の わを 回る。奥（上半分）に いるときは
 * からだより先に（front=false で）、手前に いるときは あとで 描く
 */
function drawOrbit(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, t: number, front: boolean): void {
  for (let k = 0; k < 2; k++) {
    const a = t * 0.7 + k * Math.PI;
    const depth = Math.sin(a);
    if ((depth >= 0) !== front) continue;
    // よこは 0.5s まで。わっかを 足して 0.63s。これより 広げると 走るときに主人公に かかる
    const x = cx + Math.cos(a) * s * 0.5;
    const y = cy + depth * s * 0.18;
    const r = s * 0.07 * (0.85 + depth * 0.15);
    g.save();
    g.globalAlpha = 0.85 + depth * 0.15;
    if (k === 0) {
      // わっかの ほし。わの 奥がわ → ほし → わの 手前がわ の順で、ほしを くぐって 見せる
      g.strokeStyle = '#fff3b0';
      g.lineWidth = Math.max(1, s * 0.016);
      g.beginPath();
      g.ellipse(x, y, r * 1.9, r * 0.55, -0.35, Math.PI, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ffc56b';
      circle(g, x, y, r);
      g.fillStyle = 'rgba(255,255,255,.5)';
      circle(g, x - r * 0.3, y - r * 0.3, r * 0.3);
      g.beginPath();
      g.ellipse(x, y, r * 1.9, r * 0.55, -0.35, 0, Math.PI);
      g.stroke();
    } else {
      // みかづき
      g.fillStyle = '#fff3b0';
      g.beginPath();
      g.moveTo(x, y - r);
      g.arc(x, y, r, -Math.PI / 2, Math.PI / 2, true);
      g.quadraticCurveTo(x - r * 0.7, y, x, y - r);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
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
  const god = Boolean(legend && art.god);
  if (legend) drawLegendHalo(g, legend, cx, y - s * 0.38, s, t, opts.fit ? 0.72 : 1, god);
  // まわる ほしは、奥に いるあいだは からだの うしろ。シルエットでは 出さない（持つまでの おたのしみ）
  if (art.orbit && !sil) drawOrbit(g, cx, y - s * 0.38, s, t, false);

  // はねは からだの うしろ
  drawWing(g, art, cx, y - s * 0.34, s, t, sil);
  drawTail(g, art, cx - s * 0.3, y - s * 0.22, s, t, sil);
  drawLegs(g, art, cx, y, s, t, sil);

  const head = drawBody(g, art, cx, y, s, t, sil);
  if (art.cloud && !sil) drawCloud(g, cx, y, s, t);

  drawSpikes(g, art, head.x, y - s * 0.36, s * 0.36, sil);
  drawEar(g, art, head, s, sil);
  drawAntler(g, art, head, sil);
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
    if (god) drawGodCrown(g, head, t);
  }

  if (art.orbit && !sil) drawOrbit(g, cx, y - s * 0.38, s, t, true);
  if (legend) drawLegendSparkles(g, legend, cx, y - s * 0.38, s, t, god);

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
