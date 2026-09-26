/**
 * 1日にあそべる時間の「時計」と、子ども向けの のこり時間の表示。
 *
 * ■ 数えかた
 * 以前は「走ったステージの時間」と「ミニゲームを開いていた時間」だけを数えていた。
 * それだと きせかえ・ぼくじょう・ずかんに いた時間が まるごと抜け、上限を 30分に
 * しても ガチャや ペットの画面で いくらでも いられた。のこり時間も ステージが
 * 終わるたびに まとめて減るので、「あと 10ぷん」が いきなり「あと 7ふん」に跳ぶ。
 *
 * いまは **アプリが表に出ていて、子どもが さわっているあいだ** を 1秒ずつ数える。
 * - 裏に回っているあいだ（visibilityState が hidden）は数えない
 * - 90秒 なにも さわらなければ止める（置きっぱなしの画面で へらさない）
 * - おうちのかたの画面と、関門を解いているあいだは数えない（main.ts が決める）
 *
 * ■ 見せかた
 * `data-tclock` のついた要素に、へっていく ドーナツの時計と 分の数字を描く。
 * 字が読めなくても、色のついた輪が みじかくなるのが見える（タイムタイマーと同じ考え）。
 * 色は みどり → きいろ（半分をきった）→ あか（のこり 3分）。
 * 分は「くりあげ」で出す（のこり 1分10秒 は「2ふん」、さいごの 1分間が「1ぷん」）。
 */

import { minutesLeft, remainText, timeLevel } from './limit';
import { addPlayTime, allowanceToday, persist, remainingToday } from './save';

/** さわらないまま これだけ たったら数えるのをやめる */
const IDLE_MS = 90_000;
/** セーブに書く間隔（秒）。毎秒書くと、セーブ全体を毎秒 localStorage に書くことになる */
const SAVE_EVERY = 15;
/** 知らせる節目（のこり秒）。ここを またいだ瞬間に 時計を はねさせる */
const PINGS = [5 * 60, 60, 0];

let lastTs = 0;
let lastInput = 0;
let carry = 0;
let unsaved = 0;
let lastRemain = Infinity;
let pingTimer = 0;

interface ClockEnv {
  /** いま数えてよいか（おうちのかたの画面・関門のあいだは false） */
  counting: () => boolean;
  /** 1秒ごと。上限に達したときの画面の切りかえは main.ts がやる */
  onTick: () => void;
}

let env: ClockEnv = { counting: () => true, onTick: () => undefined };

/** 時計の中身を1回だけ作る。index.html には入れ物だけ置いてある */
function build(el: HTMLElement): void {
  if (el.dataset.built) return;
  el.dataset.built = '1';
  const ring = document.createElement('span');
  ring.className = 'tc-ring';
  ring.setAttribute('aria-hidden', 'true');
  const num = document.createElement('b');
  num.className = 'tc-num';
  ring.appendChild(num);
  el.appendChild(ring);
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

/** 画面にある時計を ぜんぶ描きなおす（1秒ごと＋設定が変わったとき） */
export function renderTimeBadges(): void {
  const all = allowanceToday();
  const sec = remainingToday();
  const ratio = all ? Math.min(1, sec / all) : 1;
  const level = timeLevel(sec, ratio);
  const m = minutesLeft(sec);
  const label = remainText(sec);

  for (const el of document.querySelectorAll<HTMLElement>('[data-tclock]')) {
    el.hidden = !all;
    if (!all) continue;
    build(el);
    el.dataset.level = level;
    el.style.setProperty('--p', ratio.toFixed(4));
    el.setAttribute('aria-label', label);
    el.setAttribute('role', 'img');
    const num = el.querySelector('.tc-num');
    // おわったあとは 数字の 0 ではなく 月を出す（「0」は まだ何か残っているように読める）
    if (num) {
      num.textContent = level === 'over' ? '🌙' : String(m);
      // 延長を重ねると 3けた（100分〜）になる。まるの中に収める
      num.classList.toggle('long', m >= 100);
    }
    const text = el.querySelector('.tc-text');
    if (text) text.textContent = label;
  }
}

/** 節目をまたいだら、時計を 何度か はねさせる */
function ping(): void {
  const els = document.querySelectorAll<HTMLElement>('[data-tclock]');
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

  if (document.visibilityState === 'visible' && now - lastInput < IDLE_MS && env.counting()) {
    carry += dt;
    const whole = Math.floor(carry);
    if (whole > 0) {
      carry -= whole;
      addPlayTime(whole);
      unsaved += whole;
      if (unsaved >= SAVE_EVERY) {
        unsaved = 0;
        persist();
      }
    }
  }

  const remain = remainingToday();
  if (PINGS.some((p) => lastRemain > p && remain <= p)) ping();
  lastRemain = remain;

  renderTimeBadges();
  env.onTick();
}

/** 時計を動かしはじめる。起動時に1回だけ呼ぶ */
export function startPlayClock(e: ClockEnv): void {
  env = e;
  lastTs = performance.now();
  lastInput = lastTs;
  lastRemain = remainingToday();

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
  lastRemain = remainingToday();
  renderTimeBadges();
}
