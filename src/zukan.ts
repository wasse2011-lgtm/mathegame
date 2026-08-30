/**
 * たしざん図鑑。1〜9 どうしの 81 通りを表にして、おぼえた式のマスが光る。
 *
 * この画面の役目は「勉強の進みを、そのままコレクションに見せる」こと。
 * 空いているマスが目に見えると、子どもは自分からそこを潰しに行く。
 */

import { sfx } from './audio';
import { BASIC_FACTS, ZUKAN_MAX, factKey, type Fact } from './curriculum';
import { MASTERED } from './questions';
import { peekFact, profile } from './save';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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

function stateOf(f: Fact): 'new' | 'mid' | 'done' {
  const s = peekFact(factKey(f));
  if (s.seen === 0) return 'new';
  return s.m >= MASTERED ? 'done' : 'mid';
}

function describe(f: Fact): string {
  const s = peekFact(factKey(f));
  if (s.seen === 0) return `${f.a} + ${f.b} は これから`;
  const parts = [s.m >= MASTERED ? 'おぼえた！' : 'れんしゅうちゅう', `${s.seen}かい`];
  if (s.ms) parts.push(`${(s.ms / 1000).toFixed(1)}びょう`);
  return `${f.a} + ${f.b} = ${f.a + f.b}　${parts.join('・')}`;
}

export function renderZukan(): void {
  const { done, total } = zukanProgress();
  $('zukan-desc').textContent = `おぼえた カード ${done} / ${total}`;
  $('zukan-bar2').style.width = `${(done / total) * 100}%`;
  $('zukan-detail').textContent = 'マスを タップすると くわしく みられます';

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
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `zk ${st}`;
      cell.textContent = st === 'new' ? '' : String(a + b);
      cell.setAttribute('aria-label', `${a} たす ${b}`);
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
