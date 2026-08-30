/**
 * おうちのかた向けの画面。子ども側の導線には出さず、設定の中から入る。
 *
 * PIN を持たせると必ず忘れるので、関門は「大人なら暗算できる 2けたの足し算」にした。
 * 目的は子どもがうっかり入らないこと。厳密なロックではない。
 */

import { WORLDS, bossStage, type Fact } from './curriculum';
import { MASTERED } from './questions';
import { SAVE_KEY, freezeSave, persist, profile, save, stageStars, today } from './save';
import { zukanProgress } from './zukan';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const KEY = SAVE_KEY;

interface WeakFact {
  fact: Fact;
  miss: number;
  seen: number;
  ms: number;
  rate: number;
}

/** 一度でも出した式のうち、まちがいが多くて習熟度が低いものから並べる */
function weakList(limit: number): WeakFact[] {
  const facts = profile().facts;
  const out: WeakFact[] = [];
  for (const [key, s] of Object.entries(facts)) {
    if (!s || s.seen < 2 || s.miss === 0) continue;
    const [a, b] = key.split('+').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    out.push({ fact: { a, b }, miss: s.miss, seen: s.seen, ms: s.ms, rate: s.miss / s.seen });
  }
  out.sort((x, y) => y.rate - x.rate || y.miss - x.miss);
  return out.slice(0, limit);
}

function totalStars(): number {
  let n = 0;
  for (const w of WORLDS) {
    for (let s = 1; s <= bossStage(w); s++) n += stageStars(w.id, s);
  }
  return n;
}

export function renderParent(): void {
  const p = profile();
  const sec = p.play.date === today() ? p.play.sec : 0;
  $('p-time').textContent = sec < 60 ? `${sec} 秒` : `${Math.round(sec / 60)} 分`;

  const z = zukanProgress();
  $('p-zukan').textContent = `${z.done} / ${z.total}`;
  $('p-streak').textContent = `${p.daily.streak} 日`;
  $('p-stars').textContent = String(totalStars());

  const body = $('p-weak');
  body.replaceChildren();
  const weak = weakList(5);
  for (const w of weak) {
    const tr = document.createElement('tr');
    const cells = [
      `${w.fact.a} + ${w.fact.b}`,
      `${Math.round(w.rate * 100)}%`,
      `${w.seen}`,
      w.ms ? `${(w.ms / 1000).toFixed(1)}秒` : '-',
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  $('p-weak-note').textContent = weak.length
    ? 'まちがえた割合の高い順です。紙のドリルで補うならこの5つから。'
    : 'まだ十分なデータがありません。何ステージか遊ぶと出てきます。';

  $<HTMLSelectElement>('p-limit').value = String(save.settings.dailyLimitMin);
  $<HTMLInputElement>('p-slow').checked = save.settings.slow;

  try {
    $<HTMLTextAreaElement>('p-data').value = localStorage.getItem(KEY) ?? JSON.stringify(save);
  } catch {
    $<HTMLTextAreaElement>('p-data').value = JSON.stringify(save);
  }
  $('p-data-msg').textContent = '';

  const mastered = Object.values(p.facts).filter((s) => s.m >= MASTERED).length;
  $('parent-sub').textContent = `おぼえた式 ${mastered} こ ・ コイン ${p.coins}`;
}

/** 設定の変更と、セーブデータの持ち出し／読みこみ */
export function initParent(onChange: () => void): void {
  $('p-limit').addEventListener('change', () => {
    save.settings.dailyLimitMin = Number($<HTMLSelectElement>('p-limit').value) || 0;
    persist();
    onChange();
  });

  $('p-slow').addEventListener('change', () => {
    save.settings.slow = $<HTMLInputElement>('p-slow').checked;
    persist();
    onChange();
  });

  $('p-copy').addEventListener('click', () => {
    const ta = $<HTMLTextAreaElement>('p-data');
    ta.select();
    navigator.clipboard
      ?.writeText(ta.value)
      .then(() => { $('p-data-msg').textContent = 'コピーしました。'; })
      .catch(() => { $('p-data-msg').textContent = '選択した文字をコピーしてください。'; });
  });

  $('p-load').addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('p-data').value.trim();
    const msg = $('p-data-msg');
    try {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.players) || parsed.players.length === 0) {
        msg.textContent = 'この文字列は読みこめません。';
        return;
      }
      localStorage.setItem(KEY, text);
      // リロードまでのあいだに、メモリ上の古いセーブで上書きされないようにする
      freezeSave();
      msg.textContent = '読みこみました。画面を作りなおします…';
      window.setTimeout(() => location.reload(), 600);
    } catch {
      msg.textContent = 'この文字列は読みこめません。';
    }
  });
}

/** 関門の問題を作る。答えは 2けた同士の足し算 */
export function makeGate(): { text: string; answer: number } {
  const a = 13 + Math.floor(Math.random() * 60);
  const b = 17 + Math.floor(Math.random() * 60);
  return { text: `${a} + ${b} = ?`, answer: a + b };
}
