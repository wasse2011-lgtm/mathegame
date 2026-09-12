/**
 * ミニゲーム。走らない れんしゅう場。
 *
 * 本編はどこも「式を読む → 3〜4つの答えから選ぶ → 時間内に跳ぶ」の一本で、
 * 手ざわりが同じものしかない。ここだけは
 *   ・時間切れが無い
 *   ・答えそのものではなく「いくつ見えたか」「10 の相手」「分けかた」を聞く
 * ようにしてある。
 *
 * つまずきは1か所ではなく下から積み上がっているので、3つをその層に当てる。
 *   いくつ？       … 数をかたまりで見る（W1〜W2 の下地）
 *   ペアあわせ     … 10 の合成（W3。繰り上がりの前提）
 *   さくらんぼ わけ … 繰り上がりの分解（W5）
 *
 * **ここでの正解・不正解は、習熟度にも★にも図鑑にも反映しない。**
 * ペアあわせは手あたりしだいに押しても そのうち当たるし、さくらんぼは
 * まちがえてもその場でやり直す。どちらも「おぼえたか」の証拠にはならない。
 * 記録を動かすのは本編（ランナー）だけ、という線をここでも守る。
 * 逆に、出す式を選ぶときは記録を**読む**（にがてな式から先に出す）。
 *
 * 出るのはコインだけ。1日1回めだけ多めにして、あとは少額にしてある。
 * ここを稼ぎ場にすると、いちばん短いミニゲームを回すのがコインの最適解になり、
 * 走る理由が消える（ステージの周回に REPLAY_RATE を置いたのと同じ理由）。
 */

import { sfx } from './audio';
import { cherry, type Cherry, type Fact } from './curriculum';
import { HurdleGame } from './hurdle';
import { distractorPool, weakestFacts } from './questions';
import {
  MINI_AGAIN,
  MINI_FIRST,
  MINI_JUMP_AGAIN,
  MINI_JUMP_CAP,
  MINI_PERFECT,
} from './rewards';
import {
  addPlayTime,
  markMiniDone,
  miniDoneToday,
  overDailyLimit,
  persist,
  profile,
  save,
} from './save';
import { currentLook } from './sprites';
import { cherryArt, dotsArt, frameArt, splitArt } from './tenframe';

export type MiniId = 'count' | 'pair' | 'cherry' | 'hurdle' | 'ruler';

export interface MiniEnv {
  /** いま出してよい式（解放ずみのワールドぜんぶ）。にがてな順に選ぶ材料 */
  facts: () => Fact[];
  /** そのワールドが解放されているか。ミニゲームを開ける条件に使う */
  unlocked: (worldId: number) => boolean;
  /** コインが動いた（ホームやリザルトのコイン表示を作りなおす） */
  onCoins: () => void;
  /** 一覧で ← を押した（ホームへ戻す） */
  onExit: () => void;
}

interface MiniDef {
  id: MiniId;
  name: string;
  sub: string;
  /** 見出しに出す短いほう。sub は長いと1行に入らず、途中で切れる */
  short: string;
  emoji: string;
  /** 遊べないときの理由。遊べるなら null */
  locked: () => string | null;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const svg$ = (id: string): SVGElement => document.getElementById(id) as unknown as SVGElement;

let env: MiniEnv;

const GAMES: MiniDef[] = [
  {
    id: 'count',
    name: 'いくつ？',
    sub: 'ぱっと 見て、いくつか あてる',
    short: 'ぱっと 見て あてる',
    emoji: '👀',
    locked: () => null,
  },
  {
    id: 'pair',
    name: 'ペアあわせ',
    sub: 'たして きりのいい かずに なる 2まいを さがす',
    short: '2まいで きりのいい かず',
    emoji: '🍎',
    locked: () => null,
  },
  {
    id: 'cherry',
    name: 'さくらんぼ わけ',
    sub: 'くりあがりを 10 と のこりに わける',
    short: '10 と のこりに わける',
    emoji: '🍒',
    // W5（くりあがり やま）に着く前は、まだ習っていない式しか出せない
    locked: () => (env.unlocked(5) ? null : 'くりあがり やま に つくと あそべる'),
  },
  {
    id: 'hurdle',
    name: 'ぴょんぴょん ハードル',
    sub: 'おおきい かずから かぞえて、のこりの かずだけ とぶ',
    short: 'かぞえながら とぶ',
    emoji: '🏃',
    // やさしい式でも「跳んだ数＝答え」は成立するので、ここは開けておく。
    // むずかしさはレベル帯（HURDLE_LEVELS）のほうで区切る
    locked: () => null,
  },
  {
    id: 'ruler',
    name: 'かずの ものさし',
    sub: 'その かずが どこか、せんの うえで あてる',
    short: 'せんの うえで あてる',
    emoji: '📏',
    locked: () => null,
  },
];

// ------------------------------------------------------------------ 後始末

/**
 * 出しっぱなしのタイマー。子どもは演出を待たずに ← を押すので、
 * 画面を離れるときに必ず全部止める（止め忘れると、別の画面で盤面が動く）。
 */
const timers: number[] = [];

function later(fn: () => void, ms: number): void {
  timers.push(window.setTimeout(fn, ms));
}

function clearTimers(): void {
  while (timers.length) clearTimeout(timers.pop());
}

/**
 * 遊んだ時間。ここも「1日にあそべる時間」に数える。
 *
 * 数えないと、上限をつけた家庭で「本編は終わりでも ミニゲームは無限」になり、
 * 親の設定が意味を持たなくなる。ランナーとちがって毎フレーム進めていないので、
 * ひらいてから閉じるまでの実時間で数える。裏に回したまま放置されたぶんまで
 * 数えないよう、1回ぶんは 10分で頭打ちにする。
 */
const PLAY_CAP_SEC = 600;
let startedAt = 0;

function countPlayTime(): void {
  if (!startedAt) return;
  const sec = Math.min((performance.now() - startedAt) / 1000, PLAY_CAP_SEC);
  startedAt = 0;
  addPlayTime(sec);
}

// ------------------------------------------------------------------ 共通の見た目

function shake(el: HTMLElement): void {
  el.classList.remove('ng');
  // クラスを付けなおすだけでは同じアニメが再生されない。1フレーム空ける
  requestAnimationFrame(() => el.classList.add('ng'));
  later(() => el.classList.remove('ng'), 500);
}

/** 10マスの絵を出す。絵にできない式では、何も出さずに黙る */
function showFrame(fact: Fact, blank: boolean): void {
  const art = frameArt(fact, blank);
  if (!art) return;
  const frame = svg$('mini-frame');
  frame.setAttribute('viewBox', art.viewBox);
  frame.innerHTML = art.svg;
  $('mini-hint-text').textContent = art.text;
  $('mini-hint').hidden = false;
}

function hideFrame(): void {
  $('mini-hint').hidden = true;
}

function say(text: string): void {
  $('mini-say').textContent = text;
}

/** のこりの数を、まるで見せる。ぜんぶ消えたら おしまい */
function renderPips(total: number, done: number): void {
  const box = $('mini-pips');
  box.replaceChildren();
  for (let i = 0; i < total; i++) {
    const p = document.createElement('i');
    if (i < done) p.className = 'done';
    box.appendChild(p);
  }
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------------------------------------------------------------------ ごほうび

/**
 * やりきったときのコイン。1日1回めだけ多い。
 *
 * jumped を渡すと「拾った枚数をそのまま」の道に入る（ハードル専用）。
 * そちらは上限つきで、2回め以降は薄くする。理由は rewards.ts に書いてある。
 */
function payout(id: MiniId, perfect: boolean, jumped?: number): { coins: number; first: boolean } {
  const first = !miniDoneToday(id);
  const capped = jumped === undefined ? 0 : Math.min(jumped, MINI_JUMP_CAP);
  const coins =
    jumped === undefined
      ? (first ? MINI_FIRST : MINI_AGAIN) + (perfect ? MINI_PERFECT : 0)
      : // 1回も きれいに跳べなくても 0 にはしない。0 は「もう やってもむだ」になる
        Math.max(MINI_AGAIN, first ? capped : Math.round(capped * MINI_JUMP_AGAIN));
  if (first) markMiniDone(id);
  profile().coins += coins;
  persist();
  env.onCoins();
  // ここの見出しのコインも増やす（onCoins が作りなおすのはホームとリザルト）
  $('mini-coins').textContent = String(profile().coins);
  return { coins, first };
}

/** いま遊んでいるゲーム。「もういちど」で使う（openGame が必ず上書きする） */
let current: MiniId = 'count';

function finish(id: MiniId, perfect: boolean, note: string, jumped?: number): void {
  countPlayTime();
  const { coins, first } = payout(id, perfect, jumped);
  sfx.clear();
  $('mini-clear-head').textContent = perfect ? 'ぜんぶ せいかい！' : 'できた！';
  $('mini-clear-coins').textContent = `+${coins}`;
  $('mini-clear-note').textContent = first
    ? note
    : `${note}（きょうの ごほうびは もらいずみ）`;
  $('overlay-mini').hidden = false;
}

// ------------------------------------------------------------------ ペアあわせ

interface PairLevel extends Level {
  target: number;
  /** 場に出す数。かならず ペアになる組みあわせで書く */
  cards: number[];
}

/**
 * 10 の合成は 1+9 〜 5+5 の 5とおりしかないので、1回で全部が場に出る。
 * 毎回おなじ顔ぶれになるが、そこは狙い（自動化するまで繰り返す場）。
 * 20 は「11+9」のような、くりあがりの形をそのまま2枚にしたもの。
 */
const PAIR_LEVELS: PairLevel[] = [
  { target: 5, label: '5 を つくる', cards: [1, 4, 2, 3, 1, 4, 2, 3], need: 0 },
  { target: 10, label: '10 を つくる', cards: [1, 9, 2, 8, 3, 7, 4, 6, 5, 5], need: 0 },
  // 2けた＋1けたのくりあがり（W7）の形。W6 に着いてから出す
  { target: 20, label: '20 を つくる', cards: [11, 9, 12, 8, 13, 7, 14, 6, 15, 5], need: 6 },
];

interface PairCard {
  v: number;
  gone: boolean;
  el: HTMLButtonElement;
}

let pairLevel = 1;

function startPair(): void {
  const level = PAIR_LEVELS[pairLevel];
  const values = shuffle([...level.cards]);
  const cards: PairCard[] = [];
  let picked = -1;
  let found = 0;
  let misses = 0;
  const pairs = values.length / 2;

  $('mini-goal').textContent = `たして ${level.target}`;
  say(`${level.target} に なる 2まいを さがそう`);
  hideFrame();
  renderPips(pairs, 0);

  const board = $('mini-body');
  board.className = 'mini-body pair';
  board.replaceChildren();

  const hintFor = (i: number): void => {
    const v = cards[i].v;
    // 「v と いくつで target?」。空きマスの数がそのまま答えの形になる
    showFrame({ a: v, b: level.target - v }, true);
  };

  const tap = (i: number): void => {
    const card = cards[i];
    if (card.gone) return;

    if (picked === i) {
      picked = -1;
      card.el.classList.remove('picked');
      hideFrame();
      say(`${level.target} に なる 2まいを さがそう`);
      sfx.tap();
      return;
    }

    if (picked < 0) {
      picked = i;
      card.el.classList.add('picked');
      say(`${card.v} と いくつで ${level.target}？`);
      sfx.tap();
      return;
    }

    const first = cards[picked];
    if (first.v + card.v === level.target) {
      sfx.correct(found);
      say(`${first.v} と ${card.v} で ${level.target}！`);
      for (const c of [first, card]) {
        c.gone = true;
        c.el.classList.remove('picked');
        c.el.classList.add('gone');
        c.el.disabled = true;
      }
      picked = -1;
      found++;
      hideFrame();
      renderPips(pairs, found);
      if (found === pairs) {
        later(() => {
          finish(
            'pair',
            misses === 0,
            misses === 0 ? 'ひとつも まちがえなかった！' : `${level.target} の ペアを ${pairs}くみ そろえた`,
          );
        }, 450);
      }
      return;
    }

    // ちがった。最初の1枚は選んだままにする（また選びなおす手間をかけない）
    misses++;
    sfx.wrong();
    shake(card.el);
    say(`${first.v} と ${card.v} では ${level.target} に ならないね`);
    hintFor(picked);
  };

  values.forEach((v, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mcard';
    b.textContent = String(v);
    b.addEventListener('click', () => tap(i));
    board.appendChild(b);
    cards.push({ v, gone: false, el: b });
  });

  $('mini-hint-btn').hidden = false;
  $('mini-hint-btn').onclick = () => {
    sfx.tap();
    if (picked < 0) {
      say('まず 1まい えらんでね');
      return;
    }
    hintFor(picked);
  };

  // 前のゲームのボタンを残さない（隠すだけだと、読み上げには残る）
  $('mini-choices').replaceChildren();
  $('mini-choices').hidden = true;
  renderChips(PAIR_LEVELS, pairLevel, (i) => {
    pairLevel = i;
    startPair();
  });
}

/**
 * むずかしさを選ぶ帯。
 * 先のものも、開いていないと分かる形で見せる（次に何が来るかが見えるほうが進みたくなる）。
 */
interface Level {
  label: string;
  /** 遊べるようになるワールド。0 は最初から */
  need: number;
}

function renderChips(list: Level[], at: number, pick: (i: number) => void): void {
  const row = $('mini-levels');
  row.hidden = false;
  row.replaceChildren();
  list.forEach((lv, i) => {
    const open = lv.need === 0 || env.unlocked(lv.need);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-selected', String(i === at));
    b.textContent = open ? lv.label : `${lv.label} 🔒`;
    b.disabled = !open;
    b.addEventListener('click', () => {
      sfx.tap();
      pick(i);
    });
    row.appendChild(b);
  });
}

// ------------------------------------------------------------------ いくつ？

/**
 * 玉を見せている時間。
 *
 * 数えきる前に隠れる長さにしてある。1つずつ数えるのではなく
 * 「5と2で7」のように かたまりで見る（サビタイジング）ための場なので、
 * ゆっくり数えられる長さにすると、ねらいが変わってしまう。
 * 見のがしても ヒントで見なおせるので、こわい設定にはならない。
 *
 * ただし 6こ以上は、ひとかたまりでは見えない（人が一度に つかめるのは 5こまで）。
 * 「5と2」の2かたまりに割って、足しなおす手間がそのぶん増えるので、
 * 玉が1つ増えるごとに 90ms だけ足す。数えきれる長さにはしない（上限つき）。
 */
const PEEK_MS = 1500;
const PEEK_STEP_MS = 90;
const PEEK_MAX_MS = 2300;
const COUNT_ROUNDS = 6;

export function peekMs(n: number): number {
  return n <= 5 ? PEEK_MS : Math.min(PEEK_MS + (n - 5) * PEEK_STEP_MS, PEEK_MAX_MS);
}

const COUNT_LEVELS: (Level & { min: number; max: number })[] = [
  { label: '1〜5', min: 1, max: 5, need: 0 },
  { label: '1〜10', min: 1, max: 10, need: 0 },
  // 10 のまとまりが見えるようになってから（W4 = じゅう の まち）
  { label: '10より おおきい', min: 11, max: 18, need: 4 },
];

let countLevel = 1;

function startCount(): void {
  const level = COUNT_LEVELS[countLevel];
  let at = 0;
  let misses = 0;

  const board = $('mini-body');
  board.className = 'mini-body count';
  board.replaceChildren();
  const art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  art.setAttribute('class', 'tenframe mini-dots');
  art.setAttribute('aria-hidden', 'true');
  board.appendChild(art);

  $('mini-goal').textContent = 'いくつ？';
  $('mini-choices').hidden = false;
  $('mini-hint-btn').hidden = false;
  hideFrame();

  const paint = (n: number, show: boolean): void => {
    const a = dotsArt(n, show);
    art.setAttribute('viewBox', a.viewBox);
    art.innerHTML = a.svg;
  };

  const round = (): void => {
    renderPips(COUNT_ROUNDS, at);
    if (at >= COUNT_ROUNDS) {
      $('mini-choices').replaceChildren();
      finish(
        'count',
        misses === 0,
        misses === 0 ? 'ひとつも まちがえなかった！' : `${COUNT_ROUNDS}かい あてられた`,
      );
      return;
    }

    const n = level.min + Math.floor(Math.random() * (level.max - level.min + 1));
    // 玉が多いほど、見せる時間を少しだけ延ばす（peekMs のコメントを見る）
    const peek = peekMs(n);
    paint(n, true);
    say('よく 見てね…');
    later(() => {
      paint(n, false);
      say('いくつ だった？');
    }, peek);

    $('mini-hint-btn').onclick = () => {
      sfx.tap();
      paint(n, true);
      later(() => paint(n, false), peek);
    };

    const box = $('mini-choices');
    box.replaceChildren();
    for (const v of nearChoices(n, 20)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mchoice';
      b.textContent = String(v);
      b.addEventListener('click', () => {
        if (v !== n) {
          misses++;
          sfx.wrong();
          shake(b);
          // まちがえたら もう一度見せる。当てずっぽうを続けさせない
          paint(n, true);
          say('もう いちど 見てみよう');
          later(() => paint(n, false), peek);
          return;
        }
        sfx.correct(at);
        paint(n, true);
        say(`${n} こ！`);
        at++;
        box.replaceChildren();
        later(round, 800);
      });
      box.appendChild(b);
    }
  };

  renderChips(COUNT_LEVELS, countLevel, (i) => {
    countLevel = i;
    startCount();
  });
  round();
}

// ------------------------------------------------------------------ さくらんぼ わけ

const CHERRY_ROUNDS = 5;

/** 3つの答えを作る。答えのまわりの数から2つ選ぶ */
function nearChoices(answer: number, max: number): number[] {
  const pool: number[] = [];
  for (const v of [answer + 1, answer - 1, answer + 2, answer - 2, answer + 3]) {
    if (v > 0 && v <= max && v !== answer && !pool.includes(v)) pool.push(v);
  }
  return shuffle([answer, ...shuffle(pool).slice(0, 2)]);
}

/** 「10 と のこりで？」の誤答は、本編と同じ「ありがちな間違い」から取る */
function sumChoices(f: Fact): number[] {
  const sum = f.a + f.b;
  const wrong = distractorPool(f.a, f.b, sum)
    .sort((x, y) => x.tier - y.tier)
    .slice(0, 4)
    .map((d) => d.v);
  return shuffle([sum, ...shuffle(wrong).slice(0, 2)]);
}

function startCherry(): void {
  // くりあがる 1けたどうしだけを相手にする。2けたが混ざると さくらんぼの絵が
  // 「27 を 3 と 24 に分ける」になり、元の式より読みにくくなる
  const pool = env.facts().filter((f) => f.a < 10 && f.b < 10 && cherry(f) !== null);
  const facts = weakestFacts(pool, CHERRY_ROUNDS);
  // 解放条件があるので空にはならないはずだが、空のまま進むと1問目で止まる
  if (!facts.length) {
    renderMiniList();
    return;
  }
  let at = 0;
  let step = 0;
  let misses = 0;

  const board = $('mini-body');
  board.className = 'mini-body cherry';
  board.replaceChildren();
  const art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  art.setAttribute('class', 'mini-cherry');
  art.setAttribute('aria-hidden', 'true');
  // 10マスの絵。ここでは「ヒント」ではなく盤面の一部なので、いつも出しておく。
  // ボタンの奥に隠していたころは、まだ字の読めない子が最後まで押さないまま
  // 記号（さくらんぼ）だけを見て当てずっぽうを続けていた。
  const frame = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  frame.setAttribute('class', 'tenframe cherry-frame');
  frame.setAttribute('aria-hidden', 'true');
  board.append(art, frame);

  // むずかしさは、にがてな式のほうで自動的に決まる。選ばせるものが無い
  $('mini-levels').replaceChildren();
  $('mini-levels').hidden = true;
  $('mini-choices').hidden = false;
  // 絵が出しっぱなしなので、ヒントのボタンと枠は使わない
  $('mini-hint-btn').hidden = true;
  hideFrame();

  /**
   * いまの手に合う 10マスの絵。
   *
   * くりあがりの絵（frameArt の carry）は「8 に 2 を あげて 10、のこり 3」と
   * 3手ぶん全部を描いてしまうので、前の2手は「あと いくつ」の形に置きかえる。
   * 数えれば分かるが、聞いていることの先までは描かない。
   */
  const paintFrame = (c: Cherry, f: Fact): void => {
    // 2手めは「other を need と いくつに わける」。ここだけ 10マスではなく
    // other の数ぶんの枠にする（10マスだと、聞いていない残りのマスまで数える）
    const a =
      step === 0
        ? frameArt({ a: c.base, b: c.need }, true)
        : step === 1
          ? splitArt(c.other, c.need)
          : frameArt(f, false);
    if (!a) return;
    // 1れつの絵は、そのままだと高さいっぱいまで伸びて マスだけ倍の大きさになる。
    // 手が進んでもマスの大きさが変わらないよう、1れつのときは低く抑える
    frame.classList.toggle('row1', step === 1);
    frame.setAttribute('viewBox', a.viewBox);
    frame.innerHTML = a.svg;
  };

  /** まちがえたとき。絵のほうを1回ゆらして「ここを見て」と言う */
  const nudgeArt = (): void => {
    board.classList.remove('look');
    requestAnimationFrame(() => board.classList.add('look'));
    later(() => board.classList.remove('look'), 700);
  };

  const ask = (): void => {
    const f = facts[at];
    const c = cherry(f);
    if (!c) {
      // cherry() が null の式はプールから外してあるので、ここには来ない。
      // 万一来ても止まらないよう、次の式へ送る
      next();
      return;
    }
    renderPips(facts.length, at);
    $('mini-goal').textContent = `${f.a} + ${f.b} = ?`;
    const cy = cherryArt(c, step === 0 ? 0 : step === 1 ? 1 : 2);
    art.setAttribute('viewBox', cy.viewBox);
    art.innerHTML = cy.svg;
    paintFrame(c, f);

    if (step === 0) {
      say(`${c.base} は あと いくつで ${c.ten}？`);
      choices(nearChoices(c.need, 9), c.need);
    } else if (step === 1) {
      say(`${c.other} を ${c.need} と いくつに わける？`);
      choices(nearChoices(c.rest, 9), c.rest);
    } else {
      say(`${c.ten} と ${c.rest} で？`);
      choices(sumChoices(f), f.a + f.b);
    }
  };

  const next = (): void => {
    at++;
    step = 0;
    hideFrame();
    if (at >= facts.length) {
      renderPips(facts.length, facts.length);
      $('mini-choices').replaceChildren();
      finish(
        'cherry',
        misses === 0,
        misses === 0 ? 'ひとつも まちがえなかった！' : `くりあがりを ${facts.length}もん わけられた`,
      );
      return;
    }
    ask();
  };

  const choices = (list: number[], answer: number): void => {
    const box = $('mini-choices');
    box.replaceChildren();
    for (const v of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mchoice';
      b.textContent = String(v);
      b.addEventListener('click', () => {
        if (v !== answer) {
          misses++;
          sfx.wrong();
          shake(b);
          // 絵はもう出ている。「そっちを見て」とだけ言う（答えは言わない）
          nudgeArt();
          return;
        }
        sfx.correct(step);
        if (step < 2) {
          step++;
          ask();
          return;
        }
        // さいごの1手。式が つながったところを見せてから、つぎへ
        const f = facts[at];
        $('mini-goal').textContent = `${f.a} + ${f.b} = ${f.a + f.b}`;
        say('そのとおり！');
        box.replaceChildren();
        later(next, 900);
      });
      box.appendChild(b);
    }
  };

  ask();
}

// ------------------------------------------------------------------ ぴょんぴょん ハードル

interface HurdleLevel extends Level {
  /** 出す式の 和のはんい */
  min: number;
  max: number;
  endless?: boolean;
}

/**
 * ロックはゲーム単位ではなくここで区切る。やさしい式でも「えらんだ数から
 * 数え足す」は成立するので、初日から遊べたほうがこのゲームの目的に合う。
 */
const HURDLE_LEVELS: HurdleLevel[] = [
  { label: '10まで とぶ', min: 4, max: 10, need: 0 },
  { label: '20まで とぶ', min: 11, max: 18, need: 5 },
  { label: 'どこまで とべる？', min: 0, max: 0, endless: true, need: 5 },
];

const HURDLE_ROUNDS = 5;

/** 「どちらから かぞえる？」のボタンが押せるようになるまでの間（連打よけ） */
const PICK_GUARD_MS = 450;

let hurdleLevel = 0;
let hurdle: HurdleGame | null = null;
let hurdleCanvas: HTMLCanvasElement | null = null;
/** どちらの数から数えているか（0 = 左、1 = 右）。式が変わるたびに消す */
let hurdleFrom: 0 | 1 | null = null;

/**
 * `8 + 5 = ?` と、答えが出たあとの `8 + 5 = 13`。
 * 数えはじめに えらんだほうの数には印をつける（頭の上の数と結びつける）。
 */
function hurdleGoal(f: Fact, sum: number | null): void {
  const box = $('mini-goal');
  const num = (v: number, at: 0 | 1): HTMLElement => {
    const el = document.createElement('span');
    el.className = hurdleFrom === at ? 'hnum on' : 'hnum';
    el.textContent = String(v);
    return el;
  };
  const b = document.createElement('b');
  b.className = sum === null ? 'hq' : 'hq got';
  b.textContent = sum === null ? '?' : String(sum);
  box.replaceChildren(num(f.a, 0), ' + ', num(f.b, 1), ' = ', b);
}

function hurdleDone(clean: number, jumped: number, best: boolean): void {
  const lv = HURDLE_LEVELS[hurdleLevel];
  let note: string;

  if (lv.endless) {
    const p = profile();
    const prev = p.hurdleBest;
    if (best) {
      p.hurdleBest = jumped;
      persist();
    }
    note = best
      ? `${jumped}こ！ さいこう きろく こうしん！`
      : `${jumped}こ とんだ（さいこう ${prev}こ）`;
  } else {
    note =
      clean === jumped
        ? `${jumped}かい ぜんぶ きれいに とべた！`
        : `${jumped}かい とんで、コインを ${clean}まい ひろった`;
  }

  finish('hurdle', clean === jumped, note, clean);
}

/**
 * canvas と エンジンは1つだけ作って使いまわす。
 * HurdleGame は作るときに window の resize を取るので、毎回 new すると
 * 1回あそぶごとにリスナーが1つ増える。
 */
function hurdleGame(): HurdleGame {
  if (!hurdle) {
    const canvas = document.createElement('canvas');
    canvas.id = 'mini-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    hurdleCanvas = canvas;
    // タップは画面ぜんたいで受ける。canvas だけにしていたころは指を置ける帯が
    // せますぎて、「押したのに跳ばない」がいちばん多いつまずきだった
    hurdle = new HurdleGame(canvas, $('screen-mini'), {
      onProgress: (at, total, f) => {
        if (f) hurdleGoal(f, null);
        if (total) renderPips(total, at);
      },
      /**
       * 「どちらの かずから かぞえる？」。
       * ここで選んだ数が頭の上に乗り、ハードルは のこりの数だけ流れてくる。
       * 小さいほうを選んでも走れる（そのぶんハードルが増えるだけ）。
       */
      onPick: (f) => {
        hurdleFrom = null;
        hurdleGoal(f, null);
        say('どちらの かずから かぞえる？');
        const box = $('mini-choices');
        box.hidden = false;
        box.replaceChildren();
        const btns: HTMLButtonElement[] = [];
        ([f.a, f.b] as const).forEach((v, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'mchoice from';
          b.textContent = String(v);
          // 跳ぶタップは画面ぜんたいで受ける。式が切りかわった瞬間に
          // 連打が続いていると、そのままボタンを踏んで勝手に選ばれてしまう。
          // ひと呼吸だけ受けつけない
          b.disabled = true;
          b.addEventListener('click', () => {
            sfx.tap();
            hurdleFrom = i as 0 | 1;
            hurdleGoal(f, null);
            box.replaceChildren();
            box.hidden = true;
            hurdle?.pick(v);
          });
          btns.push(b);
          box.appendChild(b);
        });
        later(() => btns.forEach((b) => { b.disabled = false; }), PICK_GUARD_MS);
      },
      onSay: say,
      onAnswer: (f, sum) => {
        // 子どもが自分の足で出した数が、そのまま ? の場所に入る瞬間
        hurdleGoal(f, sum);
        say(`${f.a} と ${f.b} で ${sum}！`);
      },
      onDone: (r) => hurdleDone(r.clean, r.jumped, r.best),
    });
  }
  return hurdle;
}

function startHurdle(): void {
  const lv = HURDLE_LEVELS[hurdleLevel];
  const game = hurdleGame();
  game.stop();

  const board = $('mini-body');
  board.className = 'mini-body hurdle';
  board.replaceChildren(hurdleCanvas as HTMLCanvasElement);

  // ボタンは「どちらから かぞえる？」のときだけ出る。
  // 前のゲームのものを残さない（隠すだけだと読み上げに残る）
  $('mini-choices').replaceChildren();
  $('mini-choices').hidden = true;
  $('mini-hint-btn').hidden = true;
  hurdleFrom = null;
  hideFrame();
  renderChips(HURDLE_LEVELS, hurdleLevel, (i) => {
    hurdleLevel = i;
    startHurdle();
  });

  const look = currentLook();
  const slow = save.settings.slow;

  // #mini-play を出したのと同じ処理の中で測ると、canvas の実寸が 0 になる。
  // 1フレームおいてから始める（本編の startRun と同じ）
  const begin = (go: () => void): void => {
    requestAnimationFrame(() => {
      if (current !== 'hurdle' || $('mini-play').hidden) return;
      go();
    });
  };

  if (lv.endless) {
    $('mini-goal').textContent = 'どこまで とべる？';
    $('mini-pips').replaceChildren();
    const best = profile().hurdleBest;
    say(best ? `さいこう ${best}こ。こえられる？` : 'ハートが なくなるまで！');
    begin(() => game.start({ mode: 'endless', best, slow, look }));
    return;
  }

  const pool = env
    .facts()
    .filter((f) => f.a < 10 && f.b < 10 && f.a + f.b >= lv.min && f.a + f.b <= lv.max);
  const facts = weakestFacts(pool, HURDLE_ROUNDS);
  // 解放ずみの式だけを見ているので、はんい外しか無い日はありうる
  if (!facts.length) {
    renderMiniList();
    return;
  }
  renderPips(facts.length, 0);
  hurdleGoal(facts[0], null);
  begin(() => game.start({ mode: 'facts', facts, slow, look }));
}

// ------------------------------------------------------------------ かずの ものさし

interface RulerLevel extends Level {
  max: number;
}

const RULER_LEVELS: RulerLevel[] = [
  { label: '0〜10', max: 10, need: 0 },
  // 10 が 20 のまん中、という関係が読めるようになってから（W4 = じゅう の まち）
  { label: '0〜20', max: 20, need: 4 },
  { label: '0〜100', max: 100, need: 6 },
];

const RULER_ROUNDS = 6;

export type RulerBand = 'hit' | 'near' | 'far';

/**
 * 置いた旗の近さ。
 *
 * 「ぴったり」は、いちばん近い整数が答えになる幅（±0.5）を下限にして、
 * 0〜100 のときだけ画面の細かさに合わせて広げる。1.5px を狙わせない。
 */
export function bandFor(guess: number, answer: number, max: number): RulerBand {
  const err = Math.abs(guess - answer);
  if (err <= Math.max(0.5, max * 0.04)) return 'hit';
  if (err <= Math.max(1.5, max * 0.1)) return 'near';
  return 'far';
}

let rulerLevel = 0;

/**
 * 目もりの刻みと、数字を書く間かく。
 *
 * 数字は「読める大きさ」を先に決めて、入る本数のほうを後から決めている。
 * 0〜100 で 10 ごとに数字を書くと、狭い画面では字を 0.7rem まで落とすことになり、
 * いちばん見せたいもの（線の上の数）がいちばん読みにくくなる。
 */
function rulerSteps(max: number): { tick: number; label: number } {
  if (max <= 10) return { tick: 1, label: 1 };
  if (max <= 20) return { tick: 1, label: 5 };
  return { tick: 10, label: 20 };
}

function startRuler(): void {
  const level = RULER_LEVELS[rulerLevel];
  const max = level.max;
  let at = 0;
  let misses = 0;
  let guess = -1;
  let locked = false;

  const board = $('mini-body');
  board.className = 'mini-body ruler';
  board.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'ruler-wrap';
  const band = document.createElement('div');
  band.className = `ruler-band${max > 20 ? ' wide' : ''}`;
  const line = document.createElement('div');
  line.className = 'ruler-line';
  const ticks = document.createElement('div');
  ticks.className = 'ruler-ticks';
  const fill = document.createElement('div');
  fill.className = 'ruler-fill';
  const flag = document.createElement('div');
  flag.className = 'ruler-flag';
  flag.hidden = true;
  flag.textContent = '🚩';
  const truth = document.createElement('div');
  truth.className = 'ruler-true';
  truth.hidden = true;
  const walk = document.createElement('div');
  walk.className = 'ruler-walk';
  walk.hidden = true;
  const walkFace = document.createElement('span');
  walkFace.className = 'rw-face';
  walkFace.textContent = '🐰';
  const walkNum = document.createElement('b');
  walkNum.textContent = '0';
  walk.append(walkFace, walkNum);

  // はしの数字。線の上に大きく置く。
  // 以前は線の下に小さい字で並べていたが、いちばん手がかりになる 0 と はしの数が
  // いちばん読みにくいという、さかさまなことになっていた
  const e0 = document.createElement('div');
  e0.className = 'ruler-end at0';
  e0.textContent = '0';
  const e1 = document.createElement('div');
  e1.className = 'ruler-end at1';
  e1.textContent = String(max);

  band.append(line, ticks, fill, e0, e1, flag, truth, walk);
  wrap.append(band);
  board.append(wrap);

  // まん中の印だけは、答える前から出す。
  // 0〜20 で 10 を見せるのは「10 は 20 のまん中」を教えるためで、これは狙い。
  // 目もりを全部出さないのは、そうすると「見積もる」ではなく「数える」になるから
  const mid = document.createElement('div');
  mid.className = 'ruler-mid';
  const midBar = document.createElement('i');
  const midLabel = document.createElement('span');
  midLabel.textContent = String(max / 2);
  mid.append(midBar, midLabel);
  band.append(mid);

  $('mini-levels').hidden = false;
  $('mini-choices').hidden = false;
  $('mini-hint-btn').hidden = true;
  hideFrame();

  const put = (v: number): void => {
    guess = Math.min(Math.max(v, 0), max);
    flag.hidden = false;
    flag.style.left = `${(guess / max) * 100}%`;
    // 置きなおすたびに はたが はずむ。「いま ここに置いた」を目で分かるようにする
    flag.classList.remove('drop');
    void flag.offsetWidth;
    flag.classList.add('drop');
  };

  band.addEventListener('pointerdown', (e) => {
    if (locked) return;
    const rect = band.getBoundingClientRect();
    if (rect.width < 2) return;
    put(((e.clientX - rect.left) / rect.width) * max);
    sfx.tap();
    ok.disabled = false;
  });

  /** 答え合わせのときだけ出す目もり。大きい目もりには数字を書く */
  const drawTicks = (): void => {
    ticks.replaceChildren();
    const { tick, label } = rulerSteps(max);
    for (let v = 0; v <= max; v += tick) {
      const i = document.createElement('i');
      i.style.left = `${(v / max) * 100}%`;
      const big = v % label === 0;
      if (big) i.className = 'big';
      ticks.appendChild(i);
      // はしの数字は最初から出ているので、ここでは書かない（重なる）
      if (!big || v === 0 || v === max) continue;
      const t = document.createElement('b');
      t.style.left = `${(v / max) * 100}%`;
      t.textContent = String(v);
      ticks.appendChild(t);
    }
  };

  /** 0 から答えまで、数えながら歩く。ふきだしはハードルと同じ「数の見せかた」 */
  const countTo = (answer: number, then: () => void): void => {
    const step = answer > 20 ? 10 : 1;
    walk.hidden = false;
    let v = 0;
    const hop = (): void => {
      v = Math.min(v + step, answer);
      walk.style.left = `${(v / max) * 100}%`;
      walkNum.textContent = String(v);
      fill.style.width = `${(v / max) * 100}%`;
      // 1歩ごとに ぴょんと跳ねる。数がふえる拍を、動きでも出す
      walk.classList.remove('hop');
      void walk.offsetWidth;
      walk.classList.add('hop');
      if (v >= answer) {
        later(then, 650);
        return;
      }
      later(hop, 110);
    };
    hop();
  };

  const ask = (): void => {
    renderPips(RULER_ROUNDS, at);
    if (at >= RULER_ROUNDS) {
      $('mini-choices').replaceChildren();
      finish(
        'ruler',
        misses === 0,
        misses === 0 ? 'ぜんぶ ちかかった！' : `${RULER_ROUNDS}かい あてられた`,
      );
      return;
    }

    locked = false;
    guess = -1;
    flag.hidden = true;
    truth.hidden = true;
    walk.hidden = true;
    walk.classList.remove('hop');
    band.classList.remove('hit');
    ticks.replaceChildren();
    fill.style.width = '0%';
    ok.disabled = true;

    // 3ラウンドめからは たし算。7 のあたりに旗を立ててから 5つぶん動かす、
    // という数直線の数え足しになる
    const useFact = at >= 2;
    const pool = env.facts().filter((f) => f.a + f.b <= max && f.a + f.b >= Math.max(3, max * 0.15));
    const fact = useFact && pool.length ? weakestFacts(pool, 1)[0] : null;
    const answer = fact ? fact.a + fact.b : 1 + Math.floor(Math.random() * max);

    $('mini-goal').textContent = fact ? `${fact.a} + ${fact.b} は どこ？` : `${answer} は どこ？`;
    say('せんを タップして、はたを たてよう');

    ok.onclick = () => {
      if (locked || guess < 0) return;
      locked = true;
      ok.disabled = true;
      sfx.tap();
      drawTicks();
      truth.hidden = false;
      truth.style.left = `${(answer / max) * 100}%`;
      truth.textContent = String(answer);

      const band2 = bandFor(guess, answer, max);
      if (band2 === 'far') misses++;
      countTo(answer, () => {
        if (band2 === 'hit') {
          sfx.correct(at);
          say('🎉 ぴったり！');
          // 当たったときは線ごと光らせる。数字が合っていたことを、色でも出す
          band.classList.add('hit');
        } else if (band2 === 'near') {
          sfx.correct(0);
          say('おしい、ちかい！');
        } else {
          sfx.wrong();
          say(`${answer} は ここだったね`);
        }
        at++;
        later(ask, 900);
      });
    };
  };

  const box = $('mini-choices');
  box.replaceChildren();
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-primary btn-xl';
  ok.textContent = 'これで いい';
  ok.disabled = true;
  box.appendChild(ok);

  renderChips(RULER_LEVELS, rulerLevel, (i) => {
    rulerLevel = i;
    startRuler();
  });
  ask();
}

// ------------------------------------------------------------------ 一覧と出入り

/** ミニゲームの一覧。きょうの ごほうびが残っているかも ここに出す */
export function renderMiniList(): void {
  hurdle?.stop();
  countPlayTime();
  $('mini-coins').textContent = String(profile().coins);
  $('mini-name').textContent = 'ミニゲーム';
  $('mini-desc').textContent = 'あそびながら たしざんが つよくなる';
  $('mini-play').hidden = true;
  $('overlay-mini').hidden = true;
  const list = $('mini-list');
  list.hidden = false;
  list.replaceChildren();

  for (const g of GAMES) {
    const why = g.locked();
    const done = miniDoneToday(g.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mini-card${why ? ' locked' : ''}${done ? ' done' : ''}`;
    b.disabled = Boolean(why);

    const face = document.createElement('span');
    face.className = 'mini-face';
    face.textContent = why ? '🔒' : g.emoji;

    const main = document.createElement('span');
    main.className = 'mini-main';
    const name = document.createElement('b');
    name.textContent = g.name;
    const sub = document.createElement('span');
    sub.textContent = why ?? g.sub;
    main.append(name, sub);

    const state = document.createElement('span');
    state.className = 'mini-state';
    state.textContent = why ? '' : done ? `+${MINI_AGAIN}` : `+${MINI_FIRST}`;

    b.append(face, main, state);
    b.addEventListener('click', () => {
      sfx.tap();
      openGame(g.id);
    });
    list.appendChild(b);
  }
}

function openGame(id: MiniId): void {
  clearTimers();
  // later() は setTimeout しか覚えていない。rAF はここで自分で止める
  hurdle?.stop();
  countPlayTime();
  // 上限に達したら、新しい1回は始めない（走るステージと同じ。途中では止めない）。
  // ここを見ないと「もういちど」を押しつづけるかぎり、いつまでも遊べてしまう
  if (overDailyLimit()) {
    env.onExit();
    return;
  }
  startedAt = performance.now();
  current = id;
  const def = GAMES.find((g) => g.id === id) ?? GAMES[0];
  $('mini-name').textContent = def.name;
  $('mini-desc').textContent = def.short;
  $('mini-list').hidden = true;
  $('mini-play').hidden = false;
  $('overlay-mini').hidden = true;
  // 裸の else にすると、知らない id が黙って1つのゲームに流れる。
  // switch なら、id を増やしたときに tsc が漏れを教えてくれる
  switch (id) {
    case 'count':
      startCount();
      break;
    case 'pair':
      startPair();
      break;
    case 'cherry':
      startCherry();
      break;
    case 'hurdle':
      startHurdle();
      break;
    case 'ruler':
      startRuler();
      break;
  }
}

/** ← を押した。ゲーム中なら一覧へ、一覧ならホームへ */
export function miniBack(): void {
  sfx.tap();
  // 一覧へ戻るときも ホームへ戻るときも、まず走りを止める。
  // 下の早期 return より前でないと、ホームに戻る道で止め忘れる
  hurdle?.stop();
  if ($('mini-play').hidden) {
    env.onExit();
    return;
  }
  clearTimers();
  renderMiniList();
}

/** 画面を離れるとき。動いているものを全部止め、遊んだ時間を記録する */
export function stopMini(): void {
  clearTimers();
  hurdle?.stop();
  countPlayTime();
  $('overlay-mini').hidden = true;
}

/** きょう まだ ごほうびが残っているミニゲームの数。ホームのカードに出す */
export function miniLeftToday(): number {
  return GAMES.filter((g) => !g.locked() && !miniDoneToday(g.id)).length;
}

export function initMini(e: MiniEnv): void {
  env = e;
  $('mini-back').addEventListener('click', miniBack);
  $('mini-again').addEventListener('click', () => {
    sfx.tap();
    openGame(current);
  });
  $('mini-other').addEventListener('click', () => {
    sfx.tap();
    clearTimers();
    hurdle?.stop();
    renderMiniList();
  });
}
