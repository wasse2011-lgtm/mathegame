import './style.css';

import { sfx, unlockAudio } from './audio';
import {
  DAILY_WORLD,
  WORLDS,
  answerTimeFor,
  bossRequirement,
  bossStage,
  isBoss,
  questionCount,
  worldById,
  type Fact,
  type World,
} from './curriculum';
import { initParent, makeGate, renderParent } from './parent';
import { initShop, onShopChange, renderShop } from './shop';
import { MASTERED, weakestFacts } from './questions';
import { COIN_BOSS, COIN_DAILY } from './rewards';
import { Runner, type RunConfig, type StageResult } from './runner';
import {
  clearSlot,
  flushSave,
  isEmptySlot,
  overDailyLimit,
  persist,
  profile,
  refreshDaily,
  requestPersistentStorage,
  resetAll,
  save,
  selectSlot,
  slots,
  stageStars,
  storageWorks,
  usedSlots,
} from './save';
import { SKINS, drawChar, paintSkinIcon } from './sprites';
import { skyCss, themeFor, timeIdFor, type TimeId } from './theme';
import { renderZukan, zukanProgress } from './zukan';

type ScreenName = 'title' | 'slots' | 'map' | 'play' | 'result' | 'zukan' | 'shop' | 'parent';

const screens: Record<ScreenName, HTMLElement> = {
  title: document.getElementById('screen-title') as HTMLElement,
  slots: document.getElementById('screen-slots') as HTMLElement,
  map: document.getElementById('screen-map') as HTMLElement,
  play: document.getElementById('screen-play') as HTMLElement,
  result: document.getElementById('screen-result') as HTMLElement,
  zukan: document.getElementById('screen-zukan') as HTMLElement,
  shop: document.getElementById('screen-shop') as HTMLElement,
  parent: document.getElementById('screen-parent') as HTMLElement,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const runner = new Runner();
let current: ScreenName = 'title';
let mapWorld = 1;
let lastRun: RunConfig | null = null;
let lastResult: StageResult | null = null;

function show(name: ScreenName): void {
  // リザルトの演出は音とタイマーを持っている。画面を離れるときに必ず止める
  if (current === 'result' && name !== 'result') stopResultAnim();
  current = name;
  (Object.keys(screens) as ScreenName[]).forEach((k) => {
    screens[k].hidden = k !== name;
  });
  if (name === 'title') startHomeIdle();
}

// ------------------------------------------------------------------ ホームのキャラ

const homeCanvas = $<HTMLCanvasElement>('home-char');
let homeRaf = 0;

/** ホーム画面で、いま着せているキャラがその場で走っている */
function paintHome(ts: number): void {
  if (screens.title.hidden || homeCanvas.hidden) {
    homeRaf = 0;
    return;
  }
  const g = homeCanvas.getContext('2d');
  if (g) {
    const size = 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (homeCanvas.width !== Math.round(size * dpr)) {
      homeCanvas.width = Math.round(size * dpr);
      homeCanvas.height = Math.round(size * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const t = ts / 1000;
    const p = profile();
    const bob = Math.abs(Math.sin(t * 6)) * 3;
    g.fillStyle = 'rgba(40,70,40,.16)';
    g.beginPath();
    g.ellipse(size / 2, size - 12, 26, 6, 0, 0, Math.PI * 2);
    g.fill();
    drawChar(g, size / 2, size - 14 - bob, 52, p.skin, { t, air: false, hurt: 0, squash: 1 }, p.hat);
  }
  homeRaf = requestAnimationFrame(paintHome);
}

function startHomeIdle(): void {
  if (!homeRaf) homeRaf = requestAnimationFrame(paintHome);
}

/** ホームに戻る。描き直しを忘れないよう、必ずここを通す */
function goHome(): void {
  $('overlay-pause').hidden = true;
  renderTitle();
  show('title');
}

// ------------------------------------------------------------------ 進行状況

/** ワールドの通常ステージで集めた★ */
function normalStars(w: World): number {
  let n = 0;
  for (let s = 1; s <= w.stages; s++) n += stageStars(w.id, s);
  return n;
}

/**
 * ステージが開いているか。
 * 通常ステージは前を1つでもクリアすれば開くが、ボスだけは★の合計で見る。
 * ★の下限は1なので、当てずっぽうで通過し続けた子はここで足が止まり、
 * 先のワールドに進めない（ゲームオーバーにはしない）。
 */
function stageUnlocked(w: World, stage: number): boolean {
  if (isBoss(w, stage)) return normalStars(w) >= bossRequirement(w);
  if (stage === 1) return true;
  return stageStars(w.id, stage - 1) > 0;
}

function worldUnlocked(id: number): boolean {
  if (id === 1) return true;
  const prev = worldById(id - 1);
  return stageStars(prev.id, bossStage(prev)) > 0;
}

function nextStageOf(worldId: number, stage: number): { world: World; stage: number } | null {
  if (stage < 1) return null; // デイリーには「つぎ」がない
  const w = worldById(worldId);
  if (stage < bossStage(w)) return { world: w, stage: stage + 1 };
  const nw = WORLDS.find((x) => x.id === worldId + 1);
  return nw ? { world: nw, stage: 1 } : null;
}

function starsInWorld(w: World): number {
  let n = 0;
  for (let s = 1; s <= bossStage(w); s++) n += stageStars(w.id, s);
  return n;
}

/** 解放済みの一番奥のワールド */
function lastPlayedWorld(): number {
  let id = 1;
  for (const w of WORLDS) if (worldUnlocked(w.id)) id = w.id;
  return id;
}

// ------------------------------------------------------------------ ホーム

function renderTitle(): void {
  const p = profile();
  const needsSetup = !p.name;
  $('skin-pick').hidden = !needsSetup;
  $('home').hidden = needsSetup;
  $('title-sub').hidden = needsSetup;
  homeCanvas.hidden = needsSetup;
  $('btn-start').textContent = needsSetup ? 'はじめる' : 'あそぶ';
  if (!needsSetup) startHomeIdle();

  if (needsSetup) {
    const row = $('skin-row');
    row.replaceChildren();
    for (const skin of SKINS.slice(0, 3)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-btn';
      b.setAttribute('aria-pressed', String(p.skin === skin.id));
      const c = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = skin.label;
      b.append(c, label);
      b.addEventListener('click', () => {
        profile().skin = skin.id;
        persist();
        sfx.tap();
        renderTitle();
      });
      row.appendChild(b);
      paintSkinIcon(c, skin.id, '', 56);
    }
    $<HTMLInputElement>('name-input').value = p.name;
    return;
  }

  refreshDaily(p);
  $('hello').textContent = `${p.name} の ぼうけん`;
  $('hello').setAttribute('aria-label', `${p.name} の ぼうけん。きろくを えらぶ`);
  $('home-coins').textContent = String(p.coins);

  // 1日の上限に達したら、遊ぶ導線だけ閉じる（図鑑ときせかえは見られる）
  const over = overDailyLimit();
  const startBtn = $<HTMLButtonElement>('btn-start');
  const daily = $<HTMLButtonElement>('daily-card');
  startBtn.disabled = over;
  daily.disabled = over;
  startBtn.textContent = over ? 'きょうは おしまい' : 'あそぶ';
  $('over-note').hidden = !over;

  daily.classList.toggle('done', p.daily.done);
  $('daily-state').textContent = over
    ? 'また あした'
    : p.daily.done
      ? 'きょうは クリア！'
      : `＋${COIN_DAILY} コイン`;
  const streak = $('home-streak');
  streak.hidden = p.daily.streak < 1;
  const sb = streak.querySelector('b');
  if (sb) sb.textContent = String(p.daily.streak);

  const { done, total } = zukanProgress();
  $('zukan-count').textContent = `${done} / ${total}`;
  $('zukan-bar').style.width = `${(done / total) * 100}%`;
}

$('btn-start').addEventListener('click', () => {
  const p = profile();
  if (!p.name) {
    // trim してから既定値に落とす。先に || を書くと、空白だけの入力が
    // truthy なので 'きみ' に落ちず、名前が空のままマップへ進んでしまう。
    p.name = $<HTMLInputElement>('name-input').value.trim().slice(0, 6) || 'きみ';
    persist();
    renderTitle(); // 戻ってきたときのホームを先に作っておく
  }
  sfx.tap();
  mapWorld = lastPlayedWorld();
  renderMap();
  show('map');
});

// ------------------------------------------------------------------ きろく（セーブデータ）

/** そのきろくが集めた★の合計 */
function starsOf(stars: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(stars)) n += v;
  return n;
}

/** 消す前に確認するきろくの番号。-1 は確認中でない */
let eraseTarget = -1;

function renderSlots(): void {
  const list = $('slot-list');
  list.replaceChildren();

  slots().forEach((p, i) => {
    const empty = isEmptySlot(p);
    const card = document.createElement('div');
    card.className = `slot${empty ? ' empty' : ''}${i === save.active && !empty ? ' current' : ''}`;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'slot-pick';

    const c = document.createElement('canvas');
    c.className = 'slot-face';
    const body = document.createElement('span');
    body.className = 'slot-body';

    if (empty) {
      const name = document.createElement('b');
      name.textContent = 'あたらしい ぼうけん';
      const sub = document.createElement('span');
      sub.textContent = 'ここから はじめる';
      body.append(name, sub);
      const plus = document.createElement('span');
      plus.className = 'slot-plus';
      plus.textContent = '＋';
      pick.append(plus, body);
    } else {
      const name = document.createElement('b');
      name.textContent = p.name;
      const sub = document.createElement('span');
      const zukan = Object.values(p.facts).filter((s) => s.m >= MASTERED).length;
      sub.textContent = `★${starsOf(p.stars)}　コイン ${p.coins}　ずかん ${zukan}`;
      const seen = document.createElement('small');
      seen.textContent = p.seen ? `さいごに あそんだ日 ${p.seen}` : 'まだ あそんでいません';
      body.append(name, sub, seen);
      pick.append(c, body);
      queueMicrotask(() => paintSkinIcon(c, p.skin, p.hat, 54));
    }

    pick.addEventListener('click', () => {
      sfx.tap();
      selectSlot(i);
      goHome();
    });
    card.appendChild(pick);

    if (!empty) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'slot-del';
      del.textContent = 'けす';
      del.setAttribute('aria-label', `${p.name} の きろくを けす`);
      del.addEventListener('click', () => {
        sfx.tap();
        eraseTarget = i;
        $('erase-name').textContent = `${p.name} の ぼうけん`;
        $('overlay-erase').hidden = false;
      });
      card.appendChild(del);
    }

    list.appendChild(card);
  });
}

function showSlots(): void {
  renderSlots();
  show('slots');
}

$('hello').addEventListener('click', () => {
  sfx.tap();
  showSlots();
});

$('btn-slots').addEventListener('click', () => {
  sfx.tap();
  $('overlay-settings').hidden = true;
  showSlots();
});

$('slots-back').addEventListener('click', () => {
  sfx.tap();
  // 名前の無い枠を選んだまま戻ると行き場が無いので、必ずホームを作りなおす
  goHome();
});

$('erase-cancel').addEventListener('click', () => {
  eraseTarget = -1;
  $('overlay-erase').hidden = true;
});

$('erase-ok').addEventListener('click', () => {
  if (eraseTarget >= 0) clearSlot(eraseTarget);
  eraseTarget = -1;
  $('overlay-erase').hidden = true;
  renderSlots();
});

$('btn-zukan').addEventListener('click', () => {
  sfx.tap();
  renderZukan();
  show('zukan');
});

$('btn-shop').addEventListener('click', () => {
  sfx.tap();
  renderShop();
  show('shop');
});

$('zukan-back').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

$('shop-back').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

// ------------------------------------------------------------------ デイリー

$('daily-card').addEventListener('click', () => {
  unlockAudio();
  sfx.tap();
  refreshDaily(profile()); // 日付をまたいだまま開きっぱなしのことがある
  const pool: Fact[] = WORLDS.filter((x) => worldUnlocked(x.id)).flatMap((x) => x.facts);
  startRun({
    world: DAILY_WORLD,
    stage: 0,
    total: 5,
    boss: false,
    label: 'きょうの 5もん',
    facts: weakestFacts(pool, 5),
    saveStars: false,
  });
});

// ------------------------------------------------------------------ マップ

/** ステージの時間帯。マップのマスに小さく出す */
const TIME_ICON: Record<TimeId, string> = {
  day: '☀️', dawn: '🌅', sunset: '🌇', night: '🌙', boss: '⚡',
};
const TIME_NAME: Record<TimeId, string> = {
  day: 'ひるま', dawn: 'あさ', sunset: 'ゆうがた', night: 'よる', boss: 'ボス',
};

function renderMap(): void {
  const w = worldById(mapWorld);
  $('map-world').textContent = `${w.id}. ${w.name}`;
  $('map-desc').textContent = w.desc;
  $('map-coins').textContent = String(profile().coins);

  const tabs = $('world-tabs');
  tabs.replaceChildren();
  for (const world of WORLDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'world-tab';
    b.setAttribute('aria-selected', String(world.id === mapWorld));
    const open = worldUnlocked(world.id);
    b.textContent = open ? `W${world.id}` : '🔒';
    b.disabled = !open;
    b.addEventListener('click', () => {
      mapWorld = world.id;
      sfx.tap();
      renderMap();
    });
    tabs.appendChild(b);
  }

  const grid = $('stage-grid');
  grid.replaceChildren();
  for (let stage = 1; stage <= bossStage(w); stage++) {
    const boss = isBoss(w, stage);
    const open = stageUnlocked(w, stage);
    const got = stageStars(w.id, stage);

    const b = document.createElement('button');
    b.type = 'button';
    b.className = `stage-btn${boss ? ' boss' : ''}`;
    b.disabled = !open || overDailyLimit();

    const label = document.createElement('span');
    label.textContent = boss ? '👑' : String(stage);
    const stars = document.createElement('span');
    stars.className = 'st';
    stars.innerHTML = [0, 1, 2].map((i) => `<span class="${i < got ? '' : 'off'}">★</span>`).join('');
    // ステージごとに景色が変わることを、遊ぶ前に見せる
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = TIME_ICON[timeIdFor(stage, boss)];
    b.append(when, label, stars);
    b.setAttribute(
      'aria-label',
      `${boss ? 'ボス' : `ステージ ${stage}`} ${TIME_NAME[timeIdFor(stage, boss)]} ほし ${got}`,
    );

    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startStage(w, stage);
    });
    grid.appendChild(b);
  }

  const bossNeed = bossRequirement(w) - normalStars(w);
  $('map-hint').textContent = overDailyLimit()
    ? 'きょうの ぼうけんは ここまで。また あした！'
    : bossNeed > 0
      ? `ボスまで あと ★${bossNeed}　（いま ★${starsInWorld(w)}）`
      : `★ ${starsInWorld(w)} / ${bossStage(w) * 3}`;
}

$('map-back').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

// ------------------------------------------------------------------ プレイ

function startStage(world: World, stage: number): void {
  const boss = isBoss(world, stage);
  startRun({
    world,
    stage,
    total: questionCount(world, stage),
    boss,
    label: boss ? `${world.id}-ボス` : `${world.id}-${stage}`,
    bonusCoins: boss ? COIN_BOSS : 0,
  });
}

function startRun(cfg: RunConfig): void {
  // 上限に達していたら新しいステージは始めない（走っている途中では止めない）
  if (overDailyLimit()) {
    goHome();
    return;
  }
  // デイリーのおまけは走り出すたびに計算しなおす。
  // 設定オブジェクトを使いまわすので、ここで決めないと、その日のうちに
  // 何度でもデイリーのボーナスがもらえてしまう。
  if (cfg.stage === 0) cfg.bonusCoins = profile().daily.done ? 0 : COIN_DAILY;

  lastRun = cfg;
  screens.play.classList.toggle('lefty', save.settings.leftHanded);
  // canvas の外（式やボタンの後ろ）も、そのステージの空の色にそろえる。
  // 夜とボスは空が暗いので、式やコインの数字を白抜きに切りかえる
  const theme = themeFor(cfg.world.id, cfg.stage, cfg.boss);
  screens.play.style.background = skyCss(theme);
  screens.play.classList.toggle('dark', theme.dark);
  $('overlay-pause').hidden = true;
  show('play');
  // 画面を出してからレイアウトが確定するので、次のフレームで開始する
  requestAnimationFrame(() => {
    runner.start(cfg, (r) => {
      if (cfg.stage === 0) {
        const p = profile();
        refreshDaily(p); // 日付をまたいで走り終えることがある
        if (!p.daily.done) {
          p.daily.done = true;
          p.daily.streak += 1;
          persist();
        }
      }
      lastResult = r;
      renderResult(r);
      show('result');
    });
  });
}

$('btn-pause').addEventListener('click', () => {
  runner.setPaused(true);
  $('overlay-pause').hidden = false;
});

$('pause-resume').addEventListener('click', () => {
  // iOS は裏に回ると AudioContext を止める。戻ってきたら鳴らしなおす
  unlockAudio();
  $('overlay-pause').hidden = true;
  runner.setPaused(false);
});

$('pause-quit').addEventListener('click', () => {
  $('overlay-pause').hidden = true;
  runner.stop();
  if (lastRun && lastRun.stage === 0) {
    goHome();
  } else {
    renderMap();
    show('map');
  }
});

// ------------------------------------------------------------------ リザルト

const STAR_SVG = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="#ffc53d" stroke="#d99a10" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/**
 * リザルトの演出はタイマーとアニメの束。画面を離れるとき（子どもは待たずに
 * 次を押す）に全部止められるよう、後始末をここにためておく。
 */
const resultStop: (() => void)[] = [];

function stopResultAnim(): void {
  while (resultStop.length) resultStop.pop()?.();
}

function later(fn: () => void, ms: number): void {
  const id = window.setTimeout(fn, ms);
  resultStop.push(() => clearTimeout(id));
}

/**
 * 数字を数え上げる。いきなり「+48」と出すより、増えていくのを見せるほうが効く。
 * チャリンという音も一緒に鳴らして、耳からも「増えた」を伝える。
 */
function countUp(el: HTMLElement, from: number, to: number, ms: number, prefix = ''): void {
  const t0 = performance.now();
  let id = 0;
  let alive = true;
  let lastTick = -1;
  const step = (now: number): void => {
    if (!alive) return;
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - (1 - k) * (1 - k);
    el.textContent = `${prefix}${Math.round(from + (to - from) * eased)}`;
    const tick = Math.floor(k * 7);
    if (tick !== lastTick) {
      lastTick = tick;
      if (k < 1) sfx.coin();
    }
    if (k < 1) id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  resultStop.push(() => { alive = false; cancelAnimationFrame(id); });
}

// ---------------------------------------------------------------- 紙吹雪

const CONFETTI_COLORS = ['#ffc53d', '#ff8fb1', '#6ec8f0', '#7ed37c', '#c79bf0', '#ffffff'];

interface Flake { x: number; y: number; vx: number; vy: number; r: number; a: number; va: number; c: string; }

function confetti(count: number): void {
  const canvas = $<HTMLCanvasElement>('confetti');
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2) return;
  const g = canvas.getContext('2d');
  if (!g) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = rect.width;
  const H = rect.height;
  const flakes: Flake[] = Array.from({ length: count }, () => ({
    x: W * (0.1 + Math.random() * 0.8),
    y: -20 - Math.random() * H * 0.6,
    vx: (Math.random() - 0.5) * 90,
    vy: 130 + Math.random() * 190,
    r: 4 + Math.random() * 5,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 9,
    c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));

  let id = 0;
  let alive = true;
  let last = performance.now();
  const step = (now: number): void => {
    if (!alive) return;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    g.clearRect(0, 0, W, H);
    let live = 0;
    for (const f of flakes) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.a += f.va * dt;
      f.vx *= 0.99;
      if (f.y < H + 20) live++;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.a);
      g.fillStyle = f.c;
      g.fillRect(-f.r / 2, -f.r * 0.7, f.r, f.r * 1.4);
      g.restore();
    }
    if (live > 0) id = requestAnimationFrame(step);
    else g.clearRect(0, 0, W, H);
  };
  id = requestAnimationFrame(step);
  resultStop.push(() => {
    alive = false;
    cancelAnimationFrame(id);
    g.clearRect(0, 0, W, H);
  });
}

// ---------------------------------------------------------------- リザルト本体

interface CoinLine { label: string; value: number; }

/** もらったコインの内訳。0 の行は出さない（読む量が増えるだけ） */
function coinLines(r: StageResult): CoinLine[] {
  const daily = r.stage === 0;
  const out: CoinLine[] = [];
  if (r.gain.correct) out.push({ label: `せいかい ${r.correct}もん`, value: r.gain.correct });
  if (r.gain.combo) out.push({ label: 'れんぞく ボーナス', value: r.gain.combo });
  if (r.gain.perfect) out.push({ label: 'ノーミス ボーナス', value: r.gain.perfect });
  if (r.gain.bonus) out.push({ label: daily ? 'きょうの 5もん' : 'ボス ボーナス', value: r.gain.bonus });
  if (r.gain.lost) out.push({ label: 'おとした コイン', value: -r.gain.lost });
  return out;
}

function renderResult(r: StageResult): void {
  stopResultAnim();

  const daily = r.stage === 0;
  const w = worldById(r.worldId);
  $('result-stage').textContent = daily
    ? 'きょうの 5もん'
    : isBoss(w, r.stage)
      ? `${w.id}-ボス  ${w.name}`
      : `${w.id}-${r.stage}  ${w.name}`;
  $('result-head').textContent = r.stars === 3 ? 'パーフェクト！' : r.stars === 2 ? 'クリア！' : 'ゴール！';
  $('result-correct').textContent = `${r.correct} / ${r.total}`;

  const bestRow = $('result-best-row');
  if (r.bestKey) {
    bestRow.hidden = false;
    $('result-best').textContent = `${r.bestKey}　${(r.bestMs / 1000).toFixed(1)}びょう`;
  } else {
    bestRow.hidden = true;
  }

  const comboRow = $('result-combo-row');
  comboRow.hidden = r.maxCombo < 3;
  $('result-combo').textContent = `${r.maxCombo} れんぞく`;

  const learned = $('result-learned');
  if (r.learned.length) {
    learned.hidden = false;
    learned.textContent = `あたらしく おぼえた！  ${r.learned.map((k) => k.replace('+', ' + ')).join('、')}`;
  } else {
    learned.hidden = true;
  }

  // 星 → コインの内訳 → 合計、の順に見せる。いちどに全部出すと、
  // どれが自分の手柄なのか分からないまま画面が終わる
  const box = $('result-stars');
  box.innerHTML = STAR_SVG.repeat(3);
  const stars = Array.from(box.children) as HTMLElement[];
  sfx.clear();
  stars.forEach((el, i) => {
    if (i < r.stars) {
      later(() => {
        el.classList.add('on');
        sfx.star(i);
      }, 260 + i * 300);
    }
  });

  const hero = $('result-coins');
  const total = $('result-total');
  const list = $('coin-lines');
  hero.textContent = '+0';
  total.textContent = String(r.totalCoins - r.coins);
  list.replaceChildren();

  const lines = coinLines(r);
  const startAt = 300 + r.stars * 300;
  let running = 0;

  lines.forEach((line, i) => {
    later(() => {
      const li = document.createElement('li');
      li.className = line.value < 0 ? 'minus' : '';
      const label = document.createElement('span');
      label.textContent = line.label;
      const value = document.createElement('b');
      value.textContent = `${line.value < 0 ? '−' : '＋'}${Math.abs(line.value)}`;
      li.append(label, value);
      list.appendChild(li);

      const from = running;
      running = Math.max(0, running + line.value);
      countUp(hero, from, running, 420, '+');
      $('coin-hero').classList.remove('pop');
      void $('coin-hero').offsetWidth;
      $('coin-hero').classList.add('pop');
      sfx.star(Math.min(i, 2));
    }, startAt + i * 460);
  });

  const endAt = startAt + lines.length * 460 + 260;
  later(() => {
    countUp(total, r.totalCoins - r.coins, r.totalCoins, 700);
    sfx.fanfare();
    confetti(r.stars === 3 ? 90 : r.stars === 2 ? 50 : 28);
  }, endAt);

  // ボタンの行き先。「もういちど」はやめて、つづけるか、スタートへ戻る
  const over = overDailyLimit();
  const next = nextStageOf(r.worldId, r.stage);
  const nextBtn = $('result-next');
  nextBtn.textContent = over
    ? 'きょうは おしまい'
    : next
      ? 'つづける'
      : daily
        ? 'スタートへ'
        : 'マップへ';
  // つぎのボタンがマップ／スタートを兼ねているときは、同じ行き先を2つ出さない
  $('result-map').hidden = over || !next;
  $('result-home').hidden = over || (!next && daily);
}

$('result-next').addEventListener('click', () => {
  if (!lastResult) return;
  sfx.tap();
  if (overDailyLimit()) {
    goHome();
    return;
  }
  const next = nextStageOf(lastResult.worldId, lastResult.stage);
  if (next) {
    startStage(next.world, next.stage);
  } else if (lastResult.stage === 0) {
    goHome();
  } else {
    mapWorld = lastResult.worldId;
    renderMap();
    show('map');
  }
});

$('result-map').addEventListener('click', () => {
  sfx.tap();
  mapWorld = lastResult && lastResult.stage > 0 ? lastResult.worldId : lastPlayedWorld();
  renderMap();
  show('map');
});

$('result-home').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

// ------------------------------------------------------------------ せってい

const setSound = $<HTMLInputElement>('set-sound');
const setSlow = $<HTMLInputElement>('set-slow');
const setLeft = $<HTMLInputElement>('set-left');

function syncSettings(): void {
  setSound.checked = save.settings.sound;
  setSlow.checked = save.settings.slow;
  setLeft.checked = save.settings.leftHanded;
}

$('btn-settings').addEventListener('click', () => {
  syncSettings();
  $('overlay-settings').hidden = false;
});

setSound.addEventListener('change', () => {
  save.settings.sound = setSound.checked;
  persist();
  if (setSound.checked) sfx.tap();
});
setSlow.addEventListener('change', () => {
  save.settings.slow = setSlow.checked;
  persist();
});
setLeft.addEventListener('change', () => {
  save.settings.leftHanded = setLeft.checked;
  persist();
  screens.play.classList.toggle('lefty', setLeft.checked);
});

$('set-close').addEventListener('click', () => {
  $('overlay-settings').hidden = true;
});

// ------------------------------------------------------------------ おうちのかた

let gateAnswer = 0;

$('btn-parent').addEventListener('click', () => {
  const gate = makeGate();
  gateAnswer = gate.answer;
  $('gate-q').textContent = gate.text;
  $<HTMLInputElement>('gate-input').value = '';
  $('gate-msg').textContent = '';
  $('overlay-settings').hidden = true;
  $('overlay-gate').hidden = false;
});

$('gate-cancel').addEventListener('click', () => {
  $('overlay-gate').hidden = true;
});

$('gate-ok').addEventListener('click', () => {
  const value = Number($<HTMLInputElement>('gate-input').value.trim());
  if (value !== gateAnswer) {
    $('gate-msg').textContent = 'こたえが ちがいます。';
    return;
  }
  $('overlay-gate').hidden = true;
  renderParent();
  show('parent');
});

$('parent-back').addEventListener('click', () => {
  goHome();
});

$('btn-switch').addEventListener('click', () => {
  profile().name = '';
  persist();
  sfx.tap();
  $('overlay-settings').hidden = true;
  goHome();
});

$('set-reset').addEventListener('click', () => {
  if (!window.confirm('ぜんぶ さいしょから やりなおします。いいですか？')) return;
  resetAll();
  $('overlay-settings').hidden = true;
  goHome();
});

// ------------------------------------------------------------------ 起動

// iOS は最初のユーザー操作の中でしか音を鳴らせない
const unlockOnce = (): void => {
  unlockAudio();
  window.removeEventListener('pointerdown', unlockOnce);
  window.removeEventListener('touchstart', unlockOnce);
};
window.addEventListener('pointerdown', unlockOnce);
window.addEventListener('touchstart', unlockOnce);

// user-scalable=no は iOS Safari では無視されるので、ピンチ／ダブルタップを個別に止める
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (current === 'play') {
      runner.setPaused(true);
      $('overlay-pause').hidden = false;
    }
  } else {
    unlockAudio(); // 中断されたオーディオを起こしなおす
  }
});

// 書き込みは 120ms まとめているので、閉じられる前に必ず吐き出す。
// iOS は裏に回した時点でタイマーを止めるため、これがないと直前の1ステージが消える。
window.addEventListener('pagehide', flushSave);
window.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
});

requestPersistentStorage();
initShop();
onShopChange(renderTitle);
initParent(() => {
  syncSettings();
  renderTitle();
});
syncSettings();

// file:// で開いたときなど、記録が残らない環境ではその場で伝える
$('no-storage').hidden = storageWorks;

renderTitle();
// きろくが2つ以上あるなら、まず誰のぼうけんかを選んでもらう。
// きょうだいで1台を使うとき、前の子のデータで走り出してしまうのを防ぐ。
if (usedSlots() > 1 || (usedSlots() > 0 && !profile().name)) showSlots();
else show('title');

// 埋め込み表示（iframe やビューアの中）と開発サーバーでは sw.js を登録しない。
// dev で登録すると、ハッシュのつかないソースが恒久的にキャッシュされて
// 変更が反映されなくなる。
const embedded = window.top !== window.self;
if (
  'serviceWorker' in navigator &&
  location.protocol.startsWith('http') &&
  !embedded &&
  !import.meta.env.DEV
) {
  window.addEventListener('load', async () => {
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register(
        // updateViaCache: 'none' が無いと、sw.js 自体が HTTP キャッシュから返って
        // 更新に気づかないことがある（GitHub Pages は max-age=600 を付ける）
        new URL('./sw.js', document.baseURI).href,
        { updateViaCache: 'none' },
      );
    } catch {
      return; // Service Worker が使えなくても、ふつうに遊べる
    }

    // 画面を開いただけでは更新の確認が走らないことがある（実測で、新しい
    // sw.js を置いても取りにこなかった）。ホーム画面から起動したアプリには
    // 再読みこみの手段が無く（引っぱって更新は overscroll-behavior で
    // 止めてある）、放っておくと古い版のまま何日も動く。自分で確認しにいく。
    const check = () => void reg.update().catch(() => undefined);
    check();

    // iOS はアプリを何日も宙づりにしたまま復帰させる。戻ってきたら見にいく。
    // 遊んでいる最中に入れ替わっても、読みこみ後は何も取りにいかない作りなので
    // 画面は壊れない（新しい版になるのは次に開いたとき）
    const HOUR = 60 * 60 * 1000;
    let checkedAt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - checkedAt < HOUR) return;
      checkedAt = Date.now();
      check();
    });
  });
}

// 制限時間の目安をコンソールに出しておく（数値を詰めるときの手がかり）
if (import.meta.env.DEV) {
  console.info(
    'answerTime:',
    WORLDS.map((w) => `W${w.id} ${answerTimeFor(w, 1, false).toFixed(1)}s → ${answerTimeFor(w, 8, false).toFixed(1)}s`).join(' / '),
  );
}
