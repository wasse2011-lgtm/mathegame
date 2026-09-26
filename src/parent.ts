/**
 * おうちのかた向けの画面。子ども側の導線には出さず、設定の中から入る。
 *
 * PIN を持たせると必ず忘れるので、関門は「大人なら暗算できる かけ算」にしてある。
 * 以前は 2けたの足し算だったが、このアプリは W8 で 2けたの足し算そのものを
 * 練習させる。遊びこんだ子ほど関門を解けてしまうので、かけ算（2けた × 1けたで
 * こたえが 3けた。小学3年の内容）に替えた。
 * まちがえるたびに問題を替え、3回つづけて まちがえたら 30秒 待たせる。
 * 当てずっぽうの連打で通れないようにするため。
 *
 * それでも「電卓を使える子」や「上のきょうだい」は止められない。厳密なロックが
 * 要る家庭は、端末のスクリーンタイム／ファミリーリンクと併用してもらう（画面にも書く）。
 */

import { TIER_LIST, WORLDS, bossStage, type Fact } from './curriculum';
import { EXTEND_CHOICES, LIMIT_CHOICES, makeGate, minuteWord, toHalfWidth } from './limit';
import { activePet, ownedPets, rarityDef } from './pets';
import { MASTERED } from './questions';
import { powerText } from './ranch';
import {
  SAVE_KEY,
  extendToday,
  freeToday,
  freezeSave,
  isEmptySlot,
  persist,
  playedToday,
  profile,
  remainingToday,
  clearSession,
  extendSession,
  save,
  sessionLeft,
  setFreeToday,
  slots,
  stageStars,
  today,
} from './save';
import { openTimerSheet } from './timer';
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

/** 集めた★。ハード・ベリーハード（うらマップ）の★も入れる（きろくを えらぶ画面の★と そろえる） */
function totalStars(): number {
  let n = 0;
  for (const w of WORLDS) {
    for (const t of TIER_LIST) {
      for (let s = 1; s <= bossStage(w); s++) n += stageStars(w.id, s, t);
    }
  }
  return n;
}

export function renderParent(): void {
  const p = profile();
  // 下の「1日に あそべる時間」と同じ数え方にそろえる（四捨五入だと、のこりと足して合わない）
  $('p-time').textContent = minText(playedToday(p));

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
      + 'ホームの「にがて たいじ」は、この式だけを時間制限なしで出します。'
    : 'まだ十分なデータがありません。何ステージか遊ぶと出てきます。';

  renderLimit();
  renderTimerRow();
  $<HTMLInputElement>('p-slow').checked = save.settings.slow;

  const pet = activePet();
  $('p-pet').textContent = pet
    ? `いま連れているのは「${pet.name}」（${rarityDef(pet.rarity).label}）。${powerText(pet)}。集めたペットは ${ownedPets().length} ひきです。`
    : `いまはペットを連れていません。集めたペットは ${ownedPets().length} ひきです。`;

  try {
    $<HTMLTextAreaElement>('p-data').value = localStorage.getItem(KEY) ?? JSON.stringify(save);
  } catch {
    $<HTMLTextAreaElement>('p-data').value = JSON.stringify(save);
  }
  $('p-data-msg').textContent = '';

  const mastered = Object.values(p.facts).filter((s) => s.m >= MASTERED).length;
  $('parent-sub').textContent = `おぼえた式 ${mastered} こ ・ コイン ${p.coins}`;
}

// ------------------------------------------------------------------ 1日にあそべる時間

/** 「きょうだけ」足す分数 */
const EXTEND_MIN = 10;

function minText(sec: number): string {
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分`;
}

/** 分のくりあげ（子どもの画面の「あと 12ふん」と同じ数え方にそろえる） */
function leftText(sec: number): string {
  return sec <= 0 ? '0分（きょうは おしまい）' : `${Math.ceil(sec / 60)}分`;
}

/**
 * 時間の制限のところ。選んだ瞬間に保存されるので「保存」ボタンは置かない。
 * きろくが2つ以上あるときは、それぞれの きょうの時間を並べる（時間は きろくごとに数える）。
 */
function renderLimit(): void {
  const limit = save.settings.dailyLimitMin;
  for (const b of $('p-limit-chips').querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-checked', String(Number(b.dataset.min) === limit));
  }

  const used = slots().filter((q) => !isEmptySlot(q));
  const now = $('p-limit-now');
  now.replaceChildren();
  const lines = used.length ? used : [profile()];
  for (const q of lines) {
    const row = document.createElement('p');
    const who = used.length > 1 ? `${q.name}：` : '';
    const played = `きょう ${minText(playedToday(q))} あそびました`;
    const extra = q.play.date === today() ? q.play.extra : 0;
    row.textContent = !limit
      ? `${who}${played}。`
      : freeToday(q)
        ? `${who}${played}。きょうは 制限なし（おしまいの画面で「このまま」を選びました）`
        : `${who}${played}。のこり ${leftText(remainingToday(q))}` +
          (extra ? `（きょうだけ ＋${Math.round(extra / 60)}分）` : '');
    if (limit && remainingToday(q) <= 0) row.className = 'over';
    now.appendChild(row);
  }
  if (!limit) {
    const row = document.createElement('p');
    row.textContent = 'いまは制限なしです。遊んだ時間は数えています。';
    now.appendChild(row);
  }

  const p = profile();
  const free = freeToday(p);
  const extend = $<HTMLButtonElement>('p-extend');
  // 外している日は のこりが無いので、足しても変わらない
  extend.disabled = !limit || free;
  extend.textContent = used.length > 1
    ? `${p.name} に きょうだけ ＋${EXTEND_MIN}分`
    : `きょうだけ ＋${EXTEND_MIN}分`;
  const extra = p.play.date === today() ? p.play.extra : 0;
  const undo = $('p-extend-undo');
  undo.hidden = !limit || (extra <= 0 && !free);
  undo.textContent = free ? '制限を元に戻す' : '延長を取り消す';
}

/** タイマー（いまから ○分）の いまの状態。タイマーは きろくごとなので、いま遊んでいる きろくのもの */
function renderTimerRow(): void {
  const p = profile();
  const t = p.timer;
  const left = sessionLeft();
  const who = slots().filter((q) => !isEmptySlot(q)).length > 1 ? `${p.name}：` : '';
  $('p-timer-now').textContent = who + (!t
    ? 'いまは かかっていません。'
    : left > 0
      ? `かかっています。のこり ${leftText(left)}（ぜんぶで ${Math.round(t.totalMs / 60_000)}分）`
      : '時間になりました（お子さんには「じかんに なったよ」の画面が出ています）。');
  $('p-timer-set').textContent = t ? 'かけなおす' : 'タイマーを かける';
  $('p-timer-add').hidden = !t;
  $('p-timer-stop').hidden = !t;
}

/** 設定の変更と、セーブデータの持ち出し／読みこみ */
export function initParent(onChange: () => void): void {
  // ここは関門の内側なので、かかっていても そのまま開く
  $('p-timer-set').addEventListener('click', () => {
    openTimerSheet(profile().timer ? 'running' : 'setup');
  });
  $('p-timer-add').addEventListener('click', () => {
    extendSession(10);
    renderTimerRow();
    onChange();
  });
  $('p-timer-stop').addEventListener('click', () => {
    clearSession();
    renderTimerRow();
    onChange();
  });

  const chips = $('p-limit-chips');
  for (const min of LIMIT_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'p-chip';
    b.setAttribute('role', 'radio');
    b.dataset.min = String(min);
    b.textContent = min ? `${min}分` : 'なし';
    b.addEventListener('click', () => {
      save.settings.dailyLimitMin = min;
      persist();
      renderLimit();
      onChange();
    });
    chips.appendChild(b);
  }

  $('p-extend').addEventListener('click', () => {
    extendToday(EXTEND_MIN * 60);
    renderLimit();
    onChange();
  });

  // きょうだけ足した時間も、「このまま」で外した制限も、まとめて元に戻す
  $('p-extend-undo').addEventListener('click', () => {
    const p = profile();
    extendToday(-(p.play.date === today() ? p.play.extra : 0));
    if (freeToday(p)) setFreeToday(false);
    renderLimit();
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

// ------------------------------------------------------------------ 関門

/** 何回つづけて まちがえたら待たせるか */
const GATE_TRIES = 3;
/** 待たせる長さ */
const GATE_WAIT_MS = 30_000;

let gateAnswer = 0;
let gateMiss = 0;
let gateLockUntil = 0;
let gateTimer = 0;
let gatePass: ((extendMin: number) => void) | null = null;
/**
 * のばす分数（おしまいの画面から開いたときだけ使う）。
 * 前に えらんだ長さを おぼえておく（毎回 同じ長さを のばす家庭が多いはず）
 */
let gateExtend: number = EXTEND_CHOICES[0];
let gateExtendOn = false;
/**
 * おしまいの画面から開いたときに、とおったあと どうするか。
 * 'home' は「このまま スタート画面へ」、'extend' は「じかんを のばして もどる」。
 * 開くたびに 'home' から（のばすかどうかは そのつど えらんでもらう）
 */
let gateMode: 'home' | 'extend' = 'home';
/** 「このまま スタート画面へ」で 何が起きるか（おとな向けの説明の うしろ半分。main.ts が決める） */
let gateHomeLead = '';

function newGateQuestion(): void {
  // 組は 23とおりしかないので、そのまま引くと 同じ問題が また出ることがある。
  // 「まちがえたら問題を替える」を 必ず守る
  const before = $('gate-q').textContent;
  let gate = makeGate();
  for (let i = 0; i < 8 && gate.text === before; i++) gate = makeGate();
  gateAnswer = gate.answer;
  $('gate-q').textContent = gate.text;
  $<HTMLInputElement>('gate-input').value = '';
}

/** 待たせているあいだは、入力もボタンも止め、のこり秒を出す */
function renderGateLock(): void {
  const input = $<HTMLInputElement>('gate-input');
  const ok = $<HTMLButtonElement>('gate-ok');
  const left = Math.ceil((gateLockUntil - Date.now()) / 1000);
  const locked = left > 0;
  input.disabled = locked;
  ok.disabled = locked;
  if (locked) {
    $('gate-msg').textContent = `まちがいが つづいたので、${left}秒 まってください。`;
    if (!gateTimer) gateTimer = window.setInterval(renderGateLock, 1000);
    return;
  }
  if (gateTimer) {
    clearInterval(gateTimer);
    gateTimer = 0;
    $('gate-msg').textContent = '';
  }
}

function closeGate(): void {
  $('overlay-gate').hidden = true;
  if (gateTimer) {
    clearInterval(gateTimer);
    gateTimer = 0;
  }
  gatePass = null;
}

function submitGate(): void {
  if (Date.now() < gateLockUntil) return;
  const input = $<HTMLInputElement>('gate-input');
  const raw = toHalfWidth(input.value).trim();
  if (raw === '') {
    $('gate-msg').textContent = 'こたえを 数字で入れてください。';
    input.focus();
    return;
  }
  if (Number(raw) === gateAnswer) {
    gateMiss = 0;
    const pass = gatePass;
    closeGate();
    pass?.(gateExtendOn && gateMode === 'extend' ? gateExtend : 0);
    return;
  }
  gateMiss++;
  // 同じ問題のまま こたえだけ替えて当てにいけないよう、まちがえたら問題を替える
  newGateQuestion();
  if (gateMiss >= GATE_TRIES) {
    gateMiss = 0;
    gateLockUntil = Date.now() + GATE_WAIT_MS;
  } else {
    $('gate-msg').textContent = 'ちがいます。問題を かえました。';
  }
  renderGateLock();
  if (!input.disabled) input.focus();
}

/** 2つの えらびかた・のばす分数のボタンと、すすむボタンの字を合わせる */
function renderGateExtend(): void {
  const ext = gateMode === 'extend';
  $('gate-opt-home').setAttribute('aria-checked', String(!ext));
  $('gate-opt-ext').setAttribute('aria-checked', String(ext));
  // 「このまま」のあいだは 分数を うすく出す（押せば「のばして もどる」に切りかわる）
  $('gate-chips').classList.toggle('off', !ext);
  for (const b of $('gate-chips').querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String(ext && Number(b.dataset.min) === gateExtend));
  }
  $('gate-ok').textContent = !gateExtendOn
    ? 'すすむ'
    : ext
      ? `${gateExtend}${minuteWord(gateExtend)} のばして もどる`
      : 'スタート画面へ';
  $('gate-lead').textContent = !gateExtendOn
    ? '保護者の方へ：次のかけ算の答えを入力してください。'
    : ext
      ? '保護者の方へ：かけ算の答えを入力すると、選んだ時間だけ延ばして元の画面に戻ります。'
      : `保護者の方へ：かけ算の答えを入力すると、${gateHomeLead || 'スタート画面に戻ります。'}`;
}

/** 2つの えらびかた・分数を押したあと。そのまま答えを打てるように 入力へ戻す */
function pickGate(mode: 'home' | 'extend', min = gateExtend): void {
  gateMode = mode;
  gateExtend = min;
  renderGateExtend();
  const input = $<HTMLInputElement>('gate-input');
  if (!input.disabled) input.focus();
}

/**
 * 関門を出す。解けたら onPass を呼ぶ。
 * @param why 子どもに向けた ひとこと（なぜ ここで止まったのか）。なければ出さない
 * @param opts.extend おしまいの画面から開いたとき。問題の上で「このまま スタート画面へ」
 *   （ふだんは こちら）か「じかんを のばして もどる（5〜10分）」かを えらばせ、
 *   解けたら onPass に のばす分数を渡す（このまま なら 0）。解いたあとに
 *   もう1枚 画面をはさまないため
 * @param opts.homeLead 「このまま」で何が起きるか（「タイマーを止めてスタート画面に戻ります。」など。
 *   おとな向けの説明の うしろ半分に入れる）
 */
export function openGate(
  onPass: (extendMin: number) => void,
  why = '',
  opts: { extend?: boolean; homeLead?: string } = {},
): void {
  gatePass = onPass;
  gateExtendOn = Boolean(opts.extend);
  gateMode = 'home';
  gateHomeLead = opts.homeLead ?? '';
  $('gate-extend').hidden = !gateExtendOn;
  renderGateExtend();
  newGateQuestion();
  $('gate-msg').textContent = '';
  const whyEl = $('gate-why');
  whyEl.textContent = why;
  whyEl.hidden = !why;
  $('overlay-gate').hidden = false;
  renderGateLock();
  const input = $<HTMLInputElement>('gate-input');
  if (!input.disabled) input.focus();
}

/** 関門のボタン。main.ts から1回だけ呼ぶ */
export function initGate(): void {
  const chips = $('gate-chips');
  for (const min of EXTEND_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tm-chip';
    b.dataset.min = String(min);
    b.innerHTML = `<b>${min}</b><small>${minuteWord(min)}</small>`;
    b.addEventListener('click', () => pickGate('extend', min));
    chips.appendChild(b);
  }
  $('gate-opt-home').addEventListener('click', () => pickGate('home'));
  $('gate-opt-ext').addEventListener('click', () => pickGate('extend'));

  $('gate-ok').addEventListener('click', submitGate);
  $('gate-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitGate();
    }
  });
  $('gate-cancel').addEventListener('click', closeGate);
}
