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

/**
 * 1つの束にまとめて読む。
 *
 * load() はファイルごとに別の束にするので、save.ts（記録）も別々の写しになる。
 * 「記録をこう書いたとき、どの式が選ばれるか」を見るには、記録と選ぶ側が
 * 同じ写しを見ていないといけない。
 */
async function loadTogether(name, contents) {
  const file = join(out, `${name}.mjs`);
  await build({
    stdin: { contents, resolveDir: root, sourcefile: `${name}.ts`, loader: 'ts' },
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
const {
  laneFrom, endlessLane, cadenceAt, endlessCadence, endlessGap, tallChance, endlessMaxHearts,
  AIRTIME, LAND_LAG, TRIP_LAG, CLEAR_RATIO, TALL_CLEAR_RATIO, clearsAt, clearWindow,
  HEARTS, ENDLESS_RANDOM_AT, ENDLESS_TALL_AT, ENDLESS_STAGES, STAGE_WARN,
} = await load('hurdle');

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

console.log('\nG) ぴょんぴょん ハードルの道すじ');
{
  // ここで確かめているのは、そのまま企画の主張になっている:
  //  ・えらんだ数から数え足すと、止まった数が かならず答えになる
  //  ・跳ぶ回数は えらばなかったほうの数（大きいほうを選ぶと いちばん少ない）
  //  ・10のもんは かならず 10 のところ（10のまとまりが走りの区切りになる）
  //  ・色の切れめが cherry() の分解と重なる（さくらんぼ わけ と同じ話をしている）
  const bad = [];
  const kinds = (lane, k) => lane.filter((h) => h.kind === k).length;

  for (const w of WORLDS) {
    for (const f of allFacts(w)) {
      if (f.a >= 10 || f.b >= 10) continue;
      const sum = f.a + f.b;

      // どちらの数からでも走れる。どちらを選んでも、止まる数は答えと一致する
      for (const start of [Math.max(f.a, f.b), Math.min(f.a, f.b)]) {
        const other = sum - start;
        const lane = laneFrom(start, sum);
        const tag = `${f.a}+${f.b}（${start} から）`;

        if (lane.length !== other) bad.push(`${tag}: 本数 ${lane.length} ≠ のこり ${other}`);
        if (lane.length && lane[lane.length - 1].n !== sum) {
          bad.push(`${tag}: 止まる数 ${lane[lane.length - 1].n} ≠ こたえ ${sum}`);
        }
        if (lane.some((h, i) => h.n !== start + i + 1)) bad.push(`${tag}: 番号が とんでいる`);

        const gate = lane.filter((h) => h.kind === 'gate');
        if (sum >= 10 && start < 10) {
          if (gate.length !== 1 || gate[0].n !== 10) bad.push(`${tag}: 10のもんが 10 のところに無い`);
        } else if (gate.length) {
          bad.push(`${tag}: 10 をまたがないのに 10のもんが ある`);
        }
      }

      // 色の切れめは、大きいほうから数えたときに cherry() の分解と重なる
      const c = cherry(f);
      if (c) {
        const lane = laneFrom(c.base, sum);
        const tag = `${f.a}+${f.b}`;
        // gate は need の さいごの1こ。だから need の本数は c.need - 1 になる
        if (kinds(lane, 'need') !== c.need - 1) bad.push(`${tag}: きいろ ${kinds(lane, 'need')} ≠ ${c.need - 1}`);
        if (kinds(lane, 'rest') !== c.rest) bad.push(`${tag}: みどり ${kinds(lane, 'rest')} ≠ ${c.rest}`);
        // もとの数は頭の上に乗っているので、ハードルには1本も出てこない
        if (kinds(lane, 'base')) bad.push(`${tag}: もとの数が ハードルに出ている`);
      }
    }
  }

  // エンドレスは 10本ごとに区切りが来る
  const long = endlessLane(1, 95);
  if (long.length !== 95) bad.push('エンドレス: 本数が合わない');
  for (const h of long) {
    if ((h.n % 10 === 0) !== (h.kind === 'gate')) bad.push(`エンドレス: ${h.n} こめの区切りがおかしい`);
  }

  // 乱数の列を決めうちにする（CI の結果が 回すたびに変わらないように）
  const seeded = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // たかい ハードルは 100本めを こえてから。10のもんは たかくしない（区切りは ひと息つく場所）
  {
    const always = () => 0;
    const lane = endlessLane(1, 400, always);
    const early = lane.filter((h) => h.tall && h.n <= ENDLESS_TALL_AT);
    if (early.length) bad.push(`エンドレス: ${early[0].n} こめ（${ENDLESS_TALL_AT} より前）が たかい`);
    if (lane.some((h) => h.tall && h.kind === 'gate')) bad.push('エンドレス: 10のもんが たかい');
    if (!lane.some((h) => h.tall)) bad.push(`エンドレス: ${ENDLESS_TALL_AT} を こえても たかい ハードルが出ない`);
    // 割合は ふえる一方で、半分で止まる（ぜんぶ たかくはならない）
    let prev = 0;
    for (let n = 1; n <= 400; n++) {
      const c = tallChance(n);
      if (c < prev - 1e-9) bad.push(`エンドレス: たかい割合が ${n} こめで へった`);
      if (c > 0.5 + 1e-9) bad.push(`エンドレス: たかい割合が ${n} こめで 半分を こえた`);
      prev = c;
    }
    // じっさいの乱数でも、100本め より先で まざっている
    const real = endlessLane(101, 300, seeded(7)).filter((h) => h.kind === 'base');
    const rate = real.filter((h) => h.tall).length / real.length;
    if (!(rate > 0.2 && rate < 0.6)) bad.push(`エンドレス: 101〜400本めの たかい割合が ${(rate * 100).toFixed(0)}%`);
  }

  // ハートの上限は 70本めで 2つ、100本めで 1つ。へる一方で、0 には ならない
  {
    const want = [[1, HEARTS], [69, HEARTS], [70, 2], [99, 2], [100, 1], [1000, 1]];
    for (const [n, h] of want) {
      if (endlessMaxHearts(n) !== h) bad.push(`エンドレス: ${n} こめの ハートの上限が ${endlessMaxHearts(n)}（${h} のはず）`);
    }
    let prev = HEARTS;
    for (let n = 1; n <= 300; n++) {
      const h = endlessMaxHearts(n);
      if (h > prev) bad.push(`エンドレス: ${n} こめで ハートの上限が ふえた`);
      if (h < 1) bad.push(`エンドレス: ${n} こめで ハートの上限が 0`);
      prev = h;
    }
    // 節目は 10のもんの上に来て、予告は まえの節目より あと（予告が 札に かくれない）
    let last = 0;
    for (const st of ENDLESS_STAGES) {
      if (st.at % 10 !== 0) bad.push(`エンドレス: 節目 ${st.at} が 10のもんの上に無い`);
      if (st.at - STAGE_WARN <= last) bad.push(`エンドレス: 節目 ${st.at} の予告が まえの節目と かさなる`);
      if (!st.warn || !st.title || !st.sub || !st.say) bad.push(`エンドレス: 節目 ${st.at} に ことばが足りない`);
      last = st.at;
    }
    if (!ENDLESS_STAGES.some((st) => st.at === ENDLESS_RANDOM_AT)) bad.push('エンドレス: バラバラになる節目の予告が無い');
    if (!ENDLESS_STAGES.some((st) => st.at === ENDLESS_TALL_AT)) bad.push('エンドレス: たかい ハードルの節目の予告が無い');
  }

  // 拍は詰まる一方で、しかも かならず「跳んで、着地して、また跳べるようになる」
  // ぶんより長い。ここが破れると、次が来ても まだ跳べず、原理的に越えられなくなる
  const READY = AIRTIME + LAND_LAG;
  for (const slow of [false, true]) {
    for (const [name, at] of [
      ['式モード', (i) => cadenceAt(i, 60, slow)],
      ['エンドレス', (i) => endlessCadence(i, slow)],
    ]) {
      let prev = Infinity;
      for (let i = 0; i <= 200; i++) {
        const c = at(i);
        if (c > prev + 1e-9) bad.push(`${name}の拍が ${i} 本めで ゆるんだ（slow=${slow}）`);
        if (c < READY) {
          bad.push(`${name}の拍 ${c.toFixed(2)}s が 跳べるようになるまで ${READY.toFixed(2)}s より短い（slow=${slow}）`);
        }
        prev = c;
      }
    }
  }

  // 50本めから先は 間がバラバラ。それより前は 決まった拍のまま。
  // どれだけ短くなっても「跳べるようになるまで」より長い（乱数の両はしで見る）
  if (ENDLESS_RANDOM_AT !== 50 || ENDLESS_TALL_AT !== 100) {
    bad.push(`エンドレス: 節目が バラバラ ${ENDLESS_RANDOM_AT}本め・たかい ${ENDLESS_TALL_AT}本め（50・100 のはず）`);
  }
  for (const slow of [false, true]) {
    for (let i = 0; i <= 300; i++) {
      const lo = endlessGap(i, slow, 0);
      const hi = endlessGap(i, slow, 0.999999);
      if (i < ENDLESS_RANDOM_AT && (lo !== endlessCadence(i, slow) || hi !== lo)) {
        bad.push(`エンドレス: ${i} 本め（${ENDLESS_RANDOM_AT} より前）で 拍が バラバラ（slow=${slow}）`);
      }
      if (i >= ENDLESS_RANDOM_AT && !(hi > lo + 0.2)) {
        bad.push(`エンドレス: ${i} 本めで 拍が バラバラに なっていない（${lo.toFixed(2)}〜${hi.toFixed(2)}s, slow=${slow}）`);
      }
      if (lo < READY) {
        bad.push(`エンドレスの いちばん短い間 ${lo.toFixed(2)}s が 跳べるようになるまで ${READY.toFixed(2)}s より短い（${i} 本め, slow=${slow}）`);
      }
    }
  }

  // 当たり判定。**跳んだ「つもり」では越えられない**
  if (clearsAt(0)) bad.push('地面をはなれた瞬間に もう横木を越えている（当たり判定が無い）');
  if (clearsAt(AIRTIME)) bad.push('着地した瞬間に まだ横木を越えている');
  if (!clearsAt(AIRTIME / 2)) bad.push('いちばん高いところでも 横木を越えられない');
  if (!(CLEAR_RATIO > 0.2 && CLEAR_RATIO < 0.9)) bad.push(`越える高さの割合が おかしい（${CLEAR_RATIO}）`);
  // 越えていられる時間が 連打の拍より短い＝連打では かならず取りこぼす
  if (clearWindow() >= READY) {
    bad.push(`越えていられる ${clearWindow().toFixed(2)}s が 連打の拍 ${READY.toFixed(2)}s 以上（連打で ぜんぶ越えられる）`);
  }
  // たかい ハードル。越えていられる時間は ふつうより短いが、いちばん高いところなら越えられる
  if (clearsAt(0, true) || clearsAt(AIRTIME, true)) bad.push('たかい ハードル: 地面の高さで 越えている');
  if (!clearsAt(AIRTIME / 2, true)) bad.push('たかい ハードル: いちばん高いところでも 越えられない');
  if (!(TALL_CLEAR_RATIO > CLEAR_RATIO && TALL_CLEAR_RATIO < 0.85)) {
    bad.push(`たかい ハードル: 越える高さの割合が おかしい（${TALL_CLEAR_RATIO}）`);
  }
  if (!(clearWindow(true) < clearWindow() && clearWindow(true) > 0.3)) {
    bad.push(`たかい ハードル: 越えていられる時間が ${clearWindow(true).toFixed(2)}s（ふつう ${clearWindow().toFixed(2)}s）`);
  }

  /**
   * 連打（毎フレーム押しつづける）で走らせたときの成功率。
   *
   * 直す前は 100%だった。空中のタップをいつでも先行入力として受けて、
   * 着地したフレームで即 跳びなおしていたので、押しつづけているあいだ
   * ずっと空中にいた（＝ぶつかりようがない）。
   * いまは跳躍が AIRTIME + LAND_LAG ごとの決まった拍になるので、
   * ハードルの拍とは合わず、必ず取りこぼす。
   */
  /** ハードルが体に届く時刻。1本めは 1.6秒後（本物の pushLane と同じ）、あとは拍の関数で */
  const hitsOf = (cadence, n) => {
    const hits = [];
    let t = 1.6;
    for (let i = 0; i < n; i++) {
      hits.push(t);
      t += cadence(i + 1);
    }
    return hits;
  };

  /**
   * エンドレスを じっさいの形で並べる。間は endlessGap（50本めから バラバラ）、
   * どれが たかいかは endlessLane（100本めから まざる）。乱数は 決めうちの列
   */
  const endlessRun = (n, slow, rnd) => {
    const lane = endlessLane(1, n, rnd);
    return { hits: hitsOf((i) => endlessGap(i, slow, rnd()), n), tall: lane.map((h) => !!h.tall) };
  };

  const mash = (hits, tall = []) => {
    const n = hits.length;
    const dt = 1 / 120;
    let clean = 0, air = false, airT = 0, lag = 0, at = 0;
    for (let now = 0; at < n && now < 2000; now += dt) {
      if (!air && lag <= 0) { air = true; airT = 0; }  // 連打なので毎フレーム押す
      if (lag > 0) lag = Math.max(0, lag - dt);
      if (air) {
        airT += dt;
        if (airT >= AIRTIME) { air = false; airT = 0; lag = LAND_LAG; }
      }
      while (at < n && now >= hits[at]) {
        if (air && clearsAt(airT, tall[at])) clean++;
        else { air = false; airT = 0; lag = TRIP_LAG; }
        at++;
      }
    }
    return clean / n;
  };

  const mashFacts = mash(hitsOf((i) => cadenceAt(i, 60, false), 60));
  const mashEndless = mash(hitsOf((i) => endlessCadence(i, false), 120));
  // 50本めから先（バラバラ・たかいのが まざる）でも、連打は通らない
  const late = endlessRun(250, false, seeded(3));
  const mashLate = mash(late.hits.slice(ENDLESS_RANDOM_AT), late.tall.slice(ENDLESS_RANDOM_AT));
  for (const [name, rate] of [['式モード', mashFacts], ['エンドレス', mashEndless], ['エンドレス 50本めから', mashLate]]) {
    if (rate > 0.9) bad.push(`連打だけで ${name}の ${(rate * 100).toFixed(0)}% を きれいに跳べる`);
  }

  /**
   * 拍に合わせて跳ぶ子は、**ぜんぶ取れる**。
   *
   * むずかしくしたのは「連打が通らない」ようにするためで、
   * 跳ぶ場所が分かっている子に取りこぼさせるためではない。
   * いちばん高いところがハードルに重なるように跳んだら 100% になることを見る。
   */
  const timed = (hits, tall = []) => {
    const n = hits.length;
    const dt = 1 / 120;
    let clean = 0, air = false, airT = 0, lag = 0, at = 0;
    for (let now = 0; at < n && now < 2000; now += dt) {
      // いちばん高いところ（AIRTIME/2）が ハードルに重なるように押す
      const want = hits[at] - AIRTIME / 2;
      if (!air && lag <= 0 && now >= want) { air = true; airT = 0; }
      if (lag > 0) lag = Math.max(0, lag - dt);
      if (air) {
        airT += dt;
        if (airT >= AIRTIME) { air = false; airT = 0; lag = LAND_LAG; }
      }
      while (at < n && now >= hits[at]) {
        if (air && clearsAt(airT, tall[at])) clean++;
        else { air = false; airT = 0; lag = TRIP_LAG; }
        at++;
      }
    }
    return clean / n;
  };

  const runs = [
    ['式モード', timed(hitsOf((i) => cadenceAt(i, 60, false), 60))],
    ['エンドレス', timed(hitsOf((i) => endlessCadence(i, false), 150))],
  ];
  // バラバラの間と たかい ハードルが まざっても、拍に合わせれば ぜんぶ取れる。
  // いちばん意地悪な形（間は ぜんぶ いちばん短い・100本めから先は ぜんぶ たかい）でも見る
  for (const slow of [false, true]) {
    for (let seed = 1; seed <= 12; seed++) {
      const r = endlessRun(250, slow, seeded(seed));
      runs.push([`エンドレス 250本（seed=${seed}, slow=${slow}）`, timed(r.hits, r.tall)]);
    }
    const worst = endlessLane(1, 250, () => 0).map((h) => h.n > ENDLESS_TALL_AT && h.kind === 'base');
    runs.push([`エンドレス いちばん意地悪（slow=${slow}）`, timed(hitsOf((i) => endlessGap(i, slow, 0), 250), worst)]);
  }
  for (const [name, rate] of runs) {
    if (rate < 1) bad.push(`拍に合わせても ${name}で ${(100 - rate * 100).toFixed(0)}% 取りこぼす（速すぎる）`);
  }

  // エンドレスは「10本ごとに少しずつ速くなり、100本で いちばん速い」。
  // ここが効いていないと、どこまで行っても同じ速さのまま長いだけになる
  if (!(endlessCadence(0, false) > endlessCadence(10, false))) bad.push('エンドレス: 10本めで速くなっていない');
  if (!(endlessCadence(90, false) > endlessCadence(100, false))) bad.push('エンドレス: 100本めで速くなっていない');
  if (endlessCadence(100, false) !== endlessCadence(200, false)) bad.push('エンドレス: 100本を過ぎても速くなり続ける');

  if (bad.length) {
    failed++;
    console.log('   ' + bad.slice(0, 8).join('\n   '));
  } else {
    const ex = laneFrom(8, 13).map((h) => h.kind[0]).join('');
    console.log(
      `   すべて正常（8+5 を 8 から: ${ex} / 式モードの拍 ${cadenceAt(0, 60, false).toFixed(2)}→${cadenceAt(60, 60, false).toFixed(2)}s` +
        ` / エンドレス ${endlessCadence(0, false).toFixed(2)}→${endlessCadence(100, false).toFixed(2)}s）`,
    );
    console.log(
      `   当たり判定: 跳んで ${AIRTIME}s のうち 越えていられるのは ${clearWindow().toFixed(2)}s、` +
        `つぎに跳べるまで ${READY.toFixed(2)}s ` +
        `→ 連打だけでは 式モード ${(mashFacts * 100).toFixed(0)}% / エンドレス ${(mashEndless * 100).toFixed(0)}%` +
        `（拍に合わせれば どちらも 100%）`,
    );
    const span = (i) => `${endlessGap(i, false, 0).toFixed(2)}〜${endlessGap(i, false, 0.999999).toFixed(2)}s`;
    console.log(
      `   エンドレスの節目: ${ENDLESS_RANDOM_AT}本めから 間がバラバラ（${span(ENDLESS_RANDOM_AT)} → 100本めから ${span(100)}）` +
        ` / ハート ${ENDLESS_STAGES.filter((st) => st.hearts).map((st) => `${st.at}本めで ${st.hearts}つ`).join('・')}` +
        ` / ${ENDLESS_TALL_AT}本めから たかい ハードル ${(tallChance(ENDLESS_TALL_AT + 1) * 100).toFixed(0)}%→${(tallChance(1000) * 100).toFixed(0)}%` +
        `（越えていられる ${clearWindow(true).toFixed(2)}s）→ 連打だけでは ${(mashLate * 100).toFixed(0)}%（拍に合わせれば 100%）`,
    );
  }
}

console.log('\nH) ミニゲームの出題が つづけて同じにならないか');
{
  // ミニゲームは記録を動かさない（習熟度が変わらない）。だから「1問ずつ
  // いちばん にがてな式を取る」と、同じ式が何回でも返ってくる。
  // かずの ものさし で `2+7` が 4回つづけて出ていたのが これ。
  // ここで見ているのは 2つ:
  //   ・weakestFacts は まとめて取れば ぜんぶ ちがう式を返す
  //     （プールはワールドをつないだだけなので `9+1` のように重複が入っている）
  //   ・ものさしの6問は、式も 旗を立てる場所も かぶらない
  const mini = await loadTogether(
    'mini',
    `export { rulerPlan } from './src/minigame';
     export { weakestFacts } from './src/questions';
     export { factStat } from './src/save';
     export { WORLDS, allFacts, factKey } from './src/curriculum';`,
  );
  const bad = [];
  const pool = mini.WORLDS.flatMap((w) => mini.allFacts(w));

  // 重複を含むプールから 8こ取っても、同じ式は2回出てこない
  for (let i = 0; i < 200; i++) {
    const got = mini.weakestFacts(pool, 8).map(mini.factKey);
    if (new Set(got).size !== got.length) {
      bad.push(`weakestFacts が同じ式を2回返した: ${got.join(' / ')}`);
      break;
    }
  }

  // 実際にあった形を作る: ほとんどの式は覚えていて、2+7 だけ にがて。
  // 直す前は、この記録で 3〜6問めが ぜんぶ 2+7 になっていた
  const max = 10;
  const p10 = pool.filter((f) => f.a + f.b <= max && f.a + f.b >= 3);
  for (const f of p10) Object.assign(mini.factStat(mini.factKey(f)), { seen: 3, m: 3, miss: 0 });
  Object.assign(mini.factStat('2+7'), { seen: 4, m: 0, miss: 4 });

  for (let i = 0; i < 200; i++) {
    const plan = mini.rulerPlan(p10, max);
    if (plan.length !== 6) bad.push(`ものさし: ${plan.length}問しか作られていない`);
    const keys = plan.filter((r) => r.fact).map((r) => mini.factKey(r.fact));
    if (new Set(keys).size !== keys.length) {
      bad.push(`ものさし: 同じ式が2回出る（${keys.join(' / ')}）`);
      break;
    }
    const answers = plan.map((r) => r.answer);
    if (new Set(answers).size !== answers.length) {
      bad.push(`ものさし: 同じ場所に2回 旗を立てさせる（${answers.join(' / ')}）`);
      break;
    }
    if (plan.slice(0, 2).some((r) => r.fact)) bad.push('ものさし: 1・2問めは 数だけのはず');
    if (plan.slice(2).some((r) => !r.fact)) bad.push('ものさし: 3問めからは たし算のはず');
    if (plan.some((r) => r.fact && r.answer !== r.fact.a + r.fact.b)) {
      bad.push('ものさし: 旗を立てる先が こたえと ちがう');
    }
  }

  if (bad.length) {
    failed++;
    console.log('   ' + bad.slice(0, 6).join('\n   '));
  } else {
    const ex = mini.rulerPlan(p10, max).map((r) => (r.fact ? `${r.fact.a}+${r.fact.b}` : r.answer));
    console.log(`   すべて正常（ものさしの6問: ${ex.join(' / ')}）`);
  }
}

console.log('\nJ) 1日に あそべる時間と、おうちのかたの関門');
{
  // 子どもに見せる「あと 12ふん」と、時間の のこり・延長・日付の切りかえ、
  // それから関門の問題（かけ算）が 子どもに解けない形になっているかを見る。
  const lim = await loadTogether(
    'limit',
    `export * from './src/limit';
     export {
       save, profile, playedToday, allowanceToday, remainingToday, overDailyLimit,
       extendToday, addPlayTime, clearSlot, today,
     } from './src/save';`,
  );
  const bad = [];
  const eq = (got, want, what) => {
    if (got !== want) bad.push(`${what}: ${JSON.stringify(got)}（ほしいのは ${JSON.stringify(want)}）`);
  };

  // ふん／ぷん。まちがった読みは 字を覚えたての子に そのまま覚えられてしまう
  const reading = {
    1: 'ぷん', 2: 'ふん', 3: 'ぷん', 4: 'ぷん', 5: 'ふん', 6: 'ぷん', 7: 'ふん', 8: 'ぷん', 9: 'ふん',
    10: 'ぷん', 11: 'ぷん', 12: 'ふん', 15: 'ふん', 20: 'ぷん', 29: 'ふん', 30: 'ぷん', 45: 'ふん', 60: 'ぷん', 90: 'ぷん', 100: 'ぷん',
  };
  for (const [n, w] of Object.entries(reading)) eq(lim.minuteWord(Number(n)), w, `${n} の読み`);

  // のこりは くりあげ。0 になるのは おわったときだけ
  eq(lim.remainText(Infinity), '', '制限なし');
  eq(lim.remainText(0), 'きょうは おしまい', 'のこり 0秒');
  eq(lim.remainText(1), 'あと 1ぷん', 'のこり 1秒');
  eq(lim.remainText(60), 'あと 1ぷん', 'のこり 60秒');
  eq(lim.remainText(61), 'あと 2ふん', 'のこり 61秒');
  eq(lim.remainText(1800), 'あと 30ぷん', 'のこり 30分');
  eq(lim.timeLevel(0, 0), 'over', '色: 0秒');
  eq(lim.timeLevel(180, 0.1), 'low', '色: のこり 3分');
  eq(lim.timeLevel(181, 0.1), 'mid', '色: のこり 3分1秒');
  eq(lim.timeLevel(1000, 0.51), 'high', '色: 半分より上');
  eq(lim.timeLevel(1000, 0.5), 'mid', '色: ちょうど半分');

  // 関門。こたえは ぜんぶ 3けた（足し算の くりかえしでは届きにくい）、数は 12〜19 と 6〜9
  if (lim.GATE_PAIRS.length < 15) bad.push(`関門の組が少なすぎる: ${lim.GATE_PAIRS.length}`);
  for (const [a, b] of lim.GATE_PAIRS) {
    if (a < 12 || a > 19 || b < 6 || b > 9 || a * b < 100) bad.push(`関門に向かない組: ${a} × ${b}`);
  }
  for (const r of [0, 0.5, 0.999999, 1]) {
    const g = lim.makeGate(() => r);
    const m = g.text.match(/^(\d+) × (\d+) = \?$/);
    if (!m || Number(m[1]) * Number(m[2]) !== g.answer) bad.push(`関門の問題がこわれている（乱数 ${r}）: ${g.text} → ${g.answer}`);
  }
  eq(lim.toHalfWidth('１３６'), '136', '全角の数字');

  // セーブの側。上限・延長・日付の切りかえ
  const p = lim.profile();
  p.name = 'テスト';
  lim.save.settings.dailyLimitMin = 0;
  eq(lim.overDailyLimit(), false, '制限なしで上限');
  eq(lim.remainingToday(), Infinity, '制限なしの のこり');
  lim.save.settings.dailyLimitMin = 30;
  p.play = { date: lim.today(), sec: 1799, extra: 0 };
  eq(lim.overDailyLimit(), false, '30分に 1秒たりない');
  lim.addPlayTime(1);
  eq(lim.overDailyLimit(), true, '30分ちょうど');
  lim.extendToday(600);
  eq(lim.remainingToday(), 600, '＋10分');
  lim.extendToday(-99999);
  eq(p.play.extra, 0, '延長の取り消しは 0 で止まる');
  // きのうの ぶんは 数えない（延長も持ちこさない）
  p.play = { date: '2000-01-01', sec: 99999, extra: 600 };
  eq(lim.playedToday(), 0, 'きのう遊んだぶん');
  eq(lim.allowanceToday(), 1800, 'きのうの延長');
  lim.addPlayTime(5);
  eq(JSON.stringify(p.play), JSON.stringify({ date: lim.today(), sec: 5, extra: 0 }), '日付が変わって最初の1秒');
  // きろくを けしても、きょう遊んだ時間は残る（けして作りなおすと 時間が戻る、を防ぐ）
  p.play = { date: lim.today(), sec: 1800, extra: 0 };
  lim.clearSlot(lim.save.active);
  eq(lim.save.players[lim.save.active].name, '', 'けしたら名前は空');
  eq(lim.save.players[lim.save.active].play.sec, 1800, 'けしても きょうの時間は残る');

  if (bad.length) {
    failed++;
    console.log('   ' + bad.slice(0, 8).join('\n   '));
  } else {
    console.log(`   すべて正常（関門 ${lim.GATE_PAIRS.length}とおり 例: ${lim.makeGate().text}）`);
  }
}

console.log('\nI) 出題の例');
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
