/**
 * きせかえアイテム。
 *
 * ガチャの中身はキャラとぼうしだけで、強さには一切影響させない。
 * 強さに効くと「引けないと勝てない」になり、算数のほうが止まる。
 */

import { persist, profile, type SkinId } from './save';

export type ItemKind = 'skin' | 'hat';

export interface Item {
  id: string;
  kind: ItemKind;
  label: string;
  /** 最初から持っているか */
  free?: boolean;
}

export const EGG_COST = 30;

export const ITEMS: Item[] = [
  { id: 'cat', kind: 'skin', label: 'ねこ', free: true },
  { id: 'dog', kind: 'skin', label: 'いぬ', free: true },
  { id: 'robo', kind: 'skin', label: 'ロボ', free: true },
  { id: 'usa', kind: 'skin', label: 'うさぎ' },
  { id: 'kuma', kind: 'skin', label: 'くま' },
  { id: 'pen', kind: 'skin', label: 'ぺんぎん' },
  { id: 'hat-cap', kind: 'hat', label: 'キャップ' },
  { id: 'hat-ribbon', kind: 'hat', label: 'リボン' },
  { id: 'hat-leaf', kind: 'hat', label: 'はっぱ' },
  { id: 'hat-star', kind: 'hat', label: 'ほし' },
  { id: 'hat-crown', kind: 'hat', label: 'おうかん' },
];

export function itemById(id: string): Item | undefined {
  return ITEMS.find((i) => i.id === id);
}

export function isOwned(item: Item): boolean {
  return Boolean(item.free) || profile().unlocked.includes(item.id);
}

export function lockedItems(): Item[] {
  return ITEMS.filter((i) => !isOwned(i));
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
  if (item.kind === 'skin') p.skin = item.id as SkinId;
  else p.hat = item.id;

  persist();
  return item;
}
