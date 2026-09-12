/**
 * きせかえ。コインの使いみち その1。
 *
 * やることは1つだけ。
 *   「キャラ／ぼうし／アクセ／いろ のどれを増やすか えらぶ → ガチャを1回まわす」
 *
 * 以前は たまご（ランダム）・ねらい買い・いろの直接買いが混ざっていて、
 * マスごとに ちがう値段（75 / 180 / 210 / 240）が並んでいた。
 * 「何をすればアイテムが増えるのか」が画面から読めず、値札を読むゲームに
 * なっていたので、行為を1つにそろえた（items.ts の GACHA_COST）。
 *
 * まだ持っていないものも、絵と名前は出す。伏せてあると「なにが欲しいか」を
 * 決められず、コインを貯める目標にならない。ねだんはガチャのボタンにだけ出す。
 *
 * 中身は見た目だけで、ゲームの難しさには一切影響しない。
 */

import { sfx } from './audio';
import {
  GACHA_COST,
  ITEMS,
  KIND_LABEL,
  equip,
  isEquipped,
  isOwned,
  lockedItemsOf,
  ownedCount,
  rollGacha,
  type Item,
  type ItemKind,
} from './items';
import { persist, profile, type SkinId } from './save';
import { currentLook, drawChar, paintHatIcon, paintSkinIcon } from './sprites';
import { paintWeaponIcon, weaponDef } from './weapons';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let onChange: (() => void) | null = null;

/** きせかえ内容が変わったときに呼ぶコールバック（ホームのコイン表示など） */
export function onShopChange(fn: () => void): void {
  onChange = fn;
}

// ぶきは2番目に置く。さいごの1問の フィニッシュに直結する品なので、
// いちばん見にきてほしい（うしろに置くと、タブを送らないと見つからない）
const TABS: ItemKind[] = ['skin', 'weapon', 'hat', 'acc', 'color'];

let tab: ItemKind = 'skin';

/** 外から開くタブを指定する（ホームの「いまの ぶき」から飛んでくる） */
export function setShopTab(kind: ItemKind): void {
  tab = kind;
}

// ---------------------------------------------------------------- スワイプ

/**
 * よこにスワイプしてタブを送る。
 *
 * タブは 44px のマスが5つ。指のおおざっぱな子には、狙って押すより
 * 「はらって めくる」ほうが速い。アルバムをめくる感じで ぜんぶ見てまわれる。
 * はしまで行ったら反対のはしへ回る（行き止まりを作らない）。
 */
const SWIPE_MIN = 44;
const SWIPE_MS = 800;

function moveTab(dir: 1 | -1): void {
  const next = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
  if (next === tab) return;
  tab = next;
  sfx.tap();
  $('shop-msg').textContent = '';
  renderShop();
  // めくった向きにマスが流れこむ。どちらへ動いたのかを目で分かるようにする
  const grid = $('item-grid');
  grid.classList.remove('slide-l', 'slide-r');
  void grid.offsetWidth;
  grid.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
}

/**
 * スワイプを見はる。
 *
 * 指が はなれるのを待たずに、**動いた時点で** めくる。待つ作りにすると、
 * ブラウザが「これは たてスクロールだ」と判断した瞬間に pointercancel が来て、
 * 指をはなしても何も起きない（＝たまに効かないボタン）になる。
 *
 * はらった指が そのままマスを押さないよう、そのあとの click は捨てる。
 */
function initSwipe(): void {
  const screen = $('screen-shop');
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  /** いま追いかけている指。めくったあとは、はなすまで見ない */
  let live = false;
  /** めくった直後か。次に来る click ひとつを捨てるための印 */
  let swiped = false;

  const begin = (x: number, y: number): void => {
    x0 = x;
    y0 = y;
    t0 = performance.now();
    live = true;
    swiped = false;
  };

  const move = (x: number, y: number): void => {
    if (!live) return;
    const dx = x - x0;
    const dy = y - y0;
    // たての動きのほうが大きいときは たてスクロール。この指は もう見ない
    if (Math.abs(dy) > Math.abs(dx) * 1.4 && Math.abs(dy) > SWIPE_MIN) {
      live = false;
      return;
    }
    if (Math.abs(dx) < SWIPE_MIN || performance.now() - t0 > SWIPE_MS) return;
    live = false;
    swiped = true;
    moveTab(dx < 0 ? 1 : -1);
  };

  screen.addEventListener('pointerdown', (e) => begin(e.clientX, e.clientY));
  screen.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
  // 指は pointer とは別にも受ける。ブラウザが「これはスクロールだ」と決めると
  // その場で pointercancel が来て pointermove が止まるが、touchmove は届きつづける。
  // 片方だけに頼ると、機種やブラウザによって「たまに効かない」ものになる
  const touch = (e: TouchEvent, fn: (x: number, y: number) => void): void => {
    const t = e.touches[0];
    if (t) fn(t.clientX, t.clientY);
  };
  screen.addEventListener('touchstart', (e) => touch(e, begin), { passive: true });
  screen.addEventListener('touchmove', (e) => touch(e, move), { passive: true });

  // pointercancel と pointerleave はここに入れない。
  // ブラウザが「これはスクロールだ」と決めた時点で 3つまとめて飛んでくるので、
  // 入れると touchmove 側の道もいっしょに閉じてしまう（実測で これが原因だった）
  for (const ev of ['pointerup', 'touchend', 'touchcancel']) {
    screen.addEventListener(ev, () => { live = false; });
  }

  // click は pointerup のあと。押したことにせず、印だけ消す
  screen.addEventListener(
    'click',
    (e) => {
      if (!swiped) return;
      swiped = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

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
    // ぶきは キャラに持たせず、そのものを大きく見せる。
    // 小さいマスの中で キャラの横に付けても、何を持っているのか読めない
    case 'weapon':
      paintWeaponIcon(canvas, item.id, 56);
      break;
    case 'color':
      paintSkinIcon(canvas, { skin: p.skin, color: item.id }, 56);
      break;
  }
}

/** ガチャのボタンを1回はねさせる。「そっちを押すんだよ」を、ことばの前に見せる */
function pointAtGacha(): void {
  const btn = $('gacha-btn');
  btn.classList.remove('call');
  requestAnimationFrame(() => btn.classList.add('call'));
  window.setTimeout(() => btn.classList.remove('call'), 700);
}

function itemButton(item: Item): HTMLButtonElement {
  const owned = isOwned(item);

  const b = document.createElement('button');
  b.type = 'button';
  b.className = `item${owned ? '' : ' locked'}`;
  b.setAttribute('aria-pressed', String(isEquipped(item)));

  const c = document.createElement('canvas');
  const label = document.createElement('span');
  label.textContent = item.label;
  b.append(c, label);

  if (!owned) {
    // 値札のかわりの目じるし。「まだ持っていない」だけを言う
    const mark = document.createElement('span');
    mark.className = 'item-lock';
    mark.textContent = '？';
    mark.setAttribute('aria-label', 'まだ もっていない');
    b.appendChild(mark);
  }

  b.addEventListener('click', () => {
    if (owned) {
      sfx.tap();
      equip(item);
      // ぶきは「なにが起きるか」を言う。持ちかえた理由がその場で分かるように
      $('shop-msg').textContent =
        item.kind === 'weapon' ? `${item.label}：${weaponDef(item.id).note}` : '';
      renderShop();
      onChange?.();
      return;
    }
    // 押しても何も起きないボタンにはしない。どうすれば手に入るかを言う
    sfx.tap();
    $('shop-msg').textContent = `${item.label} は ガチャで あたるよ！`;
    pointAtGacha();
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
  $('gacha-cost').textContent = String(GACHA_COST);
  $('shop-desc').textContent = `あつめた ${ownedCount()} / ${ITEMS.length}`;
  startShopIdle();

  const tabs = $('shop-tabs');
  tabs.replaceChildren();
  for (const kind of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-selected', String(kind === tab));
    const got = ITEMS.filter((i) => i.kind === kind && isOwned(i)).length;
    const all = ITEMS.filter((i) => i.kind === kind).length;
    b.innerHTML = `${KIND_LABEL[kind]}<small>${got}/${all}</small>`;
    b.addEventListener('click', () => {
      tab = kind;
      sfx.tap();
      $('shop-msg').textContent = '';
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

  // ガチャのボタンは、いま えらんでいる種類のもの。
  // 「なにが増えるのか」がボタンの文字だけで分かるようにする
  const remaining = lockedItemsOf(tab).length;
  const btn = $<HTMLButtonElement>('gacha-btn');
  $('gacha-label').textContent = `${KIND_LABEL[tab]}の ガチャ`;
  if (remaining === 0) {
    btn.disabled = true;
    $('gacha-sub').textContent = `${KIND_LABEL[tab]}は ぜんぶ そろった！`;
  } else if (p.coins < GACHA_COST) {
    btn.disabled = true;
    $('gacha-sub').textContent = `あと ${GACHA_COST - p.coins} コイン`;
  } else {
    btn.disabled = false;
    $('gacha-sub').textContent = `のこり ${remaining}こ`;
  }
}

function showGachaResult(item: Item): void {
  $('egg-got-head').textContent = `あたらしい ${KIND_LABEL[item.kind]}！`;
  $('egg-got').textContent = item.label;
  const c = $<HTMLCanvasElement>('egg-result-canvas');
  paintSkinIcon(c, currentLook(), 120);
  $('overlay-egg').hidden = false;
  sfx.crack();
}

export function initShop(): void {
  initSwipe();

  $('gacha-btn').addEventListener('click', () => {
    const item = rollGacha(tab);
    if (!item) return;
    showGachaResult(item);
    renderShop();
    onChange?.();
  });

  $('egg-close').addEventListener('click', () => {
    sfx.tap();
    $('overlay-egg').hidden = true;
  });
}
