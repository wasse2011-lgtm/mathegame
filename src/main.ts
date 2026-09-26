import './style.css';

import { applySoundSetting, installAudioWake, sfx, unlockAudio } from './audio';
import {
  DAILY_WORLD,
  HUNT_WORLD,
  WORLDS,
  allFacts,
  answerTimeFor,
  blankFor,
  bossRequirement,
  bossStage,
  factsFor,
  isBoss,
  questionCount,
  stageCount,
  stepOf,
  worldById,
  type Fact,
  type World,
} from './curriculum';
import { GACHA_COST, lockedItems } from './items';
import { GRACE_SEC, minuteWord } from './limit';
import { initMini, miniLeftToday, miniPlaying, renderMiniList, stopMini } from './minigame';
import { renderMiniMap } from './minimap';
import { initGate, initParent, openGate, renderParent } from './parent';
import {
  PET_COUNT,
  PET_EGG_COST,
  PET_EGG_SHINY_COST,
  activePet,
  ownedPets,
  type PetDef,
} from './pets';
import { mountTimerButton, refreshPlayClock, ringClocks, startPlayClock } from './playclock';
import { Playground } from './playground';
import { initRanch, onRanchChange, renderRanch, startRanchIdle } from './ranch';
import { initShop, onShopChange, renderShop, startShopIdle } from './shop';
import { initTimer } from './timer';
import { MASTERED, easiestFacts, weakFactCount, weakFacts, weakestFacts } from './questions';
import { COIN_BOSS, COIN_HUNT, dailyBonus } from './rewards';
import { Runner, type RunConfig, type StageResult } from './runner';
import {
  clearSlot,
  extendSession,
  extendToday,
  flushSave,
  isEmptySlot,
  overDailyLimit,
  persist,
  profile,
  refreshDaily,
  requestPersistentStorage,
  resetAll,
  save,
  selectSlot,
  sessionOver,
  slots,
  stageStars,
  storageWorks,
  timeUp,
  usedSlots,
} from './save';
import { SKINS, currentLook, drawChar, paintSkinIcon } from './sprites';
import { mapLook, skyCss, themeFor, timeIdFor, type TimeId } from './theme';
import { nextTrivia, type Trivia } from './trivia';
import { weaponDef } from './weapons';
import { initZukan, onZukanChange, openZukan, zukanNewCount, zukanPrizeReady } from './zukan';

type ScreenName =
  | 'title' | 'slots' | 'map' | 'play' | 'result' | 'zukan' | 'shop' | 'ranch' | 'mini' | 'parent' | 'rest';

const screens: Record<ScreenName, HTMLElement> = {
  title: document.getElementById('screen-title') as HTMLElement,
  slots: document.getElementById('screen-slots') as HTMLElement,
  map: document.getElementById('screen-map') as HTMLElement,
  play: document.getElementById('screen-play') as HTMLElement,
  result: document.getElementById('screen-result') as HTMLElement,
  zukan: document.getElementById('screen-zukan') as HTMLElement,
  shop: document.getElementById('screen-shop') as HTMLElement,
  ranch: document.getElementById('screen-ranch') as HTMLElement,
  mini: document.getElementById('screen-mini') as HTMLElement,
  parent: document.getElementById('screen-parent') as HTMLElement,
  rest: document.getElementById('screen-rest') as HTMLElement,
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const runner = new Runner();
let current: ScreenName = 'title';
let mapWorld = 1;
/** マップは「せかい一覧」と「その せかいの みち」の2段 */
let mapView: 'worlds' | 'stages' = 'worlds';
let lastRun: RunConfig | null = null;
let lastResult: StageResult | null = null;
/** きせかえ／ぼくじょうをどこから開いたか。ゲームの途中なら続きへ戻す導線を出す */
let shopFrom: 'home' | 'result' = 'home';

/**
 * 1日に あそべる時間を使いきったら、ここへは行かせず「きょうは ここまで」にする画面。
 *
 * プレイ（play）とリザルト（result）は入れない。ステージの途中では止めず、
 * 終わった結果までは見せる（新しいステージは startRun が止める）。
 * きろく えらび（slots）も入れない。きょうだいが 1台を使っているとき、
 * つぎの子に かわれなくなる（時間は きろくごとに数えている）。
 * ミニゲームは、1回ぶんを遊んでいる途中だけ見のがす（onClockTick を見る）。
 */
const LOCKED_WHEN_OVER: ReadonlySet<ScreenName> = new Set<ScreenName>([
  'title', 'map', 'zukan', 'shop', 'ranch', 'mini',
]);

/**
 * 「きょうは ここまで」に切りかわる直前に いた画面（行こうとしていた画面）。
 * おうちのかたが 関門を解いて時間をのばしたら、ここへ そのまま戻す
 * （ホームに飛ばすと、マップの どこを見ていたか・きせかえの どのタブだったかが消える）。
 */
let restFrom: ScreenName | null = null;
/** 戻るときに 描きなおしが要るか（ステージの途中で打ち切ったときの マップ） */
let restRedraw = false;

function show(name: ScreenName): void {
  if (LOCKED_WHEN_OVER.has(name) && timeUp()) {
    if (!restFrom) restFrom = name;
    name = 'rest';
  }
  if (name === 'rest') {
    renderRest();
  } else {
    restFrom = null;
    restRedraw = false;
  }
  // リザルトの演出は音とタイマーを持っている。画面を離れるときに必ず止める
  if (current === 'result' && name !== 'result') stopResultAnim();
  // ミニゲームも同じ。演出の途中で ← を押されても、タイマーを残さない
  if (current === 'mini' && name !== 'mini') stopMini();
  current = name;
  (Object.keys(screens) as ScreenName[]).forEach((k) => {
    screens[k].hidden = k !== name;
  });
  // 動いている画面は、表に出たときに描画ループを起こしなおす
  if (name === 'title') {
    startHomeIdle();
  } else {
    yard.stop(); // 見ていないあいだは動かさない（電池を食う）
    hideSensei(); // ふきだしのタイマーを、別の画面に持ちこさない
  }
  if (name === 'shop') startShopIdle();
  if (name === 'ranch') startRanchIdle();
}

// ------------------------------------------------------------------ ぴょんぴょん広場

/**
 * タイトルの草の上。じぶんの子と集めたなかまが跳ねまわり、さわると反応する。
 * ここは毎回いちばん最初に見る画面なので、さわれるほうが戻ってきたくなる。
 */
const yard = new Playground(
  $<HTMLCanvasElement>('home-char'),
  (g, x, y, size, t, squash, air) => {
    drawChar(g, x, y, size, currentLook(), { t, air, hurt: 0, squash });
  },
);

/** 広場に出す顔ぶれ。じぶんの子＋つれている子＋持っている子から数ひき */
function yardCast(): (PetDef | null)[] {
  const active = activePet();
  const others = ownedPets().filter((p) => p.id !== active?.id).slice(0, active ? 3 : 4);
  return [null, ...(active ? [active] : []), ...others];
}

function startHomeIdle(): void {
  // ホームを見ていないときは動かさない。renderTitle() は きせかえ・ぼくじょうで
  // 買ったときにも呼ばれるので、ここを見ないと「別の画面を見ているあいだ、
  // 隠れた広場が回りっぱなし」になる（show() が止めるのは画面を切りかえた時だけ）
  if (current !== 'title') return;
  if ($('yard').hidden) return;
  yard.setCast(yardCast());
  yard.start();
}

// ------------------------------------------------------------------ ホーくん（ものしりフクロウ）

/**
 * タイトルの草の上にいる めがねの フクロウ。
 *
 * タップすると **2種類のどちらか**が、ひと呼吸おいて こたえまで出る。
 * - にがてな式を1つ（走らなくても、押すだけで1問ぶん出会える）
 * - 数の まめちしき・クイズを1つ（`trivia.ts`）
 *
 * 式だけを出していたときは、押すこと自体が れんしゅうの合図になってしまい、
 * 「押すと おべんきょうが出てくるボタン」として避けられる。
 * **当たりが2種類あると、もう一度押す。** ここに来る子は「あそぶ」を押す前に
 * かならずこの画面を見ているので、いちばん通る道の上に、いちばん短い
 * れんしゅうを1つ置いたことになる。
 *
 * すぐ答えを出さないのは、出てから答えが見えるまでの1〜2秒がいちばんおぼえる時間だから。
 * 待てない子は もう一度押せば出る（考えることを強制はしない）。
 *
 * **こたえが出たあとは、押されるまで消さない。**
 * 前は 5〜8秒で 勝手に消していたが、字を おぼえたてで ゆっくり読む子には
 * 短すぎて、読みおわる前に消えていた（読める子の速さで計った時間だった）。
 * 読む速さは子によって何倍もちがうので、時間で決めること自体をやめて、
 * 「読みおわった」を決めるのを 子ども自身の指にわたす。
 * 消す手だては ふきだしを押すこと1つで、その案内を ふきだしの中に必ず出す。
 * 画面を離れるときは `show()` が消すので、別の画面には持ちこさない。
 *
 * **記録は読むだけで、一切動かさない。**（★・ずかん・習熟度）
 * 押せば答えが出るものを「おぼえた」の証拠にしない、という線は
 * ミニゲームと同じ。出すのは にがての記録を読んで決める。
 */
const SENSEI_WAIT = 1900;
/** まめちしきは もんだい文が長いぶん、こたえを出すまでを のばす */
const TRIVIA_WAIT = 3000;
/** 語尾は「〜ホ」。ここだけは説明ではなく、話しかけられている形にする */
const SENSEI_ASK = 'これ わかるホ？';

/** いま ふきだしに出しているもの */
type SenseiCard = { kind: 'fact'; fact: Fact } | { kind: 'trivia'; item: Trivia };

let senseiList: Fact[] = [];
let senseiAt = 0;
let senseiCard: SenseiCard | null = null;
/** こたえまで出したか。出ていない間にもう一度押されたら、その場で見せる */
let senseiOpen = false;
let senseiTimer = 0;
/** 同じ種類が何回つづいたか。3回つづいたら、つぎは かならず もう一方にする */
let senseiRun = 0;
let senseiWasTrivia = false;

/** 出す式。にがてが1ぴきも居ない日でも空にはしない（いちばん あやしい式から） */
function senseiPool(): Fact[] {
  const pool = unlockedFacts();
  const weak = weakFacts(pool, 8);
  return weak.length ? weak : weakestFacts(pool, 8);
}

/**
 * つぎに出すのは まめちしきか、式か。
 * 半々の くじ引きにしているが、**同じ種類が3回つづいたら 強制的に切りかえる。**
 * 運まかせのままだと「5回押して ぜんぶ式」が普通に起きて、
 * 2種類あることに気づかないまま やめてしまう。
 */
function wantTrivia(): boolean {
  if (senseiRun >= 3) return !senseiWasTrivia;
  return Math.random() < 0.5;
}

function nextCard(): SenseiCard | null {
  const trivia = wantTrivia();
  senseiRun = trivia === senseiWasTrivia ? senseiRun + 1 : 1;
  senseiWasTrivia = trivia;
  if (trivia) return { kind: 'trivia', item: nextTrivia() };

  if (senseiAt >= senseiList.length) {
    senseiList = senseiPool();
    senseiAt = 0;
  }
  const f = senseiList[senseiAt++];
  return f ? { kind: 'fact', fact: f } : null;
}

function renderFactCard(fact: Fact, answer: number | null): void {
  const box = $('sensei-say');
  box.classList.remove('trivia');

  const lead = document.createElement('p');
  lead.className = 'ss-lead';
  lead.textContent = answer === null ? SENSEI_ASK : `${answer} だホ！`;

  const line = document.createElement('p');
  line.className = 'ss-fact';
  const q = document.createElement('b');
  q.className = answer === null ? 'ss-q' : 'ss-q got';
  q.textContent = answer === null ? '?' : String(answer);
  line.append(String(fact.a), ' ＋ ', String(fact.b), ' ＝ ', q);

  // こたえが出たら、消しかたを必ず出す。時間では消えないので、
  // これが無いと ふきだしが下のボタンに かぶったまま戻らない
  const foot = document.createElement('p');
  foot.className = answer === null ? 'st-wait' : 'st-close';
  foot.textContent = answer === null ? 'タップで こたえ' : 'タップで とじる';

  box.replaceChildren(lead, line, foot);
  box.hidden = false;
}

function renderTriviaCard(t: Trivia, open: boolean): void {
  const box = $('sensei-say');
  box.classList.add('trivia');
  const quiz = t.kind === 'quiz';

  const lead = document.createElement('p');
  lead.className = 'ss-lead';
  lead.textContent = open
    ? (quiz ? 'せいかいは…' : 'なるほど ホ〜！')
    : (quiz ? 'クイズ だホ！' : 'しってる ホ？');

  const icon = document.createElement('p');
  icon.className = 'st-icon';
  icon.textContent = t.icon;

  const q = document.createElement('p');
  q.className = 'st-q';
  q.textContent = t.q;

  const rows: HTMLElement[] = [lead, icon, q];
  if (open) {
    const a = document.createElement('p');
    a.className = 'st-a';
    a.textContent = t.a;
    rows.push(a);
    if (t.sub) {
      const sub = document.createElement('p');
      sub.className = 'st-sub';
      sub.textContent = t.sub;
      rows.push(sub);
    }
    const close = document.createElement('p');
    close.className = 'st-close';
    close.textContent = 'タップで とじる';
    rows.push(close);
  } else {
    // 待てない子に「押せば出る」ことを教える。待つのを強制はしない
    const wait = document.createElement('p');
    wait.className = 'st-wait';
    wait.textContent = quiz ? 'タップで こたえ' : 'タップで つづき';
    rows.push(wait);
  }

  box.replaceChildren(...rows);
  box.hidden = false;
}

function revealSensei(): void {
  const c = senseiCard;
  if (!c) return;
  window.clearTimeout(senseiTimer);
  senseiTimer = 0;
  senseiOpen = true;
  // ここで 消すタイマーは しかけない。消すのは押されたときだけ
  if (c.kind === 'fact') {
    renderFactCard(c.fact, c.fact.a + c.fact.b);
    sfx.correct(0);
  } else {
    renderTriviaCard(c.item, true);
    sfx.star(1);
  }
}

function hideSensei(): void {
  window.clearTimeout(senseiTimer);
  senseiTimer = 0;
  senseiCard = null;
  senseiOpen = false;
  $('sensei-say').hidden = true;
}

/**
 * ふきだしを押しても、ホーくんを押したのと同じ（こたえが出る）。
 * ただし **こたえまで出ている ふきだしを押したら、閉じる。**
 * ふきだしは下の3つのボタンに かぶるので、読みおわったら消す手が要る。
 * ここで つぎのネタを出してしまうと、ボタンが ずっと隠れたままになる。
 */
$('sensei-say').addEventListener('click', () => {
  if (senseiCard && !senseiOpen) {
    unlockAudio();
    revealSensei();
    return;
  }
  hideSensei();
});

$('sensei').addEventListener('click', () => {
  unlockAudio();
  const owl = $('sensei');
  owl.classList.remove('talk');
  void owl.offsetWidth;
  owl.classList.add('talk');
  sfx.voice('bird');

  // もんだいが出ているだけなら、2回めの押しで こたえ
  if (senseiCard && !senseiOpen) {
    revealSensei();
    return;
  }
  const card = nextCard();
  if (!card) return;
  window.clearTimeout(senseiTimer);
  senseiCard = card;
  senseiOpen = false;
  if (card.kind === 'fact') {
    renderFactCard(card.fact, null);
    senseiTimer = window.setTimeout(revealSensei, SENSEI_WAIT);
  } else {
    renderTriviaCard(card.item, false);
    senseiTimer = window.setTimeout(revealSensei, TRIVIA_WAIT);
  }
});

/** ホームに戻る。描き直しを忘れないよう、必ずここを通す */
function goHome(): void {
  $('overlay-pause').hidden = true;
  renderTitle();
  // きろくを切りかえたあとなどは のこり時間が変わっている。節目の知らせを
  // 出しなおさないよう、時計の基準も ここで取りなおす
  refreshPlayClock();
  show('title');
}

// ------------------------------------------------------------------ きょうは ここまで

/** 0 になった ボタンの ことば。タイマーなら「おしまい」、1日の時間なら「きょうは おしまい」 */
function endLabel(): string {
  return sessionOver() ? 'おしまい' : 'きょうは おしまい';
}

/**
 * 「きょうは ここまで」の画面。show('rest') のたびに作りなおす。
 *
 * タイマーで おわったときは「じかんに なったよ」。夕方の空に 目ざまし時計が鳴り、
 * 「おうちの ひとに わたしてね」で終わる（1日の時間とちがい、あしたの話はしない）。
 */
function renderRest(): void {
  const p = profile();
  const session = sessionOver();
  screens.rest.dataset.reason = session ? 'session' : 'daily';
  paintSkinIcon($<HTMLCanvasElement>('rest-char'), currentLook(), session ? 96 : 120);
  $('rest-head').textContent = session ? 'じかんに なったよ！' : 'きょうは ここまで！';
  $('rest-who').textContent = session
    ? p.name ? `${p.name}、たのしかったね。` : 'たのしかったね。'
    : p.name ? `${p.name}、たくさん あそんだね。` : 'たくさん あそんだね。';
  $('rest-bye').textContent = session ? 'また あそぼうね！' : 'また あした あそぼう！';
  const min = save.settings.dailyLimitMin;
  $('rest-next').textContent = session
    ? 'おうちの ひとに わたしてね'
    : min ? `あしたは また ${min}${minuteWord(min)} あそべるよ` : '';
  // きろくが1つだけなら出さない。新しい きろくは関門の向こうなので、押しても行き場がない。
  // タイマーは端末に1つなので、きろくを かえても遊べない（出さない）
  $('rest-slots').hidden = session || usedSlots() < 2;
  // 目ざまし時計は タイマーのときだけ。出すたびに鳴らしなおす
  const clock = screens.rest.querySelector<HTMLElement>('.rest-clock');
  clock?.classList.remove('ringing');
  if (clock && session) requestAnimationFrame(() => clock.classList.add('ringing'));
}

$('rest-slots').addEventListener('click', () => {
  sfx.tap();
  showSlots();
});

/**
 * おしまいの画面から、元の画面へ戻る。
 * 画面は隠していただけなので、描きなおさずに出せば スクロールも タブも そのまま。
 * ステージの途中で打ち切ったときだけ、マップを描きなおす（★が動いているかもしれない）。
 */
function leaveRest(): void {
  const to = restFrom ?? 'title';
  if (to === 'title') {
    goHome();
    return;
  }
  if (to === 'map' && restRedraw) {
    mapView = 'stages';
    renderMap();
  }
  // ミニゲームの途中で打ち切ったなら、止まった盤面ではなく 一覧に戻す
  if (to === 'mini' && miniPlaying()) renderMiniList();
  show(to);
}

/**
 * 関門を解いた。えらんだ分だけ のばして、おしまいになる前の画面へ そのまま戻す。
 * タイマーと 1日の時間の両方が 0 なら 両方のばす（片方だけだと また すぐ おしまいになる）。
 */
function unlockFor(min: number): void {
  if (sessionOver()) extendSession(min);
  if (overDailyLimit()) extendToday(min * 60);
  refreshPlayClock();
  leaveRest();
}

$('rest-parent').addEventListener('click', () => {
  sfx.tap();
  // のばす時間を えらぶのも 関門の画面の中。解いたら もう1枚 はさまずに戻る
  openGate(unlockFor, '', { extend: true });
});

/** オーバーレイが出ているか。ガチャや たまごの結果を見ているあいだは切りかえない */
function overlayOpen(): boolean {
  return document.querySelector('#app > .overlay:not([hidden])') !== null;
}

let wasOver = timeUp();
/** 0 になった時刻（performance.now）。途中の ステージを 待つ長さを はかる */
let overAt = 0;

/** 遊んでいる途中か（ステージ・ミニゲームの1回ぶん）。0 になっても ここは待つ */
function midGame(): boolean {
  return current === 'play' || (current === 'mini' && miniPlaying());
}

/**
 * 時計が 1秒ごとに呼ぶ。のこりが 0 になったら「きょうは ここまで」へ、
 * 時間を足してもらったり 日付が変わったりしたら ホームへ戻す。
 *
 * ステージやミニゲームの途中は 終わるまで待つが、GRACE_SEC（3分）で打ち切る。
 * ハードルのエンドレスは 終わりがなく、ポーズのまま置くこともできるので、
 * 待ちっぱなしにすると 時間の意味がなくなる。
 */
function onClockTick(): void {
  const over = timeUp();
  if (over) {
    if (!wasOver) overAt = performance.now();
    if (midGame()) {
      if (performance.now() - overAt > GRACE_SEC * 1000) {
        // 打ち切ったステージには戻れないので、のばしたあとは その手前（マップ／ホーム）へ
        if (current === 'play') {
          runner.stop();
          restFrom = lastRun && lastRun.stage === 0 ? 'title' : 'map';
          restRedraw = true;
        } else {
          restFrom = 'mini';
        }
        $('overlay-pause').hidden = true;
        show('rest');
      }
    } else if (current !== 'rest' && LOCKED_WHEN_OVER.has(current) && !overlayOpen()) {
      restFrom = current;
      show('rest');
    }
  } else if (current === 'rest') {
    // 日付が変わった・ほかの画面で のばした。元の画面へ戻す
    leaveRest();
  }
  if (over !== wasOver) {
    wasOver = over;
    // 0 になった瞬間。見えているときだけ、やわらかい ベルで知らせる
    if (over && document.visibilityState === 'visible') sfx.alarm();
    // リザルトを見ているあいだに またいだら、ボタンの顔（つづける／きょうは おしまい）を合わせる
    if (current === 'result' && lastResult) {
      renderResultBtns(lastResult);
      renderResultEgg();
    }
  }
}

// ------------------------------------------------------------------ 進行状況

/** ワールドの通常ステージで集めた★ */
function normalStars(w: World): number {
  let n = 0;
  // 「ボスの手前まで」。面数を直接書くと、ステップ数を変えたときにずれる
  for (let s = 1; s < bossStage(w); s++) n += stageStars(w.id, s);
  return n;
}

/**
 * ステージが開いているか。
 * 通常ステージは前を1つでもクリアすれば開くが、ボスだけは★の合計で見る。
 * ★の下限は1なので、当てずっぽうで通過し続けた子はここで足が止まり、
 * 先のワールドに進めない（ゲームオーバーにはしない）。
 */
function stageUnlocked(w: World, stage: number): boolean {
  if (isBoss(w, stage)) return normalStars(w) >= bossRequirement(w);
  if (stage === 1) return true;
  return stageStars(w.id, stage - 1) > 0;
}

function worldUnlocked(id: number): boolean {
  if (id === 1) return true;
  const prev = worldById(id - 1);
  return stageStars(prev.id, bossStage(prev)) > 0;
}

function nextStageOf(worldId: number, stage: number): { world: World; stage: number } | null {
  if (stage < 1) return null; // デイリーには「つぎ」がない
  const w = worldById(worldId);
  if (stage < bossStage(w)) return { world: w, stage: stage + 1 };
  const nw = WORLDS.find((x) => x.id === worldId + 1);
  return nw ? { world: nw, stage: 1 } : null;
}

function starsInWorld(w: World): number {
  let n = 0;
  for (let s = 1; s <= bossStage(w); s++) n += stageStars(w.id, s);
  return n;
}

/** 解放済みの一番奥のワールド */
function lastPlayedWorld(): number {
  let id = 1;
  for (const w of WORLDS) if (worldUnlocked(w.id)) id = w.id;
  return id;
}

/**
 * 「いま」いる場所＝まだ★のついていない、いちばん手前のステージ。
 * ★が足りなくてまだ入れないボスもここに出す。行き止まりを隠すより、
 * 「つぎはボス、でも★が足りない」と見えているほうが分かりやすい。
 */
function currentSpot(): { worldId: number; stage: number } {
  for (const w of WORLDS) {
    if (!worldUnlocked(w.id)) continue;
    for (let stage = 1; stage <= bossStage(w); stage++) {
      if (stageStars(w.id, stage) === 0) return { worldId: w.id, stage };
    }
  }
  // ぜんぶ★つき。最後のボスを「いま」にしておく
  const last = WORLDS[WORLDS.length - 1];
  return { worldId: last.id, stage: bossStage(last) };
}

function spotLabel(spot: { worldId: number; stage: number }): string {
  const w = worldById(spot.worldId);
  return isBoss(w, spot.stage) ? `${w.id}-ボス` : `${w.id}-${spot.stage}`;
}

// ------------------------------------------------------------------ コインの使いみち

/**
 * いま、コインで何ができるか。
 *
 * 貯めていても「それで何ができるのか」が画面のどこにも出ていないと、
 * コインはただの数字になる。割れるなら割れると言い、足りないなら
 * あと何枚かを言う。行き先（ペット／きせかえ）もここで決める。
 *
 * ペットを先に見るのは、子どもが割りたがるのがペットのたまごだから。
 */
interface EggState {
  where: 'ranch' | 'shop';
  /** いま割れる／まわせる */
  ready: boolean;
  label: string;
  /** 見出しに入れる短いことば。「あと 37 コインで ガチャ」の最後の1語 */
  short: string;
  /** 絵。ペットは たまご（キラたまごまで届いていれば ✨）、きせかえは ガチャ */
  emoji: string;
  /** 届かないとき、目標までの残り。届いているときは 0 */
  need: number;
  cost: number;
  /**
   * ペットのたまごで、キラたまご（PET_EGG_SHINY_COST）まで届いている。
   * 「たまごが われる」だけだと、どちらの たまごなのかが ぼくじょうへ行くまで分からない。
   * キラたまごは レアが出やすいので、届いているなら それを先に言う
   */
  shiny: boolean;
}

/**
 * コインの行き先を ぜんぶ並べる（ペット → きせかえ の順）。
 * ぜんぶ集めおわった行き先は入れない。
 *
 * @param coins 数える枚数。リザルトは「走る前の枚数」からも描くので、引数で受ける
 */
function spendGoals(coins: number): EggState[] {
  const goals: EggState[] = [];
  if (ownedPets().length < PET_COUNT) {
    const shiny = coins >= PET_EGG_SHINY_COST;
    goals.push({
      where: 'ranch',
      ready: coins >= PET_EGG_COST,
      label: shiny ? 'キラたまご' : 'ペットの たまご',
      short: 'たまご',
      emoji: shiny ? '✨' : '🥚',
      need: Math.max(0, PET_EGG_COST - coins),
      cost: PET_EGG_COST,
      shiny,
    });
  }
  if (lockedItems().length > 0) {
    goals.push({
      where: 'shop',
      ready: coins >= GACHA_COST,
      label: 'きせかえの ガチャ',
      short: 'ガチャ',
      emoji: '🎁',
      need: Math.max(0, GACHA_COST - coins),
      cost: GACHA_COST,
      shiny: false,
    });
  }
  return goals;
}

/** 割れる／まわせるものの動作。ペットは「われる」、きせかえは「まわせる」 */
function spendVerb(g: EggState): string {
  return g.where === 'shop' ? 'まわせる' : 'われる';
}

// ------------------------------------------------------------------ ホーム

function renderTitle(): void {
  const p = profile();
  const needsSetup = !p.name;
  $('skin-pick').hidden = !needsSetup;
  $('home').hidden = needsSetup;
  $('title-sub').hidden = needsSetup;
  $('yard').hidden = needsSetup;
  $('start-main').textContent = needsSetup ? 'はじめる' : 'あそぶ';
  $('start-sub').hidden = true;
  if (!needsSetup) startHomeIdle();

  if (needsSetup) {
    const row = $('skin-row');
    row.replaceChildren();
    for (const skin of SKINS.slice(0, 3)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-btn';
      b.setAttribute('aria-pressed', String(p.skin === skin.id));
      const c = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = skin.label;
      b.append(c, label);
      b.addEventListener('click', () => {
        profile().skin = skin.id;
        persist();
        sfx.tap();
        renderTitle();
      });
      row.appendChild(b);
      paintSkinIcon(c, { skin: skin.id }, 56);
    }
    $<HTMLInputElement>('name-input').value = p.name;
    return;
  }

  refreshDaily(p);
  // 走ったあとは にがての顔ぶれが変わっている。ホーくんの手札は取りなおす
  senseiList = [];
  senseiAt = 0;
  hideSensei();
  $('hello').textContent = `${p.name} の ぼうけん`;
  $('hello').setAttribute('aria-label', `${p.name} の ぼうけん。きろくを えらぶ`);
  $('home-coins').textContent = String(p.coins);

  // 1日の上限に達したら、遊ぶ導線だけ閉じる（図鑑ときせかえは見られる）
  const over = timeUp();
  const startBtn = $<HTMLButtonElement>('btn-start');
  const daily = $('daily-card');
  const hunt = $<HTMLButtonElement>('hunt-card');
  startBtn.disabled = over;

  // ミニゲームも「あそび」なので、1日の上限の中に入れる。
  // ここだけ外に置くと、上限をつけた家庭で ミニゲームだけ無限に遊べてしまう。
  const left = miniLeftToday();
  $<HTMLButtonElement>('mini-card').disabled = over;
  // 半分の幅のカードなので、2行に折れない長さで書く
  $('mini-card-state').textContent = over
    ? 'また あした'
    : left > 0
      ? `ごほうび ${left}こ`
      : 'あそべるよ';
  $('mini-card').classList.toggle('done', !over && left === 0);

  // にがて たいじ。相手がいないと始まらないので、何ひきいるかを先に出す
  const weak = weakFactCount(unlockedFacts());
  hunt.disabled = over || weak === 0;
  $('hunt-state').textContent = over
    ? 'また あした'
    : weak === 0
      ? 'にがては いないよ！'
      : `にがて ${Math.min(weak, HUNT_MAX)}ひき`;
  $('start-main').textContent = over ? 'きょうは おしまい' : 'あそぶ';

  // 開いた時点で「つぎはどこか」が読めるようにする
  const spot = currentSpot();
  const sub = $('start-sub');
  sub.hidden = over;
  sub.textContent = `つぎは ${spotLabel(spot)}`;

  daily.classList.toggle('done', p.daily.done);
  // 何問やるかは このカードの中で直接えらぶ（1・3・5）。
  // ふだんは説明の行を出さない。ボタンの数と ●の数で足りている
  const dstate = $('daily-state');
  dstate.hidden = !(over || p.daily.done);
  // もらいずみの日は ✓ だけ。カードの枠も緑になるので、字を足す必要がない
  dstate.textContent = over ? 'また あした' : '✓ クリア';
  renderDailyQty(over);
  const streak = $('home-streak');
  streak.hidden = p.daily.streak < 1;
  const sb = streak.querySelector('b');
  if (sb) sb.textContent = String(p.daily.streak);

  // ずかんは、開かないと何も起きない画面。開く理由はボタンの 🆕 だけで出す。
  // 棒グラフの行をホームに並べていたころは、遊ぶ前に読む行が増えるわりに、
  // 子どもは伸びた棒を眺めて終わっていた（進みぐあいは ずかんの中にある）
  const pets = ownedPets().length;
  $('zukan-badge').hidden = !(zukanPrizeReady() > 0 || zukanNewCount() > 0);

  // いま「まわせる／割れる」入口にだけ合図を出す（両方なら両方）
  $('shop-badge').hidden = !(lockedItems().length > 0 && p.coins >= GACHA_COST);
  $('ranch-badge').hidden = !(pets < PET_COUNT && p.coins >= PET_EGG_COST);
}

$('btn-start').addEventListener('click', () => {
  const p = profile();
  if (!p.name) {
    // trim してから既定値に落とす。先に || を書くと、空白だけの入力が
    // truthy なので 'きみ' に落ちず、名前が空のままマップへ進んでしまう。
    p.name = $<HTMLInputElement>('name-input').value.trim().slice(0, 6) || 'きみ';
    persist();
    renderTitle(); // 戻ってきたときのホームを先に作っておく
  }
  sfx.tap();
  // まずは「せかい ぜんぶ」から。どこまで来たかを毎回いちど目に入れる
  mapWorld = lastPlayedWorld();
  mapView = 'worlds';
  renderMap();
  show('map');
});

// ------------------------------------------------------------------ きろく（セーブデータ）

/** そのきろくが集めた★の合計 */
function starsOf(stars: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(stars)) n += v;
  return n;
}

/** 消す前に確認するきろくの番号。-1 は確認中でない */
let eraseTarget = -1;

function renderSlots(): void {
  const list = $('slot-list');
  list.replaceChildren();

  slots().forEach((p, i) => {
    const empty = isEmptySlot(p);
    const card = document.createElement('div');
    card.className = `slot${empty ? ' empty' : ''}${i === save.active && !empty ? ' current' : ''}`;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'slot-pick';

    const c = document.createElement('canvas');
    c.className = 'slot-face';
    const body = document.createElement('span');
    body.className = 'slot-body';

    if (empty) {
      const name = document.createElement('b');
      name.textContent = 'あたらしい ぼうけん';
      const sub = document.createElement('span');
      sub.textContent = 'ここから はじめる';
      body.append(name, sub);
      const plus = document.createElement('span');
      plus.className = 'slot-plus';
      plus.textContent = '＋';
      pick.append(plus, body);
    } else {
      const name = document.createElement('b');
      name.textContent = p.name;
      const sub = document.createElement('span');
      const zukan = Object.values(p.facts).filter((s) => s.m >= MASTERED).length;
      sub.textContent = `★${starsOf(p.stars)}　コイン ${p.coins}　ずかん ${zukan}`;
      const seen = document.createElement('small');
      seen.textContent = p.seen ? `さいごに あそんだ日 ${p.seen}` : 'まだ あそんでいません';
      body.append(name, sub, seen);
      pick.append(c, body);
      queueMicrotask(() => paintSkinIcon(c, { skin: p.skin, hat: p.hat, acc: p.acc, color: p.color }, 54));
    }

    pick.addEventListener('click', () => {
      sfx.tap();
      const go = (): void => {
        selectSlot(i);
        goHome();
      };
      // 時間の制限をかけているあいだは、新しい きろくを作るのに関門を通す。
      // 時間は きろくごとに数えるので、ここが素通りだと「新しい きろくを作れば
      // また遊べる」になってしまう
      if (empty && save.settings.dailyLimitMin > 0) {
        openGate(go, 'あたらしい きろくは、おうちの ひとと いっしょに つくってね');
      } else {
        go();
      }
    });
    card.appendChild(pick);

    if (!empty) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'slot-del';
      del.textContent = 'けす';
      del.setAttribute('aria-label', `${p.name} の きろくを けす`);
      del.addEventListener('click', () => {
        sfx.tap();
        eraseTarget = i;
        $('erase-name').textContent = `${p.name} の ぼうけん`;
        $('overlay-erase').hidden = false;
      });
      card.appendChild(del);
    }

    list.appendChild(card);
  });
}

function showSlots(): void {
  renderSlots();
  show('slots');
}

$('hello').addEventListener('click', () => {
  sfx.tap();
  showSlots();
});

$('btn-slots').addEventListener('click', () => {
  sfx.tap();
  $('overlay-settings').hidden = true;
  showSlots();
});

$('slots-back').addEventListener('click', () => {
  sfx.tap();
  // 名前の無い枠を選んだまま戻ると行き場が無いので、必ずホームを作りなおす
  goHome();
});

$('erase-cancel').addEventListener('click', () => {
  eraseTarget = -1;
  $('overlay-erase').hidden = true;
});

$('erase-ok').addEventListener('click', () => {
  if (eraseTarget >= 0) clearSlot(eraseTarget);
  eraseTarget = -1;
  $('overlay-erase').hidden = true;
  renderSlots();
});

// ロゴをさわると、広場のみんながいっせいに跳ねる
$('logo').addEventListener('pointerdown', () => {
  unlockAudio();
  yard.cheerAll();
});

function goZukan(): void {
  sfx.tap();
  openZukan();
  show('zukan');
}

$('btn-zukan').addEventListener('click', goZukan);

$('zukan-back').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

/**
 * きせかえ／ぼくじょうを開く。
 *
 * ゲームの途中（リザルト）から来たときは、遊びが途切れないように
 * 「つづきを あそぶ」を足し、← ではリザルトへ戻す。
 * ホームまで戻らないと続きに行けないと、たまごを割ったところで手が止まる。
 */
function openCollection(where: 'shop' | 'ranch', from: 'home' | 'result'): void {
  shopFrom = from;
  if (where === 'shop') renderShop();
  else renderRanch();

  const play = $<HTMLButtonElement>(where === 'shop' ? 'shop-play' : 'ranch-play');
  play.hidden = from !== 'result' || timeUp();
  if (!play.hidden) {
    const next = lastResult && nextStageOf(lastResult.worldId, lastResult.stage);
    play.textContent = next ? 'つづきを あそぶ' : nextLabel();
  }
  show(where);
}

/** きせかえ／ぼくじょうから戻る。来た場所へ返す */
function leaveCollection(): void {
  sfx.tap();
  if (shopFrom === 'result' && lastResult) {
    renderResultEgg();
    show('result');
  } else {
    goHome();
  }
}

$('btn-shop').addEventListener('click', () => {
  sfx.tap();
  openCollection('shop', 'home');
});

$('btn-ranch').addEventListener('click', () => {
  sfx.tap();
  openCollection('ranch', 'home');
});

$('shop-back').addEventListener('click', leaveCollection);
$('ranch-back').addEventListener('click', leaveCollection);

$('shop-play').addEventListener('click', () => {
  sfx.tap();
  goNext();
});

$('ranch-play').addEventListener('click', () => {
  sfx.tap();
  goNext();
});

// ------------------------------------------------------------------ デイリー・にがて たいじ

/** いま出しても良い式。まだ開いていないせかいの式は出さない */
function unlockedFacts(): Fact[] {
  return WORLDS.filter((x) => worldUnlocked(x.id)).flatMap((x) => allFacts(x));
}

/**
 * にがて たいじ に出す にがての数。
 *
 * 5ひきは、10問のステージの半分。倒すたびに演出が入るぶん、
 * 数を増やすとテンポが落ちる。残りは つぎに挑んだときの相手になる。
 */
const HUNT_MAX = 5;

/**
 * きょうの もんだい で えらべる問題数。
 *
 * 5問だけだったころは、気乗りしない日の逃げ場が「やらない」しかなく、
 * そこで れんぞくが切れていた。1問なら たいてい やる。
 * 数を増やすほどコインは増えるので、5問を選ぶ理由は残してある（dailyBonus）。
 */
const DAILY_COUNTS = [1, 3, 5];

/**
 * きょうの もんだい に出す式。
 *
 * **前半は やさしく、さいごの1問だけ いま取り組んでいるところから出す。**
 * 以前は5問ぜんぶ「いちばん にがてな式」だったので、毎日いちばん重い5問を
 * 出されることになり、開く理由のほうが先に折れていた。
 * 助走で「解ける」を数回ふませてから、いまの1問に当てる形にする。
 */
function dailyFacts(count: number): Fact[] {
  const pool = unlockedFacts();
  // 「いま」いるステージの式。ボスの手前で止まっているときは そのワールド全体
  const spot = currentSpot();
  const w = worldById(spot.worldId);
  const here = isBoss(w, spot.stage) ? allFacts(w) : (stepOf(w, spot.stage)?.facts ?? allFacts(w));
  const last = weakestFacts(here.length ? here : pool, 1);
  return [...easiestFacts(pool, count - 1, last), ...last];
}

function startDaily(count: number): void {
  refreshDaily(profile()); // 日付をまたいだまま開きっぱなしのことがある
  startRun({
    world: DAILY_WORLD,
    stage: 0,
    mode: 'daily',
    total: count,
    boss: false,
    label: `きょうの ${count}もん`,
    facts: dailyFacts(count),
    // 並べた順に出す。さいごの1問が「いまのレベル」なのは、順番が守られて初めて成り立つ
    ordered: true,
    saveStars: false,
  });
}

/**
 * 「なんもん やる？」を、ホームのカードの中に置く。
 *
 * 以前は カードを押す → 別画面で 1／3／5 を選ぶ、の2段だった。あいだの画面には
 * 「まえの ほうは かんたんな しき…」という説明が2行あり、遊びはじめるまでに
 * 読む字と ひと押しが増えるだけだった（説明の中身は おうちのかた の画面にある）。
 *
 * 字ではなく数で分かるように、ボタンには **問題の数だけ ●** をならべる。
 * ごほうびのコインも 数字と絵だけで出す（1日1回きり。もらいずみの日は出さない）。
 */
function renderDailyQty(over: boolean): void {
  const p = profile();
  const row = $('daily-qty');
  row.replaceChildren();
  for (const n of DAILY_COUNTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qty-btn';
    b.disabled = over;
    b.setAttribute('aria-label', `きょうの もんだいを ${n}もん あそぶ`);

    // ●の数 ＝ 問題の数。字が読めなくても「多い・少ない」が見て分かる
    const pips = document.createElement('span');
    pips.className = 'qty-pips';
    pips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < n; i++) pips.appendChild(document.createElement('i'));

    const big = document.createElement('b');
    big.textContent = String(n);

    b.append(pips, big);
    // ごほうびは1日1回きり。もらいずみの日と 上限の日は、コインの行を出さない
    if (!over && !p.daily.done) {
      const coin = document.createElement('span');
      coin.className = 'qty-coin';
      coin.setAttribute('aria-hidden', 'true');
      const dot = document.createElement('span');
      dot.className = 'coin-dot';
      const num = document.createElement('i');
      num.textContent = String(dailyBonus(n));
      coin.append(dot, num);
      b.appendChild(coin);
    }

    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startDaily(n);
    });
    row.appendChild(b);
  }
}

/**
 * にがて たいじ。
 *
 * 「きょうの もんだい」は日に1回で終わってしまうので、いつでも挑める場をもう1つ置く。
 * こちらは にがてと記録された式だけを相手にして、時間制限なしで倒していく。
 * 相手が1ひきもいない日は、そもそもカードが押せない（renderTitle）。
 */
$('hunt-card').addEventListener('click', () => {
  unlockAudio();
  sfx.tap();
  const facts = weakFacts(unlockedFacts(), HUNT_MAX);
  if (facts.length === 0) return;
  startRun({
    world: HUNT_WORLD,
    stage: 0,
    mode: 'hunt',
    total: facts.length,
    boss: false,
    label: 'にがて たいじ',
    facts,
    // にがては 1けたどうしとは限らない。ワールドの穴埋め設定は借りない
    blank: false,
    bonusCoins: COIN_HUNT,
    saveStars: false,
  });
});

/**
 * ミニゲーム。
 *
 * 走る導線（あそぶ・きょうの もんだい・にがて たいじ）とちがって、
 * 1日の上限に達しても開ける。ここは時間で追われない れんしゅう場で、
 * 記録（★・図鑑・習熟度）も動かさないため、上限の対象にしていない。
 */
$('mini-card').addEventListener('click', () => {
  unlockAudio();
  sfx.tap();
  renderMiniList();
  show('mini');
});

// ------------------------------------------------------------------ マップ

/** ステージの時間帯。みちのマスに小さく出す */
// 'hunt' はマップに出てこない（にがて たいじ はホームから入る）が、
// Record の型を満たすために置いておく
const TIME_ICON: Record<TimeId, string> = {
  day: '☀️', dawn: '🌅', sunset: '🌇', night: '🌙', boss: '⚡', hunt: '👹',
};
const TIME_NAME: Record<TimeId, string> = {
  day: 'ひるま', dawn: 'あさ', sunset: 'ゆうがた', night: 'よる', boss: 'ボス', hunt: 'にがて',
};

/** そのワールドで、つぎに遊ぶステージ（ぜんぶクリア済みなら 0） */
function nextStageIn(w: World): number {
  for (let s = 1; s <= bossStage(w); s++) {
    if (stageUnlocked(w, s) && stageStars(w.id, s) === 0) return s;
  }
  return 0;
}

function totalStars(): number {
  return WORLDS.reduce((n, w) => n + starsInWorld(w), 0);
}

function maxStars(): number {
  return WORLDS.reduce((n, w) => n + bossStage(w) * 3, 0);
}

function starRow(got: number): string {
  return [0, 1, 2].map((i) => `<span class="${i < got ? '' : 'off'}">★</span>`).join('');
}

function renderMap(): void {
  // となりの せかいへ うつっている途中に ← や せかいを押されたら、うつるのを先に終わらせる
  // （写しが残ったまま 別の道を描くと、写しを外したときに位置がずれる）
  endSlide?.();
  $('map-coins').textContent = String(profile().coins);
  if (mapView === 'worlds') renderWorldList();
  else renderStagePath();
}

/**
 * せかいの一覧。
 * 「ぜんぶで いくつ あって、いま どこまで来たか」をこの画面だけで分かるようにする。
 * 鍵のかかった先も名前と面数まで見せる（次に何が待っているか分かるほうが進みたくなる）。
 */
function renderWorldList(): void {
  $('world-view').hidden = false;
  $('stage-view').hidden = true;
  screens.map.style.removeProperty('--wc');

  const cleared = WORLDS.filter((w) => stageStars(w.id, bossStage(w)) > 0).length;
  $('map-world').textContent = 'せかい ぜんぶ';
  $('map-desc').textContent = `${WORLDS.length}つの せかい・クリア ${cleared}／${WORLDS.length}`;

  const got = totalStars();
  const max = maxStars();
  $('total-bar').style.width = `${(got / max) * 100}%`;
  $('total-count').textContent = `★ ${got} / ${max}`;

  const here = lastPlayedWorld();
  const list = $('world-list');
  list.replaceChildren();

  for (const w of WORLDS) {
    const open = worldUnlocked(w.id);
    const stars = starsInWorld(w);
    const full = bossStage(w) * 3;
    const done = stageStars(w.id, bossStage(w)) > 0;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = `world-card${open ? '' : ' locked'}${done ? ' done' : ''}${open && w.id === here ? ' here' : ''}`;
    b.style.setProperty('--wc', w.color);
    b.disabled = !open;
    b.innerHTML =
      `<span class="wc-badge"><span class="wc-emoji">${open ? w.emoji : '🔒'}</span><b>${w.id}</b></span>` +
      `<span class="wc-main">` +
      `<b class="wc-name">${open ? w.name : '？？？'}</b>` +
      `<span class="wc-desc">${open ? w.desc : 'まえの ボスを たおすと ひらく'}</span>` +
      `<span class="bar"><i style="width:${open ? (stars / full) * 100 : 0}%"></i></span>` +
      `</span>` +
      `<span class="wc-right">` +
      `<span class="wc-stars">★ ${open ? stars : 0}<small>/${full}</small></span>` +
      `<span class="wc-stages">${stageCount(w)}めん＋ボス</span>` +
      `</span>` +
      (done ? '<span class="wc-flag">クリア</span>' : open && w.id === here ? '<span class="wc-flag now">いま ここ</span>' : '');

    b.addEventListener('click', () => {
      sfx.tap();
      mapWorld = w.id;
      mapView = 'stages';
      renderMap();
    });
    list.appendChild(b);
  }

  $('map-hint').textContent = timeUp()
    ? 'きょうの ぼうけんは ここまで。また あした！'
    : `せかいを タップすると、なかの みちが みえるよ`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 飾りの置き場所を散らすための、決まった並びの乱数（0〜1）。開くたびに位置が変わらないようにする */
function spread(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 道のわきの飾り（木・花・ビル・ヤシ…）。マスとは反対の側に置く。
 * 同じ側に置くとマスや「いま ここ」の札とかさなって、押すところが読めなくなる。
 */
function decoFor(w: World, i: number, k: number, far = false): HTMLElement {
  const look = mapLook(w.id);
  const d = document.createElement('span');
  d.className = `path-deco${far ? ' far' : ''}`;
  d.setAttribute('aria-hidden', 'true');
  d.textContent = look.deco[(i + (far ? 3 : 0)) % look.deco.length];
  const r = spread(w.id * 31 + i + (far ? 97 : 0));
  // マスが右にふれていれば左、左なら右。まんなかのときは交互
  const away = k > 0.15 ? 'left' : k < -0.15 ? 'right' : i % 2 ? 'left' : 'right';
  if (far) {
    // 広い画面だけ出す2つめ（.far）。マスと同じがわの、さらに外のはしに置く。
    // 行ごと k * 20% ずれるので、そのぶんを足して画面の外へ出ないようにする
    const side = away === 'left' ? 'right' : 'left';
    d.style.setProperty(side, `${3 + Math.abs(k) * 20 + r * 5}%`);
  } else {
    d.style.setProperty(away, `${4 + r * 12}%`);
  }
  d.style.setProperty('--dy', `${Math.round((spread(i + (far ? 23 : 5)) - 0.5) * 36)}px`);
  d.style.setProperty('--ds', (0.85 + spread(i + 11) * 0.5).toFixed(2));
  d.style.setProperty('--dr', `${Math.round((r - 0.5) * 16)}deg`);
  return d;
}

/**
 * 道を描く。マスを並べおわってから、マスの中心どうしを なめらかな曲線でつなぐ。
 *
 * 形を先に決めてマスを置くのではなく、置いたマスの位置を測ってから線を引く。
 * マスは CSS で左右にふっているので、画面のはばが変わっても道がマスからずれない
 * （向きを変えたときは ResizeObserver から呼びなおす）。
 *
 * 行ったことのある区間（そのマスが開いている）は せかいの色の線、まだの区間は白い点線。
 * 「どこまで来たか」が、道そのものの色で分かる。
 */
function drawRoad(): void {
  const path = $('stage-path');
  const svg = path.querySelector<SVGSVGElement>('svg.road');
  if (!svg || screens.map.hidden || $('stage-view').hidden) return;
  const box = path.getBoundingClientRect();
  if (box.width < 2) return;
  const pts = Array.from(path.querySelectorAll<HTMLElement>('[data-road]')).map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, walked: el.dataset.road === '1', lead: false };
  });
  if (!pts.length) return;
  // となりの せかいへ続く道。上のはしから スタートへ、「つぎの せかい」から下のはしへ、
  // まっすぐ伸ばす。せかいを たてに つないだとき、つなぎ目で道が1本につながる（slideToWorld）
  if (path.dataset.leadIn) pts.unshift({ x: pts[0].x, y: 0, walked: true, lead: true });
  if (path.dataset.leadOut) {
    const last = pts[pts.length - 1];
    pts.push({ x: last.x, y: box.height, walked: path.dataset.leadOut === '1', lead: true });
  }
  let all = '';
  let lead = '';
  let walked = '';
  let rest = '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const my = (a.y + b.y) / 2;
    const seg = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${a.x.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (a.lead || b.lead) lead += seg;
    else all += seg;
    if (b.walked) walked += seg;
    else rest += seg;
  }
  svg.setAttribute('viewBox', `0 0 ${box.width.toFixed(0)} ${box.height.toFixed(0)}`);
  svg.setAttribute('width', box.width.toFixed(0));
  svg.setAttribute('height', box.height.toFixed(0));
  // はしへ伸ばす区間（lead）だけ、線のはしを丸めない。丸いと つなぎ目で となりの せかいの道に
  // 半円がはみ出して、道が1本に見えない
  svg.innerHTML =
    `<path class="road-edge" d="${all}"/><path class="road-edge lead" d="${lead}"/>` +
    `<path class="road-bed" d="${all}"/><path class="road-bed lead" d="${lead}"/>` +
    `<path class="road-walked" d="${walked}"/>` +
    `<path class="road-rest" d="${rest}"/>`;
}

// 向きを変えた・はばが変わったときに、道をマスに合わせなおす
if (typeof ResizeObserver === 'function') new ResizeObserver(() => drawRoad()).observe($('stage-path'));

/**
 * ステージの道。ぐねぐねした一本道に、ステージが順番に並ぶ。
 * 前のマス目グリッドだと「あと何面あるのか」「いまどこか」が読み取れなかった。
 *
 * @param focus 開いたときに どこを見せるか。
 *              'now' は「いま ここ」（無ければ いちばん上）、'end' は いちばん下、
 *              'keep' は動かさない（となりの せかいへ つなぐときは slideToWorld が動かす）
 */
function renderStagePath(focus: 'now' | 'end' | 'keep' = 'now'): void {
  const w = worldById(mapWorld);
  $('world-view').hidden = true;
  $('stage-view').hidden = false;
  screens.map.style.setProperty('--wc', w.color);
  const look = mapLook(w.id);
  const view = $('stage-view');
  view.style.setProperty('--land-1', look.land[0]);
  view.style.setProperty('--land-2', look.land[1]);
  view.style.setProperty('--land-dot', look.dot);
  view.style.setProperty('--road', look.road);
  view.style.setProperty('--road-edge', look.roadEdge);
  view.style.setProperty('--road-dash', look.dash);

  const next = nextStageIn(w);

  $('map-world').textContent = `${w.emoji} ${w.id}. ${w.name}`;
  // 「つぎに何を練習するか」を名前で見せる。ステージ番号だけだと中身が読めない
  const nextStep = stepOf(w, next);
  $('map-desc').textContent = nextStep
    ? `${w.desc}　・　つぎは「${nextStep.name}」`
    : `${w.desc}　・　${stageCount(w)}めん＋ボス`;

  const path = $('stage-path');
  path.replaceChildren();

  // 道は いちばん うしろ。マスと飾りを置いてから drawRoad で線を引く
  const road = document.createElementNS(SVG_NS, 'svg');
  road.classList.add('road');
  road.setAttribute('aria-hidden', 'true');
  path.appendChild(road);

  // スタート。道の はじまりを はっきりさせる（いきなり 1 のマスから始まると、
  // どちらが はじめで どちらが おわりか 読めない）。まえの せかいが あれば、そこへ戻れる
  const pw = WORLDS.find((x) => x.id === w.id - 1);
  const start = document.createElement('div');
  start.className = 'path-start';
  start.dataset.road = '1';
  start.innerHTML = '<span class="ps-flag" aria-hidden="true">🚩</span><b>スタート</b>';
  if (pw) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'world-hop prev';
    back.setAttribute('aria-label', `まえの せかい ${pw.id}. ${pw.name}`);
    back.innerHTML = `<span aria-hidden="true">‹</span>${pw.emoji} ${pw.id}`;
    back.addEventListener('click', () => {
      sfx.tap();
      slideToWorld(pw.id, -1);
    });
    start.appendChild(back);
  }
  path.appendChild(start);

  for (let stage = 1; stage <= bossStage(w); stage++) {
    const boss = isBoss(w, stage);
    const open = stageUnlocked(w, stage);
    const got = stageStars(w.id, stage);

    const row = document.createElement('div');
    row.className = `node-row${boss ? ' boss-row' : ''}`;
    // 一本道をぐねぐねさせる。sin にしておくと、面数が変わっても形が破綻しない
    const k = Math.sin(stage * 0.9);
    row.style.setProperty('--k', k.toFixed(3));

    const b = document.createElement('button');
    b.type = 'button';
    const here = stage === next && open;
    const step = stepOf(w, stage);
    // いま挑むところはオレンジで光らせる。押す場所で迷わせない
    b.className =
      `stage-node${boss ? ' boss' : ''}${got > 0 ? ' cleared' : ''}` +
      `${!open ? ' locked' : ''}${here ? ' now' : ''}`;
    b.disabled = !open || timeUp();
    // 道の線は、開いているマスまでを「行ったことのある道」にする
    b.dataset.road = open ? '1' : '0';
    // ステージごとに景色（時間帯）が変わることを、遊ぶ前に見せる。
    // 名前はマスの中に入れる。外にぶら下げると、隣のマスの「いま ここ」札とぶつかる
    b.innerHTML =
      `<span class="when" aria-hidden="true">${TIME_ICON[timeIdFor(stage, boss)]}</span>` +
      `<span class="sn-label">${!open ? '🔒' : boss ? '👑' : stage}</span>` +
      (open && step ? `<span class="sn-name">${step.name}</span>` : '') +
      `<span class="st">${starRow(got)}</span>`;
    b.setAttribute(
      'aria-label',
      `${boss ? 'ボス' : `ステージ ${stage} ${step?.name ?? ''}`}${here ? '（いま ここ）' : ''}` +
        ` ${TIME_NAME[timeIdFor(stage, boss)]} ほし ${got}`,
    );

    b.addEventListener('click', () => {
      unlockAudio();
      sfx.tap();
      startStage(w, stage);
    });
    // ボスのマスには 飾りを置かない（かわりに 奥に あやしい光を出す: .boss-row）
    if (!boss) row.append(decoFor(w, stage, k), decoFor(w, stage, k, true));
    row.appendChild(b);

    // ふだ（「ボス」「いま ここ」）はマスの中に絶対配置する。
    // 行に並べると、その行だけマスが道からずれる
    if (boss) {
      const tag = document.createElement('span');
      tag.className = 'node-tag boss-tag';
      const need = bossRequirement(w) - normalStars(w);
      tag.textContent = open ? 'ボス' : `★あと ${need}`;
      b.appendChild(tag);
    }
    if (here) {
      const tag = document.createElement('span');
      tag.className = 'node-tag now';
      tag.textContent = 'いま ここ';
      b.appendChild(tag);
    }
    path.appendChild(row);
  }

  // つぎの せかいへの ひきつづき。先に何があるか見せて、進みたくさせる。
  // もう開いていれば ボタンにして、押すと 道をたどって たてに つぎの せかいの みちへ うつる
  // （いちど「せかい ぜんぶ」へ戻ってから選びなおす、を しなくていい）
  const nw = WORLDS.find((x) => x.id === w.id + 1);
  const bossDone = stageStars(w.id, bossStage(w)) > 0;
  let goal: HTMLElement;
  if (nw && worldUnlocked(nw.id)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'path-goal go';
    btn.style.setProperty('--wc', nw.color);
    btn.innerHTML = `<span class="pg-emoji" aria-hidden="true">${nw.emoji}</span>` +
      `<span class="pg-text"><b>つぎの せかいへ</b><span>${nw.id}. ${nw.name}</span></span>` +
      '<span class="pg-go" aria-hidden="true">›</span>';
    btn.addEventListener('click', () => {
      sfx.tap();
      slideToWorld(nw.id, 1);
    });
    goal = btn;
  } else {
    goal = document.createElement('div');
    goal.className = 'path-goal';
    if (nw) {
      goal.style.setProperty('--wc', nw.color);
      goal.innerHTML = `<span class="pg-emoji">🔒</span>` +
        `<span class="pg-text"><b>つぎの せかい</b><span>ボスを たおすと ひらく</span></span>`;
    } else {
      goal.innerHTML = `<span class="pg-emoji">🏁</span>` +
        `<span class="pg-text"><b>さいごの せかい</b><span>ここを クリアで ぜんぶ せいは！</span></span>`;
    }
  }
  goal.dataset.road = bossDone ? '1' : '0';
  path.appendChild(goal);
  // 上と下のはしまで道を伸ばすか（drawRoad）。となりの せかいがある向きだけ伸ばす
  if (pw) path.dataset.leadIn = '1';
  else delete path.dataset.leadIn;
  if (nw) path.dataset.leadOut = bossDone ? '1' : '0';
  else delete path.dataset.leadOut;

  // 面が増えると「いま ここ」が画面の外にいることがある。開いた時点で見えるところへ寄せる。
  // scrollIntoView は使わない（画面ぜんたいまで動かすことがある）。道の箱だけを動かす
  requestAnimationFrame(() => {
    drawRoad();
    if (focus === 'keep') return;
    const scroller = path.parentElement as HTMLElement;
    scroller.scrollTop = focus === 'end' ? scroller.scrollHeight : focusTop(path, scroller);
  });

  const bossNeed = bossRequirement(w) - normalStars(w);
  $('map-hint').textContent = timeUp()
    ? 'きょうの ぼうけんは ここまで。また あした！'
    : bossNeed > 0
      ? `ボスまで あと ★${bossNeed}　（いま ★${starsInWorld(w)}）`
      : `★ ${starsInWorld(w)} / ${bossStage(w) * 3}　ボスに いどめる！`;
}

/**
 * 道の箱（scroller）を どこまで送れば「いま ここ」が まんなかに来るか。
 * 「いま ここ」が無い（ぜんぶクリア・まだ開いていない）ときは いちばん上。
 */
function focusTop(path: HTMLElement, scroller: HTMLElement): number {
  const now = path.querySelector<HTMLElement>('.stage-node.now');
  if (!now) return 0;
  const pr = path.getBoundingClientRect();
  const nr = now.getBoundingClientRect();
  const y = nr.top - pr.top + nr.height / 2 - scroller.clientHeight / 2;
  return Math.max(0, Math.min(y, path.offsetHeight - scroller.clientHeight));
}

/** となりの せかいへ うつっている途中なら、そこで終わらせる関数。うつっていなければ null */
let endSlide: (() => void) | null = null;

/**
 * となりの せかいの みちへ、道をたどって たてに うつる。
 *
 * 地図は上から下へ進む（スタート → 1 → … → ボス → つぎの せかい）。だから
 * つぎの せかいは「いまの道の下」に、まえの せかいは「上」につなげて置き、
 * 箱ごと なめらかに送る。道は せかいの はしまで伸ばしてあるので（drawRoad の lead）、
 * つなぎ目で1本につながったまま、地面の色だけが変わっていく。
 * 横に すべらせていたころは、道が画面の外で切れて「つながっている」が見えなかった。
 *
 * しくみ: いまの道を写しとった板（ghost）を、新しい道の上（または下）に じかに並べ、
 * 押した瞬間と同じ景色になる位置へ scrollTop を合わせてから、目的の位置まで送る。
 * 着いたら写しを外し、同じ景色のまま scrollTop を付けかえる（画面は動かない）。
 *
 * @param dir 1 = つぎの せかい（下へ進む）、-1 = まえの せかい（上へ戻る）
 */
function slideToWorld(id: number, dir: 1 | -1): void {
  const path = $('stage-path');
  const scroller = path.parentElement as HTMLElement;
  if (endSlide) return;
  // まえの せかいへ戻ったときは、つながっている下のはし（ボスと「つぎの せかいへ」）を見せる
  const focus = dir > 0 ? 'now' : 'end';
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) {
    mapWorld = id;
    renderStagePath(focus);
    return;
  }

  const ghost = path.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  ghost.classList.add('ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  // 色は画面から受けついでいる。新しい せかいの色に変わる前に、写しへ じかに書いておく
  const cs = getComputedStyle(path);
  for (const v of ['--land-1', '--land-2', '--land-dot', '--road', '--road-edge', '--road-dash', '--wc']) {
    ghost.style.setProperty(v, cs.getPropertyValue(v));
  }
  const oldTop = scroller.scrollTop;

  mapWorld = id;
  renderStagePath('keep');
  if (dir > 0) scroller.insertBefore(ghost, path);
  else scroller.appendChild(ghost);
  drawRoad();

  const gh = ghost.offsetHeight;
  const ph = path.offsetHeight;
  // 押した瞬間と同じ景色。つぎへ: 写しが上にある／まえへ: 写しが下にある
  const from = dir > 0 ? oldTop : ph + oldTop;
  const to = dir > 0 ? gh + focusTop(path, scroller) : Math.max(0, ph - scroller.clientHeight);
  scroller.scrollTop = from;
  scroller.classList.add('moving');

  // 道のりが長いほど ゆっくり。短すぎると「つながっている」が目で追えない
  const ms = Math.min(1800, Math.max(1000, Math.abs(to - from) * 1.2));
  const t0 = performance.now();
  let raf = 0;
  const finish = () => {
    cancelAnimationFrame(raf);
    endSlide = null;
    scroller.classList.remove('moving');
    ghost.remove();
    // 上の写しを外すと中身が gh ぶん上がるので、そのぶん scrollTop を戻して景色を止めたままにする
    scroller.scrollTop = dir > 0 ? to - gh : to;
    drawRoad();
  };
  endSlide = finish;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    scroller.scrollTop = from + (to - from) * e;
    if (k < 1) raf = requestAnimationFrame(step);
    else finish();
  };
  raf = requestAnimationFrame(step);
}

$('map-back').addEventListener('click', () => {
  sfx.tap();
  // 道 → せかい一覧 → ホーム の順で戻る
  if (mapView === 'stages') {
    mapView = 'worlds';
    renderMap();
    return;
  }
  goHome();
});

// ------------------------------------------------------------------ プレイ

function startStage(world: World, stage: number): void {
  const boss = isBoss(world, stage);
  startRun({
    world,
    stage,
    total: questionCount(world, stage),
    boss,
    label: boss ? `${world.id}-ボス` : `${world.id}-${stage}`,
    stepName: boss ? null : (stepOf(world, stage)?.name ?? null),
    facts: factsFor(world, stage),
    blank: blankFor(world, stage),
    bonusCoins: boss ? COIN_BOSS : 0,
  });
}

function startRun(cfg: RunConfig): void {
  // 上限に達していたら新しいステージは始めない（走っている途中では止めない）
  if (timeUp()) {
    goHome();
    return;
  }
  // デイリーのおまけは走り出すたびに計算しなおす。
  // 設定オブジェクトを使いまわすので、ここで決めないと、その日のうちに
  // 何度でもデイリーのボーナスがもらえてしまう。
  // 枚数は 何問やるかで変える（1問でもゼロにはしない。dailyBonus を見る）
  if (cfg.mode === 'daily') cfg.bonusCoins = profile().daily.done ? 0 : dailyBonus(cfg.total);
  // ★も同じ理由でここで読みなおす。startStage で決め打ちにすると、
  // 同じ設定を使いまわす「もういちど」が、★3 のあとも初回レートで払い続ける。
  cfg.prevStars = cfg.stage === 0 ? 0 : stageStars(cfg.world.id, cfg.stage);

  lastRun = cfg;
  screens.play.classList.toggle('lefty', save.settings.leftHanded);
  // canvas の外（式やボタンの後ろ）も、そのステージの空の色にそろえる。
  // 夜とボスは空が暗いので、式やコインの数字を白抜きに切りかえる
  const theme = themeFor(cfg.world.id, cfg.stage, cfg.boss, cfg.mode === 'hunt' ? 'hunt' : undefined);
  screens.play.style.background = skyCss(theme);
  screens.play.classList.toggle('dark', theme.dark);
  $('overlay-pause').hidden = true;
  show('play');
  // 画面を出してからレイアウトが確定するので、次のフレームで開始する
  requestAnimationFrame(() => {
    runner.start(cfg, (r) => {
      if (cfg.mode === 'daily') {
        const p = profile();
        refreshDaily(p); // 日付をまたいで走り終えることがある
        if (!p.daily.done) {
          p.daily.done = true;
          p.daily.streak += 1;
          persist();
        }
      }
      lastResult = r;
      renderResult(r);
      show('result');
    });
  });
}

$('btn-pause').addEventListener('click', () => {
  runner.setPaused(true);
  // 「もどる」を押す前に、さいごまで行くと何が待っているかを1行だけ置く。
  // 途中でやめると フィニッシュも そのボーナスも手に入らない
  $('pause-note').textContent =
    `さいごの 1もんまで いくと、${weaponDef(profile().weapon).label} で フィニッシュ！`;
  $('overlay-pause').hidden = false;
});

$('pause-resume').addEventListener('click', () => {
  // iOS は裏に回ると AudioContext を止める。戻ってきたら鳴らしなおす
  unlockAudio();
  $('overlay-pause').hidden = true;
  runner.setPaused(false);
});

$('pause-quit').addEventListener('click', () => {
  $('overlay-pause').hidden = true;
  runner.stop();
  if (lastRun && lastRun.stage === 0) {
    goHome();
  } else {
    mapView = 'stages';
    renderMap();
    show('map');
  }
});

// ------------------------------------------------------------------ リザルト

const STAR_SVG = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="#ffc53d" stroke="#d99a10" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/**
 * リザルトの演出はタイマーとアニメの束。画面を離れるとき（子どもは待たずに
 * 次を押す）に全部止められるよう、後始末をここにためておく。
 */
const resultStop: (() => void)[] = [];

function stopResultAnim(): void {
  while (resultStop.length) resultStop.pop()?.();
}

function later(fn: () => void, ms: number): void {
  const id = window.setTimeout(fn, ms);
  resultStop.push(() => clearTimeout(id));
}

/**
 * 数字を数え上げる。いきなり「+48」と出すより、増えていくのを見せるほうが効く。
 * チャリンという音も一緒に鳴らして、耳からも「増えた」を伝える。
 */
function countUp(el: HTMLElement, from: number, to: number, ms: number, prefix = ''): void {
  const t0 = performance.now();
  let id = 0;
  let alive = true;
  let lastTick = -1;
  const step = (now: number): void => {
    if (!alive) return;
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - (1 - k) * (1 - k);
    el.textContent = `${prefix}${Math.round(from + (to - from) * eased)}`;
    const tick = Math.floor(k * 7);
    if (tick !== lastTick) {
      lastTick = tick;
      if (k < 1) sfx.coin();
    }
    if (k < 1) id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  resultStop.push(() => { alive = false; cancelAnimationFrame(id); });
}

// ---------------------------------------------------------------- 紙吹雪

const CONFETTI_COLORS = ['#ffc53d', '#ff8fb1', '#6ec8f0', '#7ed37c', '#c79bf0', '#ffffff'];

interface Flake { x: number; y: number; vx: number; vy: number; r: number; a: number; va: number; c: string; }

function confetti(count: number): void {
  const canvas = $<HTMLCanvasElement>('confetti');
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2) return;
  const g = canvas.getContext('2d');
  if (!g) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = rect.width;
  const H = rect.height;
  const flakes: Flake[] = Array.from({ length: count }, () => ({
    x: W * (0.1 + Math.random() * 0.8),
    y: -20 - Math.random() * H * 0.6,
    vx: (Math.random() - 0.5) * 90,
    vy: 130 + Math.random() * 190,
    r: 4 + Math.random() * 5,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 9,
    c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));

  let id = 0;
  let alive = true;
  let last = performance.now();
  const step = (now: number): void => {
    if (!alive) return;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    g.clearRect(0, 0, W, H);
    let live = 0;
    for (const f of flakes) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.a += f.va * dt;
      f.vx *= 0.99;
      if (f.y < H + 20) live++;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.a);
      g.fillStyle = f.c;
      g.fillRect(-f.r / 2, -f.r * 0.7, f.r, f.r * 1.4);
      g.restore();
    }
    if (live > 0) id = requestAnimationFrame(step);
    else g.clearRect(0, 0, W, H);
  };
  id = requestAnimationFrame(step);
  resultStop.push(() => {
    alive = false;
    cancelAnimationFrame(id);
    g.clearRect(0, 0, W, H);
  });
}

// ---------------------------------------------------------------- リザルト本体

interface CoinLine { label: string; value: number; }

/** もらったコインの内訳。0 の行は出さない（読む量が増えるだけ） */
function coinLines(r: StageResult): CoinLine[] {
  const out: CoinLine[] = [];
  if (r.gain.correct) out.push({ label: `せいかい ${r.correct}もん`, value: r.gain.correct });
  if (r.gain.combo) out.push({ label: 'れんぞく ボーナス', value: r.gain.combo });
  if (r.gain.weak) out.push({ label: 'にがて げきは', value: r.gain.weak });
  if (r.gain.perfect) out.push({ label: 'ノーミス ボーナス', value: r.gain.perfect });
  // さいごまで やりきった人だけの行。ぶきの名前で出して、
  // 「これが見たいから最後まで行く」を、リザルトでもういちど結びつける
  if (r.gain.finish) out.push({ label: `${weaponDef(profile().weapon).label} フィニッシュ`, value: r.gain.finish });
  // 周回を軽くしたぶんは「減った」とは出さない。初回の上乗せとしてだけ見せる
  if (r.gain.first) {
    out.push({
      label:
        r.firstKind === 'both'
          ? 'はじめて クリア＆★3！'
          : r.firstKind === 'perfect'
            ? 'はじめての ★3！'
            : 'はじめて クリア！',
      value: r.gain.first,
    });
  }
  if (r.gain.bonus) {
    const label =
      r.mode === 'daily'
        ? `きょうの ${r.total}もん`
        : r.mode === 'hunt'
          ? 'にがて たいじ'
          : 'ボス ボーナス';
    out.push({ label, value: r.gain.bonus });
  }
  if (r.gain.lost) out.push({ label: 'おとした コイン', value: -r.gain.lost });
  return out;
}

function renderResult(r: StageResult): void {
  stopResultAnim();

  const daily = r.mode === 'daily';
  const hunt = r.mode === 'hunt';
  // マップに属さない走り（デイリー・にがて たいじ）は、ワールドを引いてはいけない。
  // worldById は知らない id を W1 に落とすので、W1 のステージ名が出てしまう
  const onMap = r.mode === 'stage';
  const w = worldById(r.worldId);
  const boss = onMap && isBoss(w, r.stage);
  // ワールド名はミニマップの見出しに出ているので、この行は小ステップの名まえに使う
  const step = onMap ? stepOf(w, r.stage) : null;
  $('result-stage').textContent = daily
    ? `きょうの ${r.total}もん`
    : hunt
      ? 'にがて たいじ'
      : boss
        ? `${w.id}-ボス  ${r.bossName ?? w.name}`
        : `${w.id}-${r.stage}  ${step?.name ?? w.name}`;

  // ボスに負けたときだけ、別の顔で出す（★もコインのボーナスも付かない）
  (document.querySelector('.result-card') as HTMLElement).classList.toggle('failed', r.failed);
  $('result-head').textContent = r.failed
    ? 'やられた…'
    : boss
      ? `${r.bossName ?? 'ボス'} を たおした！`
      // まちがえても、正解するまで撃てるので必ず全部たおして終わる。
      // ここは「たおした数」なので total、下の「せいかい」は一発で当てた数
      : hunt
        ? `にがてを ${r.total}ひき たおした！`
        : r.stars === 3
          ? 'パーフェクト！'
          : r.stars === 2
            ? 'クリア！'
            : 'ゴール！';
  const fail = $('result-fail');
  fail.hidden = !r.failed;
  if (r.failed) fail.textContent = 'ボスは 1もん まちがえると おしまい。おちついて いこう！';
  $('result-correct').textContent = `せいかい ${r.correct} / ${r.total}`;

  // 縮小マップ。デイリーと にがて たいじ はマップ上のどこでもないので出さない
  const mini = $('result-map-mini');
  mini.hidden = !onMap;
  if (onMap) {
    const spot = currentSpot();
    renderMiniMap(mini, r.worldId, spot.worldId === r.worldId ? spot.stage : r.stage);
  }

  // リベンジ（まちがえた式のやりなおし）。走った回だけ、1行だけ出す
  const rev = r.revenge;
  const revNote = $('result-revenge-note');
  revNote.hidden = !rev;
  if (rev) {
    revNote.classList.toggle('ok', rev.cleared);
    revNote.textContent = rev.cleared
      ? `リベンジ ${rev.correct}/${rev.total} せいこう！ ミスを 1つ とりけした`
      : `リベンジ ${rev.correct}/${rev.total}　まちがえた しきに もういちど ちょうせんした！`;
  }

  // ★3 を取り終えた面の周回。「減った」とは言わず、先へ行くほうが得だとだけ伝える
  const replay = $('result-replay');
  replay.hidden = !r.replay || r.failed;
  if (!replay.hidden) {
    replay.textContent = 'ここは もう ★3！ まだの ステージなら もっと もらえるよ';
  }

  const learned = $('result-learned');
  if (r.learned.length) {
    learned.hidden = false;
    // どこに増えたのかまで言う。ここで「ずかん」に結びつけないと、
    // カードが増えたことに気づかないまま次のステージへ行ってしまう
    learned.textContent =
      `ずかんに ${r.learned.length}まい ふえた！  ` +
      r.learned.map((k) => k.replace('+', ' + ')).join('、');
  } else {
    learned.hidden = true;
  }

  // 星 → コインの内訳 → 合計、の順に見せる。いちどに全部出すと、
  // どれが自分の手柄なのか分からないまま画面が終わる
  const box = $('result-stars');
  box.innerHTML = STAR_SVG.repeat(3);
  const stars = Array.from(box.children) as HTMLElement[];
  if (!r.failed) sfx.clear();
  stars.forEach((el, i) => {
    if (i < r.stars) {
      later(() => {
        el.classList.add('on');
        sfx.star(i);
      }, 220 + i * 240);
    }
  });

  const hero = $('result-coins');
  const list = $('coin-lines');
  hero.textContent = '+0';
  list.replaceChildren();

  // たまごのカードは、走る前の枚数から始めて、数え終わりに更新する。
  // 棒グラフが伸びるので「さっきより たまごに近づいた」が目で分かる
  renderResultEgg(r.totalCoins - r.coins);

  const lines = coinLines(r);
  const startAt = 260 + r.stars * 240;
  let running = 0;

  lines.forEach((line, i) => {
    later(() => {
      const li = document.createElement('li');
      li.className = line.value < 0 ? 'minus' : '';
      const label = document.createElement('span');
      label.textContent = line.label;
      const value = document.createElement('b');
      value.textContent = `${line.value < 0 ? '−' : '＋'}${Math.abs(line.value)}`;
      li.append(label, value);
      list.appendChild(li);

      const from = running;
      running = Math.max(0, running + line.value);
      countUp(hero, from, running, 340, '+');
      $('coin-hero').classList.remove('pop');
      void $('coin-hero').offsetWidth;
      $('coin-hero').classList.add('pop');
      sfx.star(Math.min(i, 2));
    }, startAt + i * 340);
  });

  const endAt = startAt + lines.length * 340 + 220;
  later(() => {
    renderResultEgg();
    if (!r.failed) {
      sfx.fanfare();
      confetti(r.stars === 3 ? 90 : r.stars === 2 ? 50 : 28);
    }
  }, endAt);

  renderResultBtns(r);
}

/**
 * リザルトの下のボタン。
 * 見ているあいだに 1日の時間を使いきったときも、onClockTick から呼びなおす。
 */
function renderResultBtns(r: StageResult): void {
  const onMap = r.mode === 'stage';
  // ボタンの行き先。「もういちど」はやめて、つづけるか、スタートへ戻る。
  // ボスに負けたときだけは、挑みなおすのが主役になる
  const over = timeUp();
  const next = nextStageOf(r.worldId, r.stage);
  const nextBtn = $('result-next');
  $('result-retry').hidden = r.failed ? over : true;
  nextBtn.hidden = r.failed && !over;
  nextBtn.textContent = over
    ? endLabel()
    : next
      ? 'つづける'
      : onMap
        ? 'マップへ'
        : 'スタートへ';
  // つぎのボタンがマップ／スタートを兼ねているときは、同じ行き先を2つ出さない
  $('result-map').hidden = over || (!next && !r.failed);
  $('result-home').hidden = over || (!next && !onMap);
}

/** 「つづける」の文字。きせかえ／ぼくじょうの「つづきを あそぶ」でも同じ行き先を使う */
function nextLabel(): string {
  if (timeUp()) return endLabel();
  if (!lastResult) return 'スタートへ';
  if (nextStageOf(lastResult.worldId, lastResult.stage)) return 'つづける';
  return lastResult.stage === 0 ? 'スタートへ' : 'マップへ';
}

/**
 * リザルトの「たまご」カード。
 *
 * 「コインが増えた」で終わらせず、そのコインで いま何ができるのかを、
 * 稼いだその場に置く。足りないときも棒グラフで残りを見せて、
 * つぎの1ステージへつなげる。
 *
 * @param coins 表示に使う所持コイン。省略すると いまの所持数
 */
function renderResultEgg(coins = profile().coins): void {
  const goals = spendGoals(coins);
  const ready = goals.filter((g) => g.ready);
  const btn = $<HTMLButtonElement>('result-egg');
  const row = $('result-spend');
  const bar = $('result-egg-bar');
  const fill = bar.firstElementChild as HTMLElement;

  // きょうの時間を使いきったら、きせかえ・ぼくじょうへの入口は出さない
  // （押しても「きょうは ここまで」になるだけ）
  if (timeUp()) {
    btn.hidden = true;
    row.hidden = true;
    return;
  }

  // 両方できるときは、小さく横に2つ並べる。1枚だけ出していたころは
  // ペットのほうしか出ず、ガチャも まわせるのに そこから行けなかった
  const both = ready.length >= 2;
  row.hidden = !both;
  btn.hidden = both;
  if (both) {
    row.replaceChildren(
      ...ready.map((g) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `spend-btn ready${g.shiny ? ' shiny' : ''}`;
        b.innerHTML =
          `<span class="egg-emoji" aria-hidden="true">${g.emoji}</span>` +
          `<span class="spend-text"><b>${g.where === 'shop' ? 'ガチャ' : g.shiny ? 'キラたまご' : 'たまご'}</b>` +
          `<span>${spendVerb(g)}！</span></span>`;
        b.setAttribute('aria-label', `${g.label}が ${spendVerb(g)}`);
        b.addEventListener('click', () => {
          sfx.tap();
          openCollection(g.where, 'result');
        });
        return b;
      }),
    );
    return;
  }

  // 1つだけ出すとき。割れる／まわせるものがあれば それを、無ければ いちばん近い目標
  const egg = ready[0] ?? (goals.length ? goals.reduce((a, b) => (b.need < a.need ? b : a)) : null);
  btn.dataset.where = egg?.where ?? 'ranch';
  btn.classList.toggle('ready', Boolean(egg?.ready));
  btn.classList.toggle('shiny', Boolean(egg?.ready && egg.shiny));
  const emoji = btn.querySelector('.egg-emoji');
  if (emoji) emoji.textContent = egg?.emoji ?? '🥚';
  if (!egg) {
    // ぜんぶ集めたら、行き先は牧場（連れて歩く子を選びなおせる）
    $('result-egg-label').textContent = 'ぼくじょうで あそぶ';
    $('result-egg-sub').textContent = 'ぜんぶ そろった！';
    bar.hidden = true;
  } else if (egg.ready) {
    // ペットは「われる」、きせかえは「まわせる」。行きさきの動作をそのまま言う
    $('result-egg-label').textContent = `${egg.label}が ${spendVerb(egg)}！`;
    // どちらの たまごかを下の行でも言う。ふつうの たまごなら、キラたまごまでの残りを出して
    // 「もう1ステージ走れば キラたまご」を目標にできるようにする
    $('result-egg-sub').textContent =
      egg.where === 'shop'
        ? `もっている コイン ${coins}`
        : egg.shiny
          ? `ふつうの たまごも われる・コイン ${coins}`
          : `キラたまごまで あと ${PET_EGG_SHINY_COST - coins}`;
    bar.hidden = true;
  } else {
    // 見出しを1行に収める。何のたまご／ガチャかは下の行で言う
    $('result-egg-label').textContent = `あと ${egg.need} コインで ${egg.short}`;
    $('result-egg-sub').textContent = `${egg.label}　${coins} / ${egg.cost}`;
    bar.hidden = false;
    fill.style.width = `${Math.min(100, (coins / egg.cost) * 100)}%`;
  }
}

$('result-egg').addEventListener('click', () => {
  sfx.tap();
  openCollection($('result-egg').dataset.where === 'shop' ? 'shop' : 'ranch', 'result');
});

$('result-retry').addEventListener('click', () => {
  if (!lastRun) return;
  sfx.tap();
  startRun(lastRun);
});

/** 「つづける」の行き先。きせかえ／ぼくじょうから戻ってきたときも同じ場所へ進む */
function goNext(): void {
  if (!lastResult || timeUp()) {
    goHome();
    return;
  }
  const next = nextStageOf(lastResult.worldId, lastResult.stage);
  if (next) {
    startStage(next.world, next.stage);
  } else if (lastResult.stage === 0) {
    goHome();
  } else {
    mapWorld = lastResult.worldId;
    mapView = 'stages';
    renderMap();
    show('map');
  }
}

$('result-next').addEventListener('click', () => {
  sfx.tap();
  goNext();
});

$('result-map').addEventListener('click', () => {
  sfx.tap();
  mapWorld = lastResult && lastResult.stage > 0 ? lastResult.worldId : lastPlayedWorld();
  // 走り終わった直後は、いま走っていた せかいの みちに戻す
  mapView = 'stages';
  renderMap();
  show('map');
});

$('result-home').addEventListener('click', () => {
  sfx.tap();
  goHome();
});

// ------------------------------------------------------------------ せってい

const setSound = $<HTMLInputElement>('set-sound');
const setSlow = $<HTMLInputElement>('set-slow');
const setLeft = $<HTMLInputElement>('set-left');

function syncSettings(): void {
  setSound.checked = save.settings.sound;
  setSlow.checked = save.settings.slow;
  setLeft.checked = save.settings.leftHanded;
}

/**
 * せっていの歯車。
 *
 * 子どもの導線（あそぶ・きせかえ・ペット・ずかん）から外して画面のすみに置き、
 * そのうえで **ひと押しでは開かない**。すみに置くだけでは、遊んでいる指が
 * 端まで来たときに触れてしまう。長く押すのは「開こうとしたとき」だけなので、
 * ここで偶然ひらくことがなくなる。
 *
 * 短く押したときは、開きかたを1行だけ出す（おとなが迷子にならないように）。
 * キーボードの Enter／Space では、そのまま開く（使うのはおとなだけ）。
 */
const GEAR_HOLD_MS = 800;
const gear = $<HTMLButtonElement>('btn-settings');
const gearHint = $('gear-hint');
let gearTimer = 0;
let gearHintTimer = 0;
/** ながおしで開いたか。開いたあとに来る click で、ヒントを出さないための印 */
let gearOpened = false;

function openSettings(): void {
  gearOpened = true;
  syncSettings();
  gearHint.hidden = true;
  gear.classList.remove('holding');
  $('overlay-settings').hidden = false;
}

function stopGearHold(): void {
  if (gearTimer) clearTimeout(gearTimer);
  gearTimer = 0;
  gear.classList.remove('holding');
}

gear.addEventListener('pointerdown', () => {
  gearOpened = false;
  stopGearHold();
  gear.classList.add('holding');
  gearTimer = window.setTimeout(() => {
    gearTimer = 0;
    sfx.tap();
    openSettings();
  }, GEAR_HOLD_MS);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
  gear.addEventListener(ev, stopGearHold);
}

gear.addEventListener('click', () => {
  if (gearOpened) return;
  gearHint.hidden = false;
  if (gearHintTimer) clearTimeout(gearHintTimer);
  gearHintTimer = window.setTimeout(() => {
    gearHint.hidden = true;
    gearHintTimer = 0;
  }, 2600);
});

gear.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  openSettings();
});

setSound.addEventListener('change', () => {
  save.settings.sound = setSound.checked;
  persist();
  // ON に戻したときは、止まっていた音を起こしてから確認の音を鳴らす。
  // OFF にしたときは鳴りっぱなしの持続音を止める（audio 側でまとめて面倒を見る）
  applySoundSetting();
});
setSlow.addEventListener('change', () => {
  save.settings.slow = setSlow.checked;
  persist();
});
setLeft.addEventListener('change', () => {
  save.settings.leftHanded = setLeft.checked;
  persist();
  screens.play.classList.toggle('lefty', setLeft.checked);
});

$('set-close').addEventListener('click', () => {
  $('overlay-settings').hidden = true;
});

// ------------------------------------------------------------------ おうちのかた

function openParent(): void {
  renderParent();
  show('parent');
}

$('btn-parent').addEventListener('click', () => {
  $('overlay-settings').hidden = true;
  openGate(openParent);
});

$('parent-back').addEventListener('click', () => {
  goHome();
});

$('btn-switch').addEventListener('click', () => {
  profile().name = '';
  persist();
  sfx.tap();
  $('overlay-settings').hidden = true;
  goHome();
});

$('set-reset').addEventListener('click', () => {
  if (!window.confirm('ぜんぶ さいしょから やりなおします。いいですか？')) return;
  resetAll();
  $('overlay-settings').hidden = true;
  goHome();
});

// ------------------------------------------------------------------ 起動

// iOS は最初のユーザー操作の中でしか音を鳴らせない。
// しかも電話や開き直しで止まるので、1回で外さずに「どのタップでも起こす」を置く
installAudioWake();

// user-scalable=no は iOS Safari では無視されるので、ピンチ／ダブルタップを個別に止める
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (current === 'play') {
      runner.setPaused(true);
      $('overlay-pause').hidden = false;
    }
  } else {
    unlockAudio(); // 中断されたオーディオを起こしなおす
  }
});

// 書き込みは 120ms まとめているので、閉じられる前に必ず吐き出す。
// iOS は裏に回した時点でタイマーを止めるため、これがないと直前の1ステージが消える。
window.addEventListener('pagehide', flushSave);
window.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
});

requestPersistentStorage();
// たまごを割るとコインが減る。ホームも、裏にいるリザルトのカードも作りなおす
const onCollectionChange = (): void => {
  renderTitle();
  renderResultEgg();
};
initShop();
onShopChange(onCollectionChange);
initRanch();
onRanchChange(onCollectionChange);
initZukan();
onZukanChange(onCollectionChange);
initMini({
  facts: unlockedFacts,
  unlocked: worldUnlocked,
  onCoins: onCollectionChange,
  onExit: goHome,
});
initGate();
initParent(() => {
  syncSettings();
  renderTitle();
  refreshPlayClock();
});
initTimer({
  gate: (onPass, why) => openGate(onPass, why),
  onChange: (what) => {
    refreshPlayClock();
    if (current === 'parent') renderParent();
    // かけたら ホームへ。わたされた子が いちばん最初に見るのが、のこりの時計になる
    if (what === 'start') {
      goHome();
      ringClocks();
    } else if (current === 'rest') {
      leaveRest();
    }
  },
});
mountTimerButton($('btn-timer'));
syncSettings();

// file:// で開いたときなど、記録が残らない環境ではその場で伝える
$('no-storage').hidden = storageWorks;

// 1日に あそべる時間を数える時計。おうちのかたの画面と関門のあいだは数えない
// （大人が設定している時間を、子どもの持ち時間から引かない）。
// 「きょうは ここまで」の画面も数えない（もう遊べない時間を足しても意味がない）
startPlayClock({
  // タイマーを かける画面も おとなの時間なので数えない
  counting: () =>
    current !== 'parent' && current !== 'rest' && $('overlay-gate').hidden && $('overlay-timer').hidden,
  onTick: onClockTick,
});

renderTitle();
// きろくが2つ以上あるなら、まず誰のぼうけんかを選んでもらう。
// きょうだいで1台を使うとき、前の子のデータで走り出してしまうのを防ぐ。
if (usedSlots() > 1 || (usedSlots() > 0 && !profile().name)) showSlots();
else show('title');

// 埋め込み表示（iframe やビューアの中）と開発サーバーでは sw.js を登録しない。
// dev で登録すると、ハッシュのつかないソースが恒久的にキャッシュされて
// 変更が反映されなくなる。
const embedded = window.top !== window.self;
if (
  'serviceWorker' in navigator &&
  location.protocol.startsWith('http') &&
  !embedded &&
  !import.meta.env.DEV
) {
  window.addEventListener('load', async () => {
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register(
        // updateViaCache: 'none' が無いと、sw.js 自体が HTTP キャッシュから返って
        // 更新に気づかないことがある（GitHub Pages は max-age=600 を付ける）
        new URL('./sw.js', document.baseURI).href,
        { updateViaCache: 'none' },
      );
    } catch {
      return; // Service Worker が使えなくても、ふつうに遊べる
    }

    // 画面を開いただけでは更新の確認が走らないことがある（実測で、新しい
    // sw.js を置いても取りにこなかった）。ホーム画面から起動したアプリには
    // 再読みこみの手段が無く（引っぱって更新は overscroll-behavior で
    // 止めてある）、放っておくと古い版のまま何日も動く。自分で確認しにいく。
    const check = () => void reg.update().catch(() => undefined);
    check();

    // iOS はアプリを何日も宙づりにしたまま復帰させる。戻ってきたら見にいく。
    // 遊んでいる最中に入れ替わっても、読みこみ後は何も取りにいかない作りなので
    // 画面は壊れない（新しい版になるのは次に開いたとき）
    const HOUR = 60 * 60 * 1000;
    let checkedAt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - checkedAt < HOUR) return;
      checkedAt = Date.now();
      check();
    });
  });
}

// 制限時間の目安をコンソールに出しておく（数値を詰めるときの手がかり）
if (import.meta.env.DEV) {
  console.info(
    'answerTime:',
    WORLDS.map((w) => `W${w.id} ${answerTimeFor(w, 1, false).toFixed(1)}s → ${answerTimeFor(w, 8, false).toFixed(1)}s`).join(' / '),
  );
}
