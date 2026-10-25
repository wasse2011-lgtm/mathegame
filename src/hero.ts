/**
 * せかいを すくった えいゆう。各せかいの ベリーハードの ボスを たおしたときの 称号と 金の像。
 *
 * - 像は たおしたときの すがた（save.ts の HeroStatue）。あとで きせかえても かわらない
 * - ホームの 広場の下に 台座を 8つ ならべ、たった数で うまっていく（main.ts）
 * - 名まえの下に 称号を出す。8つ そろうと「でんせつの えいゆう」になり、
 *   どの画面でも キャラが 金色に光る（sprites.ts の Look.legend）
 * - 演出（世界が かわる・名まえを よばれる）は runner.ts。この ファイルは 絵と ことばだけ
 */

import { WORLDS, worldById } from './curriculum';
import { isLegend, type HeroStatue, type Profile } from './save';
import { drawChar, type Look } from './sprites';

export const LEGEND_TITLE = '👑 でんせつの えいゆう';

/** 「🌱 はじまりの のはらの えいゆう」 */
export function heroTitle(worldId: number): string {
  const w = worldById(worldId);
  return `${w.emoji} ${w.name}の えいゆう`;
}

/** 名まえの下に出す 称号。8つ → でんせつ、ほかは いちばん先の せかい、まだなら '' */
export function titleOf(p: Profile): string {
  if (isLegend(p)) return LEGEND_TITLE;
  for (let i = WORLDS.length - 1; i >= 0; i--) {
    if (p.heroes[String(WORLDS[i].id)]) return heroTitle(WORLDS[i].id);
  }
  return '';
}

export function statueLook(h: HeroStatue): Look {
  return { skin: h.skin as Look['skin'], hat: h.hat, acc: h.acc, color: h.color, weapon: h.weapon };
}

/**
 * 金の ぬり。明るさ（0〜1）→ 色。暗い線は こげ茶、まんなかは 金、明るい ところは 白っぽい金。
 * 色そのものを 捨てて 明るさだけ のこすので、どの きせかえでも 同じ 金の像に見える
 */
const GOLD: [number, number, number, number][] = [
  [0, 74, 44, 5],
  [0.32, 150, 98, 16],
  [0.58, 216, 164, 42],
  [0.8, 246, 210, 100],
  [1, 255, 247, 214],
];

function gold(l: number): [number, number, number] {
  for (let i = 1; i < GOLD.length; i++) {
    const [b, ...hi] = GOLD[i];
    if (l <= b) {
      const [a, ...lo] = GOLD[i - 1];
      const k = (l - a) / (b - a);
      return [0, 1, 2].map((j) => Math.round(lo[j] + (hi[j] - lo[j]) * k)) as [number, number, number];
    }
  }
  const last = GOLD[GOLD.length - 1];
  return [last[1], last[2], last[3]];
}

/**
 * 金の像の絵。キャラを ふつうに描いてから、画素の 明るさを 金の色に おきかえる。
 * w×h は 描く大きさ（見える大きさは CSS が決める。画面の はばで かわる）。
 * キャラは 足もとを 下のはしに そろえて、ぼうしや ぶきが 入る大きさにする
 */
export function paintStatue(canvas: HTMLCanvasElement, look: Look, w: number, h: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const size = Math.min(w * 0.66, h * 0.62);
  // 像は 光らせない（でんせつの 光は いまの すがたの ほうに だけ出す）
  drawChar(g, w * 0.44, h - 1, size, { ...look, legend: false }, { t: 0.4, air: false, hurt: 0, squash: 1 });
  let img: ImageData;
  try {
    img = g.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return;
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    // すこし コントラストを つけて、のっぺりした 金の かたまりに ならないようにする
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    const c = gold(Math.min(1, Math.max(0, (l - 0.5) * 1.25 + 0.55)));
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
  g.putImageData(img, 0, 0);
}

/**
 * 台座つきの 像（ホームの 広場・演出の カード）。h が null なら からの 台座。
 * big は 演出の カードの 大きい像（台座から せり上がる。CSS）。
 * ホームの 広場の 像は 押せる（ボタン。押すと 称号を言う）。still なら 押せない 絵だけ
 */
export function buildStatue(worldId: number, h: HeroStatue | null, big = false, still = false): HTMLElement {
  const w = worldById(worldId);
  const el = document.createElement(big || still ? 'div' : 'button');
  if (el instanceof HTMLButtonElement) el.type = 'button';
  el.className = `statue${h ? '' : ' empty'}${big ? ' big' : ''}`;
  el.dataset.world = String(worldId);
  el.style.setProperty('--wc', w.color);
  el.setAttribute('aria-label', h ? heroTitle(worldId) : `${w.name}の だいざ（まだ）`);
  const fig = document.createElement('div');
  fig.className = 'statue-fig';
  if (h) {
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    fig.appendChild(c);
    paintStatue(c, statueLook(h), big ? 150 : 64, big ? 168 : 72);
  } else {
    fig.textContent = '?';
  }
  const base = document.createElement('span');
  base.className = 'statue-base';
  base.setAttribute('aria-hidden', 'true');
  base.textContent = w.emoji;
  el.append(fig, base);
  return el;
}
