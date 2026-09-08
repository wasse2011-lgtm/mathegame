/**
 * きせかえ。コインの使いみち その1。
 *
 * ・たまごを割ると、まだ持っていないキャラ・ぼうし・アクセがひとつ出る（90コイン）
 * ・いろ はガチャに混ぜず、ねらって直接買える（75コイン、にじいろ・きんいろだけ 240）
 * ・たまごの中身も、値段は高いが ねらって買える（210コイン）
 *
 * まだ持っていないものも、絵と名前と値段を出す。伏せてあると
 * 「なにが欲しいか」を決められず、コインを貯める目標にならない。
 * 何が出るか分からない楽しさは、たまごを割る その瞬間に残っている。
 *
 * 中身は見た目だけで、ゲームの難しさには一切影響しない。
 */

import { sfx } from './audio';
import {
  EGG_COST,
  ITEMS,
  buyItem,
  equip,
  isEquipped,
  isOwned,
  lockedItems,
  openEgg,
  ownedCount,
  priceOf,
  type Item,
  type ItemKind,
} from './items';
import { persist, profile, type SkinId } from './save';
import { currentLook, drawChar, paintHatIcon, paintSkinIcon } from './sprites';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let onChange: (() => void) | null = null;

/** きせかえ内容が変わったときに呼ぶコールバック（ホームのコイン表示など） */
export function onShopChange(fn: () => void): void {
  onChange = fn;
}

const TABS: { kind: ItemKind; label: string }[] = [
  { kind: 'skin', label: 'キャラ' },
  { kind: 'hat', label: 'ぼうし' },
  { kind: 'acc', label: 'アクセ' },
  { kind: 'color', label: 'いろ' },
];

let tab: ItemKind = 'skin';

// ---------------------------------------------------------------- すがた見本

const preview = () => $<HTMLCanvasElement>('shop-preview');
let previewRaf = 0;

/** いま着ているすがたを、大きく その場で走らせる */
function paintPreview(ts: number): void {
  const canvas = preview();
  if ($('screen-shop').hidden) {
    previewRaf = 0;
    return;
  }
  const g = canvas.getContext('2d');
  if (g) {
    const size = 132;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const t = ts / 1000;
    const bob = Math.abs(Math.sin(t * 6)) * 3;
    g.fillStyle = 'rgba(40,70,40,.14)';
    g.beginPath();
    g.ellipse(size / 2, size - 12, 28, 6, 0, 0, Math.PI * 2);
    g.fill();
    drawChar(g, size / 2, size - 14 - bob, 58, currentLook(), { t, air: false, hurt: 0, squash: 1 });
  }
  previewRaf = requestAnimationFrame(paintPreview);
}

export function startShopIdle(): void {
  if (!previewRaf) previewRaf = requestAnimationFrame(paintPreview);
}

// ---------------------------------------------------------------- マス

function iconFor(canvas: HTMLCanvasElement, item: Item): void {
  const p = profile();
  switch (item.kind) {
    case 'skin':
      paintSkinIcon(canvas, { skin: item.id as SkinId, hat: '', color: p.color }, 56);
      break;
    case 'hat':
      paintHatIcon(canvas, item.id, 56);
      break;
    case 'acc':
      paintSkinIcon(canvas, { skin: p.skin, acc: item.id, color: p.color }, 56);
      break;
    case 'color':
      paintSkinIcon(canvas, { skin: p.skin, color: item.id }, 56);
      break;
  }
}

function itemButton(item: Item): HTMLButtonElement {
  const owned = isOwned(item);
  const p = profile();
  const cost = priceOf(item);
  const canBuy = !owned && p.coins >= cost;

  const b = document.createElement('button');
  b.type = 'button';
  b.className = `item${owned ? '' : canBuy ? ' buyable' : ' locked'}`;
  b.setAttribute('aria-pressed', String(isEquipped(item)));

  const c = document.createElement('canvas');
  const label = document.createElement('span');
  label.textContent = item.label;
  b.append(c, label);

  if (!owned) {
    const price = document.createElement('span');
    price.className = `price${canBuy ? '' : ' short'}`;
    price.innerHTML = `<span class="coin-dot"></span>${cost}`;
    b.appendChild(price);
  }

  b.addEventListener('click', () => {
    if (owned) {
      sfx.tap();
      equip(item);
    } else if (canBuy) {
      buyItem(item);
      sfx.crack();
    } else {
      // 買えない理由は「あと何枚か」で言う。押しても何も起きないボタンにはしない
      sfx.wrong();
      $('shop-msg').textContent = `${item.label} は あと ${cost - p.coins} コイン`;
      return;
    }
    $('shop-msg').textContent = '';
    renderShop();
    onChange?.();
  });

  // canvas は DOM に入れてからでないとサイズが決まらない
  queueMicrotask(() => iconFor(c, item));

  return b;
}

/** ぼうし・アクセ・いろ を外すマス */
function noneButton(kind: ItemKind, label: string): HTMLButtonElement {
  const p = profile();
  const current = kind === 'hat' ? p.hat : kind === 'acc' ? p.acc : p.color;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item none';
  b.setAttribute('aria-pressed', String(current === ''));
  b.append(Object.assign(document.createElement('span'), { className: 'no-hat', textContent: '／' }));
  b.append(Object.assign(document.createElement('span'), { textContent: label }));
  b.addEventListener('click', () => {
    sfx.tap();
    if (kind === 'hat') p.hat = '';
    else if (kind === 'acc') p.acc = '';
    else p.color = '';
    persist();
    renderShop();
    onChange?.();
  });
  return b;
}

export function renderShop(): void {
  const p = profile();
  $('shop-coins').textContent = String(p.coins);
  $('egg-cost').textContent = String(EGG_COST);
  $('shop-desc').textContent = `あつめた ${ownedCount()} / ${ITEMS.length}`;
  startShopIdle();

  const tabs = $('shop-tabs');
  tabs.replaceChildren();
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-selected', String(t.kind === tab));
    const got = ITEMS.filter((i) => i.kind === t.kind && isOwned(i)).length;
    const all = ITEMS.filter((i) => i.kind === t.kind).length;
    b.innerHTML = `${t.label}<small>${got}/${all}</small>`;
    b.addEventListener('click', () => {
      tab = t.kind;
      sfx.tap();
      renderShop();
    });
    tabs.appendChild(b);
  }

  const grid = $('item-grid');
  grid.replaceChildren();
  if (tab === 'hat') grid.appendChild(noneButton('hat', 'なし'));
  if (tab === 'acc') grid.appendChild(noneButton('acc', 'なし'));
  if (tab === 'color') grid.appendChild(noneButton('color', 'きほん'));
  for (const item of ITEMS.filter((i) => i.kind === tab)) grid.appendChild(itemButton(item));

  const remaining = lockedItems().length;
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
  const head =
    item.kind === 'skin' ? 'あたらしい なかま！' : item.kind === 'hat' ? 'あたらしい ぼうし！' : 'あたらしい アクセ！';
  $('egg-got-head').textContent = head;
  $('egg-got').textContent = item.label;
  const c = $<HTMLCanvasElement>('egg-result-canvas');
  paintSkinIcon(c, currentLook(), 120);
  $('overlay-egg').hidden = false;
  sfx.crack();
}

export function initShop(): void {
  $('egg-btn').addEventListener('click', () => {
    const item = openEgg();
    if (!item) return;
    tab = item.kind;
    showEggResult(item);
    renderShop();
    onChange?.();
  });

  $('egg-close').addEventListener('click', () => {
    sfx.tap();
    $('overlay-egg').hidden = true;
  });
}
