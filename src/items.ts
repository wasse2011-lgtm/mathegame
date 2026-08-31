/**
 * きせかえアイテム。
 *
 * ガチャ（たまご）の中身はキャラ・ぼうし・アクセだけで、強さには一切影響しない。
 * 強さに効くと「引けないと勝てない」になり、算数のほうが止まる。
 * （ペットだけは別枠。pets.ts のとおり「やさしくなる」方向にだけ小さく効く）
 *
 * いろ（からだの色）はガチャに混ぜず、コインで直接買える。
 * たまごは「なにが出るか」の楽しさ、いろは「ねらって買う」楽しさで、
 * どちらもコインの使いみちにする。
 */

import { persist, profile, type SkinId } from './save';

export type ItemKind = 'skin' | 'hat' | 'acc' | 'color';

export interface Item {
  id: string;
  kind: ItemKind;
  label: string;
  /** 最初から持っているか */
  free?: boolean;
  /** コインで直接買えるもの（いろ）。たまごには入らない */
  cost?: number;
}

/** たまご1個の値段。1ステージぶんのコイン（30〜60枚）で必ず1個は割れる */
export const EGG_COST = 90;

export const ITEMS: Item[] = [
  // ---- キャラ 12 ----
  { id: 'cat', kind: 'skin', label: 'ねこ', free: true },
  { id: 'dog', kind: 'skin', label: 'いぬ', free: true },
  { id: 'robo', kind: 'skin', label: 'ロボ', free: true },
  { id: 'usa', kind: 'skin', label: 'うさぎ' },
  { id: 'kuma', kind: 'skin', label: 'くま' },
  { id: 'pen', kind: 'skin', label: 'ぺんぎん' },
  { id: 'fox', kind: 'skin', label: 'きつね' },
  { id: 'panda', kind: 'skin', label: 'ぱんだ' },
  { id: 'sheep', kind: 'skin', label: 'ひつじ' },
  { id: 'tora', kind: 'skin', label: 'とら' },
  { id: 'azarashi', kind: 'skin', label: 'あざらし' },
  { id: 'dora', kind: 'skin', label: 'ドラゴンっこ' },

  // ---- ぼうし 12 ----
  { id: 'hat-cap', kind: 'hat', label: 'キャップ' },
  { id: 'hat-ribbon', kind: 'hat', label: 'リボン' },
  { id: 'hat-leaf', kind: 'hat', label: 'はっぱ' },
  { id: 'hat-star', kind: 'hat', label: 'ほし' },
  { id: 'hat-crown', kind: 'hat', label: 'おうかん' },
  { id: 'hat-straw', kind: 'hat', label: 'むぎわら' },
  { id: 'hat-tall', kind: 'hat', label: 'シルクハット' },
  { id: 'hat-santa', kind: 'hat', label: 'サンタぼう' },
  { id: 'hat-band', kind: 'hat', label: 'はちまき' },
  { id: 'hat-horn', kind: 'hat', label: 'つの' },
  { id: 'hat-flower', kind: 'hat', label: 'おはな' },
  { id: 'hat-halo', kind: 'hat', label: 'てんしのわ' },

  // ---- アクセ 6 ----
  { id: 'acc-scarf', kind: 'acc', label: 'マフラー' },
  { id: 'acc-cape', kind: 'acc', label: 'マント' },
  { id: 'acc-wings', kind: 'acc', label: 'つばさ' },
  { id: 'acc-glasses', kind: 'acc', label: 'めがね' },
  { id: 'acc-bag', kind: 'acc', label: 'リュック' },
  { id: 'acc-tail', kind: 'acc', label: 'しっぽ' },

  // ---- いろ 9（コインで直接買う） ----
  { id: 'color-sakura', kind: 'color', label: 'さくら', cost: 75 },
  { id: 'color-sora', kind: 'color', label: 'そら', cost: 75 },
  { id: 'color-mint', kind: 'color', label: 'ミント', cost: 75 },
  { id: 'color-lemon', kind: 'color', label: 'レモン', cost: 75 },
  { id: 'color-grape', kind: 'color', label: 'ぶどう', cost: 75 },
  { id: 'color-choco', kind: 'color', label: 'チョコ', cost: 75 },
  { id: 'color-snow', kind: 'color', label: 'ゆき', cost: 75 },
  { id: 'color-night', kind: 'color', label: 'よぞら', cost: 75 },
  { id: 'color-rainbow', kind: 'color', label: 'にじいろ', cost: 240 },
];

/** いろの中身。キャラ本来の色を上から塗りかえる */
export interface ColorDef {
  id: string;
  body: string;
  shade: string;
  /** にじいろだけ、時間で色が変わる */
  rainbow?: boolean;
}

export const COLORS: ColorDef[] = [
  { id: 'color-sakura', body: '#f7b6c8', shade: '#dd8ba3' },
  { id: 'color-sora', body: '#8ec6ee', shade: '#5b9fd1' },
  { id: 'color-mint', body: '#8bd6b4', shade: '#5aae8d' },
  { id: 'color-lemon', body: '#f8dd6a', shade: '#d9b62c' },
  { id: 'color-grape', body: '#b79ae0', shade: '#8e73bd' },
  { id: 'color-choco', body: '#a9764f', shade: '#815433' },
  { id: 'color-snow', body: '#f7f7f4', shade: '#cdd6dd' },
  { id: 'color-night', body: '#4c5a72', shade: '#333e53' },
  { id: 'color-rainbow', body: '#ff8f8f', shade: '#e06a6a', rainbow: true },
];

export function colorDef(id: string): ColorDef | null {
  return COLORS.find((c) => c.id === id) ?? null;
}

export function isOwned(item: Item): boolean {
  return Boolean(item.free) || profile().unlocked.includes(item.id);
}

/** たまごから出うるもの（いろは入らない） */
export function eggItems(): Item[] {
  return ITEMS.filter((i) => i.kind !== 'color');
}

export function lockedItems(): Item[] {
  return eggItems().filter((i) => !isOwned(i));
}

export function ownedCount(): number {
  return ITEMS.filter(isOwned).length;
}

/** たまごを割る。コインが足りない・全部そろっている場合は null */
export function openEgg(): Item | null {
  const p = profile();
  const pool = lockedItems();
  if (!pool.length || p.coins < EGG_COST) return null;

  p.coins -= EGG_COST;
  const item = pool[Math.floor(Math.random() * pool.length)];
  p.unlocked.push(item.id);

  // 出たものをそのまま着せる。子どもは必ず「今すぐ見たい」ので
  equip(item);

  persist();
  return item;
}

/** コインで直接買う（いろ）。買えなければ false */
export function buyItem(item: Item): boolean {
  const p = profile();
  if (!item.cost || isOwned(item) || p.coins < item.cost) return false;
  p.coins -= item.cost;
  p.unlocked.push(item.id);
  equip(item);
  persist();
  return true;
}

/** 身につける。おなじものをもう一度えらぶと外れる（キャラだけは外せない） */
export function equip(item: Item): void {
  const p = profile();
  switch (item.kind) {
    case 'skin':
      p.skin = item.id as SkinId;
      break;
    case 'hat':
      p.hat = p.hat === item.id ? '' : item.id;
      break;
    case 'acc':
      p.acc = p.acc === item.id ? '' : item.id;
      break;
    case 'color':
      p.color = p.color === item.id ? '' : item.id;
      break;
  }
  persist();
}

export function isEquipped(item: Item): boolean {
  const p = profile();
  switch (item.kind) {
    case 'skin':
      return p.skin === item.id;
    case 'hat':
      return p.hat === item.id;
    case 'acc':
      return p.acc === item.id;
    case 'color':
      return p.color === item.id;
    default:
      return false;
  }
}
