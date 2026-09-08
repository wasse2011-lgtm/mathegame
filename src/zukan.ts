/**
 * たしざん図鑑。1〜9 どうしの 81 通りを表にして、おぼえた式のマスが光る。
 *
 * この画面の役目は「勉強の進みを、そのままコレクションに見せる」こと。
 * 空いているマスが目に見えると、子どもは自分からそこを潰しに行く。
 *
 * ただし、棒グラフと表を置いただけでは子どもは見にこなかった。
 * 「見にいくと何かある」を2つ足してある。
 *
 *   1. **あたらしいカード** … 前に見たあとで おぼえた式が、光って NEW と出る。
 *      ホームの「ずかん」の行にも、その枚数が出る（開くと消える）。
 *   2. **ごほうび** … 9まいごとにコイン。おぼえた枚数でしか増えないので、
 *      ここを回して稼ぐことはできない（走って正解するのが唯一の増やしかた）。
 *
 * どちらも記録そのものは動かさない。★・習熟度・図鑑の判定は
 * ランナーの正解だけで決まる、という線はそのまま。
 */

import { sfx } from './audio';
import { BASIC_FACTS, ZUKAN_MAX, factKey, type Fact } from './curriculum';
import { MASTERED, isWeakFact } from './questions';
import { peekFact, persist, profile } from './save';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** ごほうびの区切り。81マスなので、ぜんぶで 9回もらえる */
export const ZUKAN_STEP = 9;
/** 1回ぶんのコイン。ガチャ1回（90）の3ぶんの1 */
export const ZUKAN_PRIZE = 30;

let onChange: (() => void) | null = null;

/** コインが動いたときに呼ぶコールバック（ホームの表示を作りなおす） */
export function onZukanChange(fn: () => void): void {
  onChange = fn;
}

export interface ZukanProgress {
  done: number;
  total: number;
}

export function zukanProgress(): ZukanProgress {
  const facts = profile().facts;
  let done = 0;
  for (const f of BASIC_FACTS) {
    if ((facts[factKey(f)]?.m ?? 0) >= MASTERED) done++;
  }
  return { done, total: BASIC_FACTS.length };
}

/** まだ見せていない「あたらしくおぼえたカード」の枚数。ホームの合図に使う */
export function zukanNewCount(): number {
  return profile().zukanNew.length;
}

/** いま受け取れる ごほうびの回数（0 なら まだ） */
export function zukanPrizeReady(): number {
  const p = profile();
  const earned = Math.floor(zukanProgress().done / ZUKAN_STEP);
  return Math.max(0, earned - p.zukanGot);
}

/** つぎの ごほうびまで あと何まいか。もらえる状態なら 0 */
function toNextPrize(): number {
  const { done, total } = zukanProgress();
  if (zukanPrizeReady() > 0) return 0;
  const next = (profile().zukanGot + 1) * ZUKAN_STEP;
  if (next > total) return 0;
  return next - done;
}

/**
 * この画面を開いているあいだ「あたらしい」として光らせるマス。
 *
 * profile 側はここで空にする（開いた時点で「見た」）。
 * ごほうびを受け取ると作りなおすので、枠のほうに控えておかないと
 * 光った直後に消えてしまう。
 */
let fresh = new Set<string>();

function stateOf(f: Fact): 'new' | 'mid' | 'done' {
  const s = peekFact(factKey(f));
  if (s.seen === 0) return 'new';
  return s.m >= MASTERED ? 'done' : 'mid';
}

/** いま「にがて」になっている式の数。子どもに見せる「たおすべき相手」の数 */
function weakCount(): number {
  let n = 0;
  for (const f of BASIC_FACTS) if (isWeakFact(f)) n++;
  return n;
}

function describe(f: Fact): string {
  const s = peekFact(factKey(f));
  if (s.seen === 0) return `${f.a} + ${f.b} は これから`;
  const parts = [s.m >= MASTERED ? 'おぼえた！' : 'れんしゅうちゅう', `${s.seen}かい`];
  if (s.ms) parts.push(`${(s.ms / 1000).toFixed(1)}びょう`);
  // にがては、まちがえた回数まで見せる。「あと何回たおせばいいか」が見える
  if (isWeakFact(f)) parts.push(`にがて（${s.miss}かい まちがえた）`);
  return `${f.a} + ${f.b} = ${f.a + f.b}　${parts.join('・')}`;
}

/**
 * ずかんを開く。ここでしか「あたらしいカード」の印は消さない。
 * （renderZukan はごほうびのたびに呼びなおすので、そちらで消すと1回しか光らない）
 */
export function openZukan(): void {
  const p = profile();
  fresh = new Set(p.zukanNew);
  if (p.zukanNew.length) {
    p.zukanNew = [];
    persist();
  }
  renderZukan();
}

export function renderZukan(): void {
  const { done, total } = zukanProgress();
  const weak = weakCount();
  $('zukan-desc').textContent = weak
    ? `おぼえた カード ${done} / ${total}　にがて ${weak}`
    : `おぼえた カード ${done} / ${total}`;
  $('zukan-bar2').style.width = `${(done / total) * 100}%`;
  $('zukan-detail').textContent = fresh.size
    ? `あたらしく ${fresh.size}まい おぼえた！ ひかっている マスだよ`
    : 'マスを タップすると くわしく みられます';

  // ごほうび。もらえるときだけ大きく出す
  const ready = zukanPrizeReady();
  const prize = $<HTMLButtonElement>('zukan-prize');
  prize.hidden = ready === 0;
  if (ready > 0) {
    $('zukan-prize-label').textContent = ready > 1 ? `ごほうびを もらう ×${ready}` : 'ごほうびを もらう';
    $('zukan-prize-sub').textContent = `カードを ${(profile().zukanGot + ready) * ZUKAN_STEP}まい おぼえた！`;
    $('zukan-prize-coins').textContent = String(ZUKAN_PRIZE * ready);
  }
  const left = toNextPrize();
  $('zukan-goal').textContent =
    ready > 0 ? '' : left > 0 ? `つぎの ごほうびまで あと ${left}まい` : 'ごほうびは ぜんぶ もらった！';

  const grid = $('zukan-grid');
  grid.replaceChildren();

  grid.style.setProperty('--cols', String(ZUKAN_MAX + 1));

  const corner = document.createElement('span');
  corner.className = 'zk-head corner';
  corner.textContent = '＋';
  grid.appendChild(corner);

  for (let b = 1; b <= ZUKAN_MAX; b++) {
    const h = document.createElement('span');
    h.className = 'zk-head';
    h.textContent = String(b);
    grid.appendChild(h);
  }

  for (let a = 1; a <= ZUKAN_MAX; a++) {
    const h = document.createElement('span');
    h.className = 'zk-head';
    h.textContent = String(a);
    grid.appendChild(h);

    for (let b = 1; b <= ZUKAN_MAX; b++) {
      const f = { a, b };
      const st = stateOf(f);
      const weakCell = isWeakFact(f);
      const isFresh = fresh.has(factKey(f));
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `zk ${st}${weakCell ? ' weak' : ''}${isFresh ? ' fresh' : ''}`;
      // 「あたらしい」マスは必ず答えを出す（おぼえたばかりの式なので）
      cell.textContent = st === 'new' && !isFresh ? '' : String(a + b);
      cell.setAttribute(
        'aria-label',
        `${a} たす ${b}${weakCell ? ' にがて' : ''}${isFresh ? ' あたらしく おぼえた' : ''}`,
      );
      cell.addEventListener('click', () => {
        sfx.tap();
        $('zukan-detail').textContent = describe(f);
        grid.querySelectorAll('.zk.sel').forEach((el) => el.classList.remove('sel'));
        cell.classList.add('sel');
      });
      grid.appendChild(cell);
    }
  }
}

export function initZukan(): void {
  $('zukan-prize').addEventListener('click', () => {
    const ready = zukanPrizeReady();
    if (ready <= 0) return;
    const p = profile();
    p.zukanGot += ready;
    p.coins += ZUKAN_PRIZE * ready;
    persist();
    sfx.clear();
    renderZukan();
    onChange?.();
  });
}
