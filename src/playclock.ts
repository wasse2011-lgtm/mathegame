/**
 * 遊んだ時間の「時計」と、子ども向けの のこり時間の表示。
 *
 * ■ 数えかた
 * 1日にあそべる時間は、**アプリが表に出ていて、子どもが さわっているあいだ** を 1秒ずつ数える。
 * - 裏に回っているあいだ（visibilityState が hidden）は数えない
 * - 90秒 なにも さわらなければ止める（置きっぱなしの画面で へらさない）
 * - おうちのかたの画面と、関門を解いているあいだは数えない（main.ts が決める）
 * タイマー（いまから ○分）は、それとは別に 実時間で減る（save.ts の tickSession）。
 *
 * ■ 見せかた
 * `data-tclock` のついた要素に、目ざまし時計を描く。先に終わるほう（1日の時間か
 * タイマー）の のこりを、12時まで の おうぎ形で見せる（タイムタイマーと同じ向き。
 * 針が 時計まわりに進んで、12時に着いたら おしまい）。
 * 字が読めなくても、色のついた おうぎ形が ちいさくなるのが見える。
 * 色は みどり → きいろ（半分をきった）→ あか（のこり 3分。ベルが ときどき ゆれる）。
 * 秒針が 1秒ずつ進むので、止まっている絵ではなく「いま減っている」のが分かる。
 * 分は「くりあげ」で出す（のこり 1分10秒 は「2ふん」、さいごの 1分間が「1ぷん」）。
 */

import { handAngle, minutesLeft, remainText, timeLevel, wedgePath } from './limit';
import { addPlayTime, limitView, persist, save, sessionLeft, tickSession } from './save';

/** さわらないまま これだけ たったら数えるのをやめる */
const IDLE_MS = 90_000;
/** セーブに書く間隔（ミリ秒）。毎秒書くと、セーブ全体を毎秒 localStorage に書くことになる */
const SAVE_EVERY_MS = 15_000;
/** 知らせる節目（のこり秒）。ここを またいだ瞬間に 時計を ならす */
const PINGS = [5 * 60, 60, 0];

let lastTs = 0;
let lastInput = 0;
let lastSave = 0;
let carry = 0;
let dirty = false;
let lastRemain = Infinity;
let pingTimer = 0;

interface ClockEnv {
  /** いま数えてよいか（おうちのかたの画面・関門のあいだは false） */
  counting: () => boolean;
  /** 1秒ごと。上限に達したときの画面の切りかえは main.ts がやる */
  onTick: () => void;
}

let env: ClockEnv = { counting: () => true, onTick: () => undefined };

// ------------------------------------------------------------------ 目ざまし時計の絵

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 文字盤の中心と、おうぎ形の半径（viewBox 0 0 64 64 の中） */
const CX = 32;
const CY = 35;
const WEDGE_R = 16.4;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * 目ざまし時計を1つ作る。ベル・とって・あし・わく・文字盤・目もり・おうぎ形・針・秒針。
 * 色は CSS の --tc（わく・おうぎ形）と --tc-dark（ベル）で決まる。
 */
function makeClock(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 64 64', class: 'ac', 'aria-hidden': 'true', focusable: 'false' });
  const bells = svgEl('g', { class: 'ac-bells' });
  bells.append(
    svgEl('path', { class: 'ac-handle', d: 'M23.5 10.5Q32 3.5 40.5 10.5' }),
    svgEl('circle', { class: 'ac-knob', cx: 32, cy: 6.4, r: 2.4 }),
    svgEl('circle', { class: 'ac-bell', cx: 14.6, cy: 15.2, r: 8.2 }),
    svgEl('circle', { class: 'ac-bell', cx: 49.4, cy: 15.2, r: 8.2 }),
  );
  const legs = svgEl('path', { class: 'ac-legs', d: 'M18.5 53 13.5 59.5M45.5 53l5 6.5' });
  const body = svgEl('circle', { class: 'ac-body', cx: CX, cy: CY, r: 23 });
  const face = svgEl('circle', { class: 'ac-face', cx: CX, cy: CY, r: 18.8 });
  const wedge = svgEl('path', { class: 'ac-wedge', d: '' });
  const ticks = svgEl('g', { class: 'ac-ticks' });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    const major = i % 3 === 0;
    const r1 = major ? 14.6 : 16.2;
    const r2 = 18;
    ticks.appendChild(
      svgEl('line', {
        class: major ? 'major' : '',
        x1: (CX + r1 * Math.sin(a)).toFixed(2),
        y1: (CY - r1 * Math.cos(a)).toFixed(2),
        x2: (CX + r2 * Math.sin(a)).toFixed(2),
        y2: (CY - r2 * Math.cos(a)).toFixed(2),
      }),
    );
  }
  const hand = svgEl('line', { class: 'ac-hand', x1: CX, y1: CY, x2: CX, y2: CY - 15 });
  const sec = svgEl('line', { class: 'ac-sec', x1: CX, y1: CY + 3.5, x2: CX, y2: CY - 16 });
  const cap = svgEl('circle', { class: 'ac-cap', cx: CX, cy: CY, r: 2.3 });
  const moon = svgEl('text', { class: 'ac-moon', x: CX, y: CY + 5.6, 'text-anchor': 'middle' });
  moon.textContent = '🌙';
  // 文字盤の つや。左上に うすく一本
  const glint = svgEl('path', { class: 'ac-glint', d: 'M17.5 27.5a16 16 0 0 1 8-8' });
  svg.append(bells, legs, body, face, wedge, ticks, glint, hand, sec, cap, moon);
  return svg;
}

/** おうぎ形と針を のこり p（0〜1）に合わせる */
function paintClock(svg: SVGSVGElement, p: number): void {
  svg.querySelector('.ac-wedge')?.setAttribute('d', wedgePath(CX, CY, WEDGE_R, p));
  svg.querySelector('.ac-hand')?.setAttribute('transform', `rotate(${handAngle(p).toFixed(2)} ${CX} ${CY})`);
}

/**
 * 時計を 入れ物に1つ置く（⏰ボタンなど、data-tclock ではない場所）。
 * 返す関数で おうぎ形を動かす。
 */
export function mountClock(el: HTMLElement): (p: number) => void {
  const svg = makeClock();
  el.appendChild(svg);
  return (p) => paintClock(svg, p);
}

/** data-tclock の中身を1回だけ作る。index.html には入れ物だけ置いてある */
function build(el: HTMLElement): void {
  if (el.dataset.built) return;
  el.dataset.built = '1';
  const wrap = document.createElement('span');
  wrap.className = 'tc-clock';
  wrap.appendChild(makeClock());
  // 見出しの小さい時計だけ、分の数字を 右下の まるに出す（おうぎ形の上に数字を
  // 重ねると読めない）。ほかは横の「あと 12ふん」が数字を持つ
  const num = document.createElement('b');
  num.className = 'tc-num';
  num.setAttribute('aria-hidden', 'true');
  wrap.appendChild(num);
  el.appendChild(wrap);
  if (el.classList.contains('wide')) {
    const text = document.createElement('span');
    text.className = 'tc-text';
    el.appendChild(text);
  }
  // ホームだけは 横の帯も出す。ボスや ペットの体力と同じ「へっていく帯」なので、見なれている
  if (el.classList.contains('with-bar')) {
    const bar = document.createElement('span');
    bar.className = 'tc-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(document.createElement('i'));
    el.appendChild(bar);
  }
}

// ⏰ボタン（タイマーを かける入口）。かかっていれば その のこりを、なければ ただの時計
let paintButton: ((p: number) => void) | null = null;

/** ⏰ボタンの中に時計を置く。main.ts から1回だけ */
export function mountTimerButton(el: HTMLElement): void {
  paintButton = mountClock(el);
  renderTimeBadges();
}

/** 画面にある時計を ぜんぶ描きなおす（1秒ごと＋設定が変わったとき） */
export function renderTimeBadges(): void {
  const view = limitView();
  const ratio = view ? Math.min(1, view.remain / view.total) : 1;
  const level = view ? timeLevel(view.remain, ratio) : 'idle';
  const m = view ? minutesLeft(view.remain) : 0;
  const label = view ? remainText(view.remain, view.kind === 'session' ? 'おしまい' : 'きょうは おしまい') : '';

  for (const el of document.querySelectorAll<HTMLElement>('[data-tclock]')) {
    el.hidden = !view;
    if (!view) continue;
    build(el);
    el.dataset.level = level;
    el.dataset.kind = view.kind;
    el.style.setProperty('--p', ratio.toFixed(4));
    el.setAttribute('aria-label', label);
    el.setAttribute('role', 'img');
    const svg = el.querySelector<SVGSVGElement>('svg.ac');
    if (svg) paintClock(svg, ratio);
    const num = el.querySelector('.tc-num');
    if (num) {
      num.textContent = String(m);
      // 延長を重ねると 3けた（100分〜）になる。まるの中に収める
      num.classList.toggle('long', m >= 100);
    }
    const text = el.querySelector('.tc-text');
    if (text) text.textContent = label;
  }

  if (paintButton) {
    const btn = document.getElementById('btn-timer');
    const t = save.timer;
    const p = t ? Math.min(1, sessionLeft() / (t.totalMs / 1000)) : 0;
    if (btn) {
      btn.dataset.level = t ? timeLevel(sessionLeft(), p) : 'idle';
      btn.classList.toggle('running', Boolean(t));
    }
    paintButton(p);
  }
}

/** 節目をまたいだら、時計を ならす（ベルが ゆれる） */
export function ringClocks(): void {
  const els = document.querySelectorAll<HTMLElement>('[data-tclock], #btn-timer');
  for (const el of els) {
    el.classList.remove('ping');
    // クラスを付けなおすだけでは同じアニメが再生されない。1フレーム空ける
    requestAnimationFrame(() => el.classList.add('ping'));
  }
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = window.setTimeout(() => {
    for (const el of els) el.classList.remove('ping');
    pingTimer = 0;
  }, 2600);
}

function tick(): void {
  const now = performance.now();
  // 裏に回っていたぶんを 一度に数えない。setInterval は裏では間引かれたり
  // 止まったりするので、戻ってきた最初の1回の間隔は あてにならない
  const dt = Math.min((now - lastTs) / 1000, 2);
  lastTs = now;

  // タイマーは 実時間。裏にいたぶんも ここで まとめて引く
  tickSession();

  if (document.visibilityState === 'visible' && now - lastInput < IDLE_MS && env.counting()) {
    carry += dt;
    const whole = Math.floor(carry);
    if (whole > 0) {
      carry -= whole;
      addPlayTime(whole);
      dirty = true;
    }
  }
  // タイマーは のこりと時刻を組で持っているので、書くのが遅れても ずれない
  if ((dirty || save.timer) && now - lastSave >= SAVE_EVERY_MS) {
    lastSave = now;
    dirty = false;
    persist();
  }

  const remain = limitView()?.remain ?? Infinity;
  if (PINGS.some((p) => lastRemain > p && remain <= p)) ringClocks();
  lastRemain = remain;

  renderTimeBadges();
  env.onTick();
}

/** 時計を動かしはじめる。起動時に1回だけ呼ぶ */
export function startPlayClock(e: ClockEnv): void {
  env = e;
  lastTs = performance.now();
  lastInput = lastTs;
  lastSave = lastTs;
  // 閉じていたあいだに進んだ タイマーのぶんを、最初の画面を出す前に引いておく
  tickSession();
  lastRemain = limitView()?.remain ?? Infinity;

  const touched = (): void => {
    lastInput = performance.now();
  };
  // capture で受ける。ゲームの中で stopPropagation されても取りこぼさない
  document.addEventListener('pointerdown', touched, { capture: true, passive: true });
  document.addEventListener('keydown', touched, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    // 戻ってきた瞬間から数えなおす（裏にいた時間を dt に入れない）
    lastTs = performance.now();
    if (document.visibilityState === 'visible') lastInput = lastTs;
  });

  renderTimeBadges();
  window.setInterval(tick, 1000);
}

/**
 * 設定やきろくが変わったとき。節目の知らせを出しなおさないよう、
 * いまの のこりを基準に取りなおしてから描く。
 */
export function refreshPlayClock(): void {
  lastRemain = limitView()?.remain ?? Infinity;
  renderTimeBadges();
}
