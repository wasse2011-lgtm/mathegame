/**
 * ペットぼくじょう。コインの使いみち その2。
 *
 * この画面の役目は「たくさん いることが 一目でわかる」こと。
 * 一覧の表だけだと数が増えても嬉しくないので、上に牧場を置いて
 * 持っている子ぜんぶを実際に歩かせる。増えるほど画面がにぎやかになる。
 *
 * ここでは コインの使いみちが 3つある。
 *   ・たまご／キラたまご … なかまが ふえる（pets.ts）
 *   ・あそびどうぐ … 置くと、なかまが じぶんから あそびにいく（toys.ts）
 *   ・おやつ … 落とすと、近くの子が 走ってきて食べる（treats.ts。1日 5こ まで）
 */

import { sfx } from './audio';
import { drawPet, paintPetIcon } from './petart';
import { pickAction } from './playground';
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
  voiceOf,
  type PetDef,
  type PetRoll,
} from './pets';
import { profile } from './save';
import { currentLook, drawChar, roundRect } from './sprites';
import {
  TOY_COST,
  buyNextToy,
  drawBall,
  drawToy,
  drawToyRider,
  hasToy,
  nextToy,
  ownedToys,
  paintToyIcon,
  toyBox,
  toyPose,
  type ToyDef,
} from './toys';
import { TREAT_COST, treatBlock, treatsLeft, useTreat } from './treats';

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
  // ヒントに回数があるのは さいごのボスだけ。そこだけの力だと分かる言いかたにする
  if (pw.hints > 0) parts.push(`さいごの ボスで ヒントを ${pw.hints}かい ふやす`);
  if (pw.rescue > 0) parts.push('じかんぎれのとき 1かい せなかに のせてくれる');
  if (pw.guard > 0) parts.push('まちがえたとき 1かい まもってくれる');
  return parts.length ? parts.join('・') : 'いっしょに はしってくれる';
}

// ---------------------------------------------------------------- 牧場

type Action = 'jump' | 'spin' | 'heart' | 'shout' | 'dance' | 'eat';

/** 向かっている先。おやつ・どうぐ・ボール */
type Goal =
  | { kind: 'snack'; snack: Snack }
  | { kind: 'toy'; toy: ToyDef }
  | { kind: 'ball' };

interface Walker {
  pet: PetDef;
  x: number;
  /** 0（奥）〜1（手前）。大きさと重なり順に使う */
  depth: number;
  vx: number;
  phase: number;
  /** さわられたときの反応。終わると null に戻る */
  act: Action | null;
  aT: number;
  /** 跳ねている高さ（画面ピクセル） */
  hop: number;
  spin: number;
  /** 最後に描いた位置と大きさ。さわった場所の判定に使う */
  sx: number;
  sy: number;
  ss: number;
  /** 向かっている先。null は ふつうに歩いている */
  goal: Goal | null;
  /** あそんでいる どうぐ。u は 0→1 の進みぐあい、seat は 2人用の どちら側か */
  play: { toy: ToyDef; u: number; seat: number } | null;
  /** つぎに じぶんから あそびにいくまでの秒数 */
  bored: number;
}

/** さわったときに飛ぶ ハート／きらきら／しずく */
interface Puff {
  x: number; y: number; vx: number; vy: number;
  life: number; heart: boolean; color: string;
}

/** おやつの種類。どれが落ちてくるかは その場で決める（見た目だけ） */
const SNACKS = ['りんご', 'クッキー', 'さかな', 'ドーナツ'] as const;

/** 食べおわったときの ひとこと */
const YUM = ['おいしい！', 'もぐもぐ…', 'ごちそうさま！', 'もっと たべたい！'];

interface Snack {
  /** 横位置（0..1） */
  x: number;
  depth: number;
  /** 画面の高さ。落ちている途中は 地面より上 */
  y: number;
  vy: number;
  landed: boolean;
  kind: number;
  /** 食べている子。null のあいだは まだ だれのものでもない */
  eater: Walker | null;
  /** 食べた割合 0..1 */
  bite: number;
  /** 地面についてからの秒数。だれも来ないまま長くは残さない */
  age: number;
}

/** おやつが地面で待つ長さ（秒）。すぎると ふっと消える */
const SNACK_WAIT = 14;
/** 食べている長さ（秒） */
const EAT_SEC = 1.5;

/** ボール。どうぐの1つだが、ころがるので ここで動かす */
const ball = { x: 0.64, depth: 0.85, vx: 0, vd: 0, h: 0, vh: 0, spin: 0 };

/**
 * かいぬし（じぶんの キャラ）が立つ奥行き。まんなかの手前にする。
 * さくの前は どうぐの置き場所なので、ここを奥にすると トランポリンに かぶる
 */
const OWNER_DEPTH = 0.78;

let walkers: Walker[] = [];
let puffs: Puff[] = [];
let snacks: Snack[] = [];
let ranchRaf = 0;
/** 前のフレームの時刻。反応の速さを画面の refresh rate に左右させない */
let ranchLast = 0;
let ranchT = 0;
let ranchW = 320;
let ranchH = 150;

const top = () => ranchH * 0.3;
const yOf = (depth: number) => top() + 26 + depth * (ranchH - top() - 40);
const sizeOf = (depth: number) => (22 + depth * 16) * Math.min(1.4, ranchW / 320);
/**
 * どうぐの大きさ。さくの前（いちばん奥）に置くと ペットの ものさしでは小さすぎて、
 * なにが置いてあるのか読めない。どうぐと、それで あそんでいる子だけ ひとまわり大きくする
 */
const toySize = (depth: number) => sizeOf(depth) * 1.2;

function buildWalkers(): void {
  const list = ownedPets();
  walkers = list.map((pet, i) => {
    const old = walkers.find((w) => w.pet.id === pet.id);
    if (old) return old;
    return {
      pet,
      x: ((i + 0.5) / Math.max(list.length, 1)) * 0.9 + 0.05,
      depth: ((i * 7) % 10) / 10,
      vx: (i % 2 ? 1 : -1) * (0.02 + ((i * 3) % 5) * 0.006),
      phase: (i * 1.7) % 6,
      act: null,
      aT: 0,
      hop: 0,
      spin: 0,
      sx: 0,
      sy: 0,
      ss: 24,
      goal: null,
      play: null,
      // 開いてすぐ だれかが あそびはじめるように、はじめは短めに ばらけさせる
      bored: 1.5 + ((i * 2.3) % 5),
    };
  });
}

/** いま なにもしていない（歩いているだけの）子か */
const idle = (w: Walker) => !w.act && !w.goal && !w.play;

function burst(x: number, y: number, n: number, heart: boolean, color: string): void {
  for (let i = 0; i < n; i++) {
    puffs.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 70,
      vy: -35 - Math.random() * 70,
      life: 0.9,
      heart,
      color,
    });
  }
}

// ---------------------------------------------------------------- どうぐ

/** どうぐを いま 使っている／向かっている数 */
function crowd(toy: ToyDef): number {
  return walkers.filter((w) => w.play?.toy === toy || (w.goal?.kind === 'toy' && w.goal.toy === toy)).length;
}

/** 空いている席。2人用の どうぐで、左右どちらが空いているか */
function freeSeat(toy: ToyDef): number {
  const used = walkers.filter((w) => w.play?.toy === toy).map((w) => w.play?.seat);
  for (let i = 0; i < toy.seats; i++) if (!used.includes(i)) return i;
  return -1;
}

/** どうぐの 乗り口（横位置 0..1）。すべりだいは はしごの下 */
function entryX(toy: ToyDef, seat: number): number {
  const pose = toyPose(toy, 0, toySize(toy.depth), ranchT, seat);
  return clamp(toy.x + pose.dx / ranchW, 0.04, 0.96);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** いちばん近くで ひまな子。おやつ・どうぐに呼ぶ */
function nearestIdle(x: number, depth: number, skip: Walker[] = []): Walker | null {
  let best: Walker | null = null;
  let bestD = Infinity;
  for (const w of walkers) {
    if (!idle(w) || skip.includes(w)) continue;
    const d = Math.abs(w.x - x) + Math.abs(w.depth - depth) * 0.4;
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

/** じぶんから あそびにいく。ひまな時間が たまった子が、置いてある どうぐを1つ えらぶ */
function wander(w: Walker, dt: number): void {
  w.bored -= dt;
  if (w.bored > 0) return;
  w.bored = 5 + Math.random() * 8;
  const toys = ownedToys();
  if (!toys.length || Math.random() < 0.25) return;
  const toy = toys[Math.floor(Math.random() * toys.length)];
  if (toy.id === 'ball') {
    // ボールを追いかけるのは 1ぴきずつ。みんなで群がると ボールが見えない
    if (!walkers.some((o) => o.goal?.kind === 'ball')) w.goal = { kind: 'ball' };
    return;
  }
  // 行列は作らない。空いていない どうぐには行かない
  if (crowd(toy) < toy.seats) w.goal = { kind: 'toy', toy };
}

/** どうぐに着いた。空いていれば あそびはじめる */
function startPlay(w: Walker, toy: ToyDef): void {
  const seat = freeSeat(toy);
  w.goal = null;
  if (seat < 0) return;
  w.play = { toy, u: 0, seat };
  w.act = null;
  w.hop = 0;
  w.spin = 0;
}

function endPlay(w: Walker): void {
  const play = w.play;
  if (!play) return;
  const s = toySize(play.toy.depth);
  const pose = toyPose(play.toy, 1, s, ranchT, play.seat);
  w.play = null;
  w.x = clamp(play.toy.x + pose.dx / ranchW, 0.04, 0.96);
  // どうぐの前へ ひと足 出てから歩きだす（どうぐに重なったまま歩かない）
  w.depth = clamp(play.toy.depth + (play.toy.depth > 0.5 ? -0.2 : 0.14), 0, 1);
  w.vx = (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.03);
  w.bored = 5 + Math.random() * 8;
}

/** ボールを ける。dir は 右 1 ／ 左 -1 */
function kickBall(dir: number, power = 1): void {
  ball.vx = dir * (0.3 + Math.random() * 0.2) * power;
  ball.vd = (Math.random() - 0.5) * 0.25;
  ball.vh = (60 + Math.random() * 40) * power;
}

function updateBall(dt: number): void {
  if (!hasToy('ball')) return;
  ball.x += ball.vx * dt;
  ball.depth += ball.vd * dt;
  ball.vx *= Math.max(0, 1 - dt * 0.9);
  ball.vd *= Math.max(0, 1 - dt * 1.5);
  ball.spin += ball.vx * dt * 30;
  if (ball.x < 0.05) {
    ball.x = 0.05;
    ball.vx = Math.abs(ball.vx);
  }
  if (ball.x > 0.95) {
    ball.x = 0.95;
    ball.vx = -Math.abs(ball.vx);
  }
  // どうぐの前（奥は さく・どうぐがある）だけを ころがる
  ball.depth = clamp(ball.depth, 0.4, 0.98);
  if (ball.h > 0 || ball.vh > 0) {
    ball.vh -= 320 * dt;
    ball.h += ball.vh * dt;
    if (ball.h <= 0) {
      ball.h = 0;
      ball.vh = Math.abs(ball.vh) > 40 ? -ball.vh * 0.45 : 0;
    }
  }
}

// ---------------------------------------------------------------- おやつ

/** おやつを1つ落とす（コインは呼ぶ側で払ってある） */
function dropSnack(): Snack {
  const snack: Snack = {
    // まんなか（かいぬしの足もと）は さけて、左右のどちらかに落とす
    x: Math.random() < 0.5 ? 0.12 + Math.random() * 0.28 : 0.6 + Math.random() * 0.28,
    depth: 0.35 + Math.random() * 0.5,
    y: -12,
    vy: 0,
    landed: false,
    kind: Math.floor(Math.random() * SNACKS.length),
    eater: null,
    bite: 0,
    age: 0,
  };
  snacks.push(snack);
  return snack;
}

function updateSnacks(dt: number): void {
  for (let i = snacks.length - 1; i >= 0; i--) {
    const sn = snacks[i];
    const ground = yOf(sn.depth);
    if (!sn.landed) {
      sn.vy += 900 * dt;
      sn.y += sn.vy * dt;
      if (sn.y >= ground) {
        // ぽとっと 小さく はねて止まる
        if (sn.vy > 160) {
          sn.y = ground;
          sn.vy = -sn.vy * 0.3;
          sfx.drop();
        } else {
          sn.y = ground;
          sn.vy = 0;
          sn.landed = true;
          callToSnack(sn);
        }
      }
      continue;
    }
    sn.age += dt;
    // まだ だれも向かっていなければ、ひまになった子を呼ぶ
    if (!sn.eater && !walkers.some((w) => w.goal?.kind === 'snack' && w.goal.snack === sn)) callToSnack(sn);
    if (!sn.eater && sn.age > SNACK_WAIT) {
      snacks.splice(i, 1);
      continue;
    }
    if (sn.eater) {
      sn.bite = Math.min(1, sn.eater.aT / EAT_SEC);
      if (Math.random() < dt * 6) {
        // たべかすが ぽろぽろ
        puffs.push({
          x: sn.x * ranchW + (Math.random() - 0.5) * 8,
          y: sn.y - 4,
          vx: (Math.random() - 0.5) * 50,
          vy: -30 - Math.random() * 40,
          life: 0.5,
          heart: false,
          color: '#e0b27a',
        });
      }
    }
  }
}

/** 近くの子を 3びきまで おやつに呼ぶ。いちばん先に着いた子が食べる */
function callToSnack(sn: Snack): void {
  const coming: Walker[] = walkers.filter((w) => w.goal?.kind === 'snack' && w.goal.snack === sn);
  while (coming.length < 3) {
    const w = nearestIdle(sn.x, sn.depth, coming);
    if (!w) break;
    w.goal = { kind: 'snack', snack: sn };
    coming.push(w);
  }
}

/** おやつに着いた。まだ だれも食べていなければ 食べる */
function reachSnack(w: Walker, sn: Snack): void {
  w.goal = null;
  if (sn.eater || !snacks.includes(sn)) {
    // 先を こされた。くやしがらずに ぴょんと跳ねて また歩く
    w.act = 'jump';
    w.aT = 0;
    return;
  }
  sn.eater = w;
  w.act = 'eat';
  w.aT = 0;
  w.x = clamp(sn.x - 0.035, 0.04, 0.96);
  sfx.voice(voiceOf(w.pet.art));
}

function finishSnack(w: Walker): void {
  const i = snacks.findIndex((sn) => sn.eater === w);
  if (i >= 0) snacks.splice(i, 1);
  burst(w.sx, w.sy - w.ss * 0.8, 6, true, '#ff8aa0');
  sfx.voice(voiceOf(w.pet.art));
  $('pet-detail').textContent = `${w.pet.name}「${YUM[Math.floor(Math.random() * YUM.length)]}」`;
  // 他に まだ おやつを待っている子は そのまま（別の おやつに向かう）
}

function drawSnack(g: CanvasRenderingContext2D, sn: Snack): void {
  const s = sizeOf(sn.depth);
  const r = s * 0.2 * (1 - sn.bite * 0.75);
  const x = sn.x * ranchW;
  const y = sn.y;
  const fade = sn.eater ? 1 : Math.min(1, (SNACK_WAIT - sn.age) / 1.2);
  if (r < 0.5 || fade <= 0) return;
  g.save();
  g.globalAlpha = fade;
  if (sn.landed) {
    g.fillStyle = 'rgba(40,70,40,.14)';
    g.beginPath();
    g.ellipse(x, y + 1, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
    g.fill();
  }
  const cy = y - r;
  switch (SNACKS[sn.kind]) {
    case 'りんご':
      g.fillStyle = '#e94b4b';
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#7a4a2a';
      g.lineWidth = Math.max(1, r * 0.18);
      g.beginPath();
      g.moveTo(x, cy - r * 0.8);
      g.lineTo(x + r * 0.15, cy - r * 1.3);
      g.stroke();
      g.fillStyle = '#69c07a';
      g.beginPath();
      g.ellipse(x + r * 0.45, cy - r * 1.1, r * 0.35, r * 0.18, -0.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'クッキー':
      g.fillStyle = '#e0b27a';
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6b4226';
      for (const [dx, dy] of [[-0.4, -0.3], [0.35, -0.1], [-0.05, 0.4], [0.3, 0.45]]) {
        g.beginPath();
        g.arc(x + dx * r, cy + dy * r, r * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'さかな':
      g.fillStyle = '#ff9f5a';
      g.beginPath();
      g.ellipse(x - r * 0.1, cy + r * 0.2, r * 1.1, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(x + r * 0.8, cy + r * 0.2);
      g.lineTo(x + r * 1.5, cy - r * 0.3);
      g.lineTo(x + r * 1.5, cy + r * 0.7);
      g.closePath();
      g.fill();
      g.fillStyle = '#26313d';
      g.beginPath();
      g.arc(x - r * 0.6, cy + r * 0.05, r * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    default: {
      // ドーナツ
      g.fillStyle = '#f7a8c4';
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.arc(x, cy, r * 0.38, 0, Math.PI * 2, true);
      g.fill('evenodd');
      const sprinkles = ['#ffe066', '#4dabf7', '#ffffff'];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.fillStyle = sprinkles[k % 3];
        g.fillRect(x + Math.cos(a) * r * 0.68 - 1, cy + Math.sin(a) * r * 0.68 - 1, 2.2, 2.2);
      }
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- さわる

/**
 * 牧場をさわる。
 * 見ているだけの牧場と「さわると返してくれる」牧場では、居つく時間がまるで違う。
 *
 *  ・なかま … 鳴き声・大ジャンプ・くるっと回る・ハート・おどり のどれかを返し、
 *              そのあと歩く向きも変える（何度さわっても同じにならない）
 *  ・どうぐ … いちばん近くで ひまな子が あそびに来る
 *  ・ボール … さわった向きの反対へ ころがる
 */
function pokeRanch(px: number, py: number): void {
  let hit: Walker | null = null;
  let best = Infinity;
  for (const w of walkers) {
    const dx = Math.abs(px - w.sx);
    const dy = Math.abs(py - (w.sy - w.ss * 0.5));
    if (dx > w.ss * 0.95 || dy > w.ss * 0.95) continue;
    const d = dx + dy;
    if (d < best) {
      best = d;
      hit = w;
    }
  }

  if (hit) {
    // さわった子の ひとこと。ここが note の出しどころ
    $('pet-detail').textContent = `${hit.pet.name}「${hit.pet.note}」`;
    sfx.voice(voiceOf(hit.pet.art));
    // あそんでいる子・食べている子は じゃましない。ハートだけ返す
    if (hit.play || hit.act === 'eat') {
      burst(hit.sx, hit.sy - hit.ss * 0.8, 4, true, '#ff8aa0');
      return;
    }
    hit.goal = null;
    hit.act = pickAction(hit.act);
    hit.aT = 0;
    hit.spin = 0;
    hit.vx = (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.04);
    const heart = hit.act === 'heart';
    burst(hit.sx, hit.sy - hit.ss * 0.8, heart ? 5 : 7, heart, heart ? '#ff8aa0' : '#ffd257');
    return;
  }

  // ボール
  if (hasToy('ball')) {
    const bs = sizeOf(ball.depth);
    const bx = ball.x * ranchW;
    const by = yOf(ball.depth) - ball.h - bs * 0.28;
    if (Math.abs(px - bx) < bs * 0.6 && Math.abs(py - by) < bs * 0.6) {
      kickBall(px < bx ? 1 : -1, 1.3);
      sfx.jump();
      return;
    }
  }

  // どうぐ。手前のものから当てる
  const toys = ownedToys().filter((t) => t.id !== 'ball').sort((a, b) => b.depth - a.depth);
  for (const toy of toys) {
    const s = toySize(toy.depth);
    const box = toyBox(toy, s);
    const tx = toy.x * ranchW;
    const ty = yOf(toy.depth);
    if (px < tx + box.l || px > tx + box.r || py < ty + box.t || py > ty + box.b) continue;
    sfx.tap();
    $('pet-detail').textContent = `${toy.name}：${toy.note}`;
    if (crowd(toy) < toy.seats) {
      const w = nearestIdle(toy.x, toy.depth);
      if (w) w.goal = { kind: 'toy', toy };
    }
    return;
  }
}

// ---------------------------------------------------------------- うごき

function updateWalker(w: Walker, dt: number): void {
  // どうぐで あそんでいる
  if (w.play) {
    const dur = w.play.toy.dur;
    w.play.u += dt / dur;
    if (w.play.u >= 1) endPlay(w);
    return;
  }

  // さわられた・食べている子は、その場で反応してから また歩きだす
  if (w.act) {
    w.aT += dt;
    const dur = w.act === 'spin' ? 0.7 : w.act === 'shout' ? 1.1 : w.act === 'eat' ? EAT_SEC : 1.2;
    if (w.act === 'spin') w.spin = Math.min(1, w.aT / 0.7) * Math.PI * 2;
    if (w.act === 'jump') w.hop = Math.abs(Math.sin(w.aT * 9)) * (1 - w.aT / dur);
    if (w.act === 'heart') w.hop = Math.abs(Math.sin(w.aT * 6)) * 0.35;
    // もぐもぐ。小さく はやく うなずく
    if (w.act === 'eat') w.hop = Math.abs(Math.sin(w.aT * 14)) * 0.12;
    if (w.aT >= dur) {
      if (w.act === 'eat') finishSnack(w);
      w.act = null;
      w.spin = 0;
      w.hop = 0;
    }
    return;
  }

  // おやつ・どうぐ・ボールへ向かう
  if (w.goal) {
    const g = w.goal;
    if (g.kind === 'snack' && (g.snack.eater || !snacks.includes(g.snack))) {
      // 先に食べられた。おやつが まだ ほかにあれば そっちへ
      w.goal = null;
      const other = snacks.find((sn) => sn.landed && !sn.eater);
      if (other) w.goal = { kind: 'snack', snack: other };
      return;
    }
    const gx = g.kind === 'snack' ? g.snack.x - 0.035 : g.kind === 'ball' ? ball.x - Math.sign(ball.x - w.x || 1) * 0.03 : entryX(g.toy, Math.max(0, freeSeat(g.toy)));
    const gd = g.kind === 'snack' ? g.snack.depth : g.kind === 'ball' ? ball.depth : g.toy.depth;
    const dx = gx - w.x;
    // おやつには かけ足、どうぐには 早足
    const speed = g.kind === 'snack' ? 0.3 : 0.2;
    w.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    w.depth += (gd - w.depth) * Math.min(1, dt * 2.4);
    w.vx = Math.sign(dx) * Math.abs(w.vx || 0.03);
    // かけ足の子は ぴょこぴょこ はねる
    w.hop = Math.abs(Math.sin(ranchT * 12 + w.phase)) * 0.12;
    if (Math.abs(dx) < 0.012 && Math.abs(gd - w.depth) < 0.08) {
      w.hop = 0;
      if (g.kind === 'snack') reachSnack(w, g.snack);
      else if (g.kind === 'toy') startPlay(w, g.toy);
      else {
        w.goal = null;
        kickBall(ball.x >= w.x ? 1 : -1);
        sfx.voice(voiceOf(w.pet.art));
      }
    }
    return;
  }

  w.x += w.vx * dt * 9.6;
  if (w.x < 0.04) {
    w.x = 0.04;
    w.vx = Math.abs(w.vx);
  }
  if (w.x > 0.96) {
    w.x = 0.96;
    w.vx = -Math.abs(w.vx);
  }
  // 歩いていて ボールに ぶつかったら、ついでに けとばす
  if (hasToy('ball') && Math.abs(w.x - ball.x) < 0.025 && Math.abs(w.depth - ball.depth) < 0.12 && Math.abs(ball.vx) < 0.05) {
    kickBall(w.vx >= 0 ? 1 : -1, 0.7);
  }
  wander(w, dt);
}

// ---------------------------------------------------------------- 描画

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
  const dt = Math.min(ranchLast ? (ts - ranchLast) / 1000 : 1 / 60, 1 / 20);
  ranchLast = ts;
  ranchT = t;
  const skyTop = top();

  // そら → しばふ
  const sky = g.createLinearGradient(0, 0, 0, skyTop);
  sky.addColorStop(0, '#bfe6fa');
  sky.addColorStop(1, '#e6f5fd');
  g.fillStyle = sky;
  g.fillRect(0, 0, ranchW, skyTop);
  g.fillStyle = '#8fd07d';
  g.fillRect(0, skyTop, ranchW, ranchH - skyTop);
  g.fillStyle = '#7ec96f';
  g.fillRect(0, skyTop, ranchW, 4);

  // 遠くの木
  g.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 97) % ranchW) + 20;
    g.beginPath();
    g.arc(cx, skyTop - 12, 16 + (i % 3) * 4, 0, Math.PI * 2);
    g.fill();
  }

  // さく
  g.strokeStyle = '#d9b98a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, skyTop + 10);
  g.lineTo(ranchW, skyTop + 10);
  g.stroke();
  for (let x = 12; x < ranchW; x += 46) {
    g.beginPath();
    g.moveTo(x, skyTop);
    g.lineTo(x, skyTop + 20);
    g.stroke();
  }

  updateBall(dt);
  updateSnacks(dt);
  for (const w of walkers) updateWalker(w, dt);

  const active = activePet();

  // かいぬしも 牧場に立っている
  const ownerDepth = OWNER_DEPTH;
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

  // どうぐ。あそんでいる子は どうぐの すぐ手前に描く
  for (const toy of ownedToys()) {
    const view = { x: toy.x * ranchW, y: yOf(toy.depth), s: toySize(toy.depth), t };
    if (toy.id === 'ball') {
      items.push({
        z: ball.depth,
        draw: () => {
          const s = sizeOf(ball.depth);
          drawBall(g, ball.x * ranchW, yOf(ball.depth) - ball.h, s * 0.28, ball.spin);
        },
      });
      continue;
    }
    const riders = walkers.filter((w) => w.play?.toy === toy);
    items.push({ z: toy.depth - 0.001, draw: () => drawToy(g, toy, view, riders.length > 0, riders[0]?.play?.u ?? 0) });
    for (const w of riders) {
      items.push({
        z: toy.depth + 0.001,
        draw: () => {
          const play = w.play;
          if (!play) return;
          const at = drawToyRider(g, toy, view, w.pet.art, play.u, play.seat, w.phase);
          w.sx = at.x;
          w.sy = at.y;
          w.ss = view.s;
          // ふんすいの しずく
          if (toy.id === 'fountain' && Math.random() < 0.2) {
            puffs.push({ x: at.x, y: at.y - view.s * 0.9, vx: (Math.random() - 0.5) * 50, vy: -40 - Math.random() * 40, life: 0.6, heart: false, color: '#8fd3f5' });
          }
        },
      });
    }
  }

  // おやつ。落ちている途中は いちばん手前に描く（どこに落ちるか見えるように）
  for (const sn of snacks) items.push({ z: sn.landed ? sn.depth - 0.0005 : 2, draw: () => drawSnack(g, sn) });

  for (const w of walkers) {
    if (w.play) continue;
    const dancing = w.act === 'dance';
    const s = sizeOf(w.depth);
    const y = yOf(w.depth) - w.hop * s * 1.1;
    const x = w.x * ranchW + (dancing ? Math.sin(t * 14) * s * 0.3 : 0);
    w.sx = x;
    w.sy = y;
    w.ss = s;
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
          g.ellipse(x, yOf(w.depth) + 2, s * 0.44, s * 0.16, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,.55)';
          g.beginPath();
          g.ellipse(x, yOf(w.depth) + 2, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = 'rgba(40,70,40,.14)';
          g.beginPath();
          g.ellipse(x, yOf(w.depth) + 2, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        }
        if (w.spin) {
          g.save();
          g.translate(x, y - s * 0.5);
          g.rotate(w.spin);
          g.translate(-x, -(y - s * 0.5));
          drawPet(g, x, y, s, w.pet.art, t + w.phase);
          g.restore();
        } else {
          drawPet(g, x, y, s, w.pet.art, t + w.phase);
        }
        if (w.act === 'shout') bubble(g, x, y - s * 1.15, w.pet.name, s);
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

  // さわったときに飛ぶ ハート／きらきら
  for (let i = puffs.length - 1; i >= 0; i--) {
    const q = puffs[i];
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vy += 90 * dt;
    if (q.life <= 0) {
      puffs.splice(i, 1);
      continue;
    }
    g.globalAlpha = Math.max(0, q.life / 0.9);
    g.fillStyle = q.color;
    if (q.heart) {
      const r = 6;
      g.beginPath();
      g.moveTo(q.x, q.y + r * 0.9);
      g.bezierCurveTo(q.x - r * 1.5, q.y - r * 0.3, q.x - r * 0.4, q.y - r * 1.2, q.x, q.y - r * 0.35);
      g.bezierCurveTo(q.x + r * 0.4, q.y - r * 1.2, q.x + r * 1.5, q.y - r * 0.3, q.x, q.y + r * 0.9);
      g.closePath();
      g.fill();
    } else {
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI / 4) * k - Math.PI / 2;
        const rad = k % 2 ? 2 : 5;
        const px = q.x + Math.cos(a) * rad;
        const py = q.y + Math.sin(a) * rad;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }
  g.globalAlpha = 1;

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

/** さわった子の名前を、頭の上に出す */
function bubble(g: CanvasRenderingContext2D, x: number, y: number, text: string, size: number): void {
  g.font = `700 ${Math.max(11, size * 0.4)}px "Hiragino Maru Gothic ProN", sans-serif`;
  const w = g.measureText(text).width + size * 0.5;
  const h = size * 0.66;
  const bx = Math.min(Math.max(x - w / 2, 2), ranchW - w - 2);
  const by = Math.max(y, h + 4);
  g.fillStyle = '#fff';
  g.strokeStyle = 'rgba(38,49,61,.18)';
  g.lineWidth = 2;
  roundRect(g, bx, by - h, w, h, h * 0.42);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(x - size * 0.12, by - 1);
  g.lineTo(x + size * 0.1, by - 1);
  g.lineTo(x, by + size * 0.16);
  g.closePath();
  g.fill();
  g.fillStyle = '#26313d';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, bx + w / 2, by - h / 2);
}

export function startRanchIdle(): void {
  if (!ranchRaf) {
    ranchLast = 0;
    ranchRaf = requestAnimationFrame(paintRanch);
  }
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
  const owned = ownedPets();
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

  renderSpend();
  buildWalkers();
  startRanchIdle();
}

/**
 * コインで押すボタン（たまご・どうぐ・おやつ）と コインの数だけを 作りなおす。
 * おやつは何回も続けて押すので、そのたびに一覧（40マス）まで作りなおさない。
 */
function renderSpend(): void {
  const p = profile();
  $('ranch-coins').textContent = String(p.coins);

  const egg = $<HTMLButtonElement>('pet-egg');
  const shiny = $<HTMLButtonElement>('pet-egg-shiny');
  egg.disabled = p.coins < PET_EGG_COST;
  shiny.disabled = p.coins < PET_EGG_SHINY_COST;
  $('pet-egg-sub').textContent = egg.disabled ? `あと ${PET_EGG_COST - p.coins}` : 'なかま +1';
  $('pet-egg-shiny-sub').textContent = shiny.disabled
    ? `あと ${PET_EGG_SHINY_COST - p.coins}`
    : 'レアが でやすい';

  // どうぐ。つぎに置くものの絵と名前を いつも出す（ためる目標になる）
  const toy = nextToy();
  const toyBtn = $<HTMLButtonElement>('toy-buy');
  const noPets = ownedPets().length === 0;
  $('toy-name').textContent = toy ? toy.name : 'どうぐ';
  toyBtn.disabled = !toy || noPets || p.coins < TOY_COST;
  $('toy-sub').textContent = !toy
    ? 'ぜんぶ おいた！'
    : noPets
      ? 'なかまが きたら'
      : p.coins < TOY_COST
        ? `あと ${TOY_COST - p.coins}`
        : 'ぼくじょうに おく';
  $('toy-cost-row').hidden = !toy;
  const icon = $<HTMLCanvasElement>('toy-icon');
  const shown = toy ?? ownedToys()[ownedToys().length - 1];
  if (shown && icon.dataset.toy !== shown.id) {
    icon.dataset.toy = shown.id;
    paintToyIcon(icon, shown, 34);
  }

  // おやつ。のこりの数は「あと ○こ」で出す（1日 5こ まで）
  const left = treatsLeft('snack');
  const snackBtn = $<HTMLButtonElement>('snack-btn');
  snackBtn.classList.toggle('off', noPets || treatBlock('snack') !== null);
  snackBtn.setAttribute('aria-label', `おやつ ${TREAT_COST.snack}コイン。きょう あと ${left}こ`);
  $('snack-left').textContent = left > 0 ? `あと${left}` : 'あした';
}

// ---------------------------------------------------------------- たまご

/**
 * たまごの色。RARITIES と同じ順（ふつう・レア・スーパーレア・でんせつ）。
 *
 * たまごは どれも白で出てきて、引いたレア度の段まで 1段ずつ色が変わる
 * （レアは あお、スーパーレアは あお→むらさき、でんせつは あお→むらさき→きん）。
 * 段の数だけ ゆれる回数も のびるので、レア度が高いほど 演出が長く・はでになる。
 */
const EGG_TINTS: { egg: string; hi: string; spot: string }[] = [
  { egg: '#fff1d6', hi: '#ffffff', spot: '#f0cf92' },
  { egg: '#8fcaf3', hi: '#ecf7ff', spot: '#4aa3dd' },
  { egg: '#c49de6', hi: '#f8f0ff', spot: '#9a56bd' },
  { egg: '#ffcc4a', hi: '#fff8d8', spot: '#e8912a' },
];

/** 段が上がったときの ひとこと。3段めは でんせつのときだけ出る */
const EGG_STEP_SAY = ['', 'ひかった！', 'また かわった！', 'こ、これは…！'];

/** 段の 光。ふつうの たまごは 光らせない */
const EGG_GLOW = ['transparent', 'rgba(74,163,221,.95)', 'rgba(168,106,208,.95)', 'rgba(255,190,60,1)'];

/** 演出の タイマー。とばしたとき・閉じたときに まとめて止める */
let hatchTimers: number[] = [];
/** たまごの演出中なら、タップで とばしたときに出す結果 */
let skipHatch: (() => void) | null = null;
/**
 * 結果を出した時刻。すぐあとの タップでは「やったー！」を押させない。
 * たまごを とばした指が そのまま ボタンの上に来て、結果を見ないまま閉じてしまう
 */
let revealedAt = 0;

function stopHatch(): void {
  for (const t of hatchTimers) clearTimeout(t);
  hatchTimers = [];
  skipHatch = null;
}

function hatchLater(fn: () => void, ms: number): void {
  hatchTimers.push(window.setTimeout(fn, ms));
}

const stillMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** たまご そのものの動き。重ねると あとの規則が勝つので、いつも1つだけ付ける */
function eggMove(egg: HTMLElement, move: 'in' | 'wobble' | 'shake'): void {
  egg.classList.remove('in', 'wobble', 'shake');
  void egg.offsetWidth;
  egg.classList.add(move);
}

function hatchFlash(color: string): void {
  const f = $('hatch-flash');
  f.style.setProperty('--flash', color);
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
}

/** きらきら（ふつうは 紙ふぶき）を とばす。数と色は レア度で変える */
function hatchBurst(rank: number, color: string): void {
  const top = $('hatch-top');
  const n = [12, 16, 24, 36][rank];
  const palette =
    rank === 0 ? ['#ff8fa3', '#ffd257', '#8fe3a0', '#8fc8ff', '#c9a0ff'] : [color, '#ffffff', color, '#fff3b0'];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.className = rank === 0 ? 'hatch-bit paper' : 'hatch-bit';
    if (rank > 0) b.textContent = rank === 3 && i % 3 === 0 ? '★' : '✦';
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 90 + Math.random() * (60 + rank * 40);
    b.style.setProperty('--dx', `${Math.round(Math.cos(a) * dist)}px`);
    b.style.setProperty('--dy', `${Math.round(Math.sin(a) * dist)}px`);
    b.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
    b.style.setProperty('--c', palette[i % palette.length]);
    b.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
    top.appendChild(b);
  }
  // でんせつは 金の ほしが 上から ふってくる
  if (rank === 3) {
    for (let i = 0; i < 18; i++) {
      const b = document.createElement('i');
      b.className = 'hatch-bit rain';
      b.textContent = i % 2 ? '★' : '✦';
      b.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
      b.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
      b.style.setProperty('--c', i % 3 ? '#ffd257' : '#ffffff');
      b.style.animationDelay = `${(0.2 + Math.random() * 1.4).toFixed(2)}s`;
      top.appendChild(b);
    }
  }
}

function clearBits(): void {
  $('hatch-top').querySelectorAll('.hatch-bit').forEach((b) => b.remove());
}

/**
 * たまごが かえる。レア度が高いほど 長く・はでにする。
 *
 * 1. 白い たまごが出て、コトコト ゆれる
 * 2. レア度の段の数だけ、ゆれて 色が変わる（光・うしろの光のすじも 段ごとに ふえる）
 * 3. ひびが入って われる → 結果の札。うしろの光と きらきらは レア度で変える
 *
 * かえった子は rollPetEgg の時点で もう記録してある。演出は見せかただけで、
 * 途中で何が起きても なかまは なくならない。何回も割る子のために、
 * 画面を タップすると すぐ結果へ とべる。動きを へらす設定のときは たまごを出さない。
 *
 * `after` は 結果を出したときに呼ぶ。牧場と一覧を 先に作りなおすと、
 * たまごが われる前に うしろの牧場を 新しい子が歩きだして 中身が ばれる。
 */
function showRoll(roll: PetRoll, after: () => void): void {
  stopHatch();
  clearBits();
  const r = rarityDef(roll.pet.rarity);
  const rank = Math.max(
    RARITIES.findIndex((x) => x.id === roll.pet.rarity),
    0,
  );
  const badge = $('pet-rarity');
  badge.textContent = r.label;
  badge.style.setProperty('--rc', r.color);
  badge.style.setProperty('--rs', r.soft);
  $('pet-got').textContent = roll.pet.name;
  $('pet-result-note').textContent = roll.dup
    ? `なかよし度アップ！（♥${roll.friend}）　コインが ${roll.refund} もどってきた`
    : `${roll.pet.note}${roll.equipped ? '' : '（つれて歩く子は そのまま）'}`;
  $('pet-result-head').textContent = roll.dup ? 'また あえたね！' : 'なかまに なった！';

  const ov = $('overlay-pet');
  ov.classList.toggle('legend', roll.pet.rarity === 'ur');
  const c = $<HTMLCanvasElement>('pet-result-canvas');
  paintPetIcon(c, roll.pet.art, 132);

  const sheet = $('pet-sheet');
  const stage = $('hatch-stage');
  const egg = $('hatch-egg');
  const say = $('hatch-say');

  /** たまごの色・光と、うしろの光（光のすじは スーパーレアの段から）を その段に そろえる */
  const tint = (step: number): void => {
    const t = EGG_TINTS[step];
    egg.style.setProperty('--egg', t.egg);
    egg.style.setProperty('--egg-hi', t.hi);
    egg.style.setProperty('--egg-spot', t.spot);
    egg.style.setProperty('--glow', EGG_GLOW[step]);
    egg.style.setProperty('--glow-r', `${step * 9}px`);
    ov.dataset.fx = RARITIES[step].id;
    ov.style.setProperty('--fx', RARITIES[step].color);
  };

  let opened = false;
  const reveal = (): void => {
    stopHatch();
    tint(rank);
    ov.classList.remove('hatching');
    stage.hidden = true;
    sheet.hidden = false;
    hatchBurst(rank, r.color);
    revealedAt = performance.now();
    if (rank === 3) sfx.legend();
    else if (rank === 2) sfx.fanfare();
    else {
      if (!opened) sfx.crack();
      if (rank === 1) sfx.sparkle();
    }
    after();
  };

  ov.hidden = false;
  if (stillMotion()) {
    reveal();
    return;
  }

  ov.classList.add('hatching');
  sheet.hidden = true;
  stage.hidden = false;
  egg.classList.remove('cracking', 'open');
  tint(0);
  eggMove(egg, 'in');
  say.textContent = 'あれ？ たまごが…';
  skipHatch = reveal;

  let t = 450;
  hatchLater(() => {
    eggMove(egg, 'wobble');
    sfx.eggWobble();
  }, t);
  t += 700;
  for (let s = 1; s <= rank; s++) {
    const step = s;
    hatchLater(() => {
      tint(step);
      eggMove(egg, 'shake');
      hatchFlash(EGG_TINTS[step].hi);
      say.textContent = EGG_STEP_SAY[step];
      sfx.eggGlow(step);
    }, t);
    // でんせつの 手前は ひと呼吸 長く ためる
    t += step === 2 && rank === 3 ? 1150 : 850;
  }
  hatchLater(() => {
    egg.classList.add('cracking');
    eggMove(egg, 'wobble');
    say.textContent = 'うまれる！';
    sfx.eggWobble();
  }, t);
  t += 600;
  hatchLater(() => {
    opened = true;
    egg.classList.add('open');
    hatchFlash(rank === 3 ? '#fff6d0' : '#ffffff');
    sfx.crack();
  }, t);
  t += 330;
  hatchLater(reveal, t);
}

export function initRanch(): void {
  // 牧場の子をさわれるようにする
  const pasture = $<HTMLCanvasElement>('pasture');
  pasture.addEventListener('pointerdown', (e) => {
    const rect = pasture.getBoundingClientRect();
    pokeRanch(e.clientX - rect.left, e.clientY - rect.top);
  });

  const open = (shiny: boolean) => {
    const roll = rollPetEgg(shiny);
    if (!roll) return;
    showRoll(roll, () => {
      renderRanch();
      onChange?.();
    });
  };

  // たまごの演出中は、どこを タップしても すぐ結果へ とぶ
  $('overlay-pet').addEventListener('pointerdown', () => skipHatch?.());

  $('pet-egg').addEventListener('click', () => open(false));
  $('pet-egg-shiny').addEventListener('click', () => open(true));

  // どうぐを置く。置いた どうぐに、いちばん近い子が すぐ あそびにいく
  $('toy-buy').addEventListener('click', () => {
    const toy = buyNextToy();
    if (!toy) return;
    sfx.fanfare();
    $('pet-detail').textContent = `${toy.name}を おいた！ ${toy.note}`;
    const s = sizeOf(toy.depth);
    const x = (toy.id === 'ball' ? ball.x : toy.x) * ranchW;
    const y = yOf(toy.id === 'ball' ? ball.depth : toy.depth) - s * 0.8;
    burst(x, y, 8, false, '#ffd257');
    burst(x, y, 4, true, '#ff8aa0');
    if (toy.id === 'ball') {
      const w = nearestIdle(ball.x, ball.depth);
      if (w) w.goal = { kind: 'ball' };
    } else {
      const w = nearestIdle(toy.x, toy.depth);
      if (w) w.goal = { kind: 'toy', toy };
    }
    renderSpend();
    onChange?.();
  });

  // おやつ。押しても何も起きないボタンにはしない。買えないときは わけを言う
  $('snack-btn').addEventListener('click', () => {
    if (!ownedPets().length) {
      sfx.tap();
      $('pet-detail').textContent = 'たまごを わると なかまが やってくる';
      return;
    }
    const block = treatBlock('snack');
    if (block) {
      sfx.tap();
      $('pet-detail').textContent = block === 'day'
        ? 'おやつは また あした！ おなか いっぱい'
        : `あと ${TREAT_COST.snack - profile().coins} コインで おやつ`;
      return;
    }
    if (!useTreat('snack')) return;
    const sn = dropSnack();
    sfx.tap();
    $('pet-detail').textContent = `${SNACKS[sn.kind]}が おちてきた！`;
    renderSpend();
    onChange?.();
  });
  $('pet-close').addEventListener('click', () => {
    if (performance.now() - revealedAt < 600) return;
    sfx.tap();
    stopHatch();
    clearBits();
    $('overlay-pet').hidden = true;
  });

  $('pet-egg-cost').textContent = String(PET_EGG_COST);
  $('pet-egg-shiny-cost').textContent = String(PET_EGG_SHINY_COST);
  $('toy-cost').textContent = String(TOY_COST);
  $('snack-cost').textContent = String(TREAT_COST.snack);
  $('dup-note').textContent = `おなじ子が でたら なかよし度アップ＋${DUP_REFUND}コイン`;
}
