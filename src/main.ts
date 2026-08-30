import './style.css';

import { sfx, unlockAudio } from './audio';
import { WORLDS, bossStage, isBoss, worldById, type World } from './curriculum';
import { Runner, type StageResult } from './runner';
import {
  persist,
  profile,
  requestPersistentStorage,
  resetAll,
  save,
  stageStars,
} from './save';
import { SKINS, paintSkinIcon } from './sprites';

type ScreenName = 'title' | 'map' | 'play' | 'result';

const screens: Record<ScreenName, HTMLElement> = {
  title: document.getElementById('screen-title') as HTMLElement,
  map: document.getElementById('screen-map') as HTMLElement,
  play: document.getElementById('screen-play') as HTMLElement,
  result: document.getElementById('screen-result') as HTMLElement,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const runner = new Runner();
let current: ScreenName = 'title';
let mapWorld = 1;
let lastResult: StageResult | null = null;

function show(name: ScreenName): void {
  current = name;
  (Object.keys(screens) as ScreenName[]).forEach((k) => {
    screens[k].hidden = k !== name;
  });
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

// ------------------------------------------------------------------ タイトル

function renderTitle(): void {
  const p = profile();
  const needsSetup = !p.name;
  $('skin-pick').hidden = !needsSetup;
  $('hello').hidden = needsSetup;
  $('btn-switch').hidden = needsSetup;

  if (needsSetup) {
    const row = $('skin-row');
    row.replaceChildren();
    for (const skin of SKINS) {
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
      paintSkinIcon(c, skin.id);
    }
    const input = $<HTMLInputElement>('name-input');
    input.value = p.name;
  } else {
    $('hello').textContent = `${p.name} の ぼうけん`;
  }
}

$('btn-start').addEventListener('click', () => {
  const p = profile();
  if (!p.name) {
    const input = $<HTMLInputElement>('name-input');
    p.name = (input.value || 'きみ').trim().slice(0, 6);
    persist();
  }
  sfx.tap();
  mapWorld = lastPlayedWorld();
  renderMap();
  show('map');
});

$('btn-switch').addEventListener('click', () => {
  profile().name = '';
  persist();
  sfx.tap();
  renderTitle();
});

/** 最後に触っていたワールド（＝解放済みの一番奥） */
function lastPlayedWorld(): number {
  let id = 1;
  for (const w of WORLDS) if (worldUnlocked(w.id)) id = w.id;
  return id;
}

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
    b.textContent = `W${world.id}`;
    b.setAttribute('aria-selected', String(world.id === mapWorld));
    const open = worldUnlocked(world.id);
    b.disabled = !open;
    if (!open) b.textContent = '🔒';
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
    b.disabled = !open;

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

  const total = bossStage(w) * 3;
  $('map-hint').textContent = `★ ${starsInWorld(w)} / ${total}`;
}

$('map-back').addEventListener('click', () => {
  sfx.tap();
  renderTitle();
  show('title');
});

// ------------------------------------------------------------------ プレイ

function startStage(world: World, stage: number): void {
  screens.play.classList.toggle('lefty', save.settings.leftHanded);
  show('play');
  // 画面を出してからレイアウトが確定するので、次のフレームで開始する
  requestAnimationFrame(() => {
    runner.start(world, stage, (r) => {
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
  renderMap();
  show('map');
});

// ------------------------------------------------------------------ リザルト

const STAR_SVG = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="#ffc53d" stroke="#d99a10" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

function renderResult(r: StageResult): void {
  const w = worldById(r.worldId);
  $('result-stage').textContent = isBoss(w, r.stage) ? `${w.id}-ボス  ${w.name}` : `${w.id}-${r.stage}  ${w.name}`;
  $('result-head').textContent = r.stars === 3 ? 'パーフェクト！' : r.stars === 2 ? 'クリア！' : 'ゴール！';
  $('result-correct').textContent = `${r.correct} / ${r.total}`;
  $('result-coins').textContent = `+${r.coins}`;

  const bestRow = $('result-best-row');
  if (r.bestKey) {
    bestRow.hidden = false;
    $('result-best').textContent = `${r.bestKey.replace('+', ' + ')} を ${(r.bestMs / 1000).toFixed(1)}びょう`;
  } else {
    bestRow.hidden = true;
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

  const next = nextStageOf(r.worldId, r.stage);
  $('result-next').textContent = next ? 'つぎへ' : 'マップへ';
}

$('result-retry').addEventListener('click', () => {
  if (!lastResult) return;
  sfx.tap();
  startStage(worldById(lastResult.worldId), lastResult.stage);
});

$('result-next').addEventListener('click', () => {
  if (!lastResult) return;
  sfx.tap();
  const next = nextStageOf(lastResult.worldId, lastResult.stage);
  if (next) {
    startStage(next.world, next.stage);
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
