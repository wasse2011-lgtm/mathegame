/**
 * ペットぼくじょう。コインの使いみち その2。
 *
 * この画面の役目は「たくさん いることが 一目でわかる」こと。
 * 一覧の表だけだと数が増えても嬉しくないので、上に牧場を置いて
 * 持っている子ぜんぶを実際に歩かせる。増えるほど画面がにぎやかになる。
 */

import { sfx } from './audio';
import { drawPet, paintPetIcon } from './petart';
import {
  DUP_REFUND,
  PETS,
  PET_COUNT,
  PET_EGG_COST,
  PET_EGG_SHINY_COST,
  RARITIES,
  activePet,
  friendLevel,
  hasPet,
  ownedPets,
  powerOf,
  rarityDef,
  rollPetEgg,
  setActivePet,
  type PetDef,
  type PetRoll,
} from './pets';
import { profile } from './save';
import { currentLook, drawChar } from './sprites';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let onChange: (() => void) | null = null;

export function onRanchChange(fn: () => void): void {
  onChange = fn;
}

/** その子のはたらきを、子どもに読める言葉にする */
export function powerText(pet: PetDef): string {
  const pw = powerOf(pet);
  const parts: string[] = [];
  if (pw.slow > 0) parts.push(`しょうがいぶつが ${Math.round(pw.slow * 100)}％ ゆっくり`);
  if (pw.rescue > 0) parts.push('1かい せなかに のせてくれる');
  return parts.length ? parts.join('・') : 'いっしょに はしってくれる';
}

// ---------------------------------------------------------------- 牧場

interface Walker {
  pet: PetDef;
  x: number;
  /** 0（奥）〜1（手前）。大きさと重なり順に使う */
  depth: number;
  vx: number;
  phase: number;
}

let walkers: Walker[] = [];
let ranchRaf = 0;
let ranchW = 320;
let ranchH = 150;

function buildWalkers(): void {
  const list = ownedPets();
  walkers = list.map((pet, i) => ({
    pet,
    x: ((i + 0.5) / Math.max(list.length, 1)) * 0.9 + 0.05,
    depth: ((i * 7) % 10) / 10,
    vx: (i % 2 ? 1 : -1) * (0.02 + ((i * 3) % 5) * 0.006),
    phase: (i * 1.7) % 6,
  }));
}

function paintRanch(ts: number): void {
  const canvas = $<HTMLCanvasElement>('pasture');
  if ($('screen-ranch').hidden) {
    ranchRaf = 0;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const g = canvas.getContext('2d');
  if (!g || rect.width < 2) {
    ranchRaf = requestAnimationFrame(paintRanch);
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ranchW = Math.round(rect.width);
  ranchH = Math.round(rect.height);
  if (canvas.width !== Math.round(ranchW * dpr)) {
    canvas.width = Math.round(ranchW * dpr);
    canvas.height = Math.round(ranchH * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, ranchW, ranchH);

  const t = ts / 1000;
  const top = ranchH * 0.3;

  // そら → しばふ
  const sky = g.createLinearGradient(0, 0, 0, top);
  sky.addColorStop(0, '#bfe6fa');
  sky.addColorStop(1, '#e6f5fd');
  g.fillStyle = sky;
  g.fillRect(0, 0, ranchW, top);
  g.fillStyle = '#8fd07d';
  g.fillRect(0, top, ranchW, ranchH - top);
  g.fillStyle = '#7ec96f';
  g.fillRect(0, top, ranchW, 4);

  // 遠くの木
  g.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 97) % ranchW) + 20;
    g.beginPath();
    g.arc(cx, top - 12, 16 + (i % 3) * 4, 0, Math.PI * 2);
    g.fill();
  }

  // さく
  g.strokeStyle = '#d9b98a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, top + 10);
  g.lineTo(ranchW, top + 10);
  g.stroke();
  for (let x = 12; x < ranchW; x += 46) {
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, top + 20);
    g.stroke();
  }

  const active = activePet();
  const yOf = (depth: number) => top + 26 + depth * (ranchH - top - 40);
  const sizeOf = (depth: number) => (22 + depth * 16) * Math.min(1.4, ranchW / 320);

  // かいぬしも 牧場に立っている
  const ownerDepth = 0.55;
  const items: { z: number; draw: () => void }[] = [
    {
      z: ownerDepth,
      draw: () => {
        const y = yOf(ownerDepth);
        const s = sizeOf(ownerDepth) * 1.25;
        g.fillStyle = 'rgba(40,70,40,.16)';
        g.beginPath();
        g.ellipse(ranchW * 0.5, y + 2, s * 0.42, s * 0.13, 0, 0, Math.PI * 2);
        g.fill();
        drawChar(g, ranchW * 0.5, y, s, currentLook(), { t, air: false, hurt: 0, squash: 1 });
      },
    },
  ];

  for (const w of walkers) {
    w.x += w.vx * 0.16;
    if (w.x < 0.04) {
      w.x = 0.04;
      w.vx = Math.abs(w.vx);
    }
    if (w.x > 0.96) {
      w.x = 0.96;
      w.vx = -Math.abs(w.vx);
    }
    const y = yOf(w.depth);
    const s = sizeOf(w.depth);
    const x = w.x * ranchW;
    const isActive = active?.id === w.pet.id;
    items.push({
      // つれて歩く子は、ほかの子のうしろに隠れないよう最前面に描く
      z: isActive ? 1.05 : w.depth,
      draw: () => {
        // つれて歩く子は、足もとの わっかでも分かるようにする
        // （ハートだけだと、まわりの子と重なって見えなくなる）
        if (isActive) {
          g.fillStyle = 'rgba(255,197,61,.55)';
          g.beginPath();
          g.ellipse(x, y + 2, s * 0.44, s * 0.16, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,.55)';
          g.beginPath();
          g.ellipse(x, y + 2, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = 'rgba(40,70,40,.14)';
          g.beginPath();
          g.ellipse(x, y + 2, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        }
        drawPet(g, x, y, s, w.pet.art, t + w.phase);
        if (isActive) {
          // つれて歩く子には しるしを付ける
          g.fillStyle = '#ffc53d';
          g.strokeStyle = '#d99a10';
          g.lineWidth = 1.5;
          g.beginPath();
          const hy = y - s * (w.pet.art.fly ? 1.15 : 0.95);
          g.moveTo(x, hy + s * 0.12);
          g.bezierCurveTo(x - s * 0.2, hy - s * 0.06, x - s * 0.06, hy - s * 0.2, x, hy - s * 0.06);
          g.bezierCurveTo(x + s * 0.06, hy - s * 0.2, x + s * 0.2, hy - s * 0.06, x, hy + s * 0.12);
          g.fill();
          g.stroke();
        }
      },
    });
  }

  items.sort((a, b) => a.z - b.z).forEach((i) => i.draw());

  if (!walkers.length) {
    // かいぬしと重ならないよう、しばふの手前に置く
    g.fillStyle = 'rgba(40,60,70,.62)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.min(15, ranchW / 22)}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.fillText('たまごを わると なかまが ふえるよ', ranchW / 2, ranchH - 16);
  }

  ranchRaf = requestAnimationFrame(paintRanch);
}

export function startRanchIdle(): void {
  if (!ranchRaf) ranchRaf = requestAnimationFrame(paintRanch);
}

// ---------------------------------------------------------------- 一覧

function heartRow(level: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'hearts';
  wrap.textContent = '♥'.repeat(level);
  wrap.setAttribute('aria-label', `なかよし ${level}`);
  return wrap;
}

function petCell(pet: PetDef): HTMLButtonElement {
  const owned = hasPet(pet.id);
  const r = rarityDef(pet.rarity);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `pet-cell r-${pet.rarity}${owned ? '' : ' locked'}`;
  b.setAttribute('aria-pressed', String(activePet()?.id === pet.id));
  b.style.setProperty('--rc', r.color);
  b.style.setProperty('--rs', r.soft);

  const c = document.createElement('canvas');
  const name = document.createElement('span');
  name.className = 'pet-name';
  name.textContent = owned ? pet.name : '？？？';
  b.append(c, name);
  if (owned && friendLevel(pet.id) > 1) b.appendChild(heartRow(friendLevel(pet.id)));

  b.addEventListener('click', () => {
    sfx.tap();
    if (owned) {
      setActivePet(pet.id);
      renderRanch();
      onChange?.();
    } else {
      $('pet-detail').textContent = `？？？　${r.label}の なかま`;
    }
  });

  queueMicrotask(() => paintPetIcon(c, pet.art, 54, { silhouette: !owned }));
  return b;
}

export function renderRanch(): void {
  const p = profile();
  const owned = ownedPets();
  $('ranch-coins').textContent = String(p.coins);
  $('ranch-desc').textContent = `なかま ${owned.length} / ${PET_COUNT}`;

  const active = activePet();
  $('pet-detail').textContent = active
    ? `🐾 ${active.name}　${powerText(active)}`
    : owned.length
      ? 'つれていく なかまを タップして えらぼう'
      : 'たまごを わると なかまが やってくる';

  const grid = $('pet-grid');
  grid.replaceChildren();
  for (const r of RARITIES) {
    const list = PETS.filter((x) => x.rarity === r.id);
    const got = list.filter((x) => hasPet(x.id)).length;

    const head = document.createElement('p');
    head.className = 'rarity-head';
    head.style.setProperty('--rc', r.color);
    head.innerHTML = `<span class="dot"></span>${r.label}<b>${got} / ${list.length}</b>`;
    grid.appendChild(head);

    const row = document.createElement('div');
    row.className = 'pet-row';
    for (const pet of list) row.appendChild(petCell(pet));
    grid.appendChild(row);
  }

  const egg = $<HTMLButtonElement>('pet-egg');
  const shiny = $<HTMLButtonElement>('pet-egg-shiny');
  egg.disabled = p.coins < PET_EGG_COST;
  shiny.disabled = p.coins < PET_EGG_SHINY_COST;
  $('pet-egg-sub').textContent = egg.disabled ? `あと ${PET_EGG_COST - p.coins}` : 'なかま +1';
  $('pet-egg-shiny-sub').textContent = shiny.disabled
    ? `あと ${PET_EGG_SHINY_COST - p.coins}`
    : 'レアが でやすい';

  buildWalkers();
  startRanchIdle();
}

// ---------------------------------------------------------------- たまご

function showRoll(roll: PetRoll): void {
  const r = rarityDef(roll.pet.rarity);
  const badge = $('pet-rarity');
  badge.textContent = r.label;
  badge.style.setProperty('--rc', r.color);
  badge.style.setProperty('--rs', r.soft);
  $('pet-got').textContent = roll.pet.name;
  $('pet-result-note').textContent = roll.dup
    ? `なかよし度アップ！（♥${roll.friend}）　コインが ${roll.refund} もどってきた`
    : `${roll.pet.note}${roll.equipped ? '' : '（つれて歩く子は そのまま）'}`;
  $('pet-result-head').textContent = roll.dup ? 'また あえたね！' : 'なかまに なった！';

  const c = $<HTMLCanvasElement>('pet-result-canvas');
  paintPetIcon(c, roll.pet.art, 132);
  $('overlay-pet').hidden = false;

  if (roll.pet.rarity === 'ur') sfx.legend();
  else if (roll.pet.rarity === 'sr') sfx.fanfare();
  else sfx.crack();
}

export function initRanch(): void {
  const open = (shiny: boolean) => {
    const roll = rollPetEgg(shiny);
    if (!roll) return;
    showRoll(roll);
    renderRanch();
    onChange?.();
  };

  $('pet-egg').addEventListener('click', () => open(false));
  $('pet-egg-shiny').addEventListener('click', () => open(true));
  $('pet-close').addEventListener('click', () => {
    sfx.tap();
    $('overlay-pet').hidden = true;
  });

  $('pet-egg-cost').textContent = String(PET_EGG_COST);
  $('pet-egg-shiny-cost').textContent = String(PET_EGG_SHINY_COST);
  $('dup-note').textContent = `おなじ子が でたら なかよし度アップ＋${DUP_REFUND}コイン`;
}
