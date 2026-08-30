/**
 * きせかえ。コインの使いみち。
 * たまごを割ると、まだ持っていないキャラかぼうしがひとつ出る。
 * 中身は見た目だけで、ゲームの難しさには一切影響しない。
 */

import { sfx } from './audio';
import { EGG_COST, ITEMS, isOwned, openEgg, ownedCount, type Item } from './items';
import { persist, profile, type SkinId } from './save';
import { paintHatIcon, paintSkinIcon } from './sprites';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let onChange: (() => void) | null = null;

/** きせかえ内容が変わったときに呼ぶコールバック（ホームのコイン表示など） */
export function onShopChange(fn: () => void): void {
  onChange = fn;
}

function itemButton(item: Item): HTMLButtonElement {
  const p = profile();
  const owned = isOwned(item);
  const equipped = item.kind === 'skin' ? p.skin === item.id : p.hat === item.id;

  const b = document.createElement('button');
  b.type = 'button';
  b.className = `item${owned ? '' : ' locked'}`;
  b.setAttribute('aria-pressed', String(equipped));
  b.disabled = !owned;

  const c = document.createElement('canvas');
  const label = document.createElement('span');
  label.textContent = owned ? item.label : '？';
  b.append(c, label);

  if (owned) {
    b.addEventListener('click', () => {
      sfx.tap();
      if (item.kind === 'skin') p.skin = item.id as SkinId;
      else p.hat = p.hat === item.id ? '' : item.id;
      persist();
      renderShop();
      onChange?.();
    });
  }

  // canvas は DOM に入れてからでないとサイズが決まらない
  queueMicrotask(() => {
    if (item.kind === 'skin') paintSkinIcon(c, item.id as SkinId, owned ? p.hat : '', 56);
    else paintHatIcon(c, owned ? item.id : '', 56);
  });

  return b;
}

export function renderShop(): void {
  const p = profile();
  $('shop-coins').textContent = String(p.coins);
  $('egg-cost').textContent = String(EGG_COST);
  $('shop-desc').textContent = `あつめた ${ownedCount()} / ${ITEMS.length}`;

  const skins = $('skin-grid');
  const hats = $('hat-grid');
  skins.replaceChildren();
  hats.replaceChildren();

  // ぼうしを外す用のマス
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'item none';
  none.setAttribute('aria-pressed', String(p.hat === ''));
  none.append(Object.assign(document.createElement('span'), { className: 'no-hat', textContent: '／' }));
  none.append(Object.assign(document.createElement('span'), { textContent: 'なし' }));
  none.addEventListener('click', () => {
    sfx.tap();
    p.hat = '';
    persist();
    renderShop();
    onChange?.();
  });
  hats.appendChild(none);

  for (const item of ITEMS) {
    (item.kind === 'skin' ? skins : hats).appendChild(itemButton(item));
  }

  const remaining = ITEMS.filter((i) => !isOwned(i)).length;
  const eggBtn = $<HTMLButtonElement>('egg-btn');
  if (remaining === 0) {
    eggBtn.disabled = true;
    $('egg-label').textContent = 'ぜんぶ そろった！';
    $('egg-sub').textContent = 'コンプリート おめでとう';
  } else if (p.coins < EGG_COST) {
    eggBtn.disabled = true;
    $('egg-label').textContent = 'たまごを わる';
    $('egg-sub').textContent = `あと ${EGG_COST - p.coins} コイン`;
  } else {
    eggBtn.disabled = false;
    $('egg-label').textContent = 'たまごを わる';
    $('egg-sub').textContent = `のこり ${remaining}こ`;
  }
}

function showEggResult(item: Item): void {
  $('egg-got-head').textContent = item.kind === 'skin' ? 'あたらしい なかま！' : 'あたらしい ぼうし！';
  $('egg-got').textContent = item.label;
  const c = $<HTMLCanvasElement>('egg-result-canvas');
  if (item.kind === 'skin') paintSkinIcon(c, item.id as SkinId, profile().hat, 120);
  else paintSkinIcon(c, profile().skin, item.id, 120);
  $('overlay-egg').hidden = false;
  sfx.crack();
}

export function initShop(): void {
  $('egg-btn').addEventListener('click', () => {
    const item = openEgg();
    if (!item) return;
    showEggResult(item);
    renderShop();
    onChange?.();
  });

  $('egg-close').addEventListener('click', () => {
    sfx.tap();
    $('overlay-egg').hidden = true;
  });
}
