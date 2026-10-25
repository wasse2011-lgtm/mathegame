/**
 * ふたりで ボス の入口（2人を えらぶ画面）と、main.ts との つなぎ。
 *
 * きろくの子は ホームで選ばれている子に固定（ほかの子にするなら ホームで きろくを選びなおす）。
 * なかまは ほかの きろくの子・ゲスト（てで）・ゲスト（CPU）から えらぶ。
 * ふだんは きろくの子が 左。「いれかえる」で 右に すわれる（その子の きろくに おぼえておく）。
 * 🏆 は でんどういり（8体 ぜんぶ倒した）の 額縁の かざり棚。
 * むずかしさは 本編と同じ3段階で、2人の どちらかが 1つ下を 最後まで倒していれば開く。
 *
 * 出すのは iPad だけ（duo-rules.ts の duoDevice）。2人の板を左右に並べると、
 * スマホの横持ち（852×393）では 舞台と ボタンが 両方は入らない。
 */

import { sfx, unlockAudio } from './audio';
import { bossDef } from './boss';
import { TIER_LIST, tierDef, type Tier } from './curriculum';
import { DuoGame, type DuoPartner } from './duo';
import { DUO_BOSSES, DUO_BOSS_COUNT, duoDevice, duoSaveKey, duoTierOpen } from './duo-rules';
import { buildFameFrame } from './duo-fame';
import { persist, profile, save, slots, timeUp, type DuoSuspend, type Profile } from './save';
import { paintSkinIcon } from './sprites';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface DuoEnv {
  /** スタートへ（ホーム） */
  onExit: () => void;
  /** コイン・きせかえが変わった */
  onChange: () => void;
}

let env: DuoEnv = { onExit: () => undefined, onChange: () => undefined };
let game: DuoGame | null = null;
let tierSel: Tier = 0;
/** 右の相手。開きなおしても 前に えらんだ相手を おぼえておく（その日のうちだけ） */
let partnerSel: DuoPartner | null = null;

/** この端末で出すか（iPad 相当のタッチ画面） */
export function duoAvailable(): boolean {
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  return duoDevice(window.screen.width, window.screen.height, touch);
}

export function initDuo(e: DuoEnv): void {
  env = e;
  $('duo-back').addEventListener('click', () => {
    sfx.tap();
    env.onExit();
  });
  $('duo-swap').addEventListener('click', () => {
    sfx.tap();
    const d = profile().duo;
    d.swap = !d.swap;
    persist();
    renderPick();
  });
  $('duo-hall-btn').addEventListener('click', () => {
    sfx.tap();
    openHall();
  });
  $('duo-hall-close').addEventListener('click', () => {
    sfx.tap();
    $('duo-hall').hidden = true;
  });
}

/** でんどう（かざり棚）。あたらしい 額縁から ならべる */
function openHall(): void {
  const fame = profile().duo.fame;
  const list = $('duo-hall-list');
  list.replaceChildren(...fame.slice().reverse().map((f) => buildFameFrame(f, false)));
  $('duo-hall-empty').hidden = fame.length > 0;
  $('duo-hall').hidden = false;
}

function engine(): DuoGame {
  if (!game) game = new DuoGame();
  return game;
}

/** ほかの きろくの子（左の子と、まだ使っていない枠を のぞく） */
function otherKids(): { slot: number; p: Profile }[] {
  return slots()
    .map((p, slot) => ({ slot, p }))
    .filter((x) => x.slot !== save.active && x.p.name !== '');
}

function partnerProfile(pt: DuoPartner | null): Profile | null {
  return pt && pt.kind === 'kid' ? slots()[pt.slot] ?? null : null;
}

function samePartner(a: DuoPartner | null, b: DuoPartner): boolean {
  if (!a) return false;
  if (a.kind === 'kid' && b.kind === 'kid') return a.slot === b.slot;
  if (a.kind === 'guest' && b.kind === 'guest') return a.cpu === b.cpu;
  return false;
}

/** その組・その段階の つづき。右の子の枠に 別の子が入っていたら使わない */
function savedRun(tier: Tier, pt: DuoPartner): DuoSuspend | null {
  const key = duoSaveKey(tier, pt.kind === 'kid' ? pt.slot : 'g');
  const s = profile().duo.saves[key];
  if (!s) return null;
  const right = partnerProfile(pt);
  if (right && s.partner !== right.name) return null;
  return s;
}

/** 2人を えらぶ画面を出す */
export function openDuo(): void {
  const kids = otherKids();
  // 前の相手が もういない（きろくを消した）ときは、ほかの子 → CPU の順に えらびなおす
  if (!partnerSel || (partnerSel.kind === 'kid' && !kids.some((k) => partnerSel?.kind === 'kid' && k.slot === partnerSel.slot))) {
    partnerSel = kids[0] ? { kind: 'kid', slot: kids[0].slot } : { kind: 'guest', cpu: true };
  }
  $('duo-pick').hidden = false;
  $('duo-play').hidden = true;
  $('duo-hall').hidden = true;
  $('screen-duo').style.background = '';
  renderPick();
}

function renderPick(): void {
  const left = profile();
  const pt = partnerSel as DuoPartner;
  const right = partnerProfile(pt);
  // 相手を かえて いまの段階が閉じたら、開いている いちばん上に下げる
  while (tierSel > 0 && !duoTierOpen(tierSel, left, right)) tierSel = (tierSel - 1) as Tier;

  paintSkinIcon($<HTMLCanvasElement>('duo-left-face'), {
    skin: left.skin, hat: left.hat, acc: left.acc, color: left.color, weapon: left.weapon,
  }, 72);
  $('duo-left-name').textContent = left.name;
  // すわる ところ。いれかえると きみの列が 右へ（えらぶ画面も すわる順に ならべる）
  const swap = left.duo.swap;
  $('duo-cols').classList.toggle('swap', swap);
  $('duo-me-head').textContent = swap ? 'みぎ（きみ）' : 'ひだり（きみ）';
  $('duo-mate-head').textContent = swap ? 'ひだり（なかま）' : 'みぎ（なかま）';
  $('duo-hall-count').textContent = left.duo.fame.length ? String(left.duo.fame.length) : '';

  // むずかしさ。どこまで倒したかを 札に出す（8体ぜんぶなら 👑）
  const tiers = $('duo-tiers');
  tiers.replaceChildren();
  for (const t of TIER_LIST) {
    const def = tierDef(t);
    const open = duoTierOpen(t, left, right);
    const best = Math.max(left.duo.best[t], right?.duo.best[t] ?? 0);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip duo-tier';
    b.style.setProperty('--tier', def.color);
    b.setAttribute('aria-selected', String(t === tierSel));
    b.disabled = !open;
    const mark = !open ? '🔒' : best >= DUO_BOSS_COUNT ? '👑' : `${best}/${DUO_BOSS_COUNT}`;
    b.innerHTML = `${def.icon}${def.name}<small>${mark}</small>`;
    b.addEventListener('click', () => {
      sfx.tap();
      tierSel = t;
      renderPick();
    });
    tiers.appendChild(b);
  }

  // 右の相手
  const list = $('duo-partners');
  list.replaceChildren();
  const add = (p: DuoPartner, label: string, paint: (c: HTMLCanvasElement) => void, note = '', off = false): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'duo-partner';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(samePartner(partnerSel, p)));
    b.disabled = off;
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    const name = document.createElement('b');
    name.textContent = label;
    b.append(c, name);
    if (note) {
      const small = document.createElement('small');
      small.textContent = note;
      b.appendChild(small);
    }
    b.addEventListener('click', () => {
      sfx.tap();
      partnerSel = p;
      renderPick();
    });
    list.appendChild(b);
    paint(c);
  };
  for (const k of otherKids()) {
    const over = timeUp(Date.now(), k.p);
    add(
      { kind: 'kid', slot: k.slot },
      k.p.name,
      (c) => paintSkinIcon(c, { skin: k.p.skin, hat: k.p.hat, acc: k.p.acc, color: k.p.color }, 44),
      over ? '🌙 きょうは おしまい' : '',
      over,
    );
  }
  const guestLook = { skin: 'cat' as const, color: 'color-silver' };
  add({ kind: 'guest', cpu: false }, 'ゲスト（てで）', (c) => paintSkinIcon(c, guestLook, 44), 'きろくの ない子');
  add({ kind: 'guest', cpu: true }, '🤖 CPU', (c) => paintSkinIcon(c, guestLook, 44), 'コンピューターと くむ');

  // はじめる／つづきから
  const go = $('duo-go');
  go.replaceChildren();
  const msg = $('duo-pick-msg');
  msg.textContent = '';
  if (right && timeUp(Date.now(), right)) {
    msg.textContent = `${right.name}は きょうは もう あそべないよ`;
    return;
  }
  const saved = savedRun(tierSel, pt);
  const btn = (label: string, cls: string, resume: DuoSuspend | null): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startRun(resume);
    });
    go.appendChild(b);
  };
  if (saved) {
    const def = bossDef(DUO_BOSSES[saved.boss].world, tierSel, tierDef(tierSel).bossPrefix);
    btn(`つづきから（${saved.boss + 1}/${DUO_BOSS_COUNT} ${def.name}）`, 'btn btn-primary btn-xl', saved);
    btn('さいしょから', 'btn btn-ghost', null);
  } else {
    btn(pt.kind === 'guest' && pt.cpu ? 'CPUと スタート' : 'ふたりで スタート', 'btn btn-primary btn-xl', null);
  }
}

function startRun(resume: DuoSuspend | null): void {
  const pt = partnerSel as DuoPartner;
  // 「さいしょから」は、のこっていた つづきを消してから はじめる
  if (!resume) {
    delete profile().duo.saves[duoSaveKey(tierSel, pt.kind === 'kid' ? pt.slot : 'g')];
    persist();
  }
  $('duo-pick').hidden = true;
  engine().start({ tier: tierSel, partner: pt, resume, swap: profile().duo.swap }, {
    onExit: () => env.onExit(),
    onChange: () => env.onChange(),
  });
}

// ------------------------------------------------------------------ main.ts から

/** 戦っている途中か・でんどういりの 演出中か（0 になった時間の 3分の待ちに使う） */
export function duoFighting(): boolean {
  return game ? game.fighting() || game.celebrating() : false;
}

/** 1日の時間・タイマーで区切る。つづきは保存する（時間切れは負けにしない） */
export function duoHaltForTime(): void {
  if (game?.active()) game.haltForTime();
}

export function duoPauseForHidden(): void {
  game?.pauseForHidden();
}

/** いっしょに遊んでいる 右の子（1日の時間を同じだけ減らす） */
export function duoPartners(): Profile[] {
  return game?.partnerProfiles() ?? [];
}

export function duoTick(): void {
  game?.tick1s();
}

/** 画面を離れた（ホームへ・きょうは ここまで）。動いていれば止める */
export function duoLeave(): void {
  if (game?.active()) game.haltForTime();
  game?.stop();
}
