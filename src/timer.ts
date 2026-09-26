/**
 * タイマー（いまから ○分）。おうちのかたが 端末を わたすときに かける。
 *
 * 入口は ホームの左上の ⏰ボタン。せっていの歯車と同じく **ながおし（0.8秒）** で開く。
 * 押しているあいだ ボタンの まわりの輪が満ちていくので、おとなには「開きかけている」
 * ことが見える。短く押したときは「ながおしで タイマー」とだけ出す。
 *
 * ・かかっていないとき … そのまま かける画面を出す（関門なし。わたす直前に
 *   すぐかけられることを優先する。子どもが かけても、自分の時間が減るだけ）
 * ・かかっているとき … 関門（かけ算）を通してから。止める・のばす・かけなおすは
 *   子どもには させない
 *
 * かける画面の文字盤は 60分（タイムタイマーと同じ。12時が 0、反時計まわりに 5・10・15…）。
 * ボタン（5〜60分）で えらんでも、文字盤を ゆびで回しても えらべる（5分きざみ）。
 */

import { sfx } from './audio';
import { TIMER_CHOICES, dialMinutes, handAngle, minuteWord, wedgePath } from './limit';
import { clearSession, extendSession, save, sessionLeft, startSession } from './save';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** ながおしの長さ（歯車と同じ） */
const HOLD_MS = 800;
/** 開いたときに えらばれている分数 */
const DEFAULT_MIN = 15;

interface TimerEnv {
  /** かかっているタイマーを かえる前に通す関門 */
  gate: (onPass: () => void, why: string) => void;
  /** かけた／のばした／外した */
  onChange: (what: 'start' | 'extend' | 'clear') => void;
}

let env: TimerEnv = { gate: (f) => f(), onChange: () => undefined };
let pick = DEFAULT_MIN;
/** えらびなおしたか（かかっているとき、最初は いまの のこりを見せる） */
let pickTouched = false;
let mode: 'setup' | 'running' = 'setup';
let refreshTimer = 0;

// ------------------------------------------------------------------ 文字盤（60分）

const SVG_NS = 'http://www.w3.org/2000/svg';
const DC = 100;
const WEDGE_R = 60;

const dialSvg = (): SVGSVGElement => document.getElementById('tm-dial') as unknown as SVGSVGElement;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 文字盤を作る。目もり 60本、数字 0〜55（反時計まわり）、おうぎ形、針、つまみ */
function buildDial(svg: SVGSVGElement): void {
  svg.replaceChildren();
  svg.append(
    svgEl('circle', { class: 'tm-rim', cx: DC, cy: DC, r: 97 }),
    svgEl('circle', { class: 'tm-face', cx: DC, cy: DC, r: 89 }),
    svgEl('path', { class: 'tm-wedge', d: '' }),
  );
  const ticks = svgEl('g', { class: 'tm-ticks' });
  for (let m = 0; m < 60; m++) {
    const a = (-m / 60) * 2 * Math.PI;
    const major = m % 5 === 0;
    const r1 = major ? 78 : 82;
    ticks.appendChild(
      svgEl('line', {
        class: major ? 'major' : '',
        x1: (DC + r1 * Math.sin(a)).toFixed(2),
        y1: (DC - r1 * Math.cos(a)).toFixed(2),
        x2: (DC + 86 * Math.sin(a)).toFixed(2),
        y2: (DC - 86 * Math.cos(a)).toFixed(2),
      }),
    );
  }
  svg.appendChild(ticks);
  const nums = svgEl('g', { class: 'tm-nums' });
  for (let m = 0; m < 60; m += 5) {
    const a = (-m / 60) * 2 * Math.PI;
    const t = svgEl('text', {
      x: (DC + 69 * Math.sin(a)).toFixed(2),
      y: (DC - 69 * Math.cos(a) + 4.5).toFixed(2),
      'text-anchor': 'middle',
    });
    t.textContent = String(m);
    nums.appendChild(t);
  }
  svg.append(
    nums,
    svgEl('line', { class: 'tm-hand', x1: DC, y1: DC, x2: DC, y2: DC - WEDGE_R }),
    svgEl('circle', { class: 'tm-cap', cx: DC, cy: DC, r: 13 }),
    // つまみは おうぎ形の内がわに置く（外に出すと 数字に かぶる）
    svgEl('circle', { class: 'tm-knob', cx: DC, cy: DC - WEDGE_R + 14, r: 8 }),
  );
}

/** 文字盤を min 分に合わせる（60分より長いときは 満タンで止める） */
function paintDial(min: number): void {
  const svg = dialSvg();
  const p = Math.min(1, min / 60);
  svg.querySelector('.tm-wedge')?.setAttribute('d', wedgePath(DC, DC, WEDGE_R, p));
  const rot = `rotate(${handAngle(p).toFixed(2)} ${DC} ${DC})`;
  svg.querySelector('.tm-hand')?.setAttribute('transform', rot);
  svg.querySelector('.tm-knob')?.setAttribute('transform', rot);
}

/** 文字盤の中の 押した場所 → 12時から 時計まわりの角度 */
function angleAt(e: PointerEvent, svg: Element): number {
  const r = svg.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

// ------------------------------------------------------------------ かける画面

/** 画面の中身を いまの状態に合わせる */
function renderSheet(): void {
  const running = mode === 'running' && save.timer !== null;
  const left = sessionLeft();

  // かかっているときは、いまの のこりを 文字盤と大きい数字で見せる。
  // 分数を えらびなおしたら（pick が動いたら）そちらを見せる
  const showMin = running && pickTouched === false ? Math.ceil(left / 60) : pick;
  paintDial(showMin);
  $('tm-big').replaceChildren(
    document.createTextNode(String(showMin)),
    Object.assign(document.createElement('small'), { textContent: minuteWord(showMin) }),
  );

  for (const b of $('tm-chips').querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String(pickTouched || !running ? Number(b.dataset.min) === pick : false));
  }

  $('tm-lead').textContent = running
    ? left > 0
      ? `いま のこり ${Math.ceil(left / 60)}${minuteWord(Math.ceil(left / 60))}`
      : 'タイマーが おわりました'
    : 'いまから なんぷん あそぶ？';
  // かかっているときは、えらびなおすまで押せない（何分で かけなおすのか 決まっていない）
  const start = $<HTMLButtonElement>('tm-start');
  start.disabled = running && !pickTouched;
  start.textContent = !running
    ? `${pick}${minuteWord(pick)} スタート`
    : pickTouched
      ? `${pick}${minuteWord(pick)}で かけなおす`
      : 'えらんで かけなおす';
  $('tm-run').hidden = !running;
}

function setPick(min: number, from: 'dial' | 'chip'): void {
  if (min === pick && pickTouched) return;
  pick = min;
  pickTouched = true;
  // 文字盤を回したときは 5分ごとに カチッと鳴らす（ゆびの下で 何分か 見えにくいので）
  if (from === 'dial') sfx.tick();
  renderSheet();
}

/** かける画面を出す。かかっているときは running（関門のあとに呼ぶ） */
export function openTimerSheet(m: 'setup' | 'running'): void {
  mode = m;
  pickTouched = false;
  pick = DEFAULT_MIN;
  renderSheet();
  $('overlay-timer').hidden = false;
  // かかっているあいだは のこりが動くので、開いているあいだだけ1秒ごとに描きなおす
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if ($('overlay-timer').hidden) return;
    if (mode === 'running') renderSheet();
  }, 1000);
}

function closeSheet(): void {
  $('overlay-timer').hidden = true;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = 0;
}

/**
 * ⏰ボタンを ながおししたとき。かかっていなければ そのまま、
 * かかっていれば 関門を通してから 開く。
 */
export function openTimer(): void {
  if (save.timer) {
    env.gate(() => openTimerSheet('running'), 'タイマーを かえるのは、おうちの ひと だけ だよ');
  } else {
    openTimerSheet('setup');
  }
}

// ------------------------------------------------------------------ ⏰ボタン（ながおし）

function initButton(): void {
  const btn = $<HTMLButtonElement>('btn-timer');
  const hint = $('timer-hint');
  let holdTimer = 0;
  let hintTimer = 0;
  let opened = false;

  const stop = (): void => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = 0;
    btn.classList.remove('holding');
  };

  btn.addEventListener('pointerdown', () => {
    opened = false;
    stop();
    btn.classList.add('holding');
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      opened = true;
      btn.classList.remove('holding');
      hint.hidden = true;
      sfx.tap();
      openTimer();
    }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  // iOS の ながおしメニュー（画像の保存など）を出さない
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  btn.addEventListener('click', () => {
    if (opened) return;
    hint.hidden = false;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hint.hidden = true;
      hintTimer = 0;
    }, 2600);
  });

  // キーボードの Enter／Space では そのまま開く（使うのは おとなだけ）
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    opened = true;
    openTimer();
  });
}

export function initTimer(e: TimerEnv): void {
  env = e;
  buildDial(dialSvg());

  const chips = $('tm-chips');
  for (const min of TIMER_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tm-chip';
    b.dataset.min = String(min);
    b.innerHTML = `<b>${min}</b><small>${minuteWord(min)}</small>`;
    b.addEventListener('click', () => {
      sfx.tap();
      setPick(min, 'chip');
    });
    chips.appendChild(b);
  }

  // 文字盤を ゆびで回す
  const dial = dialSvg();
  let dragging = false;
  dial.addEventListener('pointerdown', (ev) => {
    dragging = true;
    dial.setPointerCapture(ev.pointerId);
    setPick(dialMinutes(angleAt(ev, dial), pickTouched ? pick : 30), 'dial');
  });
  dial.addEventListener('pointermove', (ev) => {
    if (dragging) setPick(dialMinutes(angleAt(ev, dial), pick), 'dial');
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) {
    dial.addEventListener(ev, () => {
      dragging = false;
    });
  }

  $('tm-start').addEventListener('click', () => {
    startSession(pick);
    sfx.clear();
    closeSheet();
    env.onChange('start');
  });
  for (const [id, min] of [['tm-add5', 5], ['tm-add10', 10]] as const) {
    $(id).addEventListener('click', () => {
      extendSession(min);
      sfx.tap();
      closeSheet();
      env.onChange('extend');
    });
  }
  $('tm-stop').addEventListener('click', () => {
    clearSession();
    sfx.tap();
    closeSheet();
    env.onChange('clear');
  });
  $('tm-close').addEventListener('click', () => {
    sfx.tap();
    closeSheet();
  });

  initButton();
}
