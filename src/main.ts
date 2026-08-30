import './style.css';

import { sfx, unlockAudio } from './audio';
import {
  WORLDS,
  answerTimeFor,
  bossStage,
  isBoss,
  questionCount,
  worldById,
  type Fact,
  type World,
} from './curriculum';
import { initParent, makeGate, renderParent } from './parent';
import { initShop, onShopChange, renderShop } from './shop';
import { weakestFacts } from './questions';
import { Runner, type RunConfig, type StageResult } from './runner';
import {
  overDailyLimit,
  persist,
  profile,
  refreshDaily,
  requestPersistentStorage,
  resetAll,
  save,
  stageStars,
} from './save';
import { SKINS, drawChar, paintSkinIcon } from './sprites';
import { renderZukan, zukanProgress } from './zukan';

type ScreenName = 'title' | 'map' | 'play' | 'result' | 'zukan' | 'shop' | 'parent';

const screens: Record<ScreenName, HTMLElement> = {
  title: document.getElementById('screen-title') as HTMLElement,
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

// ------------------------------------------------------------------ 進行状況

/** ステージが開いているか（前のステージを1つでもクリアしていれば開く） */
function stageUnlocked(w: World, stage: number): boolean {
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
      : '＋20 コイン';
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
    p.name = ($<HTMLInputElement>('name-input').value || 'きみ').trim().slice(0, 6);
    persist();
    renderTitle(); // 戻ってきたときのホームを先に作っておく
  }
  sfx.tap();
  mapWorld = lastPlayedWorld();
  renderMap();
  show('map');
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
  renderTitle();
  show('title');
});

$('shop-back').addEventListener('click', () => {
  sfx.tap();
  renderTitle();
  show('title');
});

// ------------------------------------------------------------------ デイリー

$('daily-card').addEventListener('click', () => {
  unlockAudio();
  sfx.tap();
  const p = profile();
  const w = worldById(lastPlayedWorld());
  const pool: Fact[] = WORLDS.filter((x) => worldUnlocked(x.id)).flatMap((x) => x.facts);
  startRun({
    world: w,
    stage: 0,
    total: 5,
    boss: false,
    label: 'きょうの 5もん',
    facts: weakestFacts(pool, 5),
    // すでに今日クリアしていれば、遊べるがコインのおまけはつかない
    bonusCoins: p.daily.done ? 0 : 20,
    saveStars: false,
  });
});

// ------------------------------------------------------------------ マップ

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
    b.append(label, stars);
    b.setAttribute('aria-label', `${boss ? 'ボス' : `ステージ ${stage}`} ほし ${got}`);

    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startStage(w, stage);
    });
    grid.appendChild(b);
  }

  $('map-hint').textContent = overDailyLimit()
    ? 'きょうの ぼうけんは ここまで。また あした！'
    : `★ ${starsInWorld(w)} / ${bossStage(w) * 3}`;
}

$('map-back').addEventListener('click', () => {
  sfx.tap();
  renderTitle();
  show('title');
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
    bonusCoins: boss ? 30 : 0,
  });
}

function startRun(cfg: RunConfig): void {
  // 上限に達していたら新しいステージは始めない（走っている途中では止めない）
  if (overDailyLimit()) {
    renderTitle();
    show('title');
    return;
  }
  lastRun = cfg;
  screens.play.classList.toggle('lefty', save.settings.leftHanded);
  show('play');
  // 画面を出してからレイアウトが確定するので、次のフレームで開始する
  requestAnimationFrame(() => {
    runner.start(cfg, (r) => {
      if (cfg.stage === 0) {
        const p = profile();
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
  $('overlay-pause').hidden = true;
  runner.setPaused(false);
});

$('pause-quit').addEventListener('click', () => {
  $('overlay-pause').hidden = true;
  runner.stop();
  if (lastRun && lastRun.stage === 0) {
    renderTitle();
    show('title');
  } else {
    renderMap();
    show('map');
  }
});

// ------------------------------------------------------------------ リザルト

const STAR_SVG = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="#ffc53d" stroke="#d99a10" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

function renderResult(r: StageResult): void {
  const daily = r.stage === 0;
  const w = worldById(r.worldId);
  $('result-stage').textContent = daily
    ? 'きょうの 5もん'
    : isBoss(w, r.stage)
      ? `${w.id}-ボス  ${w.name}`
      : `${w.id}-${r.stage}  ${w.name}`;
  $('result-head').textContent = r.stars === 3 ? 'パーフェクト！' : r.stars === 2 ? 'クリア！' : 'ゴール！';
  $('result-correct').textContent = `${r.correct} / ${r.total}`;
  $('result-coins').textContent = `+${r.coins}`;

  const bestRow = $('result-best-row');
  if (r.bestKey) {
    bestRow.hidden = false;
    $('result-best').textContent = `${r.bestKey}　${(r.bestMs / 1000).toFixed(1)}びょう`;
  } else {
    bestRow.hidden = true;
  }

  const learned = $('result-learned');
  if (r.learned.length) {
    learned.hidden = false;
    learned.textContent = `あたらしく おぼえた！  ${r.learned.map((k) => k.replace('+', ' + ')).join('、')}`;
  } else {
    learned.hidden = true;
  }

  const box = $('result-stars');
  box.innerHTML = STAR_SVG.repeat(3);
  const stars = Array.from(box.children) as HTMLElement[];
  sfx.clear();
  stars.forEach((el, i) => {
    if (i < r.stars) {
      window.setTimeout(() => {
        el.classList.add('on');
        sfx.star(i);
      }, 260 + i * 300);
    }
  });

  const over = overDailyLimit();
  $('result-retry').hidden = over;
  $('result-next').textContent = over
    ? 'きょうは おしまい'
    : nextStageOf(r.worldId, r.stage)
      ? 'つぎへ'
      : daily
        ? 'ホームへ'
        : 'マップへ';
}

$('result-retry').addEventListener('click', () => {
  if (!lastRun) return;
  sfx.tap();
  startRun(lastRun);
});

$('result-next').addEventListener('click', () => {
  if (!lastResult) return;
  sfx.tap();
  if (overDailyLimit()) {
    renderTitle();
    show('title');
    return;
  }
  const next = nextStageOf(lastResult.worldId, lastResult.stage);
  if (next) {
    startStage(next.world, next.stage);
  } else if (lastResult.stage === 0) {
    renderTitle();
    show('title');
  } else {
    mapWorld = lastResult.worldId;
    renderMap();
    show('map');
  }
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
  renderTitle();
  show('title');
});

$('btn-switch').addEventListener('click', () => {
  profile().name = '';
  persist();
  sfx.tap();
  $('overlay-settings').hidden = true;
  renderTitle();
  show('title');
});

$('set-reset').addEventListener('click', () => {
  if (!window.confirm('ぜんぶ さいしょから やりなおします。いいですか？')) return;
  resetAll();
  $('overlay-settings').hidden = true;
  renderTitle();
  show('title');
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
  if (document.hidden && current === 'play') {
    runner.setPaused(true);
    $('overlay-pause').hidden = false;
  }
});

requestPersistentStorage();
initShop();
onShopChange(renderTitle);
initParent(() => {
  syncSettings();
  renderTitle();
});
syncSettings();
renderTitle();
show('title');

// 埋め込み表示（iframe やビューアの中）では sw.js を置いていないので登録しない
const embedded = window.top !== window.self;
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !embedded) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).href).catch(() => undefined);
  });
}

// 制限時間の目安をコンソールに出しておく（数値を詰めるときの手がかり）
if (import.meta.env.DEV) {
  console.info(
    'answerTime:',
    WORLDS.map((w) => `W${w.id} ${answerTimeFor(w, 1, false).toFixed(1)}s → ${answerTimeFor(w, 8, false).toFixed(1)}s`).join(' / '),
  );
}
