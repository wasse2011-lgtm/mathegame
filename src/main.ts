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
import { drawPet } from './petart';
import { PET_COUNT, activePet, ownedPets } from './pets';
import { initRanch, onRanchChange, renderRanch, startRanchIdle } from './ranch';
import { initShop, onShopChange, renderShop, startShopIdle } from './shop';
import { weakestFacts } from './questions';
import { Runner, type RunConfig, type StageResult } from './runner';
import {
  flushSave,
  overDailyLimit,
  persist,
  profile,
  refreshDaily,
  requestPersistentStorage,
  resetAll,
  save,
  stageStars,
  storageWorks,
} from './save';
import { SKINS, currentLook, drawChar, paintSkinIcon } from './sprites';
import { renderZukan, zukanProgress } from './zukan';

type ScreenName = 'title' | 'map' | 'play' | 'result' | 'zukan' | 'shop' | 'ranch' | 'parent';

const screens: Record<ScreenName, HTMLElement> = {
  title: document.getElementById('screen-title') as HTMLElement,
  map: document.getElementById('screen-map') as HTMLElement,
  play: document.getElementById('screen-play') as HTMLElement,
  result: document.getElementById('screen-result') as HTMLElement,
  zukan: document.getElementById('screen-zukan') as HTMLElement,
  shop: document.getElementById('screen-shop') as HTMLElement,
  ranch: document.getElementById('screen-ranch') as HTMLElement,
  parent: document.getElementById('screen-parent') as HTMLElement,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const runner = new Runner();
let current: ScreenName = 'title';
let mapWorld = 1;
/** マップは「せかい一覧」と「その せかいの みち」の2段 */
let mapView: 'worlds' | 'stages' = 'worlds';
let lastRun: RunConfig | null = null;
let lastResult: StageResult | null = null;

function show(name: ScreenName): void {
  current = name;
  (Object.keys(screens) as ScreenName[]).forEach((k) => {
    screens[k].hidden = k !== name;
  });
  // 動いている画面は、表に出たときに描画ループを起こしなおす
  if (name === 'title') startHomeIdle();
  if (name === 'shop') startShopIdle();
  if (name === 'ranch') startRanchIdle();
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
    const bob = Math.abs(Math.sin(t * 6)) * 3;
    g.fillStyle = 'rgba(40,70,40,.16)';
    g.beginPath();
    g.ellipse(size * 0.62, size - 12, 24, 6, 0, 0, Math.PI * 2);
    g.fill();
    // つれている子も ホームで となりに立っている
    const pet = activePet();
    if (pet) drawPet(g, size * 0.2, size - 14, 30, pet.art, t);
    drawChar(g, size * 0.62, size - 14 - bob, 52, currentLook(), { t, air: false, hurt: 0, squash: 1 });
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
      paintSkinIcon(c, { skin: skin.id }, 56);
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

  const pets = ownedPets().length;
  $('pet-count').textContent = `${pets} / ${PET_COUNT}`;
  $('pet-bar').style.width = `${(pets / PET_COUNT) * 100}%`;
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
  // まずは「せかい ぜんぶ」から。どこまで来たかを毎回いちど目に入れる
  mapWorld = lastPlayedWorld();
  mapView = 'worlds';
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
  goHome();
});

$('shop-back').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

$('btn-ranch').addEventListener('click', () => {
  sfx.tap();
  renderRanch();
  show('ranch');
});

$('ranch-back').addEventListener('click', () => {
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

/** そのワールドで、つぎに遊ぶステージ（ぜんぶクリア済みなら 0） */
function nextStageIn(w: World): number {
  for (let s = 1; s <= bossStage(w); s++) {
    if (stageUnlocked(w, s) && stageStars(w.id, s) === 0) return s;
  }
  return 0;
}

function totalStars(): number {
  return WORLDS.reduce((n, w) => n + starsInWorld(w), 0);
}

function maxStars(): number {
  return WORLDS.reduce((n, w) => n + bossStage(w) * 3, 0);
}

function starRow(got: number): string {
  return [0, 1, 2].map((i) => `<span class="${i < got ? '' : 'off'}">★</span>`).join('');
}

function renderMap(): void {
  $('map-coins').textContent = String(profile().coins);
  if (mapView === 'worlds') renderWorldList();
  else renderStagePath();
}

/**
 * せかいの一覧。
 * 「ぜんぶで いくつ あって、いま どこまで来たか」をこの画面だけで分かるようにする。
 * 鍵のかかった先も名前と面数まで見せる（次に何が待っているか分かるほうが進みたくなる）。
 */
function renderWorldList(): void {
  $('world-view').hidden = false;
  $('stage-view').hidden = true;
  screens.map.style.removeProperty('--wc');

  const cleared = WORLDS.filter((w) => stageStars(w.id, bossStage(w)) > 0).length;
  $('map-world').textContent = 'せかい ぜんぶ';
  $('map-desc').textContent = `${WORLDS.length}つの せかい・クリア ${cleared}／${WORLDS.length}`;

  const got = totalStars();
  const max = maxStars();
  $('total-bar').style.width = `${(got / max) * 100}%`;
  $('total-count').textContent = `★ ${got} / ${max}`;

  const here = lastPlayedWorld();
  const list = $('world-list');
  list.replaceChildren();

  for (const w of WORLDS) {
    const open = worldUnlocked(w.id);
    const stars = starsInWorld(w);
    const full = bossStage(w) * 3;
    const done = stageStars(w.id, bossStage(w)) > 0;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = `world-card${open ? '' : ' locked'}${done ? ' done' : ''}${open && w.id === here ? ' here' : ''}`;
    b.style.setProperty('--wc', w.color);
    b.disabled = !open;
    b.innerHTML =
      `<span class="wc-badge"><span class="wc-emoji">${open ? w.emoji : '🔒'}</span><b>${w.id}</b></span>` +
      `<span class="wc-main">` +
      `<b class="wc-name">${open ? w.name : '？？？'}</b>` +
      `<span class="wc-desc">${open ? w.desc : 'まえの ボスを たおすと ひらく'}</span>` +
      `<span class="bar"><i style="width:${open ? (stars / full) * 100 : 0}%"></i></span>` +
      `</span>` +
      `<span class="wc-right">` +
      `<span class="wc-stars">★ ${open ? stars : 0}<small>/${full}</small></span>` +
      `<span class="wc-stages">${w.stages}めん＋ボス</span>` +
      `</span>` +
      (done ? '<span class="wc-flag">クリア</span>' : open && w.id === here ? '<span class="wc-flag now">いま ここ</span>' : '');

    b.addEventListener('click', () => {
      sfx.tap();
      mapWorld = w.id;
      mapView = 'stages';
      renderMap();
    });
    list.appendChild(b);
  }

  $('map-hint').textContent = overDailyLimit()
    ? 'きょうの ぼうけんは ここまで。また あした！'
    : `せかいを タップすると、なかの みちが みえるよ`;
}

/**
 * ステージの道。ぐねぐねした一本道に、ステージが順番に並ぶ。
 * 前のマス目グリッドだと「あと何面あるのか」「いまどこか」が読み取れなかった。
 */
function renderStagePath(): void {
  const w = worldById(mapWorld);
  $('world-view').hidden = true;
  $('stage-view').hidden = false;
  screens.map.style.setProperty('--wc', w.color);

  $('map-world').textContent = `${w.emoji} ${w.id}. ${w.name}`;
  $('map-desc').textContent = `${w.desc}　・　${w.stages}めん＋ボス`;

  const next = nextStageIn(w);
  const path = $('stage-path');
  path.replaceChildren();

  for (let stage = 1; stage <= bossStage(w); stage++) {
    const boss = isBoss(w, stage);
    const open = stageUnlocked(w, stage);
    const got = stageStars(w.id, stage);

    const row = document.createElement('div');
    row.className = 'node-row';
    // 一本道をぐねぐねさせる。sin にしておくと、面数が変わっても形が破綻しない
    row.style.setProperty('--k', String(Math.sin(stage * 0.9).toFixed(3)));

    const b = document.createElement('button');
    b.type = 'button';
    b.className = `stage-node${boss ? ' boss' : ''}${got > 0 ? ' cleared' : ''}${!open ? ' locked' : ''}`;
    b.disabled = !open || overDailyLimit();
    b.innerHTML =
      `<span class="sn-label">${!open ? '🔒' : boss ? '👑' : stage}</span>` +
      `<span class="st">${starRow(got)}</span>`;
    b.setAttribute('aria-label', `${boss ? 'ボス' : `ステージ ${stage}`} ほし ${got}`);
    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startStage(w, stage);
    });
    row.appendChild(b);

    // ふだ（「ボス」「いま ここ」）はマスの中に絶対配置する。
    // 行に並べると、その行だけマスが道からずれる
    if (boss) {
      const tag = document.createElement('span');
      tag.className = 'node-tag boss-tag';
      const need = bossRequirement(w) - normalStars(w);
      tag.textContent = open ? 'ボス' : `★あと ${need}`;
      b.appendChild(tag);
    }
    if (stage === next && open) {
      const tag = document.createElement('span');
      tag.className = 'node-tag now';
      tag.textContent = 'いま ここ';
      b.appendChild(tag);
    }
    path.appendChild(row);
  }

  // つぎの せかいへの ひきつづき。先に何があるか見せて、進みたくさせる
  const nw = WORLDS.find((x) => x.id === w.id + 1);
  const goal = document.createElement('div');
  goal.className = 'path-goal';
  if (nw) {
    const open = worldUnlocked(nw.id);
    goal.style.setProperty('--wc', nw.color);
    goal.innerHTML = `<span class="pg-emoji">${open ? nw.emoji : '🔒'}</span>` +
      `<span class="pg-text"><b>つぎの せかい</b><span>${open ? `${nw.id}. ${nw.name}` : 'ボスを たおすと ひらく'}</span></span>`;
  } else {
    goal.innerHTML = `<span class="pg-emoji">🏁</span>` +
      `<span class="pg-text"><b>さいごの せかい</b><span>ここを クリアで ぜんぶ せいは！</span></span>`;
  }
  path.appendChild(goal);

  const bossNeed = bossRequirement(w) - normalStars(w);
  $('map-hint').textContent = overDailyLimit()
    ? 'きょうの ぼうけんは ここまで。また あした！'
    : bossNeed > 0
      ? `ボスまで あと ★${bossNeed}　（いま ★${starsInWorld(w)}）`
      : `★ ${starsInWorld(w)} / ${bossStage(w) * 3}　ボスに いどめる！`;
}

$('map-back').addEventListener('click', () => {
  sfx.tap();
  // 道 → せかい一覧 → ホーム の順で戻る
  if (mapView === 'stages') {
    mapView = 'worlds';
    renderMap();
    return;
  }
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
    bonusCoins: boss ? 30 : 0,
  });
}

function startRun(cfg: RunConfig): void {
  // 上限に達していたら新しいステージは始めない（走っている途中では止めない）
  if (overDailyLimit()) {
    goHome();
    return;
  }
  // デイリーのおまけは走り出すたびに計算しなおす。
  // 設定オブジェクトを使いまわすので、ここで決めないと「もういちど」で
  // 何度でも +20 コインがもらえてしまう。
  if (cfg.stage === 0) cfg.bonusCoins = profile().daily.done ? 0 : 20;

  lastRun = cfg;
  screens.play.classList.toggle('lefty', save.settings.leftHanded);
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
    mapView = 'stages';
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
    mapView = 'stages';
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
initRanch();
onRanchChange(renderTitle);
initParent(() => {
  syncSettings();
  renderTitle();
});
syncSettings();

// file:// で開いたときなど、記録が残らない環境ではその場で伝える
$('no-storage').hidden = storageWorks;

renderTitle();
show('title');

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
