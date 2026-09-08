/**
 * 出題ロジックだけを取り出して、統計的に確かめる。
 *   npm run verify
 *
 * 見たいのは 2つ。
 *  A) 正解が選択肢の何番目に来るか。ここが偏ると、計算せずに位置や大きさで
 *     当てられてしまう（実際、以前は「まんなかを押す」だけで 9割 当たっていた）
 *  B) 当てずっぽうだけで「おぼえた」判定に届いてしまわないか
 *
 * ステージが小ステップに分かれたので、A) と C) はワールド全体だけでなく
 * 小ステップごとにも回す。子どもが実際に1回で出会うのは小ステップの中身であって、
 * ワールド全体ではない。問題を絞るほど「いちばん小さいのを押す」が通りやすくなる。
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

const { QuestionPicker, MASTERED, distractorPool, blankPool } = await load('questions');
const { WORLDS, BASIC_FACTS, allFacts, blankFor, cherry, factKey, stepOf } =
  await load('curriculum');
const { frameArt, PLACE_MAX } = await load('tenframe');

const N = 60000;
const pct = (n, d = N) => `${((n / d) * 100).toFixed(1)}%`;
let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`   ✗ ${msg}`);
};

/** ワールドの小ステップを {stage, name, facts, blank} の形でならべる */
function stepsOf(w) {
  return w.steps.map((st, i) => ({
    stage: i + 1,
    name: st.name,
    facts: st.facts,
    blank: blankFor(w, i + 1),
  }));
}

/**
 * 「毎回おなじ順位のボタンを押す」だけで取れてしまう正答率の下限。
 *
 * buildChoices は、正解が下から何番目になるかを先に引く:
 *   rank = min(U, 下に置ける候補の数, 選択肢数 - 1)      U は 0〜選択肢数-1 の一様
 * なので P(rank = k) = 1/n（k < L のとき）、P(rank = L) = (n - L)/n。
 *
 * L は「誤答候補のうち正解より小さいものの数」。ここを ans - 1 で近似すると、
 * 4択の穴埋め（候補が b-1 と b-2 しか無い）を甘く見積もるので、
 * 実際のプールを questions.ts から読んで数える。
 *
 * この式は、コードに書かれている 2つの数字をそのまま再現する:
 *   W1  1 + 1 = 2  → 2 より小さい正の整数は 1 だけ。正解が3番目になれない → 36.7%
 *   W3  9 + ? = 10 → 答えが 1。1 より小さい正の整数が無く、必ず最小 → 40.7%
 * どちらもロジックの偏りではないので、誤答候補を足しても直らない。
 */
function belowCount(f, blank, choices) {
  const sum = f.a + f.b;
  const ans = blank ? f.b : sum;
  const pool = blank ? blankPool(f.a, f.b, sum) : distractorPool(f.a, f.b, sum);
  return Math.min(pool.filter((d) => d.v < ans).length, choices - 1);
}

function rankDist(choices, facts, blank) {
  const p = new Array(choices).fill(0);
  for (const f of facts) {
    const L = belowCount(f, blank, choices);
    for (let k = 0; k < L; k++) p[k] += 1 / choices;
    p[L] += (choices - L) / choices;
  }
  return p.map((x) => x / facts.length);
}

const strategyFloor = (choices, facts, blank) => Math.max(...rankDist(choices, facts, blank));
// 余裕は 1pt。N = 60000 での標準誤差は 0.2pt ほどなので、まぐれでは超えない
const strategyLimit = (choices, facts, blank) =>
  Math.max(strategyFloor(choices, facts, blank) + 0.01, 1 / choices + 0.03);

/** 位置だけで当てにいく手のうち、いちばん通るものの正答率を実測する */
function measure(facts, choices, blank, n = N) {
  const picker = new QuestionPicker(facts, choices, blank);
  const rank = new Array(choices).fill(0);
  for (let i = 0; i < n; i++) {
    const q = picker.next();
    rank[[...q.choices].sort((a, b) => a - b).indexOf(q.answer)]++;
  }
  return { rank, best: Math.max(...rank) / n };
}

console.log('A) 正解の順位（下から）と、計算しない戦略の正答率');
const bestRate = new Map();
for (const w of WORLDS) {
  const pool = allFacts(w);
  const { rank, best } = measure(pool, w.choices, Boolean(w.blank));
  bestRate.set(w.id, best);
  const limit = strategyLimit(w.choices, pool, Boolean(w.blank));
  if (best > limit) fail(`W${w.id} 全体 ${pct(best * N)} > 上限 ${(limit * 100).toFixed(1)}%`);
  console.log(
    `   W${w.id} ${w.name.padEnd(11, '　')} ${w.choices}択 ` +
      `| ${rank.map((n) => pct(n).padStart(7)).join('')}${w.choices === 3 ? '       ' : ''}` +
      ` | 通る手 ${`${(best * 100).toFixed(1)}%`.padStart(6)} / 上限 ${(limit * 100).toFixed(1)}%`,
  );
  // 小ステップは問題数が少ないぶん偏りやすい。ここが本番
  for (const st of stepsOf(w)) {
    if (!st.facts.length) continue;
    const m = measure(st.facts, w.choices, st.blank, 20000);
    const lim = strategyLimit(w.choices, st.facts, st.blank);
    const bad = m.best > lim;
    if (bad) fail(`W${w.id}-${st.stage}「${st.name}」 ${(m.best * 100).toFixed(1)}% > 上限 ${(lim * 100).toFixed(1)}%`);
    console.log(
      `      ${w.id}-${st.stage} ${st.name.padEnd(12, '　')} 式 ${String(st.facts.length).padStart(3)}` +
        ` | 通る手 ${`${(m.best * 100).toFixed(1)}%`.padStart(6)} / 上限 ${(lim * 100).toFixed(1)}%` +
        `${bad ? '  ← 偏っている' : ''}`,
    );
  }
}

// A) で測った「いちばん通る手」の正答率をそのまま使う。1/選択肢数 を決め打ちすると、
// W3 のように位置で 40.7% 取れるワールドを甘く見積もる。
// 習熟度は式ごと（ワールドをまたぐ）なので、ここはワールド単位で見る。
console.log('\nB) 計算しない子が「おぼえた」に届く割合（低いほどよい）');
for (const w of WORLDS) {
  const p = bestRate.get(w.id);
  const trials = 20000;
  let mastered = 0;
  for (let t = 0; t < trials; t++) {
    let m = 0;
    for (let i = 0; i < 20; i++) {
      m = Math.random() < p ? Math.min(5, m + 1) : Math.max(0, m - 2);
    }
    if (m >= MASTERED) mastered++;
  }
  if (mastered / trials >= 0.05) fail(`W${w.id} まぐれで「おぼえた」が ${pct(mastered, trials)}`);
  console.log(
    `   W${w.id}（${w.choices}択・正答率 ${(p * 100).toFixed(1)}%）20回出会って: ${pct(mastered, trials)}`,
  );
}

console.log('\nC) 選択肢の健全性（小ステップごと 6000 問）');
const bad = [];
for (const w of WORLDS) {
  for (const st of stepsOf(w)) {
    if (!st.facts.length) continue;
    const picker = new QuestionPicker(st.facts, w.choices, st.blank);
    const tag = `W${w.id}-${st.stage}`;
    for (let i = 0; i < 6000 && bad.length < 5; i++) {
      const q = picker.next();
      if (q.choices.length !== w.choices) bad.push(`${tag} 選択肢が ${q.choices.length} こ`);
      else if (new Set(q.choices).size !== q.choices.length) bad.push(`${tag} 重複 ${q.text} ${q.choices}`);
      else if (!q.choices.includes(q.answer)) bad.push(`${tag} 正解がない ${q.text}`);
      else if (q.choices.some((c) => c <= 0)) bad.push(`${tag} 0以下 ${q.text} ${q.choices}`);
    }
  }
}
if (bad.length) {
  failed++;
  console.log('   ' + bad.join('\n   '));
} else console.log('   すべて正常');

/**
 * D) さくらんぼヒントは、繰り上がる式にだけ出す。しかも大きいほうを起点にする。
 *
 * 出す条件を b そのもので見ると、2けた＋2けたのワールド（W8）で
 * 「34 + 31 → 31 を 6 と 25 に分ける」のような、元の式より難しいヒントが出る。
 * 繰り上がるかどうかは一の位どうしの和で決まるので、そこを見張る。
 *
 * 起点は max(a, b)。ここが a 固定だと 4 + 9 が「4 に 6 を あげて 10」になり、
 * 子どもが教わっている「9 から 4 こ かぞえる」と逆向きのヒントになる。
 */
console.log('\nD) さくらんぼヒント（繰り上がる式・大きいほうが起点）');
const carries = (f) => (f.a % 10) + (f.b % 10) >= 10;
const hintBad = [];
for (const w of WORLDS) {
  const pool = allFacts(w);
  const hinted = pool.filter((f) => cherry(f));
  for (const f of hinted) {
    const c = cherry(f);
    const tag = `W${w.id} ${f.a} + ${f.b}`;
    if (!carries(f)) hintBad.push(`${tag} は繰り上がらないのにヒントが出る`);
    else if (c.base !== Math.max(f.a, f.b)) hintBad.push(`${tag} の起点が大きいほうでない（${c.base}）`);
    else if (c.other !== Math.min(f.a, f.b)) hintBad.push(`${tag} の分けるほうが小さいほうでない`);
    else if (c.need + c.rest !== c.other) hintBad.push(`${tag} の分解が合わない`);
    else if (c.ten !== c.base + c.need || c.ten % 10 !== 0) hintBad.push(`${tag} のきりのいい数が違う`);
    else if (c.rest <= 0) hintBad.push(`${tag} の のこりが 0 以下`);
  }
  console.log(
    `   W${w.id}  式 ${String(pool.length).padStart(3)} ・ 繰り上がる ${String(pool.filter(carries).length).padStart(3)} ・ ` +
      `ヒントが出る ${String(hinted.length).padStart(3)}`,
  );
}
if (hintBad.length) {
  failed++;
  console.log('   ' + hintBad.slice(0, 5).join('\n   '));
} else console.log('   すべて正常');

/**
 * E) 小ステップの構え。
 *
 * ・面数を変えると ★ の保存キー "${worldId}-${stage}" の意味がずれ、
 *   旧セーブの「3-7」が新しいボスとして読まれる。8 で固定する。
 * ・ずかんの81マスは W1+W2+W3+W5 でちょうど埋まる。ここが崩れると
 *   ずかんが永久に完成しなくなる。いままで検査が無かった。
 */
console.log('\nE) 小ステップの構え');
const STEPS = 8;
for (const w of WORLDS) {
  if (w.steps.length !== STEPS) fail(`W${w.id} の面数が ${w.steps.length}（★の保存キーがずれる）`);
  for (const st of stepsOf(w)) {
    if (!st.name || [...st.name].length > 12) fail(`W${w.id}-${st.stage} の名まえが長すぎる／空`);
    if (st.facts.length < 3) fail(`W${w.id}-${st.stage}「${st.name}」の式が ${st.facts.length} こしかない`);
    if (new Set(st.facts.map(factKey)).size !== st.facts.length) fail(`W${w.id}-${st.stage} に重複した式`);
    if (!stepOf(w, st.stage)) fail(`W${w.id}-${st.stage} が引けない`);
  }
  // 最後の2ステップを丸ごと使っているので、和集合は元のプールと一致するはず
  const union = new Set(allFacts(w).map(factKey));
  const last = new Set(w.steps[STEPS - 1].facts.map(factKey));
  if (last.size !== union.size) fail(`W${w.id} の「しあげ」がワールド全体を覆っていない`);
}
const zukan = new Set(BASIC_FACTS.map(factKey));
const covered = new Set();
for (const id of [1, 2, 3, 5]) {
  for (const f of allFacts(WORLDS.find((w) => w.id === id))) covered.add(factKey(f));
}
const missing = [...zukan].filter((k) => !covered.has(k));
const extra = [...covered].filter((k) => !zukan.has(k));
if (missing.length || extra.length) {
  fail(`ずかんの被覆がずれた（足りない ${missing.length} / はみ出し ${extra.length}）`);
} else {
  console.log(`   面数 ${STEPS}＋ボス × ${WORLDS.length}ワールド ・ ずかん ${zukan.size}マスを W1+W2+W3+W5 でちょうど被覆`);
}

/**
 * F) ヒントの絵。
 *
 * ヒントは、押されたときにだけ出る（自動では出ない）。押して何も出ない式は
 * ボタンが死んでいるのと同じなので、絵の出ない式がどこにどれだけあるかを数える。
 * 枠が4つ以上になる絵は、答えボタンを画面の外へ押し出す。
 * 「だから…？」の一文（nudge）は、絵といっしょに必ず出す約束になっている。
 */
console.log('\nF) ヒントの絵（10マス）');
const artBad = [];
const noArtSteps = [];
let noArt = 0;
for (const w of WORLDS) {
  for (const st of stepsOf(w)) {
    let drawable = 0;
    for (const f of st.facts) {
      const art = frameArt(f, st.blank);
      if (!art) {
        noArt++;
        continue;
      }
      drawable++;
      const tag = `W${w.id} ${f.a}+${f.b}`;
      if (art.frames > 3) artBad.push(`${tag} の枠が ${art.frames} こ（答えボタンが画面外に出る）`);
      else if (art.viewBox.split(' ').filter((n) => n !== '' && Number.isFinite(+n)).length !== 4) {
        artBad.push(`${tag} の viewBox が読めない（${art.viewBox}）`);
      } else if (art.mode === 'carry' && !cherry(f)) artBad.push(`${tag} が carry なのに分解できない`);
      else if (!art.text) artBad.push(`${tag} に ことばが無い`);
      else if (!art.nudge.endsWith('…？')) artBad.push(`${tag} の ひと押しが「…？」で終わっていない`);
    }
    // 1問も絵にできない面。ヒントボタンはあるが、その面では一度も押せない
    if (st.facts.length && drawable === 0) noArtSteps.push(`W${w.id}-${st.stage}「${st.name}」`);
  }
}
if (artBad.length) {
  failed++;
  console.log('   ' + artBad.slice(0, 5).join('\n   '));
} else {
  console.log(`   すべて正常（絵にしない式は ${noArt} こ。和が ${PLACE_MAX} を超えるもの）`);
}
// 失敗にはしない。2けた同士は 10マスで描くと画面に入らない、という設計上の限界
if (noArtSteps.length) {
  console.log(`   ヒントが1問も出ない面（${noArtSteps.length}）: ${noArtSteps.join(' / ')}`);
}

console.log('\nG) 出題の例');
for (const w of WORLDS) {
  for (const st of stepsOf(w)) {
    if (!st.facts.length) continue;
    const q = new QuestionPicker(st.facts, w.choices, st.blank).next();
    console.log(
      `   ${w.id}-${st.stage} ${st.name.padEnd(12, '　')} ${q.text.padEnd(14)} → ${q.choices.join(' / ')}`,
    );
  }
}

rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
