/**
 * 出題ロジックだけを取り出して、統計的に確かめる。
 *   npm run verify
 *
 * 見たいのは 2つ。
 *  A) 正解が選択肢の何番目に来るか。ここが偏ると、計算せずに位置や大きさで
 *     当てられてしまう（実際、以前は「まんなかを押す」だけで 9割 当たっていた）
 *  B) 当てずっぽうだけで「おぼえた」判定に届いてしまわないか
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'tj-verify-'));

// ブラウザ前提のコードを node で動かすための最小限の代役
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { setTimeout, clearTimeout };

async function load(entry) {
  const file = join(out, `${entry}.mjs`);
  await build({
    entryPoints: [join(root, 'src', `${entry}.ts`)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: file,
    logLevel: 'silent',
  });
  return import(pathToFileURL(file).href);
}

const { QuestionPicker, MASTERED } = await load('questions');
const { WORLDS } = await load('curriculum');

const N = 60000;
const pct = (n, d = N) => `${((n / d) * 100).toFixed(1)}%`;
let failed = 0;

console.log('A) 正解の順位（下から）と、計算しない戦略の正答率');
console.log('   ワールド  選択肢 |  順位のばらつき             | まんなか | 期待値');
for (const w of WORLDS) {
  const picker = new QuestionPicker(w.facts, w.choices, Boolean(w.blank));
  const rank = new Array(w.choices).fill(0);
  let mid = 0;
  for (let i = 0; i < N; i++) {
    const q = picker.next();
    const r = [...q.choices].sort((a, b) => a - b).indexOf(q.answer);
    rank[r]++;
    if (w.choices === 3 ? r === 1 : r === 1 || r === 2) mid += w.choices === 3 ? 1 : 0.5;
  }
  const worst = Math.max(...rank.map((n) => Math.abs(n / N - 1 / w.choices)));
  const ok = worst < 0.09;
  if (!ok) failed++;
  console.log(
    `   W${w.id}${w.blank ? '*' : ' '}          ${w.choices}  | ` +
      rank.map((n) => pct(n).padStart(7)).join('') +
      (w.choices === 3 ? '       ' : '') +
      ` |  ${pct(mid).padStart(6)} | ${pct(N / w.choices)}  ${ok ? '' : '← 偏っている'}`,
  );
}

console.log('\nB) 当てずっぽうだけで「おぼえた」に届く割合（低いほどよい）');
for (const w of WORLDS) {
  if (w.id !== 1 && w.id !== 5) continue;
  const trials = 20000;
  let mastered = 0;
  for (let t = 0; t < trials; t++) {
    let m = 0;
    for (let i = 0; i < 20; i++) {
      m = Math.random() < 1 / w.choices ? Math.min(5, m + 1) : Math.max(0, m - 2);
    }
    if (m >= MASTERED) mastered++;
  }
  const ok = mastered / trials < 0.05;
  if (!ok) failed++;
  console.log(`   W${w.id}（${w.choices}択）20回出会って: ${pct(mastered, trials)}  ${ok ? '' : '← 甘すぎる'}`);
}

console.log('\nC) 選択肢の健全性（各ワールド 20000 問）');
const bad = [];
for (const w of WORLDS) {
  const picker = new QuestionPicker(w.facts, w.choices, Boolean(w.blank));
  for (let i = 0; i < 20000 && bad.length < 5; i++) {
    const q = picker.next();
    if (q.choices.length !== w.choices) bad.push(`W${w.id} 選択肢が ${q.choices.length} こ`);
    else if (new Set(q.choices).size !== q.choices.length) bad.push(`W${w.id} 重複 ${q.text} ${q.choices}`);
    else if (!q.choices.includes(q.answer)) bad.push(`W${w.id} 正解がない ${q.text}`);
    else if (q.choices.some((c) => c <= 0)) bad.push(`W${w.id} 0以下 ${q.text} ${q.choices}`);
  }
}
if (bad.length) failed++;
console.log(bad.length ? '   ' + bad.join('\n   ') : '   すべて正常');

console.log('\nD) 出題の例');
for (const w of WORLDS) {
  const picker = new QuestionPicker(w.facts, w.choices, Boolean(w.blank));
  const q = picker.next();
  console.log(`   W${w.id} ${w.name.padEnd(12, '　')} ${q.text.padEnd(14)} → ${q.choices.join(' / ')}`);
}

rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
