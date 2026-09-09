/**
 * きせかえアイテム。中身は見た目だけで、強さには一切影響しない。
 * 強さに効くと「引けないと勝てない」になり、算数のほうが止まる。
 * （ペットだけは別枠。pets.ts のとおり「やさしくなる」方向にだけ小さく効く）
 *
 * 手に入れかたは **1つだけ**。「キャラ・ぼうし・アクセ・いろ のどれを増やすか
 * を選んで、ガチャを1回まわす」。
 *
 * 以前は たまご（ランダム 90）・ねらい買い（210）・いろの直接買い（75〜240）の
 * 3通りがあり、品ごとに ちがう値段が並んでいた。5歳には
 * 「なぜ同じ ぼうしが たまごなら 90 で、名前を押すと 210 なのか」が読めず、
 * きせかえの画面が値札の一覧になっていた。
 * いまは どの種類でも おなじ1回ぶんで、ねだんが出るのはガチャのボタン1か所だけ。
 * 選ぶ楽しさは「どの種類を増やすか」に、当たる楽しさは「まわした瞬間」に残す。
 */

import { persist, profile, type SkinId } from './save';
import { WEAPONS } from './weapons';

export type ItemKind = 'skin' | 'hat' | 'acc' | 'weapon' | 'color';

export interface Item {
  id: string;
  kind: ItemKind;
  label: string;
  /** 最初から持っているか */
  free?: boolean;
}

/** 種類の名前。ガチャのボタンにも、タブにも、同じことばを出す */
export const KIND_LABEL: Record<ItemKind, string> = {
  skin: 'キャラ',
  hat: 'ぼうし',
  acc: 'アクセ',
  weapon: 'ぶき',
  color: 'いろ',
};

/**
 * ガチャ1回の値段。どの種類でも同じ。
 *
 * 1ステージぶんのコイン（30〜100枚）でだいたい1回まわせる。
 * 種類ごとに値段を変えないのは、「いろは安いから いろを回す」のような
 * 損得の計算を持ちこませないため。選ぶ理由は「いま何が欲しいか」だけでいい。
 */
export const GACHA_COST = 90;

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
  // ひかりの ヒーローと、その相手の かいじゅう。
  // まほうたんてい と ようせい は、ぼうし「たんていハット」「ティアラ」や
  // アクセ「むしめがね」と組み合わせて遊べるようにしてある
  { id: 'hero', kind: 'skin', label: 'ヒカリヒーロー' },
  { id: 'kaiju', kind: 'skin', label: 'かいじゅうっこ' },
  { id: 'magi', kind: 'skin', label: 'まほうたんてい' },
  { id: 'yousei', kind: 'skin', label: 'ようせい' },

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
  { id: 'hat-mimi', kind: 'hat', label: 'ねこみみ' },
  { id: 'hat-wizard', kind: 'hat', label: 'まほうぼうし' },
  { id: 'hat-helmet', kind: 'hat', label: 'ヘルメット' },
  { id: 'hat-donut', kind: 'hat', label: 'ドーナツ' },
  { id: 'hat-mikan', kind: 'hat', label: 'みかん' },
  { id: 'hat-headphone', kind: 'hat', label: 'ヘッドホン' },
  { id: 'hat-crest', kind: 'hat', label: 'ヒーロークレスト' },
  { id: 'hat-deer', kind: 'hat', label: 'たんていハット' },
  { id: 'hat-tiara', kind: 'hat', label: 'ティアラ' },
  { id: 'hat-goggle', kind: 'hat', label: 'ゴーグル' },

  // ---- アクセ 12 ----
  { id: 'acc-scarf', kind: 'acc', label: 'マフラー' },
  { id: 'acc-cape', kind: 'acc', label: 'マント' },
  { id: 'acc-wings', kind: 'acc', label: 'つばさ' },
  { id: 'acc-glasses', kind: 'acc', label: 'めがね' },
  { id: 'acc-bag', kind: 'acc', label: 'リュック' },
  { id: 'acc-tail', kind: 'acc', label: 'しっぽ' },
  { id: 'acc-bowtie', kind: 'acc', label: 'ちょうネクタイ' },
  { id: 'acc-medal', kind: 'acc', label: 'メダル' },
  { id: 'acc-lei', kind: 'acc', label: 'はなのわ' },
  { id: 'acc-balloon', kind: 'acc', label: 'ふうせん' },
  { id: 'acc-shell', kind: 'acc', label: 'こうら' },
  { id: 'acc-jet', kind: 'acc', label: 'ジェットパック' },
  { id: 'acc-timer', kind: 'acc', label: 'カラータイマー' },
  { id: 'acc-line', kind: 'acc', label: 'ヒーローライン' },
  { id: 'acc-lens', kind: 'acc', label: 'むしめがね' },
  { id: 'acc-frill', kind: 'acc', label: 'フリルえり' },

  // ---- ぶき ----
  // 中身は weapons.ts。ここに名前を書き写すと、フィニッシュの絵と
  // きせかえのマスで名前がずれるので、必ず向こうから持ってくる
  ...WEAPONS.map((w): Item => ({ id: w.id, kind: 'weapon', label: w.label, free: w.free })),

  // ---- いろ 11 ----
  { id: 'color-sakura', kind: 'color', label: 'さくら' },
  { id: 'color-sora', kind: 'color', label: 'そら' },
  { id: 'color-mint', kind: 'color', label: 'ミント' },
  { id: 'color-lemon', kind: 'color', label: 'レモン' },
  { id: 'color-grape', kind: 'color', label: 'ぶどう' },
  { id: 'color-choco', kind: 'color', label: 'チョコ' },
  { id: 'color-snow', kind: 'color', label: 'ゆき' },
  { id: 'color-night', kind: 'color', label: 'よぞら' },
  { id: 'color-rainbow', kind: 'color', label: 'にじいろ' },
  { id: 'color-silver', kind: 'color', label: 'ぎんいろ' },
  { id: 'color-gold', kind: 'color', label: 'きんいろ' },
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
  { id: 'color-silver', body: '#dde5ea', shade: '#a7b6c1' },
  { id: 'color-gold', body: '#f2cd5c', shade: '#c39a1c' },
];

export function colorDef(id: string): ColorDef | null {
  return COLORS.find((c) => c.id === id) ?? null;
}

export function isOwned(item: Item): boolean {
  return Boolean(item.free) || profile().unlocked.includes(item.id);
}

/** まだ持っていないもの ぜんぶ。ホームの 🎁 の合図に使う */
export function lockedItems(): Item[] {
  return ITEMS.filter((i) => !isOwned(i));
}

/** その種類で、まだ持っていないもの。ガチャの中身になる */
export function lockedItemsOf(kind: ItemKind): Item[] {
  return ITEMS.filter((i) => i.kind === kind && !isOwned(i));
}

export function ownedCount(): number {
  return ITEMS.filter(isOwned).length;
}

/**
 * えらんだ種類のガチャを1回まわす。
 * コインが足りない・その種類が全部そろっている場合は null。
 */
export function rollGacha(kind: ItemKind): Item | null {
  const p = profile();
  const pool = lockedItemsOf(kind);
  if (!pool.length || p.coins < GACHA_COST) return null;

  p.coins -= GACHA_COST;
  const item = pool[Math.floor(Math.random() * pool.length)];
  p.unlocked.push(item.id);

  // 出たものをそのまま着せる。子どもは必ず「今すぐ見たい」ので
  equip(item);

  persist();
  return item;
}

/** 身につける。おなじものをもう一度えらぶと外れる（キャラと ぶき だけは外せない） */
export function equip(item: Item): void {
  const p = profile();
  switch (item.kind) {
    case 'skin':
      p.skin = item.id as SkinId;
      break;
    // ぶきは「持ちかえる」もの。外せてしまうと、さいごの1問で
    // フィニッシュが出ない状態を子どもが自分で作れてしまう
    case 'weapon':
      p.weapon = item.id;
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
    case 'weapon':
      return p.weapon === item.id;
    case 'color':
      return p.color === item.id;
    default:
      return false;
  }
}
