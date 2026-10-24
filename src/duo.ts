/**
 * ふたりで ボス（iPad の 2人プレイ・ボスラッシュ）。
 *
 * 本編の Runner は 決まった id の部品に直接つながっていて 2つ並べられないので、
 * ハードル（hurdle.ts）と同じく 別の canvas エンジンにしてある。絵は本編のものを そのまま借りる
 * （drawChar・drawBoss・drawShot・drawFinish・drawPet・drawScene）。
 * 数字と決まりは duo-rules.ts（DOM に触らないので verify から検査できる）。仕様は docs/duo-boss-plan.md。
 *
 * 画面は 上が 2人ぶんの舞台（左の子・まんなかのボス・右の子）、下が 左右に分けた こたえの板。
 *  ・ボスは 2人に交代で攻撃する。攻撃されている子は、まちがえるか時間切れで たおれる
 *  ・攻撃されていない子は 自分のペースで解き、正解ごとに ボスへ 星を投げる
 *  ・相方が 1問 正解すると、たおれていた子は起き上がる。2人とも たおれたら 負け
 *  ・のこり体力が 30% を きると ほんきモード（変身 → ほうせきを わる → ちからくらべ → ピヨピヨ → とどめ）。
 *    決まりは duo-rules.ts の「ほんきモード」
 *
 * 入力は pointerdown で受ける。2人が ほぼ同時に押すので、指ごとに来る pointerdown のほうが確実
 * （click は 2本の指が同時に触れているとき 片方しか来ないことがある）。
 *
 * ★・図鑑・おぼえた は動かさない（記録は読むだけ）。となりの子が答えを言えるので、
 * 「おぼえた」の証拠としては 本編より弱い。
 */

import { sfx, startDrone, stopDrone } from './audio';
import { bossDef, drawBoss, drawShot, shotFor, type BossDef, type BossState, type Shot, type ShotKind } from './boss';
import { bossStage, tierDef, worldById, type Tier } from './curriculum';
import {
  DUO_BOSSES,
  DUO_BOSS_COUNT,
  DUO_CLASH_BACK,
  DUO_CLASH_CHARGE,
  DUO_CLASH_DEFAULT_SEC,
  DUO_CLASH_HINT_HOLD,
  DUO_CLASH_RETRY,
  DUO_CPU_IDLE,
  DUO_EASE_BACK,
  DUO_EASE_DOWNS,
  DUO_EASE_MAX,
  DUO_FIRST_MEASURE,
  DUO_HONKI_AT,
  DUO_HONKI_BIG,
  DUO_HONKI_GROW,
  DUO_HONKI_SEC,
  DUO_POWERS,
  DUO_PRIZES,
  DUO_REVIVE_GAP,
  DUO_STUN_SEC,
  DUO_WRONG_LOCK,
  DuoPicker,
  attackTime,
  clashDrift,
  cpuAccuracy,
  cpuDelay,
  cpuPower,
  cpuWrongChoice,
  damageOf,
  duoBossCoins,
  duoChoices,
  duoClearCoins,
  duoHintQuota,
  duoPools,
  duoSaveKey,
  duoTierOpen,
  duoWorldTime,
  honkiLabel,
  nextMeasure,
  poolLevel,
  powerDef,
  powersOn,
  spotOf,
  statsOf,
  type DuoEntry,
  type DuoPool,
  type HonkiMove,
} from './duo-rules';
import { ITEMS, grantPrize } from './items';
import { drawPet, paintPetIcon } from './petart';
import { NO_POWER, petOf, powerFor, type PetDef, type PetPower } from './pets';
import { solvedParts, type Question, type StatReader } from './questions';
import { persist, profile, save, slots, timeUp, today, type DuoLog, type DuoSuspend, type Profile } from './save';
import { drawScene, drawWeather, type SceneView } from './scenery';
import { drawChar, paintSkinIcon, roundRect, type CharState, type Look } from './sprites';
import { frameArt } from './tenframe';
import { skyCss, themeFor, type Theme } from './theme';
import {
  FIN_CHARGE, FIN_FLY, FIN_TOTAL, DEFAULT_WEAPON, drawFinish, drawFinishDim, finishDim, finishHoldsWeapon, smashLeap,
  weaponDef, type FinishView, type WeaponDef,
} from './weapons';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** 右の相手。きろくの子（枠の番号）か、ゲスト（てで／CPU） */
export type DuoPartner = { kind: 'kid'; slot: number } | { kind: 'guest'; cpu: boolean };

type SideId = 0 | 1;
/**
 * 'honki' は ほんきモードへの 変身の演出、'clash' は ちからくらべ、'stun' は ちからくらべに勝って
 * ボスが 目を回しているところ。ほんきモードの あいだの ふつうの戦い（ほうせき）は 'fight' のまま（rage で見分ける）
 */
type Phase = 'off' | 'intro' | 'fight' | 'honki' | 'clash' | 'stun' | 'finish' | 'rest' | 'end';

/** ボスが出てきて名まえを言うまで（秒） */
const INTRO_SEC = 1.7;
/** 1体目の 最初の攻撃までは、式を読む時間を あげる（ボスの「あいだ」より短いときだけ これを使う） */
const FIRST_ATTACK_SEC = 3;
/** 正解したあと、つぎの式を出すまで（みどりの こたえを見せる） */
const NEXT_SEC = 0.5;
/** まもってもらったとき、こたえを見せている秒数 */
const GUARD_TEACH_SEC = 1.2;
/** 星が ボスに とどくまで */
const STAR_SEC = 0.42;
/** やすみで 2人とも えらんだあと、つぎへ行くまで */
const REST_GO_SEC = 2;
/** 時間切れで待つのは 最長これだけ（limit.ts の GRACE_SEC と同じ 3分） */
const PARTNER_GRACE_SEC = 180;
/**
 * 跳んでから いちばん高いところまでの秒数。正解したとき、攻撃は ちょうどこの時間で
 * 足もとに届くよう速くなる（dodge）。ジャンプの高さ（resize）も これから逆算するので、
 * 2つが ずれて「着地してから攻撃が届く」ことは起きない
 */
const JUMP_APEX = 0.34;
/** ぶんしんが 正解で 消えるまで（秒） */
const POOF_SEC = 0.32;

interface SideStats {
  attacks: number;
  downs: number;
  hints: number;
  answers: number;
  ms: number;
  correct: number;
  total: number;
}

interface SideEls {
  root: HTMLElement;
  face: HTMLCanvasElement;
  name: HTMLElement;
  state: HTMLElement;
  mode: HTMLButtonElement;
  q: HTMLElement;
  hint: HTMLElement;
  frame: SVGElement;
  hintText: HTMLElement;
  answers: HTMLElement;
  finger: HTMLElement;
  timer: HTMLElement;
  timerFill: HTMLElement;
  hintBtn: HTMLButtonElement;
  hintPet: HTMLCanvasElement;
  hintEmoji: HTMLElement;
  hintLabel: HTMLElement;
  hintLeft: HTMLElement;
  down: HTMLElement;
  downText: HTMLElement;
  downAns: HTMLElement;
  cheer: HTMLButtonElement;
}

interface Side {
  id: SideId;
  /** 'kid' は きろくのある子（コイン・記録あり）。'guest' は ゲスト（てで／CPU） */
  kind: 'kid' | 'guest';
  p: Profile | null;
  name: string;
  look: Look;
  pet: PetDef | null;
  petPow: PetPower;
  cpu: boolean;
  /** CPU で はじめたか。「てで あそぶ」のあと しばらく さわらなければ CPU に戻す */
  cpuStart: boolean;
  lastTouch: number;
  worldId: number;
  pools: Record<DuoPool, DuoEntry[]>;
  stat: StatReader;
  picker: DuoPicker | null;
  pickerLevel: DuoPool | null;
  q: Question | null;
  /** いまの式が出てからの秒数（ヒントを見ていた時間も数える。止めている（ポーズ）あいだは数えない） */
  qT: number;
  /**
   * いまの式を 測る時間に入れないか。変身の あいだも 式は見えている（答えられない）ので、
   * 変身の前から出ていた式は 押せるようになった瞬間に押せて、実際より速く記録されていた（レビューで見つかった）
   */
  noMeasure: boolean;
  /** まちがえたあと ボタンを止めている のこり秒 */
  lock: number;
  /** 正解・まもってもらったあと、つぎの式までの のこり秒 */
  wait: number;
  down: boolean;
  /** たおれてからの秒数 */
  downT: number;
  /** たおれたときの式の こたえ（下の板に出す） */
  downAnswer: string;
  measured: number;
  /** 測った時間を使ってよいか（持ちこした速さがある か、その場で DUO_FIRST_MEASURE 問 答えた） */
  trusted: boolean;
  samples: number;
  ease: number;
  bossDowns: number;
  dodgeRun: number;
  hintsLeft: number | null;
  hintShown: boolean;
  guardLeft: number;
  rescueLeft: number;
  power: string;
  powerUsed: boolean;
  st: SideStats;
  x: number;
  py: number;
  vy: number;
  /** とどめで ボスのほうへ 出ている きょり（ボスへ向かう向きが プラス。引くときは マイナス） */
  lunge: number;
  char: CharState;
  /** 起き上がったときの光（1 → 0） */
  revive: number;
  /** まもってもらった たて（1 → 0） */
  shield: number;
  cpuAt: number;
  cpuPick: number;
  cpuPlanned: boolean;
  btns: HTMLButtonElement[];
  el: SideEls;
}

interface Attack {
  side: SideId;
  shot: Shot;
  /** 1 は右へ（右の子をねらう）、-1 は左へ */
  dir: 1 | -1;
  /** 届くまでの秒数（はじめの長さ） */
  total: number;
  /** 正解して跳んだ（攻撃は 頂点で足もとを通るよう 速くなっている） */
  dodged: boolean;
  /** 跳んだ子の まんなかを 通りすぎた（「よけた」を出した） */
  passed: boolean;
  /** 撃ったときの「体に ふれるまでの きょり」。板の のこり時間のバーの分母 */
  span: number;
  /** ほんき技（ふつうの攻撃は null） */
  move: HonkiMove | null;
  /** ぶんしんが 消えはじめてからの秒数（ぶんしんだけ。−1 は まだ） */
  poof: number;
}

interface Star {
  from: SideId;
  x0: number;
  y0: number;
  t: number;
  dmg: number;
  /** ほんきモードで わる ほうせき（どちらの側か）。null は ボスの体へ（体力を けずる） */
  core: SideId | null;
  /** ねらう ほうせきの 番号（まんなかから 0, 1, …） */
  slot: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

export interface DuoStartOpts {
  tier: Tier;
  partner: DuoPartner;
  resume: DuoSuspend | null;
}

export interface DuoHooks {
  /** スタートへ（ホーム） */
  onExit: () => void;
  /** コイン・きせかえが変わった（ホームの数字を描きなおす） */
  onChange: () => void;
}

/** ほうせきの色（左の子・右の子）。星の色（drawStar）と そろえる */
const GEM_COLORS = ['#ffd23d', '#ff8fb8'] as const;

const freshStats = (): SideStats => ({ attacks: 0, downs: 0, hints: 0, answers: 0, ms: 0, correct: 0, total: 0 });

function rnd(): number {
  return Math.random();
}

/** 動きを へらす設定（OS の「視差効果を減らす」）。画面の ゆれと 白い光を ひかえる（hurdle.ts と同じ） */
const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class DuoGame {
  private canvas = $<HTMLCanvasElement>('duo-world');
  private g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  private elScreen = $('screen-duo');
  private elPlay = $('duo-play');
  private elBossName = $('duo-boss-name');
  private elHp = $('duo-hp');
  private elPause = $<HTMLButtonElement>('duo-pause');
  private elRest = $('duo-rest');
  private elEnd = $('duo-end');
  private elPauseBox = $('duo-pausebox');

  private sides: [Side, Side] | null = null;
  private tier: Tier = 0;
  private partner: DuoPartner = { kind: 'guest', cpu: true };
  private phase: Phase = 'off';
  private boss = 0;
  private bossDefn: BossDef = bossDef(1);
  private bossState: BossState = { t: 0, mode: 'idle', hit: 0, squash: 1 };
  /** ボスが どちらを向いているか（攻撃する相手のほう） */
  private facing: 1 | -1 = -1;
  private hp = 1;
  private hpMax = 1;
  private hpShown = 1;
  private theme: Theme = themeFor(1, 9, true);
  /** とんでいる攻撃。ほんき技の「りょうがわ」では 2つ */
  private attacks: Attack[] = [];
  private nextAttackIn = 0;
  private nextTarget: SideId = 0;
  private shots = 0;
  private stars: Star[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private phaseT = 0;
  private finT = 0;
  private finImpact = false;
  /** とどめの ぶきを 放ったか（音と のびを 1回だけ出す） */
  private finFired = false;
  private shake = 0;
  private flash = 0;
  private banner = { text: '', life: 0, full: 1 };
  private running = false;
  private paused = false;
  private raf = 0;
  private lastTs = 0;
  private t = 0;
  private hooks: DuoHooks | null = null;
  /** 1日の2回目からか（コインを少なくする）。始めたときに決めて 走りのあいだは変えない */
  private again: [boolean, boolean] = [false, false];
  private runCoins: [number, number] = [0, 0];
  private runStart = 0;
  /** やすみで えらんだ パワーアップ（左・右）と、2人とも えらんでからの秒数 */
  private restPick: [string, string] = ['', ''];
  private restGo = -1;
  private restTimer = 0;
  /** 右の子の時間が切れた（つぎの やすみで区切る）。切れた時刻（performance.now） */
  private partnerOverAt = 0;
  private logged = false;
  /** ほんきモードか（のこり 30% を きってから 倒すまで） */
  private rage = false;
  /** ボスの大きさ（ほんきで 1 → DUO_HONKI_GROW） */
  private grow = 1;
  /** のこりの ほうせき（左の子の側・右の子の側）と、とんでいる星が ねらっている数 */
  private cores: [number, number] = [0, 0];
  private coreAim: [number, number] = [0, 0];
  private coreMax = 0;
  /** ほんきに なったときの体力（上の帯は ここから ほうせきの数に合わせて へらす） */
  private rageHp = 0;
  /**
   * ちからくらべ。push は 押した数（need で勝ち、−DUO_CLASH_BACK で押しかえされる）、
   * shown は 絵の位置（push へ なめらかに寄せる）、drift は ボスが押しもどす速さ（正解 何回ぶん／秒）。
   * ボスは じわじわではなく 1/drift 秒ごとに「ぐぐっ」と 1つ ぶん押しもどす（shove が たまっていく秒数）。
   * じわじわ押すと、正解した すぐあとに「あと ○かい」の数が ふえて見えた
   */
  private duel = { push: 0, shown: 0, need: 3, drift: 0, shove: 0, hold: 0, started: false };
  /** ボスの ふきだし */
  private say = { text: '', life: 0 };
  /** この回で 倒しおわったボスの数（つづきから なら、それまでのぶんも ふくむ） */
  private reached = 0;

  // 寸法
  private W = 320;
  private H = 200;
  private s = 1;
  private groundY = 170;
  private skyTop = 0;
  private skyH = 600;
  private bossX = 160;
  private gravity = 1400;
  private jumpV = -440;

  constructor() {
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement ?? this.canvas);
    }
    this.elPause.addEventListener('click', () => this.onPauseBtn());
    $('duo-resume').addEventListener('click', () => {
      sfx.tap();
      this.setPaused(false);
    });
    $('duo-quit').addEventListener('click', () => {
      sfx.tap();
      this.quit();
    });
    $('duo-rest-quit').addEventListener('click', () => {
      sfx.tap();
      this.restQuit();
    });
  }

  // ---------------------------------------------------------------- そと向け

  /** いま戦っているか（ボスが出てから倒すまで）。0 になった時間の待ちに使う */
  fighting(): boolean {
    const p = this.phase;
    return p === 'intro' || p === 'fight' || p === 'honki' || p === 'clash' || p === 'stun' || p === 'finish';
  }

  /** 走っている途中か（やすみも ふくむ）。ここで終わったら 中断として保存する */
  active(): boolean {
    return this.phase !== 'off' && this.phase !== 'end';
  }

  /** いっしょに遊んでいる きろく（右の子）。1日の時間を 同じだけ減らす */
  partnerProfiles(): Profile[] {
    const r = this.sides?.[1];
    return r && r.kind === 'kid' && r.p && this.active() ? [r.p] : [];
  }

  start(opts: DuoStartOpts, hooks: DuoHooks): void {
    this.hooks = hooks;
    this.tier = opts.tier;
    this.partner = opts.partner;
    const left = profile();
    const right = opts.partner.kind === 'kid' ? slots()[opts.partner.slot] ?? null : null;
    const spot = spotOf(left);
    const L = this.makeSide(0, 'kid', left, spot, false, opts.resume?.ms[0] ?? 0);
    const R = right
      ? this.makeSide(1, 'kid', right, spotOf(right), false, opts.resume?.ms[1] ?? 0)
      // ゲストは 左の子と同じレベル（記録がないので 世界を決める手がかりが無い）
      : this.makeSide(1, 'guest', null, spot, opts.partner.kind === 'guest' && opts.partner.cpu, opts.resume?.ms[1] ?? 0);
    this.sides = [L, R];
    L.power = opts.resume?.power[0] ?? '';
    R.power = opts.resume?.power[1] ?? '';

    const now = today();
    this.again = [L.p?.duo.day === now, R.p?.duo.day === now];
    this.runCoins = [0, 0];
    this.runStart = performance.now();
    this.partnerOverAt = 0;
    this.logged = false;
    // つづきは 使ったら消す（ハード以上で、とちゅうで やめて また つづきから、を できないように）
    delete left.duo.saves[this.saveKey()];
    persist();

    this.elRest.hidden = true;
    this.elEnd.hidden = true;
    this.elPauseBox.hidden = true;
    this.elPlay.hidden = false;
    const canPause = tierDef(this.tier).pause;
    this.elPause.textContent = canPause ? '‖' : '←';
    this.elPause.setAttribute('aria-label', canPause ? 'ポーズ' : 'やめて もどる');
    this.elPause.classList.toggle('quit', !canPause);

    for (const side of this.sides) this.buildSide(side);
    this.reached = opts.resume?.boss ?? 0;
    this.running = true;
    this.paused = false;
    this.lastTs = 0;
    this.resize();
    this.beginBoss(opts.resume?.boss ?? 0);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 画面を離れる。中断の保存は呼ぶ側（suspend）が先にやる */
  stop(): void {
    this.running = false;
    this.paused = false;
    // ポーズの箱が 開いたまま 終わることがある（ポーズ中に 右の子の時間が切れた）
    this.elPauseBox.hidden = true;
    stopDrone();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.restTimer);
    this.restTimer = 0;
    this.phase = 'off';
  }

  /** アプリを裏に回した。どの段階でも止める（電話が来たら負け、にはしない） */
  pauseForHidden(): void {
    if (!this.fighting()) return;
    this.setPaused(true);
  }

  /**
   * 1日の時間・タイマーで区切る（3分待っても 倒しきれなかったとき、と やすみ・おわりの画面にいるとき）。
   * 時間切れは負けにしない。つぎに あそぶときは、そのボスから（やすみなら つぎのボスから）。
   */
  haltForTime(): void {
    this.bankWin();
    if (this.phase === 'rest') this.suspendAt(this.boss + 1);
    else if (this.fighting()) this.suspendAt(this.boss);
    this.finishLog();
    this.stop();
  }

  /** main の時計から 1秒ごと。右の子の 1日の時間・タイマーを見る */
  tick1s(): void {
    const r = this.sides?.[1];
    if (!r || r.kind !== 'kid' || !r.p || !this.active()) return;
    if (!this.partnerOverAt && timeUp(Date.now(), r.p)) this.partnerOverAt = performance.now();
    if (!this.partnerOverAt) return;
    // やすみに入ったところで区切る。戦いの途中は 最長 3分 待つ
    if (this.phase === 'rest') {
      this.suspendAt(this.boss + 1);
      this.endPartnerTime(r);
    } else if (this.fighting() && performance.now() - this.partnerOverAt > PARTNER_GRACE_SEC * 1000) {
      this.bankWin();
      // bankWin が phase を 'rest' に かえることがある（ts は 上の if で 'rest' では ないと 決めつけている）
      if ((this.phase as Phase) === 'rest') this.suspendAt(this.boss + 1);
      else if (this.fighting()) this.suspendAt(this.boss);
      this.endPartnerTime(r);
    }
  }

  /**
   * ちからくらべに勝ったあと（ピヨピヨ・とどめ）は もう倒したのと同じ。やめる・時間切れでも 倒したぶんを払い、
   * つぎのボスから つづける。前は とどめの とちゅうで やめると 同じボスの 体力まんたんから やりなおしだった
   */
  private bankWin(): void {
    if (this.phase === 'stun' || this.phase === 'finish') this.afterBoss(true);
  }

  // ---------------------------------------------------------------- 人

  private makeSide(
    id: SideId, kind: 'kid' | 'guest', p: Profile | null, spot: { worldId: number; stage: number }, cpu: boolean, ms: number,
  ): Side {
    const petHelp = tierDef(this.tier).petHelp;
    const pet = p ? petOf(p) : null;
    const carried = ms > 0 ? ms : p?.duo.ms ?? 0;
    const look: Look = p
      ? { skin: p.skin, hat: p.hat, acc: p.acc, color: p.color, weapon: p.weapon }
      // ゲストは 初期の ねこを ぎんいろに。左の子と見分けがつくように
      : { skin: 'cat', color: 'color-silver', weapon: DEFAULT_WEAPON };
    return {
      id,
      kind,
      p,
      name: p ? p.name : cpu ? 'CPU' : 'ゲスト',
      look,
      pet,
      petPow: p && petHelp ? powerFor(p) : NO_POWER,
      cpu,
      cpuStart: cpu,
      lastTouch: 0,
      worldId: spot.worldId,
      pools: duoPools(spot.worldId, spot.stage),
      stat: statsOf(p),
      picker: null,
      pickerLevel: null,
      q: null,
      qT: 0,
      noMeasure: false,
      lock: 0,
      wait: 0,
      down: false,
      downT: 0,
      downAnswer: '',
      measured: carried,
      trusted: carried > 0,
      samples: 0,
      ease: 0,
      bossDowns: 0,
      dodgeRun: 0,
      hintsLeft: null,
      hintShown: false,
      guardLeft: 0,
      rescueLeft: 0,
      power: '',
      powerUsed: false,
      st: freshStats(),
      x: 0,
      py: 0,
      vy: 0,
      lunge: 0,
      char: { t: 0, air: false, hurt: 0, squash: 1 },
      revive: 0,
      shield: 0,
      cpuAt: 0,
      cpuPick: -1,
      cpuPlanned: false,
      btns: [],
      el: null as unknown as SideEls,
    };
  }

  /** 下の板（こたえのボタン・ヒント・たおれたとき）を作る。2人とも同じ形で、左右だけ鏡にする */
  private buildSide(side: Side): void {
    const root = $(side.id === 0 ? 'duo-side-L' : 'duo-side-R');
    root.className = `duo-side ${side.id === 0 ? 'left' : 'right'}`;
    root.innerHTML = `
      <div class="ds-top">
        <canvas class="ds-face" aria-hidden="true"></canvas>
        <b class="ds-name"></b>
        <span class="ds-state"></span>
        <button class="ds-mode" type="button" hidden></button>
      </div>
      <p class="ds-q" aria-live="polite">　</p>
      <div class="ds-hint" hidden>
        <svg class="tenframe ds-frame" viewBox="0 0 122 47" aria-hidden="true"></svg>
        <p class="ds-hint-text"></p>
      </div>
      <div class="ds-answers"></div>
      <span class="ds-finger" aria-hidden="true" hidden>👆</span>
      <span class="ds-timer" aria-hidden="true" hidden><i></i></span>
      <button class="ds-hintbtn" type="button">
        <span class="ds-hint-pic"><canvas aria-hidden="true"></canvas><i aria-hidden="true">💡</i></span>
        <b class="ds-hint-label">ヒント</b>
        <small class="ds-hint-left"></small>
      </button>
      <div class="ds-down" hidden>
        <span class="ds-dizzy" aria-hidden="true">💫</span>
        <p class="ds-down-ans"></p>
        <p class="ds-down-text"></p>
        <button class="ds-cheer" type="button">おうえん 💗</button>
      </div>`;
    const q = <T extends Element>(sel: string): T => root.querySelector(sel) as T;
    side.el = {
      root,
      face: q('.ds-face'),
      name: q('.ds-name'),
      state: q('.ds-state'),
      mode: q('.ds-mode'),
      q: q('.ds-q'),
      hint: q('.ds-hint'),
      frame: q('.ds-frame'),
      hintText: q('.ds-hint-text'),
      answers: q('.ds-answers'),
      finger: q('.ds-finger'),
      timer: q('.ds-timer'),
      timerFill: q('.ds-timer i'),
      hintBtn: q('.ds-hintbtn'),
      hintPet: q('.ds-hint-pic canvas'),
      hintEmoji: q('.ds-hint-pic i'),
      hintLabel: q('.ds-hint-label'),
      hintLeft: q('.ds-hint-left'),
      down: q('.ds-down'),
      downText: q('.ds-down-text'),
      downAns: q('.ds-down-ans'),
      cheer: q('.ds-cheer'),
    };
    paintSkinIcon(side.el.face, side.look, 40);
    side.el.name.textContent = side.cpu ? '🤖 CPU' : side.name;
    if (side.pet) {
      paintPetIcon(side.el.hintPet, side.pet.art, 30);
      side.el.hintEmoji.hidden = true;
    } else {
      side.el.hintPet.hidden = true;
    }

    // ゲストだけ。CPU ⇄ てで を その場で切りかえる
    side.el.mode.hidden = side.kind !== 'guest';
    side.el.mode.addEventListener('click', () => {
      sfx.tap();
      side.cpu = !side.cpu;
      side.lastTouch = this.t;
      side.cpuPlanned = false;
      side.el.finger.hidden = true;
      // CPU から てで に かえた子は、20秒 さわらなければ CPU に戻す（cpuStart のときだけ）
      this.renderSide(side);
    });
    side.el.hintBtn.addEventListener('click', () => this.pullHint(side));
    side.el.cheer.addEventListener('click', () => this.cheer(side));
    // 板の どこを さわっても「さわった」に数える（てで あそんでいるか）
    root.addEventListener('pointerdown', () => {
      side.lastTouch = this.t;
    }, { capture: true, passive: true });
  }

  private other(side: Side): Side {
    const s = this.sides as [Side, Side];
    return s[side.id === 0 ? 1 : 0];
  }

  // ---------------------------------------------------------------- ボス

  private beginBoss(i: number): void {
    const sides = this.sides as [Side, Side];
    this.boss = Math.min(Math.max(i, 0), DUO_BOSS_COUNT - 1);
    const def = DUO_BOSSES[this.boss];
    const tier = tierDef(this.tier);
    this.bossDefn = bossDef(def.world, this.tier, tier.bossPrefix);
    this.bossState = { t: 0, mode: 'idle', hit: 0, squash: 1 };
    this.hpMax = def.hp;
    this.hp = def.hp;
    this.hpShown = def.hp;
    this.rage = false;
    this.grow = 1;
    this.cores = [0, 0];
    this.coreAim = [0, 0];
    this.coreMax = def.cores;
    this.rageHp = def.hp;
    this.say.life = 0;
    stopDrone();
    const w = worldById(def.world);
    this.theme = themeFor(def.world, bossStage(w), true, undefined, this.tier);
    this.elScreen.style.background = skyCss(this.theme);
    this.elPlay.classList.toggle('dark', this.theme.dark);
    this.attacks = [];
    this.stars = [];
    this.shots = 0;
    this.nextTarget = (this.boss % 2) as SideId;
    this.facing = this.nextTarget === 0 ? -1 : 1;
    this.finImpact = false;

    for (const side of sides) {
      side.down = false;
      side.bossDowns = 0;
      side.q = null;
      side.lock = 0;
      side.wait = 0;
      side.powerUsed = false;
      side.hintsLeft = duoHintQuota(this.tier, side.petPow.hints);
      // ペットの「せなかに乗せる」「まもる」は 本編の「1ステージに1回」を「ボス1体に1回」と読みかえる
      side.guardLeft = side.petPow.guard;
      side.rescueLeft = side.petPow.rescue;
      side.char = { t: 0, air: false, hurt: 0, squash: 1 };
      side.py = 0;
      side.vy = 0;
      side.lunge = 0;
      this.hideHint(side);
      this.ensurePicker(side);
    }

    this.elBossName.textContent = `${this.boss + 1}/${DUO_BOSS_COUNT} ${this.bossDefn.name}`;
    this.updateHp();
    this.phase = 'intro';
    this.phaseT = 0;
    this.showBanner(`${this.boss + 1}たいめ  ${this.bossDefn.name}`, INTRO_SEC);
    sfx.roar();
    for (const side of sides) this.renderSide(side);
  }

  private startFight(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'fight';
    this.nextAttackIn = Math.min(DUO_BOSSES[this.boss].gap, FIRST_ATTACK_SEC);
    for (const side of sides) this.newQuestion(side);
  }

  private ensurePicker(side: Side): void {
    // ちからくらべは 1段 やさしい式（いちばん下の段）。押しあいの山場で つまずかせない
    const level = this.phase === 'clash' ? 'older' : poolLevel(this.boss, this.tier === 0 ? side.ease : 0);
    if (side.picker && side.pickerLevel === level) return;
    side.pickerLevel = level;
    side.picker = new DuoPicker(side.pools[level], duoChoices(side.worldId), side.stat);
  }

  private updateHp(): void {
    this.elHp.style.width = `${Math.max(0, (this.hpShown / this.hpMax) * 100)}%`;
  }

  // ---------------------------------------------------------------- 問題

  private newQuestion(side: Side): void {
    if ((this.phase !== 'fight' && this.phase !== 'clash') || side.down) return;
    this.ensurePicker(side);
    side.q = side.picker?.next(rnd) ?? null;
    side.qT = 0;
    side.noMeasure = false;
    side.lock = 0;
    side.wait = 0;
    side.cpuPlanned = false;
    side.el.finger.hidden = true;
    this.hideHint(side);
    this.renderQuestion(side);
    this.renderSide(side);
  }

  /** 答えられる場面か。戦いの中と、ちからくらべの ためが おわったあと */
  private live(): boolean {
    return this.phase === 'fight' || (this.phase === 'clash' && this.phaseT >= DUO_CLASH_CHARGE);
  }

  /** 押せるか。たおれている・止まっている・つぎを待っている あいだは押せない */
  private canAnswer(side: Side): boolean {
    return this.live() && !this.paused && !side.down && side.q !== null && side.lock <= 0 && side.wait <= 0;
  }

  /** この子に 向かってきている（まだ よけていない）攻撃 */
  private incoming(side: Side): Attack | null {
    return this.attacks.find((a) => a.side === side.id && !a.dodged) ?? null;
  }

  private renderQuestion(side: Side): void {
    const q = side.q;
    side.el.q.classList.remove('solved', 'wrong');
    side.el.answers.replaceChildren();
    side.btns = [];
    if (!q) {
      side.el.q.textContent = '　';
      return;
    }
    side.el.q.textContent = q.text;
    q.choices.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ds-ans';
      b.textContent = String(v);
      // 2人が ほぼ同時に押すので、指ごとに来る pointerdown で受ける
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (side.cpu) return;
        this.answer(side, i);
      });
      // キーボード（Enter・Space）では pointerdown が来ない
      b.addEventListener('click', (e) => {
        if (e.detail === 0 && !side.cpu) this.answer(side, i);
      });
      side.el.answers.appendChild(b);
      side.btns.push(b);
    });
    this.renderButtons(side);
  }

  private renderButtons(side: Side): void {
    const on = this.canAnswer(side) && !side.cpu;
    for (const b of side.btns) b.disabled = !on;
  }

  /** こたえを入れた式を その場で見せる（まちがえたとき・たおれたとき・正解したとき） */
  private showSolved(side: Side, ok: boolean): void {
    const q = side.q;
    if (!q) return;
    const { head, ans, tail } = solvedParts(q);
    side.el.q.innerHTML = '';
    const span = document.createElement('span');
    span.append(head);
    const b = document.createElement('b');
    b.textContent = ans;
    span.append(b, tail);
    side.el.q.append(span);
    side.el.q.classList.add('solved');
    side.el.q.classList.toggle('wrong', !ok);
    side.btns.forEach((btn, i) => {
      btn.disabled = true;
      if (q.choices[i] === q.answer) btn.classList.add('correct');
    });
  }

  /**
   * 押した。正解なら ボスへ星を投げる（攻撃されていれば よけてから）。
   * まちがいは、攻撃されていれば たおれる、されていなければ 2秒 止まる。
   */
  private answer(side: Side, i: number): void {
    if (!this.canAnswer(side)) return;
    const q = side.q as Question;
    const v = q.choices[i];
    const btn = side.btns[i];
    side.st.total++;
    const inc = this.incoming(side);

    if (v === q.answer) {
      side.st.correct++;
      // 変身を またいだ式と、ちからくらべの式（ためのあいだも見えている・やさしい段）は 測らない
      if (!side.noMeasure && this.phase !== 'clash') {
        side.st.answers++;
        const ms = side.qT * 1000;
        side.st.ms += ms;
        side.measured = nextMeasure(side.measured, ms);
        side.samples++;
        if (side.samples >= DUO_FIRST_MEASURE) side.trusted = true;
      }
      btn?.classList.add('correct');
      this.showSolved(side, true);
      side.wait = NEXT_SEC;
      this.hideHint(side);
      sfx.correct(1);
      if (this.phase === 'clash') {
        this.pushClash(side);
      } else {
        this.throwStar(side);
        if (inc) this.dodge(side, inc);
      }
      const mate = this.other(side);
      if (mate.down) this.revive(mate);
    } else {
      btn?.classList.add('wrong');
      sfx.wrong();
      if (inc) {
        this.fail(side, 'wrong');
      } else {
        // でたらめに押して稼がせない。止まっているあいだは こたえを見せる
        side.lock = DUO_WRONG_LOCK;
        this.showSolved(side, false);
        this.hideHint(side);
      }
    }
    this.renderSide(side);
  }

  // ---------------------------------------------------------------- ヒント

  private hintUsable(side: Side): boolean {
    if (!this.canAnswer(side) || side.cpu || side.hintShown || !side.q) return false;
    if (side.hintsLeft !== null && side.hintsLeft <= 0) return false;
    return Boolean(frameArt(side.q.fact, side.q.blank));
  }

  /**
   * ヒント。10マスの絵を その子の板に出す。
   * 本編のように 世界ぜんぶは止められない（相方が遊んでいる）ので、自分に向かってくる攻撃だけを
   * ペットが押しとどめる（ペットがいなくても止まる。本編の「とまってるよ」と同じ）。
   */
  private pullHint(side: Side): void {
    if (!this.hintUsable(side)) return;
    const q = side.q as Question;
    const art = frameArt(q.fact, q.blank);
    if (!art) return;
    sfx.tap();
    if (side.hintsLeft !== null) side.hintsLeft--;
    side.st.hints++;
    side.hintShown = true;
    side.el.frame.setAttribute('viewBox', art.viewBox);
    side.el.frame.innerHTML = art.svg;
    side.el.hintText.textContent = `${art.text} ${art.nudge}`;
    side.el.hint.hidden = false;
    side.el.root.classList.add('hinting');
    if (this.incoming(side)) {
      this.floatAt(side.x, this.groundY - 70 * this.s, side.pet ? `${side.pet.name}が おさえてる！` : 'とまってるよ', '#ffffff');
    } else if (this.phase === 'clash') {
      // ちからくらべでは ヒントのあいだ ペットも いっしょに押す（ボスに押しもどされない）
      this.floatAt(side.x, this.groundY - 70 * this.s, side.pet ? `${side.pet.name}も おしてる！` : 'ふんばってる！', '#ffffff');
    }
    if (side.pet) sfx.voice('small');
    this.renderSide(side);
  }

  private hideHint(side: Side): void {
    side.hintShown = false;
    if (!side.el) return;
    side.el.hint.hidden = true;
    side.el.root.classList.remove('hinting');
  }

  // ---------------------------------------------------------------- 攻撃

  private launch(): void {
    const sides = this.sides as [Side, Side];
    const move = this.rage ? DUO_BOSSES[this.boss].honki : null;
    let targets: Side[];
    if (move?.both) {
      // りょうがわ。たおれている子には撃たない（起き上がるのを待たない）
      targets = sides.filter((x) => !x.down);
    } else {
      let target = sides[this.nextTarget];
      if (target.down) target = this.other(target);
      targets = target.down ? [] : [target];
    }
    if (!targets.length) return;
    // まちがえて ボタンが止まっている（2秒）・正解の直後で つぎの式を待っている子には、まだ撃たない。
    // 撃つと 押せないまま 攻撃が近づき、持ち時間が 最大2秒 けずられていた（レビューで見つかった）。
    // nextAttackIn は 0 以下のままなので、押せるようになった つぎのコマで撃つ
    // （りょうがわは 2人とも 押せるようになるまで待つ）
    if (targets.some((x) => x.lock > 0 || x.wait > 0 || !x.q)) return;
    const kind = shotFor(this.bossDefn, this.shots++);
    for (const target of targets) {
      this.attacks.push(this.makeAttack(target, kind, move));
      target.st.attacks++;
    }
    if (targets.length === 1) this.facing = targets[0].id === 0 ? -1 : 1;
    this.bossState.mode = 'wind';
    // ほんき技の名まえは 帯で言う（浮かぶ字にすると 小さい画面では すぐ 舞台の上から 出ていった）
    if (move) this.showBanner(honkiLabel(move), 1.0);
    // CPU の答えは 攻撃が来てから考えなおさない（いま考えている式のまま）
    sfx.shoot(kind);
    for (const side of sides) this.renderSide(side);
  }

  private makeAttack(target: Side, kind: ShotKind, move: HonkiMove | null): Attack {
    const time = attackTime({
      measuredMs: target.trusted ? target.measured : 0,
      worldTime: duoWorldTime(target.worldId),
      boss: this.boss,
      tier: this.tier,
      slow: target.kind === 'kid' && !target.cpu && save.settings.slow,
      ease: this.tier === 0 ? target.ease : 0,
      petSlow: target.petPow.slow,
      powerSlow: target.power === 'slow',
      honki: move !== null,
    });
    const dir: 1 | -1 = target.id === 0 ? -1 : 1;
    const clone = move?.clone ?? false;
    // ぶんしんは ボスの体の はしから 出てくる
    const from = this.bossX + dir * (clone ? this.bossSize() * 0.5 : 30 * this.s);
    const r = clone
      ? 16 * this.s
      : (kind === 'beam' ? 6.5 : 8.5) * this.s * (1 + this.bossDefn.tier * 0.05) * (move?.big ? DUO_HONKI_BIG : 1);
    const span = Math.max(1, Math.abs(from - target.x) - this.contact(r));
    return {
      side: target.id,
      dir,
      total: time,
      dodged: false,
      passed: false,
      span,
      move,
      poof: -1,
      shot: {
        kind,
        x: from,
        y: this.groundY - 15 * this.s,
        // 持ち時間ちょうどで「体に ふれる」ところまで来る速さ（まんなかまで、ではない）
        v: span / time,
        r,
        rot: 0,
        t: 0,
      },
    };
  }

  /**
   * 3れんぱつの 間（攻撃の半径の何倍か）。ビームと 火の玉は うしろへ 長く のびる絵なので、
   * 石と同じ間だと 3つが 1本に つながって見えた
   */
  private gapK(a: Attack): number {
    return a.shot.kind === 'beam' ? 6.2 : a.shot.kind === 'fire' ? 4.2 : 2.4;
  }

  /** 3れんぱつの うしろの2つが つらなる長さ（先頭から いちばん うしろまで） */
  private trail(a: Attack): number {
    return a.move && a.move.count > 1 ? (a.move.count - 1) * a.shot.r * this.gapK(a) : 0;
  }

  /**
   * 攻撃が 子の体に ふれる きょり（まんなか どうしの はなれ）。
   * 体の はばの半分（drawChar の 34*s の 半分より少し内がわ）＋ 攻撃の半径
   */
  private contact(r: number): number {
    return 14 * this.s + r;
  }

  /**
   * 正解して跳んだ。攻撃は、跳んだ子が いちばん高いところにいる瞬間に 足もとを通り抜ける
   * （本編の runner.ts と同じ。腕前ではなく 計算で よける）。
   *
   * 以前は 攻撃の速さを 一律 3.2倍に していた。早めに答えると 攻撃がまだ遠くにあって、
   * 着地（0.7秒ほど）のあとで 届くので、立っている子に重なって「当たった」ように見えていた。
   * 速さは「のこりの きょり ÷ 頂点までの時間」で決める。
   */
  private dodge(side: Side, a: Attack): void {
    a.dodged = true;
    side.dodgeRun++;
    // ふつうの自動調整。3回つづけて よけたら 1段もどす
    if (this.tier === 0 && side.ease > 0 && side.dodgeRun >= DUO_EASE_BACK) {
      side.ease--;
      side.dodgeRun = 0;
      side.picker = null;
    }
    if (a.move?.clone) {
      // ぶんしんは 跳び越えず、正解で ポンと消す（止まって ふくらみながら消える）
      a.poof = 0;
      side.char.squash = 1.18;
      this.ring(a.shot.x, this.groundY - 20 * this.s, '#ffffff');
      this.burst(a.shot.x, this.groundY - 20 * this.s, 16, '#d9c8ff');
      this.floatAt(a.shot.x, this.groundY - 58 * this.s, 'やっつけた！', '#fff4b8');
      sfx.dodge();
      return;
    }
    const dist = Math.max(Math.abs(side.x - a.shot.x), 10 * this.s);
    a.shot.v = Math.min(dist / JUMP_APEX, 4200);
    side.vy = this.jumpV;
    side.char.air = true;
    side.char.squash = 1.18;
    sfx.jump();
    this.burst(side.x, this.groundY - 4 * this.s, 8, '#e8d9b8');
  }

  /** 攻撃が 跳んだ子の足もとを 通り抜けた瞬間（「よけた」と分かるのは ここ） */
  private dodgeFx(side: Side, a: Attack): void {
    const y = this.groundY - 16 * this.s;
    const kind = a.shot.kind;
    this.ring(side.x, y, '#ffffff');
    this.burst(side.x, y, 12, kind === 'fire' ? '#ffb02e' : kind === 'beam' ? '#8fe3ff' : '#e0d6c2');
    // 頂点にいる頭に重ならないよう、ボスの側へ ずらして出す
    const toward = side.id === 0 ? 1 : -1;
    this.floatAt(side.x + toward * 52 * this.s, this.groundY - 92 * this.s, ['ナイス！', 'かわした！', 'よけた！'][Math.floor(rnd() * 3)], '#fff4b8');
    sfx.dodge();
  }

  /** 攻撃が かたづいた（よけた・まもった）。ぜんぶ かたづいたら つぎの攻撃までの あいだを はかりはじめる */
  private resolveAttack(a: Attack): void {
    const sides = this.sides as [Side, Side];
    this.attacks = this.attacks.filter((x) => x !== a);
    if (this.attacks.length) return;
    this.bossState.mode = 'idle';
    this.nextTarget = this.other(sides[a.side]).id;
    // りょうがわで 片方が たおれたまま のこったときも、起こす時間を あける
    const gap = DUO_BOSSES[this.boss].gap;
    this.nextAttackIn = sides.some((x) => x.down) ? Math.max(gap, DUO_REVIVE_GAP) : gap;
  }

  /** 失敗した（まちがい・時間切れ）。まもりが のこっていれば まもる。なければ たおれる */
  private fail(side: Side, why: 'wrong' | 'time'): void {
    const petHelp = tierDef(this.tier).petHelp;
    const hit = this.incoming(side);
    if (side.power === 'guard' && !side.powerUsed) {
      side.powerUsed = true;
      this.guard(side, '🛡 まもった！');
      return;
    }
    if (petHelp && side.pet && why === 'wrong' && side.guardLeft > 0) {
      side.guardLeft--;
      this.guard(side, `${side.pet.name}が まもった！`);
      return;
    }
    if (petHelp && side.pet && why === 'time' && side.rescueLeft > 0) {
      side.rescueLeft--;
      this.guard(side, `${side.pet.name}が たすけた！`);
      return;
    }

    side.down = true;
    side.downT = 0;
    side.st.downs++;
    side.bossDowns++;
    side.dodgeRun = 0;
    side.char.hurt = 0.6;
    side.downAnswer = side.q ? solvedText(side.q) : '';
    this.showSolved(side, false);
    this.hideHint(side);
    side.el.finger.hidden = true;
    this.burst(side.x, this.groundY - 20 * this.s, 16, '#ff9d7a');
    this.shake = 0.3;
    sfx.stumble();
    // ふつうの自動調整。同じボスで2回 たおれたら 1段やさしく（時間 ＋20%・式を1段下げる）
    if (this.tier === 0 && side.bossDowns >= DUO_EASE_DOWNS) {
      side.ease = Math.min(DUO_EASE_MAX, side.ease + 1);
      side.bossDowns = 0;
      side.picker = null;
    }
    const mate = this.other(side);
    this.attacks = this.attacks.filter((x) => x !== hit);
    if (mate.down) {
      this.lose();
      return;
    }
    this.nextTarget = mate.id;
    // 相方が 1問 正解すれば起き上がる。そのための時間を 終盤のボスでも残す（DUO_REVIVE_GAP）。
    // りょうがわで 相方への攻撃が まだ とんでいるときは、それが かたづいてから はかる（resolveAttack）
    if (!this.attacks.length) {
      this.bossState.mode = 'idle';
      this.nextAttackIn = Math.max(DUO_BOSSES[this.boss].gap, DUO_REVIVE_GAP);
    }
    this.renderSide(side);
    this.renderSide(mate);
  }

  /** まもってもらった。たおれず、こたえを見せてから つぎの式へ */
  private guard(side: Side, text: string): void {
    const a = this.incoming(side);
    side.shield = 1;
    this.showSolved(side, false);
    this.hideHint(side);
    side.wait = GUARD_TEACH_SEC;
    side.dodgeRun = 0;
    this.burst(a ? a.shot.x : side.x, this.groundY - 20 * this.s, 12, '#8fd8ff');
    this.floatAt(side.x, this.groundY - 80 * this.s, text, '#bfe9ff');
    sfx.guard();
    if (a?.move?.clone) {
      // ぶんしんは まもったときも ポンと消す（その場で消すと 何が起きたか見えない）
      a.dodged = true;
      a.poof = 0;
    } else if (a) {
      this.resolveAttack(a);
    }
    this.renderSide(side);
  }

  private revive(side: Side): void {
    side.down = false;
    side.revive = 1;
    side.char.hurt = 0;
    this.ring(side.x, this.groundY - 24 * this.s, '#fff4b8');
    this.floatAt(side.x, this.groundY - 84 * this.s, 'ふっかつ！', '#fff4b8');
    sfx.rescue();
    this.newQuestion(side);
  }

  private cheer(side: Side): void {
    if (!side.down) return;
    sfx.tap();
    const mate = this.other(side);
    for (let i = 0; i < 4; i++) {
      this.particles.push({
        x: side.x, y: this.groundY - 40 * this.s,
        vx: (mate.x - side.x) * (0.8 + rnd() * 0.4), vy: -120 * this.s - rnd() * 60 * this.s,
        life: 1, max: 1, r: 5 * this.s, color: '#ff8fb8',
      });
    }
  }

  // ---------------------------------------------------------------- 星（ダメージ）

  private throwStar(side: Side): void {
    const dmg = damageOf(side.trusted ? side.measured : 0, side.power === 'power');
    // ほんきモードは 体力ではなく ほうせきを ねらう。自分の側が のこっていれば 自分の側、
    // わりおえていれば 相方の側（てつだう）。とんでいる星の ぶんは 先に よやくして、同じ1こを 2つの星が ねらわないようにする
    let core: SideId | null = null;
    let slot = -1;
    if (this.rage) {
      const mate = this.other(side).id;
      if (this.cores[side.id] - this.coreAim[side.id] > 0) core = side.id;
      else if (this.cores[mate] - this.coreAim[mate] > 0) core = mate;
      if (core !== null) {
        this.coreAim[core]++;
        slot = this.cores[core] - this.coreAim[core];
      }
    }
    this.stars.push({
      from: side.id,
      x0: side.x + (side.id === 0 ? 18 : -18) * this.s,
      y0: this.groundY - 26 * this.s,
      t: 0,
      dmg,
      core,
      slot,
    });
  }

  private starPos(st: Star): { x: number; y: number } {
    const k = Math.min(1, st.t / STAR_SEC);
    const to = st.core !== null ? this.gemPos(st.core, st.slot) : null;
    const tx = to ? to.x : this.bossX;
    const ty = to ? to.y : this.groundY - this.bossSize() * 0.55;
    return {
      x: st.x0 + (tx - st.x0) * k,
      y: st.y0 + (ty - st.y0) * k - Math.sin(k * Math.PI) * 40 * this.s,
    };
  }

  private hitBoss(st: Star): void {
    if (st.core !== null) {
      this.breakCore(st.core);
      return;
    }
    const { x, y } = this.starPos(st);
    this.bossState.hit = 0.18;
    this.burst(x, y, 8 + Math.round(st.dmg * 4), '#ffe17a');
    this.shake = Math.max(this.shake, 0.12);
    sfx.coin();
    // ほんきモードで ねらう ほうせきが のこっていなかった星（ほかの星が ぜんぶ よやくずみ）は 光るだけ
    if (this.rage) return;
    // ほんきモードの前は 0 まで けずらない（30% で かならず ほんきに なる。1問の ダメージは 体力の 30% より小さい）
    this.hp = Math.max(this.hpMax * 0.01, this.hp - st.dmg);
    if (this.phase === 'fight' && this.hp / this.hpMax <= DUO_HONKI_AT) this.beginHonki();
  }

  // ---------------------------------------------------------------- ほんきモード

  /** ほうせきの置き場所。ボスの上に、左の子の側・右の子の側へ ならべる（まんなかから 0, 1, …） */
  private gemPos(side: SideId, i: number): { x: number; y: number } {
    const dir = side === 0 ? -1 : 1;
    return { x: this.bossX + dir * (40 + i * 22) * this.s, y: this.bossBarY() + 4 * this.s };
  }

  /** のこり体力が 30% を きった。変身の演出へ（攻撃・答えるのを止める） */
  private beginHonki(): void {
    const sides = this.sides as [Side, Side];
    // たおれている子は 起こしておく（ほんきの ボスに 2人そろって むかう）。phase が 'fight' のうちに起こす
    // （起こすと すぐ つぎの式を出すため）
    for (const side of sides) if (side.down) this.revive(side);
    for (const side of sides) side.noMeasure = true;
    this.rage = true;
    this.rageHp = this.hp;
    this.cores = [this.coreMax, this.coreMax];
    this.coreAim = [0, 0];
    this.attacks = [];
    this.stars = [];
    // 浮かんでいる字（「よけた！」など）は 消す。変身の ふきだし・帯と 重なる
    this.floats = [];
    this.phase = 'honki';
    this.phaseT = 0;
    this.bossState.mode = 'roar';
    this.bossState.rage = 0;
    this.flash = 0.7;
    this.shake = 0.5;
    // まず ボスが さけび、そのあとで 帯を出す（同時に出すと 帯と ふきだしが 重なる）
    this.sayLine('まだまだ〜！', 1.0);
    sfx.final();
    sfx.roar();
    for (const side of sides) {
      side.el.finger.hidden = true;
      side.el.timer.hidden = true;
      this.renderSide(side);
    }
  }

  private updateHonki(dt: number): void {
    const before = this.phaseT;
    this.phaseT += dt;
    const k = Math.min(1, this.phaseT / 0.8);
    this.grow = 1 + (DUO_HONKI_GROW - 1) * (1 - (1 - k) * (1 - k));
    this.bossState.rage = k;
    // ふきだし（1.0秒）が 消えてから 帯を出す（同じ高さで 重なる）
    if (before < 1.05 && this.phaseT >= 1.05) {
      this.showBanner('ほんきモード！', DUO_HONKI_SEC - 1.05);
      this.shake = 0.3;
    }
    // ほうせきが 1こずつ 出てくる音（drawGems と同じ間で）
    for (let i = 0; i < this.coreMax; i++) {
      const at = 1.0 + (i / this.coreMax) * 0.9;
      if (before < at && this.phaseT >= at) sfx.star(i);
    }
    if (this.phaseT < DUO_HONKI_SEC) return;
    const sides = this.sides as [Side, Side];
    this.phase = 'fight';
    this.bossState.mode = 'idle';
    // 1つめの ほんき技は すぐ見せる
    this.nextAttackIn = Math.min(DUO_BOSSES[this.boss].gap, 1.5);
    startDrone();
    for (const side of sides) {
      if (!side.q && !side.down && side.wait <= 0) this.newQuestion(side);
      this.renderSide(side);
    }
  }

  /** ほうせきを 1こ わった（星が とどいた） */
  private breakCore(side: SideId): void {
    if (!this.rage) return;
    this.cores[side] = Math.max(0, this.cores[side] - 1);
    this.coreAim[side] = Math.max(0, this.coreAim[side] - 1);
    // われたのは いちばん外の1こ（のこりの数と 同じ番号）
    const { x, y } = this.gemPos(side, this.cores[side]);
    const color = side === 0 ? GEM_COLORS[0] : GEM_COLORS[1];
    this.burst(x, y, 14, color);
    this.burst(x, y, 6, '#ffffff');
    this.bossState.hit = 0.2;
    this.shake = Math.max(this.shake, 0.16);
    sfx.crack();
    const left = this.cores[0] + this.cores[1];
    // 上の帯も ほうせきの数に合わせて へらす（0 には しない。ちからくらべで 倒すまで のこす）
    this.hp = Math.max(this.hpMax * 0.015, (this.rageHp * left) / (2 * this.coreMax));
    if (this.phase !== 'fight') return;
    const sides = this.sides as [Side, Side];
    if (this.cores[side] === 0 && left > 0) {
      const owner = sides[side];
      this.floatAt(owner.x, this.groundY - 62 * this.s, 'ぜんぶ わった！', '#fff4b8');
    }
    for (const x2 of sides) this.renderSide(x2);
    if (left === 0) this.beginClash();
  }

  /** ほうせきが ぜんぶ われた。ボスの さいごの だいわざ → ちからくらべ */
  private beginClash(): void {
    const sides = this.sides as [Side, Side];
    for (const side of sides) if (side.down) this.revive(side);
    this.attacks = [];
    this.stars = [];
    this.floats = [];
    this.phase = 'clash';
    this.phaseT = 0;
    this.duel = {
      push: 0,
      shown: 0,
      need: DUO_BOSSES[this.boss].clash,
      drift: clashDrift(sides.map((x) => this.answerSec(x))),
      shove: 0,
      hold: 0,
      started: false,
    };
    this.bossState.mode = 'charge';
    this.sayLine('これで おわりだ〜！', 1.0);
    sfx.charge();
    for (const side of sides) {
      side.el.finger.hidden = true;
      side.el.timer.hidden = true;
      // ちからくらべ用の やさしい式に とりかえる（ためのあいだは 押せない）
      this.newQuestion(side);
    }
  }

  /** その子の 1問の秒数（つぎの式が出るまで ふくむ）。ちからくらべで ボスが押す強さを決める */
  private answerSec(side: Side): number {
    return (side.trusted ? side.measured / 1000 : DUO_CLASH_DEFAULT_SEC) + NEXT_SEC;
  }

  private updateClash(dt: number): void {
    const before = this.phaseT;
    this.phaseT += dt;
    const sides = this.sides as [Side, Side];
    if (before < 1.05 && this.phaseT >= 1.05) this.showBanner('さいごの だいわざ！', DUO_CLASH_CHARGE - 1.05);
    if (this.phaseT < DUO_CLASH_CHARGE) return;
    const d = this.duel;
    if (!d.started) {
      d.started = true;
      this.showBanner('おしかえせ！', 1.2);
      this.flash = 0.5;
      this.shake = 0.3;
      sfx.finishFire();
      for (const side of sides) this.renderSide(side);
    }
    // ヒントのあいだは ペットも いっしょに押すので 押しもどされない（1回の ヒントで DUO_CLASH_HINT_HOLD 秒まで）
    const hinting = sides.some((x) => x.hintShown);
    d.hold = hinting ? d.hold + dt : 0;
    if (!hinting || d.hold > DUO_CLASH_HINT_HOLD) d.shove += dt;
    if (d.drift > 0 && d.shove >= 1 / d.drift) {
      d.shove = 0;
      d.push -= 1;
      this.shake = Math.max(this.shake, 0.3);
      this.bossState.hit = 0.15;
      this.floatAt(this.bossX, this.groundY - this.bossSize() * 0.8, 'ぐぐっ！', '#ffb3a8');
      sfx.roar();
    }
    d.shown += (d.push - d.shown) * Math.min(1, dt * 8);
    // ぶつかる点から 火花
    for (const side of sides) {
      if (rnd() > dt * 14) continue;
      const p = this.clashPoint(side);
      const a = rnd() * Math.PI * 2;
      const v = (80 + rnd() * 140) * this.s;
      this.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * this.s,
        life: 0.45, max: 0.45, r: (1.5 + rnd() * 2) * this.s, color: rnd() < 0.5 ? '#fff4b8' : this.weaponOf(side).glow,
      });
    }
    const f = this.clashFrac();
    for (const side of sides) {
      side.el.timer.hidden = false;
      side.el.timer.classList.add('push');
      side.el.timer.classList.remove('low');
      side.el.timerFill.style.transform = `scaleX(${f.toFixed(3)})`;
    }
    if (d.push <= -DUO_CLASH_BACK) this.clashLost();
  }

  /** ぶつかる点の位置。0 は 子の手もと（押しかえされた）、1 は ボス（押しきった） */
  private clashFrac(): number {
    const d = this.duel;
    return Math.max(0, Math.min(1, (d.shown + DUO_CLASH_BACK) / (d.need + DUO_CLASH_BACK)));
  }

  /** ちからくらべで 正解した。ぶつかる点を ボスのほうへ ぐいっと押す */
  private pushClash(side: Side): void {
    const d = this.duel;
    d.push = Math.min(d.need, Math.max(d.push, -DUO_CLASH_BACK) + 1);
    this.shake = Math.max(this.shake, 0.18);
    side.char.squash = 1.16;
    sfx.coin();
    const p = this.clashPoint(side);
    this.burst(p.x, p.y, 12, this.weaponOf(side).glow);
    if (d.push >= d.need) this.clashWon();
  }

  private clashWon(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'stun';
    this.phaseT = 0;
    this.hp = 0;
    this.bossState.mode = 'down';
    this.bossState.hit = 0.4;
    this.flash = 1;
    this.shake = 0.5;
    const bs = this.bossSize();
    this.burst(this.bossX, this.groundY - bs * 0.5, 34, '#ffe17a');
    this.burst(this.bossX, this.groundY - bs * 0.5, 18, '#ffffff');
    this.sayLine('ぐわ〜っ！', 1.0);
    stopDrone();
    sfx.blast();
    for (const side of sides) {
      this.hideHint(side);
      side.q = null;
      side.el.finger.hidden = true;
      side.el.timer.hidden = true;
      side.el.timer.classList.remove('push');
      this.renderQuestion(side);
      this.renderSide(side);
    }
  }

  /** ちからくらべで 押しかえされた。負けには しない（ほうせきが 1こずつ もどって もういちど） */
  private clashLost(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'fight';
    this.bossState.mode = 'idle';
    this.cores = [DUO_CLASH_RETRY, DUO_CLASH_RETRY];
    this.coreAim = [0, 0];
    this.hp = Math.max(this.hpMax * 0.015, (this.rageHp * this.cores[0]) / this.coreMax);
    this.attacks = [];
    this.nextAttackIn = DUO_BOSSES[this.boss].gap;
    this.flash = 0.4;
    this.shake = 0.4;
    // ふきだしは出さない（帯と 同じ高さで 重なる）
    this.showBanner('おしかえされた… もういちど！', 1.6);
    sfx.stumble();
    for (const side of sides) {
      side.char.hurt = 0.5;
      this.burst(side.x, this.groundY - 20 * this.s, 10, '#ff9d7a');
      side.el.timer.hidden = true;
      side.el.timer.classList.remove('push');
      this.renderSide(side);
    }
  }

  private sayLine(text: string, sec: number): void {
    this.say = { text, life: sec };
  }

  // ---------------------------------------------------------------- とどめ・やすみ・おわり

  private beginFinish(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'finish';
    this.finT = 0;
    this.finImpact = false;
    this.finFired = false;
    this.attacks = [];
    stopDrone();
    this.stars = [];
    for (const side of sides) {
      if (side.down) {
        side.down = false;
        side.revive = 1;
      }
      side.q = null;
      side.el.finger.hidden = true;
      this.hideHint(side);
      this.renderQuestion(side);
      this.renderSide(side);
    }
    this.showBanner('いまだ！ ふたりで とどめ！', 1.2);
    sfx.finishCharge();
  }

  /** 倒したボスの ぶんを払って、やすみ か おわりへ */
  private afterBoss(silent = false): void {
    const sides = this.sides as [Side, Side];
    const n = this.boss;
    for (const side of sides) {
      // とどめの途中で 時間切れに なったときも、立ち位置に もどしておく
      side.lunge = 0;
      if (side.kind !== 'kid' || !side.p) continue;
      const c = duoBossCoins(n, this.tier, this.again[side.id]);
      side.p.coins += c;
      this.runCoins[side.id] += c;
      side.p.duo.best[this.tier] = Math.max(side.p.duo.best[this.tier], n + 1);
      if (!this.again[side.id]) side.p.duo.day = today();
    }
    this.reached = n + 1;
    persist();
    this.hooks?.onChange();
    if (silent && n + 1 < DUO_BOSS_COUNT) {
      // 時間切れで区切るとき。やすみの画面は出さず、つぎのボスから つづけられるようにだけする
      this.phase = 'rest';
      this.restPick = ['', ''];
      return;
    }
    if (n + 1 >= DUO_BOSS_COUNT) this.clear();
    else this.showRest();
  }

  private saveKey(): string {
    const p = this.partner;
    return duoSaveKey(this.tier, p.kind === 'kid' ? p.slot : 'g');
  }

  /** つづきを保存する（ここから つぎに はじめる ボス） */
  private suspendAt(boss: number): void {
    const sides = this.sides;
    if (!sides) return;
    const left = sides[0].p as Profile;
    left.duo.saves[this.saveKey()] = {
      boss: Math.min(boss, DUO_BOSS_COUNT - 1),
      power: [this.phase === 'rest' ? this.restPick[0] : '', this.phase === 'rest' ? this.restPick[1] : ''],
      ms: [sides[0].trusted ? sides[0].measured : 0, sides[1].trusted ? sides[1].measured : 0],
      partner: sides[1].p ? sides[1].p.name : '',
    };
    persist();
  }

  /** この回の数を、おうちのかたの画面の記録に足す（左右の きろくの子それぞれ） */
  private finishLog(): void {
    if (this.logged || !this.sides) return;
    this.logged = true;
    const sec = Math.round((performance.now() - this.runStart) / 1000);
    for (const side of this.sides) {
      const p = side.p;
      if (side.kind !== 'kid' || !p) continue;
      const add: DuoLog = {
        runs: 1, attacks: side.st.attacks, downs: side.st.downs, hints: side.st.hints,
        answers: side.st.answers, ms: Math.round(side.st.ms), sec,
      };
      for (const k of Object.keys(add) as (keyof DuoLog)[]) p.duo.log[k] += add[k];
      p.duo.last = { ...add, tier: this.tier, reached: this.reached, day: today() };
      // 測った速さは つぎの回に持ちこす（ゲストは持ちこさない）
      if (side.trusted) p.duo.ms = side.measured;
    }
    persist();
  }

  private showRest(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'rest';
    this.restPick = ['', ''];
    this.restGo = -1;
    const next = DUO_BOSSES[this.boss + 1];
    const nextDef = bossDef(next.world, this.tier, tierDef(this.tier).bossPrefix);
    $('duo-rest-head').textContent = `${this.bossDefn.name}を たおした！`;
    this.renderTrack($('duo-rest-track'), this.boss + 1, -1);
    $('duo-rest-next').textContent = `つぎは… ${this.boss + 2}たいめ`;
    paintBossShadow($<HTMLCanvasElement>('duo-rest-shadow'), nextDef);

    const pow = powersOn(this.tier);
    const wrap = $('duo-rest-picks');
    wrap.replaceChildren();
    for (const side of sides) {
      const col = document.createElement('div');
      col.className = 'drp-col';
      const head = document.createElement('p');
      head.className = 'drp-head';
      head.textContent = pow ? `${side.cpu ? '🤖 CPU' : side.name}は どれに する？` : `${side.cpu ? '🤖 CPU' : side.name}`;
      col.appendChild(head);
      const row = document.createElement('div');
      row.className = 'drp-row';
      const opts = pow
        ? DUO_POWERS.map((d) => ({ id: d.id, icon: d.icon, label: d.label, note: d.note }))
        : [{ id: 'ok', icon: '👍', label: 'OK', note: '' }];
      for (const o of opts) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'drp-btn';
        b.dataset.id = o.id;
        // 字が読めなくても 絵で、読める子には 効き目を ひとことで
        b.innerHTML = `<span aria-hidden="true">${o.icon}</span><b>${o.label}</b>${o.note ? `<small>${o.note}</small>` : ''}`;
        b.setAttribute('aria-pressed', 'false');
        b.disabled = side.cpu;
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (side.cpu) return;
          this.pickPower(side, o.id);
        });
        b.addEventListener('click', (e) => {
          if (e.detail === 0 && !side.cpu) this.pickPower(side, o.id);
        });
        row.appendChild(b);
      }
      col.appendChild(row);
      wrap.appendChild(col);
    }
    $('duo-rest-note').textContent = pow ? 'ふたりとも えらんだら つぎへ' : 'ふたりとも おしたら つぎへ';
    for (const side of sides) this.renderSide(side);
    this.elRest.hidden = false;
    sfx.fanfare();
    this.cpuRestPick();
  }

  /** CPU は 左の子が えらんでから えらぶ（左の子が えらばなかったものから） */
  private cpuRestPick(): void {
    const sides = this.sides as [Side, Side];
    const R = sides[1];
    if (!R.cpu || this.restPick[1]) return;
    if (!this.restPick[0]) return;
    window.clearTimeout(this.restTimer);
    this.restTimer = window.setTimeout(() => {
      if (this.phase !== 'rest') return;
      this.pickPower(R, powersOn(this.tier) ? cpuPower(this.restPick[0], rnd()) : 'ok');
    }, 700);
  }

  private pickPower(side: Side, id: string): void {
    if (this.phase !== 'rest') return;
    sfx.tap();
    this.restPick[side.id] = id;
    const col = $('duo-rest-picks').children[side.id];
    col?.querySelectorAll<HTMLButtonElement>('.drp-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    });
    if (side.id === 0) this.cpuRestPick();
    if (this.restPick[0] && this.restPick[1]) {
      this.restGo = 0;
      $('duo-rest-note').textContent = 'つぎへ いくよ！';
    }
  }

  private leaveRest(): void {
    const sides = this.sides as [Side, Side];
    sides[0].power = powersOn(this.tier) ? this.restPick[0] : '';
    sides[1].power = powersOn(this.tier) ? this.restPick[1] : '';
    this.elRest.hidden = true;
    this.beginBoss(this.boss + 1);
  }

  /** やすみの「ここで やめる」。つぎのボスから つづけられる */
  restQuit(): void {
    if (this.phase !== 'rest') return;
    this.suspendAt(this.boss + 1);
    this.finishLog();
    this.stop();
    this.hooks?.onExit();
  }

  private lose(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'end';
    this.attacks = [];
    this.stars = [];
    stopDrone();
    this.bossState.mode = 'roar';
    sfx.gameover();
    for (const side of sides) {
      if (side.p) side.p.duo.best[this.tier] = Math.max(side.p.duo.best[this.tier], this.boss);
      side.el.finger.hidden = true;
      this.renderSide(side);
    }
    // ふつうは 負けたボスから つづけられる（あとで ホームから来ても）
    if (this.tier === 0) this.suspendAt(this.boss);
    this.finishLog();
    window.setTimeout(() => {
      $('duo-end-head').textContent = 'ふたりとも やられた…';
      // 1体目で負けたのに「1たいめ まで いけた！」は おかしいので言いかえる
      $('duo-end-sub').textContent = this.boss === 0
        ? `${this.bossDefn.name}に まけちゃった`
        : `${this.boss}たい たおして ${this.boss + 1}たいめ ${this.bossDefn.name} まで いけた！`;
      this.renderTrack($('duo-end-track'), this.boss, this.boss);
      this.renderEndLines(false, [], this.hp / this.hpMax <= 0.3);
      const btns = $('duo-end-btns');
      btns.replaceChildren();
      btns.appendChild(this.endButton(
        // ふつうは 負けたボスから（ふつうの ボスの名まえには「つよい」が付かない）
        this.tier === 0 ? `${this.bossDefn.name}から もういちど` : 'さいしょから もういちど',
        'primary',
        () => this.restart(this.tier === 0 ? this.boss : 0),
      ));
      btns.appendChild(this.endButton('スタートへ', 'ghost', () => this.exit()));
      this.elEnd.hidden = false;
    }, 1400);
  }

  private clear(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'end';
    const prizes: string[] = [];
    for (const side of sides) {
      const p = side.p;
      if (side.kind !== 'kid' || !p) continue;
      const c = duoClearCoins(this.tier, this.again[side.id]);
      p.coins += c;
      this.runCoins[side.id] += c;
      p.duo.best[this.tier] = DUO_BOSS_COUNT;
      if (grantPrize(p, DUO_PRIZES[this.tier])) {
        prizes.push(p.name);
        // もらった記念品を その場で身につけた姿にする（うしろの舞台にも すぐ出る）
        side.look = { skin: p.skin, hat: p.hat, acc: p.acc, color: p.color, weapon: p.weapon };
      }
    }
    for (const side of sides) this.renderSide(side);
    persist();
    this.finishLog();
    this.hooks?.onChange();
    sfx.clear();
    const t = tierDef(this.tier);
    $('duo-end-head').textContent = `ぜんぶ たおした！ ${t.icon}${t.name} クリア`;
    const total = sides[0].st.correct + sides[1].st.correct;
    $('duo-end-sub').textContent = `ふたりで ${total}もん せいかい`;
    this.renderTrack($('duo-end-track'), DUO_BOSS_COUNT, -1);
    this.renderEndLines(true, prizes);
    const btns = $('duo-end-btns');
    btns.replaceChildren();
    btns.appendChild(this.endButton('もういちど', 'primary', () => this.restart(0)));
    btns.appendChild(this.endButton('スタートへ', 'ghost', () => this.exit()));
    this.elEnd.hidden = false;
  }

  /** 右の子の時間が切れた。つづきは保存してあるので、おしまいの画面だけ出す */
  private endPartnerTime(r: Side): void {
    this.finishLog();
    this.stop();
    this.phase = 'end';
    this.elRest.hidden = true;
    $('duo-end-head').textContent = `${r.name}は じかんに なったよ`;
    $('duo-end-sub').textContent = 'つづきは また こんど あそべるよ';
    this.renderTrack($('duo-end-track'), this.boss, -1);
    $('duo-end-lines').replaceChildren();
    const btns = $('duo-end-btns');
    btns.replaceChildren();
    btns.appendChild(this.endButton('スタートへ', 'primary', () => this.exit()));
    this.elEnd.hidden = false;
  }

  private renderEndLines(cleared: boolean, prizes: string[] = [], close = false): void {
    const sides = this.sides as [Side, Side];
    const ul = $('duo-end-lines');
    ul.replaceChildren();
    const li = (text: string, cls = ''): void => {
      const x = document.createElement('li');
      x.textContent = text;
      if (cls) x.className = cls;
      ul.appendChild(x);
    };
    for (const side of sides) {
      if (side.kind === 'kid' && side.p && this.runCoins[side.id] > 0) li(`${side.p.name}  +${this.runCoins[side.id]} コイン`, 'coins');
    }
    // 負けたボスを あと すこしで倒せていたら、そう言う（つぎも やる気になる）
    if (!cleared && close) li('あと すこしだった！', 'close');
    const best = sides[0].p?.duo.best[this.tier] ?? 0;
    if (!cleared && best > 0) li(`きろく: ${best}たい たおした`, 'best');
    if (cleared && prizes.length) {
      const item = ITEMS.find((i) => i.id === DUO_PRIZES[this.tier]);
      li(`🎁 きねんの「${item?.label ?? ''}」を もらった！（${prizes.join('・')}）`, 'prize');
    }
    if (cleared && this.tier < 2) {
      const next = (this.tier + 1) as Tier;
      const t = tierDef(next);
      if (duoTierOpen(next, sides[0].p as Profile, sides[1].p)) li(`${t.icon} ${t.name}が ひらいた！`, 'unlock');
    }
  }

  private endButton(label: string, kind: 'primary' | 'ghost', fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = kind === 'primary' ? 'btn btn-primary btn-xl' : 'btn btn-ghost';
    b.textContent = label;
    b.addEventListener('click', () => {
      sfx.tap();
      fn();
    });
    return b;
  }

  /** 8体の顔。done までは ✔、now は いま（負けたところ）、のこりは ？ */
  private renderTrack(el: HTMLElement, done: number, now: number): void {
    el.replaceChildren();
    for (let i = 0; i < DUO_BOSS_COUNT; i++) {
      const b = document.createElement('span');
      b.className = `dt-node${i < done ? ' done' : ''}${i === now ? ' now' : ''}${i === done && now < 0 ? ' next' : ''}`;
      b.textContent = i < done ? '👑' : i === now ? '💥' : '❔';
      b.setAttribute('aria-label', `${i + 1}たいめ`);
      el.appendChild(b);
    }
  }

  private restart(boss: number): void {
    if (!this.sides || !this.hooks) return;
    const ms: [number, number] = [
      this.sides[0].trusted ? this.sides[0].measured : 0,
      this.sides[1].trusted ? this.sides[1].measured : 0,
    ];
    const partner = this.partner.kind === 'guest'
      ? { kind: 'guest' as const, cpu: this.sides[1].cpuStart }
      : this.partner;
    this.start({ tier: this.tier, partner, resume: boss > 0 ? { boss, power: ['', ''], ms, partner: '' } : null }, this.hooks);
  }

  private exit(): void {
    this.stop();
    this.elEnd.hidden = true;
    this.hooks?.onExit();
  }

  // ---------------------------------------------------------------- 止める・やめる

  private onPauseBtn(): void {
    if (!this.fighting()) return;
    sfx.tap();
    // ハード以上は 止められない。← は その場で おしまい（つづきは残らない）
    if (!tierDef(this.tier).pause) {
      this.quit();
      return;
    }
    this.setPaused(true);
  }

  setPaused(on: boolean): void {
    this.paused = on;
    // ほんきモードの 持続音は 止めているあいだ 消す（ちからくらべ・とどめでは もう鳴らしていない）
    if (on) stopDrone();
    else if (this.rage && (this.phase === 'fight' || this.phase === 'clash')) startDrone();
    this.elPauseBox.hidden = !on;
    $('duo-quit').textContent = this.tier === 0 ? 'やめる（つづきから あそべるよ）' : 'やめる';
    if (this.sides) for (const side of this.sides) this.renderSide(side);
    if (!on) this.lastTs = 0;
  }

  /** ポーズの「やめる」と、ハード以上の ←。ふつうは そのボスから つづけられる */
  private quit(): void {
    this.elPauseBox.hidden = true;
    this.bankWin();
    if (this.tier === 0 && this.phase === 'rest') this.suspendAt(this.boss + 1);
    else if (this.tier === 0 && this.fighting()) this.suspendAt(this.boss);
    this.finishLog();
    this.stop();
    this.hooks?.onExit();
  }

  // ---------------------------------------------------------------- 板の表示

  private renderSide(side: Side): void {
    const el = side.el;
    if (!el) return;
    const attacked = this.phase === 'fight' && this.incoming(side) !== null;
    const mate = this.other(side);
    // 相方が たおれていて、自分は攻撃されていない。「つぎの正解で 起こせる」を この子の板に出す
    // （前は たおれた子の板にしか書いておらず、起こす側は いつもの「じぶんの ペースで」のままだった）
    const rescue = this.phase === 'fight' && !side.down && mate.down && !attacked;
    const mateName = mate.cpu ? 'CPU' : mate.name;
    el.root.classList.toggle('attacked', attacked);
    el.root.classList.toggle('rescue', rescue);
    el.root.classList.toggle('is-down', side.down);
    el.root.classList.toggle('dueling', this.phase === 'clash' && this.live());
    el.root.classList.toggle('raging', this.rage && this.phase === 'fight');
    // ちからくらべの あいだは 同じ バーを「押しぐあい」に使う（updateClash が 毎コマ 描く）
    if (!attacked && this.phase !== 'clash') {
      el.timer.hidden = true;
      el.timer.classList.remove('push');
    }
    el.root.classList.toggle('cpu', side.cpu);
    el.name.textContent = side.cpu ? '🤖 CPU' : side.name;
    el.mode.textContent = side.cpu ? 'てで あそぶ' : '🤖 まかせる';

    let state = '';
    // ほんきモードで 自分の側の のこりの ほうせき。数字ではなく 自分の色の ◆ で出す
    // （数字は ボスの上の「あと ○」（2人の合計）だけにする。2つの「あと」が まぎらわしかった）
    let gems = 0;
    if (this.phase === 'rest' || this.phase === 'end') state = '';
    else if (this.phase === 'intro') state = 'じゅんび…';
    else if (this.phase === 'honki') state = '⚡ ボスが ほんきに なった！';
    else if (this.phase === 'clash') {
      state = !this.live() ? '⚡ だいわざが くる！' : side.lock > 0 ? 'ちょっと まってね' : '⚡ せいかいで おしかえせ！';
    } else if (this.phase === 'stun') state = 'いまだ！';
    else if (this.phase === 'finish') state = 'とどめ！';
    else if (side.down) state = '💫 たおれた';
    else if (attacked) state = mate.down ? `⚠ きてる！ せいかいで ${mateName}も ふっかつ` : '⚠ きてる！';
    else if (side.lock > 0) state = 'ちょっと まってね';
    else if (rescue) state = `💗 ${mateName}を たすけて！ せいかいで ふっかつ`;
    else if (side.cpu) state = '🤖 うーん…';
    else if (this.rage) {
      // とんでいる星が もう ねらっている ぶんは 引いて数える（その1こは もう われる）
      gems = Math.max(0, this.cores[side.id] - this.coreAim[side.id]);
      if (!gems) state = this.cores[mate.id] > 0 ? `💗 ${mateName}の ほうせきも わろう！` : '💎 ぜんぶ わった！';
    } else if (this.phase === 'fight') state = 'じぶんの ペースで こうげき！';
    if (gems > 0) el.state.innerHTML = `じぶんの ほうせき <b class="ds-gems g${side.id}">${'◆'.repeat(gems)}</b>`;
    else el.state.textContent = state;

    el.down.hidden = !side.down;
    if (side.down) {
      el.downAns.textContent = side.downAnswer ? `こたえは ${side.downAnswer}` : '';
      el.downText.textContent = `${mateName}が せいかいすると ふっかつ`;
    }

    // ヒントのボタン。CPU・たおれているときは出さない。ベリーハードは「ヒント なし」
    el.hintBtn.hidden = side.cpu || side.down;
    const none = side.hintsLeft === 0;
    el.hintLabel.textContent = none ? 'ヒント なし' : 'ヒント';
    el.hintLeft.textContent = side.hintsLeft !== null && side.hintsLeft > 0 ? `あと${side.hintsLeft}` : '';
    el.hintBtn.disabled = !this.hintUsable(side);
    // ふつうでは、攻撃されているときに ヒントのボタンを光らせる（押すと 攻撃を ペットが止める）。
    // ヒントに たよって ここまで来た子ほど、追われているときに ボタンを思い出せない
    el.hintBtn.classList.toggle('nudge', attacked && this.tier === 0 && this.hintUsable(side));
    this.renderButtons(side);
  }

  // ---------------------------------------------------------------- ループ

  private frame = (ts: number): void => {
    if (!this.running) return;
    const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.05) : 0;
    this.lastTs = ts;
    if (!this.paused) this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const sides = this.sides as [Side, Side];
    this.t += dt;
    this.bossState.t += dt;
    this.bossState.hit = Math.max(0, this.bossState.hit - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt * 2);
    this.banner.life = Math.max(0, this.banner.life - dt);
    this.say.life = Math.max(0, this.say.life - dt);
    this.hpShown += (this.hp - this.hpShown) * Math.min(1, dt * 8);
    if (Math.abs(this.hpShown - this.hp) < 0.01) this.hpShown = this.hp;
    this.updateHp();

    for (const side of sides) this.updateSide(side, dt);

    if (this.phase === 'intro') {
      this.phaseT += dt;
      if (this.phaseT >= INTRO_SEC) this.startFight();
    } else if (this.phase === 'fight') {
      this.updateFight(dt);
    } else if (this.phase === 'honki') {
      this.updateHonki(dt);
    } else if (this.phase === 'clash') {
      this.updateClash(dt);
    } else if (this.phase === 'stun') {
      this.phaseT += dt;
      this.bossState.rage = Math.max(0, (this.bossState.rage ?? 0) - dt * 2);
      if (this.phaseT >= DUO_STUN_SEC) this.beginFinish();
    } else if (this.phase === 'finish') {
      this.updateFinish(dt);
    } else if (this.phase === 'rest' && this.restGo >= 0) {
      this.restGo += dt;
      if (this.restGo >= REST_GO_SEC) {
        this.restGo = -1;
        this.leaveRest();
      }
    }

    for (const st of this.stars) st.t += dt;
    const landed = this.stars.filter((st) => st.t >= STAR_SEC);
    this.stars = this.stars.filter((st) => st.t < STAR_SEC);
    for (const st of landed) this.hitBoss(st);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * this.s * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floats) {
      f.y -= 40 * this.s * dt;
      f.life -= dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  private updateSide(side: Side, dt: number): void {
    side.char.t += dt;
    side.char.hurt = Math.max(0, side.char.hurt - dt);
    // 跳んだ瞬間に のびた からだを もとに戻す
    side.char.squash += (1 - side.char.squash) * Math.min(1, dt * 10);
    side.revive = Math.max(0, side.revive - dt * 1.4);
    side.shield = Math.max(0, side.shield - dt * 1.6);
    if (side.char.air || side.py < 0) {
      side.vy += this.gravity * dt;
      side.py += side.vy * dt;
      if (side.py >= 0) {
        side.py = 0;
        side.vy = 0;
        side.char.air = false;
      }
    }
    if (side.down) side.downT += dt;
    if (this.phase !== 'fight' && this.phase !== 'clash') return;

    // 測る時間は 押せるあいだだけ数える（ちからくらべの ためのあいだは 数えない）
    if (this.live() && !side.down && side.q && side.wait <= 0 && side.lock <= 0) side.qT += dt;
    if (side.wait > 0) {
      side.wait -= dt;
      if (side.wait <= 0) this.newQuestion(side);
    }
    if (side.lock > 0) {
      side.lock -= dt;
      if (side.lock <= 0) this.newQuestion(side);
    }

    // 「てで あそぶ」にしたゲストが しばらく さわらなければ CPU に戻す（CPU で はじめたときだけ）
    if (side.kind === 'guest' && side.cpuStart && !side.cpu && this.t - side.lastTouch > DUO_CPU_IDLE) {
      side.cpu = true;
      side.cpuPlanned = false;
      this.renderSide(side);
    }

    if (side.cpu) this.updateCpu(side, dt);
  }

  /**
   * CPU。左の子と同じくらいの速さ・正しさで答える。
   * 考えているあいだは「うーん…」、押す前の 0.6秒で 指の絵が ボタンへ動く。
   */
  private updateCpu(side: Side, dt: number): void {
    if (!this.canAnswer(side) || !side.q) {
      side.el.finger.hidden = true;
      return;
    }
    const L = (this.sides as [Side, Side])[0];
    if (!side.cpuPlanned) {
      side.cpuPlanned = true;
      side.cpuAt = cpuDelay(L.trusted ? L.measured : 0, rnd()) / 1000;
      const ok = rnd() < cpuAccuracy(L.st.correct, L.st.total);
      const v = ok ? side.q.answer : cpuWrongChoice(side.q, rnd());
      side.cpuPick = side.q.choices.indexOf(v);
    }
    side.cpuAt -= dt;
    const btn = side.btns[side.cpuPick];
    if (btn && side.cpuAt < 0.6) {
      side.el.finger.hidden = false;
      const k = 1 - Math.max(0, side.cpuAt) / 0.6;
      const box = side.el.answers;
      const x = btn.offsetLeft + btn.offsetWidth / 2;
      const y = btn.offsetTop + btn.offsetHeight * 0.7;
      const x0 = box.offsetLeft + box.offsetWidth / 2;
      const y0 = box.offsetTop + box.offsetHeight + 30;
      side.el.finger.style.transform = `translate(${x0 + (x - x0) * k}px, ${y0 + (y - y0) * k}px)`;
    }
    if (side.cpuAt <= 0) {
      side.el.finger.hidden = true;
      btn?.classList.add('pressed');
      this.answer(side, side.cpuPick);
    }
  }

  private updateFight(dt: number): void {
    if (!this.attacks.length) {
      this.nextAttackIn -= dt;
      if (this.nextAttackIn <= 0) this.launch();
      return;
    }
    // fail・resolveAttack が とちゅうで 配列を かえるので、写しを回す
    for (const a of [...this.attacks]) {
      if (this.phase !== 'fight') return;
      if (this.attacks.includes(a)) this.stepAttack(a, dt);
    }
  }

  private stepAttack(a: Attack, dt: number): void {
    const sides = this.sides as [Side, Side];
    const target = sides[a.side];
    a.shot.t += dt;
    a.shot.rot += dt * 6;
    if (a.poof >= 0) {
      // ぶんしんが 消えていくところ
      a.poof += dt;
      if (a.poof >= POOF_SEC) {
        this.resolveAttack(a);
        this.renderSide(target);
      }
      return;
    }
    // ヒントを見ている子への攻撃は、ペットが押しとどめている（すすまない）
    const held = target.hintShown && !a.dodged;
    if (!held) a.shot.x += a.dir * a.shot.v * dt;
    // cross: 子の まんなかを 何px 通りすぎたか（まだ手前なら マイナス）
    const cross = a.dir < 0 ? target.x - a.shot.x : a.shot.x - target.x;
    // 体に ふれたら 時間切れ。以前は まんなかの少し手前で見ていたので、
    // 時間切れになる前から 攻撃が体に食いこんで「もう当たっている」絵になっていた
    if (!a.dodged && cross >= -this.contact(a.shot.r)) {
      this.fail(target, 'time');
      return;
    }
    // 板の中の のこり時間（体に ふれるまでの きょりの割合）。子どもが見ているのは 下の板なので、
    // 舞台の赤みだけでは 気づきにくい
    if (!a.dodged) {
      const left = Math.max(0, -cross - this.contact(a.shot.r)) / a.span;
      target.el.timer.hidden = false;
      target.el.timer.classList.remove('push');
      target.el.timerFill.style.transform = `scaleX(${Math.min(1, left).toFixed(3)})`;
      target.el.timer.classList.toggle('low', left < 0.35);
    }
    // 跳んだ子の まんなかを 通りすぎた瞬間に「よけた」を見せる（跳んだ頂点と同じ時刻になる）。
    // そこからは速く ぬけさせる。ぎりぎりで答えたときは のこりの きょりが短く、そのままの速さだと
    // 着地したときに まだ せなかに重なっていて、また当たったように見える
    if (a.dodged && !a.passed && cross >= 0) {
      a.passed = true;
      // 3れんぱつは いちばん うしろまで 着地（頂点から 0.34秒）より前に ぬけさせる
      const clear = this.trail(a) + this.contact(a.shot.r) + a.shot.r;
      a.shot.v = Math.max(a.shot.v, 260 * this.s, clear / 0.26);
      this.dodgeFx(target, a);
    }
    // 3れんぱつは いちばん うしろまで 通りすぎてから 片づける
    const tail = this.trail(a);
    const out = a.shot.x < -60 * this.s - tail || a.shot.x > this.W + 60 * this.s + tail;
    if (a.dodged && (cross > 90 * this.s + tail || out)) {
      this.resolveAttack(a);
      this.renderSide(target);
    }
  }

  private updateFinish(dt: number): void {
    this.finT += dt;
    const sides = this.sides as [Side, Side];
    for (const side of sides) this.finishMotion(side);
    // 放った瞬間。ひとふんばりぶん 体をのばす（ハンマーは とびかかりの式が のばす）
    if (!this.finFired && this.finT >= FIN_CHARGE) {
      this.finFired = true;
      for (const side of sides) if (this.weaponOf(side).style !== 'smash') side.char.squash = 1.16;
      sfx.finishFire();
    }
    if (!this.finImpact && this.finT >= FIN_CHARGE + FIN_FLY) {
      this.finImpact = true;
      this.bossState.mode = 'down';
      this.bossState.hit = 0.3;
      this.flash = 1;
      this.shake = 0.4;
      this.burst(this.bossX, this.groundY - this.bossSize() * 0.5, 30, '#ffe17a');
      sfx.blast();
    }
    if (this.finImpact) this.bossState.squash += (0.24 - this.bossState.squash) * Math.min(1, dt * 6);
    if (this.finT >= FIN_TOTAL) this.afterBoss();
  }

  private weaponOf(side: Side): WeaponDef {
    return weaponDef(side.look.weapon ?? DEFAULT_WEAPON);
  }

  /**
   * とどめの 体の動き。本編（runner.ts の updateFinish）と同じく ぶきの かたちで変える。
   *  ハンマー … 振りかぶって・しゃがんで・とびかかって 振りおろす（位置も weapons.ts の 振りの式から出す）
   *  けん・ドリル・たいあたり … ボスの手前まで 踏みこんで、もどる
   *  とばす ぶき・まほう … 放つ直前に ぐっと引いて、放つと同時に もどる
   * 前は 立ったまま 光と ぶきだけが 飛んでいき、だれが どの ぶきで たおしたのか 体で 見えなかった
   */
  private finishMotion(side: Side): void {
    const def = this.weaponOf(side);
    const t = this.finT;
    const leap = smashLeap(def, this.finView(side));
    if (leap) {
      side.lunge = leap.dx;
      side.py = leap.dy;
      side.vy = 0;
      side.char.air = false;
      side.char.squash = leap.squash;
    } else if (def.style === 'slash') {
      // 本編は 相手の まんなか近くまで 斬りぬけるが、ボスは大きく 2人が まんなかで重なるので、ボスの手前で止める
      const k = Math.min(1, Math.max(0, (t - FIN_CHARGE) / (FIN_FLY + 0.35)));
      const reach = Math.max(0, Math.abs(this.bossX - side.x) - this.bossSize() * 0.5 - 20 * this.s);
      side.lunge = reach * Math.sin(k * Math.PI);
    } else {
      const tense = Math.max(0, Math.min(1, (t - (FIN_CHARGE - 0.26)) / 0.26));
      const fire = Math.max(0, Math.min(1, (t - FIN_CHARGE) / 0.14));
      side.lunge = -9 * this.s * tense * (1 - fire);
    }
  }

  // ---------------------------------------------------------------- 寸法

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    // とんでいる攻撃は「のこり時間」そのもの。画面が変わっても のこりの割合を保つ（runner.ts と同じ）。
    // まだ よけていない攻撃は「体に ふれるまで のこり何px か」を 画面の大きさに合わせて保つ
    const sides0 = this.sides;
    const prev = sides0
      ? this.attacks.map((a) => {
        const target = sides0[a.side];
        const oldSpan = target.x - this.bossX;
        return {
          a,
          oldSpan,
          frac: Math.abs(oldSpan) > 1 ? (a.shot.x - this.bossX) / oldSpan : 0,
          oldLeft: a.dodged ? 0 : Math.abs(a.shot.x - target.x) - this.contact(a.shot.r),
        };
      })
      : [];
    const oldS = this.s;
    this.W = Math.round(rect.width);
    this.H = Math.round(rect.height);
    const sr = this.elScreen.getBoundingClientRect();
    this.skyTop = rect.top - sr.top;
    this.skyH = sr.height > 1 ? sr.height : this.H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.s = Math.min(Math.max(Math.min(this.W / 420, this.H / 150), 0.8), 2.4);
    this.groundY = this.H - 20 * this.s;
    this.bossX = this.W / 2;
    // ジャンプは「頂点で 攻撃の上を通る」高さに合わせて逆算する（dodge が同じ JUMP_APEX を使う）
    const apex = 70 * this.s;
    this.gravity = (2 * apex) / (JUMP_APEX * JUMP_APEX);
    this.jumpV = -this.gravity * JUMP_APEX;
    if (this.sides) {
      const lx = Math.max(56 * this.s, this.W * 0.15);
      this.sides[0].x = lx;
      this.sides[1].x = this.W - lx;
    }
    for (const { a, oldSpan, frac, oldLeft } of prev) {
      if (!this.sides || Math.abs(oldSpan) <= 1) continue;
      const target = this.sides[a.side];
      const span = target.x - this.bossX;
      const k = Math.abs(span / oldSpan);
      a.shot.r *= this.s / oldS;
      a.shot.v *= k;
      a.span *= k;
      a.shot.y = this.groundY - 15 * this.s;
      if (a.dodged) {
        a.shot.x = this.bossX + frac * span;
      } else {
        // ボスの側（攻撃が来る向きの反対）に、体に ふれる きょり＋のこりを 置きなおす
        a.shot.x = target.x - a.dir * (this.contact(a.shot.r) + oldLeft * k);
      }
    }
  }

  /** ボスの高さ。ほんきモードでは 大きくなる */
  private bossSize(): number {
    return this.baseSize() * this.grow;
  }

  private baseSize(): number {
    return 48 * this.s * (1 + this.bossDefn.tier * 0.035);
  }

  private view(): SceneView {
    return { W: this.W, H: this.H, s: this.s, groundY: this.groundY, scroll: this.t * 8 * this.s, t: this.t, skyTop: this.skyTop, skyH: this.skyH };
  }

  // ---------------------------------------------------------------- 絵

  private draw(): void {
    const g = this.g;
    const { W, H, s } = this;
    if (!this.sides) return;
    g.clearRect(0, 0, W, H);
    const calm = reduced();
    g.save();
    if (this.shake > 0 && !calm) g.translate((rnd() - 0.5) * 7 * s, (rnd() - 0.5) * 6 * s);
    drawScene(g, this.theme, this.view());

    // とどめの暗転。景色のあと、2人と ボスを描く前（本編と同じ）
    if (this.phase === 'finish') drawFinishDim(g, this.finView(this.sides[0]), finishDim(this.finT));

    this.drawAttackGlow();
    this.drawBossFig();
    for (const side of this.sides) this.drawSide(side);
    this.drawShots();
    this.drawClash();
    for (const st of this.stars) this.drawStar(st);
    if (this.phase === 'finish') {
      for (const side of this.sides) this.drawSideFinish(side);
    }

    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    drawWeather(g, this.theme, this.view());
    this.drawFloats();
    this.drawSay();
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${calm ? Math.min(0.15, this.flash * 0.45) : this.flash * 0.45})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.banner.life > 0) this.drawBanner();
    g.restore();
  }

  /** ねらわれている子の側の ふちが、攻撃が近づくほど赤くなる（数字を出さない のこり時間） */
  private drawAttackGlow(): void {
    if (this.phase !== 'fight') return;
    for (const a of this.attacks) if (!a.dodged) this.drawGlowFor(a);
  }

  private drawGlowFor(a: Attack): void {
    const g = this.g;
    const target = (this.sides as [Side, Side])[a.side];
    // 体に ふれるところを 0 にして測る（まんなかで測ると、時間切れの瞬間でも 濃さが 8割ほどで止まる）
    const c = this.contact(a.shot.r);
    const span = Math.max(1, Math.abs(this.bossX - target.x) - c);
    const left = Math.max(0, Math.abs(a.shot.x - target.x) - c);
    const near = Math.max(0, 1 - left / span - 0.35) / 0.65;
    if (near <= 0) return;
    const x0 = a.side === 0 ? 0 : this.W;
    const grad = g.createLinearGradient(x0, 0, this.W / 2, 0);
    grad.addColorStop(0, `rgba(228,103,92,${0.35 * near})`);
    grad.addColorStop(1, 'rgba(228,103,92,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.W, this.H);
  }

  private drawBossFig(): void {
    const g = this.g;
    const s = this.s;
    const size = this.bossSize();
    // 出てくるとき 上から おちてくる
    const k = this.phase === 'intro' ? Math.min(1, this.phaseT / 0.55) : 1;
    const drop = (1 - k) * (1 - k) * -this.H;
    const fade = this.phase === 'finish' && this.finT > FIN_TOTAL - 0.5 ? Math.max(0, (FIN_TOTAL - this.finT) / 0.5) : 1;
    g.save();
    g.globalAlpha = fade;
    g.fillStyle = 'rgba(40,60,50,.2)';
    g.beginPath();
    g.ellipse(this.bossX, this.groundY + 3 * s, size * 0.6, 6 * s, 0, 0, Math.PI * 2);
    g.fill();
    // ボスの絵は左向き。右の子をねらうときは 鏡にする
    if (this.facing > 0) {
      g.translate(this.bossX * 2, 0);
      g.scale(-1, 1);
    }
    drawBoss(g, this.bossX, this.groundY + drop, size, this.bossDefn, this.bossState);
    // ほうせきが 半分を きったら・ちからくらべでは あせを かく（「もうすこしで たおせる」の しるし）
    const left = this.cores[0] + this.cores[1];
    if (this.rage && this.bossState.mode !== 'down' && (this.phase === 'clash' || left <= this.coreMax)) {
      this.drawSweat(this.bossX - size * 0.62, this.groundY - size * 0.78);
    }
    g.restore();
    if (this.phase === 'intro' || (this.phase === 'fight' && !this.rage)) this.drawBossHp(drop, fade);
    if (this.rage && (this.phase === 'fight' || this.phase === 'honki')) this.drawGems();
    if (this.phase === 'clash' && this.duel.started) {
      const need = Math.max(1, this.duel.need - this.duel.push);
      this.plate(this.bossX - 62 * this.s, this.bossX + 62 * this.s, this.bossBarY() + 4 * this.s);
      this.drawCount(`あと ${need}かい！`, this.bossX, this.bossBarY() + 4 * this.s, need <= 1);
    }
    if (this.phase === 'stun' || (this.phase === 'finish' && !this.finImpact)) this.drawDizzy(size);
  }

  /** あせ。ボスの顔の前（向いているほう）に 2つぶ、すこしずつ 落ちる */
  private drawSweat(x: number, y: number): void {
    const g = this.g;
    const s = this.s;
    for (let i = 0; i < 2; i++) {
      const k = (this.t * 0.9 + i * 0.5) % 1;
      const dx = x - i * 9 * s;
      const dy = y + k * 16 * s + i * 6 * s;
      const r = 4 * s;
      g.globalAlpha = 1 - k * 0.6;
      g.fillStyle = '#9fdcff';
      g.strokeStyle = 'rgba(30,60,90,.6)';
      g.lineWidth = Math.max(1, 1.2 * s);
      g.beginPath();
      g.moveTo(dx, dy - r * 1.8);
      g.quadraticCurveTo(dx + r * 1.1, dy - r * 0.2, dx, dy + r);
      g.quadraticCurveTo(dx - r * 1.1, dy - r * 0.2, dx, dy - r * 1.8);
      g.fill();
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** ほうせき。左の子の側と 右の子の側。まんなかに「あと ○」 */
  private drawGems(): void {
    const s = this.s;
    // 変身の あいだは 1こずつ 出てくる（updateHonki の 音と 同じ間）
    const shown = this.phase === 'honki' ? ((this.phaseT - 1.0) / 0.9) * this.coreMax : Infinity;
    if (shown > 0) {
      const reach = (40 + (this.coreMax - 1) * 22 + 15) * s;
      this.plate(this.bossX - reach, this.bossX + reach, this.bossBarY() + 4 * s, Math.min(1, shown));
    }
    for (const side of [0, 1] as SideId[]) {
      for (let i = 0; i < this.coreMax; i++) {
        const k = Math.max(0, Math.min(1, shown - i));
        if (k <= 0) continue;
        const { x, y } = this.gemPos(side, i);
        this.drawGem(x, y, 9 * s * (0.4 + 0.6 * k), i < this.cores[side] ? GEM_COLORS[side] : null, i);
      }
    }
    if (shown < 1) return;
    const left = this.cores[0] + this.cores[1];
    this.drawCount(`あと ${left}`, this.bossX, this.bossBarY() + 4 * s, left <= 2);
  }

  /**
   * ほうせきの列・「あと ○かい！」の うしろの 暗い 下じき。大きなボス（5体目から）・小さい画面では
   * つのが 列に とどくので、つのを 下じきの うしろへ かくして 字と ほうせきを 読めるようにする
   */
  private plate(x0: number, x1: number, y: number, alpha = 1): void {
    const g = this.g;
    const h = 28 * this.s;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(25,20,40,.6)';
    roundRect(g, x0, y - h / 2, x1 - x0, h, h / 2);
    g.fill();
    g.restore();
  }

  /** ほうせき1こ。color が null は われた あと（うすい 点線の ふち） */
  private drawGem(x: number, y: number, r: number, color: string | null, i: number): void {
    const g = this.g;
    g.save();
    g.translate(x, y + (color ? Math.sin(this.t * 4 + i) * r * 0.1 : 0));
    g.beginPath();
    g.moveTo(-0.55 * r, -0.65 * r);
    g.lineTo(0.55 * r, -0.65 * r);
    g.lineTo(0.95 * r, -0.15 * r);
    g.lineTo(0, r);
    g.lineTo(-0.95 * r, -0.15 * r);
    g.closePath();
    if (color) {
      g.shadowColor = color;
      g.shadowBlur = r * 0.9;
      g.fillStyle = color;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(40,30,60,.85)';
      g.lineWidth = Math.max(1.5, r * 0.18);
      g.lineJoin = 'round';
      g.stroke();
      // カットの すじと 光
      g.strokeStyle = 'rgba(40,30,60,.35)';
      g.lineWidth = Math.max(1, r * 0.09);
      g.beginPath();
      g.moveTo(-0.95 * r, -0.15 * r);
      g.lineTo(0.95 * r, -0.15 * r);
      g.moveTo(-0.3 * r, -0.65 * r);
      g.lineTo(0, r);
      g.lineTo(0.3 * r, -0.65 * r);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath();
      g.moveTo(-0.5 * r, -0.55 * r);
      g.lineTo(-0.2 * r, -0.55 * r);
      g.lineTo(-0.55 * r, -0.2 * r);
      g.closePath();
      g.fill();
    } else {
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(255,255,255,.45)';
      g.lineWidth = Math.max(1, r * 0.12);
      g.stroke();
    }
    g.restore();
  }

  /** ボスの上の 大きな数字（「あと 3」）。のこり すこしで ゆっくり ふくらむ */
  private drawCount(text: string, x: number, y: number, pulse: boolean): void {
    const g = this.g;
    const s = this.s;
    const k = pulse ? 1 + Math.max(0, Math.sin(this.t * 6)) * 0.12 : 1;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(16 * s)}px system-ui, sans-serif`;
    g.lineWidth = 5 * s;
    g.strokeStyle = 'rgba(30,25,45,.85)';
    g.strokeText(text, 0, 0);
    g.fillStyle = pulse ? '#ffe17a' : '#ffffff';
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** 目を回している ボスの頭の上を まわる 星（ちからくらべに勝ってから とどめが当たるまで） */
  private drawDizzy(size: number): void {
    const g = this.g;
    const s = this.s;
    const cy = this.groundY - size * 1.05;
    for (let i = 0; i < 3; i++) {
      const a = this.t * 5 + (i * Math.PI * 2) / 3;
      const x = this.bossX + Math.cos(a) * size * 0.42;
      const y = cy + Math.sin(a) * 7 * s;
      g.fillStyle = '#ffe17a';
      g.strokeStyle = 'rgba(40,30,60,.8)';
      g.lineWidth = Math.max(1, 1.4 * s);
      starPath(g, x, y, 6 * s, a);
      g.fill();
      g.stroke();
    }
  }

  /** ボスの頭の上の HP。上の帯は 子どもが見ている 下の板から遠いので、ボスの すぐ上にも出す */
  private bossBarY(): number {
    // つのの ぶん 上に出す（つのは 段階が上がるほど長い。boss.ts の horns）。体の すぐ上だと つのに かぶる。
    // 上は ふきだしと 帯が入るぶん あける（大きなボスでは つのの先に すこし かかる）
    const horn = 0.44 + this.bossDefn.tier * 0.035;
    return Math.max(40 * this.s, this.groundY - this.bossSize() * (1 + horn) - 16 * this.s);
  }

  private drawBossHp(drop: number, alpha: number): void {
    const g = this.g;
    const s = this.s;
    const w = this.bossSize() * 1.3;
    const h = 9 * s;
    const x = this.bossX - w / 2;
    const y = this.bossBarY() + drop;
    const k = Math.max(0, Math.min(1, this.hpShown / this.hpMax));
    const low = k <= 0.25;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(25,20,40,.6)';
    roundRect(g, x - 2 * s, y - 2 * s, w + 4 * s, h + 4 * s, h);
    g.fill();
    // のこり すこしは 色を変えて ゆっくり光らせる
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, low ? '#ffb02e' : '#e4675c');
    grad.addColorStop(1, low ? '#ffe17a' : '#ffb05c');
    g.fillStyle = grad;
    if (k > 0) {
      roundRect(g, x, y, w * k, h, h / 2);
      g.fill();
    }
    if (low) {
      g.globalAlpha = alpha * (0.35 + 0.35 * Math.sin(this.t * 8));
      g.strokeStyle = '#fff4b8';
      g.lineWidth = 2 * s;
      roundRect(g, x - 2 * s, y - 2 * s, w + 4 * s, h + 4 * s, h);
      g.stroke();
    }
    g.restore();
  }

  private drawShots(): void {
    const g = this.g;
    for (const a of this.attacks) {
      if (a.move?.clone) {
        this.drawClone(a);
        continue;
      }
      // 3れんぱつは 先頭の うしろに つらねる（いちばん うしろから描く）。
      // 撃ったところ（ボスの手もと）より うしろの ぶんは まだ描かない。ボスから 1つずつ 出てくる
      // （描くと りょうがわの 列が ボスの体の上で かさなっていた）
      const n = a.move ? a.move.count : 1;
      const origin = this.bossX + a.dir * 30 * this.s;
      const gap = a.shot.r * this.gapK(a);
      for (let k = n - 1; k >= 0; k--) {
        const x = a.shot.x - a.dir * k * gap;
        if (k > 0 && (x - origin) * a.dir < 0) continue;
        const shot: Shot = { ...a.shot, x, rot: a.shot.rot + k * 0.7, t: a.shot.t + k * 0.13 };
        // 攻撃の絵は左へ進む向き。右へ撃つときは 鏡にする
        if (a.dir > 0) {
          g.save();
          g.translate(this.W, 0);
          g.scale(-1, 1);
          drawShot(g, { ...shot, x: this.W - shot.x }, this.bossDefn);
          g.restore();
        } else {
          drawShot(g, shot, this.bossDefn);
        }
      }
    }
  }

  /** ボスの ぶんしん。小さく すけた ボスが 歩いてくる。正解で ふくらみながら 消える */
  private drawClone(a: Attack): void {
    const g = this.g;
    const s = this.s;
    const size = this.baseSize() * 0.55;
    const k = a.poof >= 0 ? Math.min(1, a.poof / POOF_SEC) : 0;
    const x = a.shot.x;
    g.save();
    g.globalAlpha = 0.22 * (1 - k);
    g.fillStyle = 'rgba(40,60,50,1)';
    g.beginPath();
    g.ellipse(x, this.groundY + 3 * s, size * 0.55, 5 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.82 * (1 - k);
    // ボスの絵は 左向き。右へ歩く ぶんしんは 鏡にする
    if (a.dir > 0) {
      g.translate(x * 2, 0);
      g.scale(-1, 1);
    }
    const sc = 1 + k * 0.6;
    g.translate(x, this.groundY);
    g.scale(sc, sc);
    g.translate(-x, -this.groundY);
    drawBoss(g, x, this.groundY, size, this.bossDefn, { t: this.t + a.side * 0.5, mode: 'charge', hit: k > 0 ? 0.4 : 0, squash: 1, rage: 0.6 });
    g.restore();
  }

  /** ちからくらべの 両はし。子の手もと（kx, ky）と ボスの口もと（bx, by） */
  private clashEnds(side: Side): { kx: number; ky: number; bx: number; by: number } {
    const s = this.s;
    const bs = this.bossSize();
    const toKid = side.id === 0 ? -1 : 1;
    return {
      kx: side.x - toKid * 24 * s,
      ky: this.groundY - 20 * s,
      bx: this.bossX + toKid * bs * 0.5,
      by: this.groundY - bs * 0.5,
    };
  }

  /** ぶつかる点（その子の側） */
  private clashPoint(side: Side): { x: number; y: number } {
    const e = this.clashEnds(side);
    const f = this.clashFrac();
    return { x: e.kx + (e.bx - e.kx) * f, y: e.ky + (e.by - e.ky) * f };
  }

  /** ちからくらべ。ボスの だいわざ（赤い ビーム）と、2人の ぶきの光が 両がわで ぶつかる */
  private drawClash(): void {
    if (this.phase !== 'clash' || !this.sides) return;
    const g = this.g;
    const s = this.s;
    const charge = Math.min(1, this.phaseT / DUO_CLASH_CHARGE);
    for (const side of this.sides) {
      const e = this.clashEnds(side);
      const w = this.weaponOf(side);
      if (!this.duel.started) {
        // ため。ボスの口もとと 子の ぶきに 光が たまっていく
        this.glowBall(e.bx, e.by, (5 + 14 * charge) * s, '#ff6b5a', '#ffd6cc');
        this.glowBall(e.kx, e.ky, (3 + 9 * charge) * s, w.color, w.glow);
        continue;
      }
      const p = this.clashPoint(side);
      this.beam(e.kx, e.ky, p.x, p.y, w.color, w.glow);
      this.beam(e.bx, e.by, p.x, p.y, '#ff5a4a', '#ffc2b8');
      const r = (15 + Math.sin(this.t * 22) * 2.5) * s;
      this.glowBall(p.x, p.y, r, '#ffffff', '#fff4b8');
      g.save();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5 * s;
      g.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = this.t * 3 + (i * Math.PI) / 4;
        const d0 = r * 1.1;
        const d1 = r * (1.7 + 0.3 * Math.sin(this.t * 17 + i));
        g.beginPath();
        g.moveTo(p.x + Math.cos(a) * d0, p.y + Math.sin(a) * d0);
        g.lineTo(p.x + Math.cos(a) * d1, p.y + Math.sin(a) * d1);
        g.stroke();
      }
      g.restore();
    }
  }

  private beam(x0: number, y0: number, x1: number, y1: number, color: string, glow: string): void {
    const g = this.g;
    const wob = 1 + Math.sin(this.t * 30) * 0.12;
    g.save();
    g.lineCap = 'round';
    for (const [w, c, al] of [[18, glow, 0.5], [9, color, 0.95], [3.5, '#ffffff', 0.95]] as const) {
      g.globalAlpha = al;
      g.strokeStyle = c;
      g.lineWidth = w * this.s * wob;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.restore();
  }

  private glowBall(x: number, y: number, r: number, core: string, glow: string): void {
    const g = this.g;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.8);
    grad.addColorStop(0, 'rgba(255,255,255,.95)');
    grad.addColorStop(0.4, glow);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r * 1.8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = core;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(x, y, r * 0.55, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  /** ボスの ふきだし。ボスの頭の上（ほうせき・体力のバーより上）に出す */
  private drawSay(): void {
    const sy = this.say;
    if (sy.life <= 0) return;
    const g = this.g;
    const s = this.s;
    g.save();
    g.globalAlpha = Math.min(1, sy.life / 0.25);
    g.font = `900 ${Math.round(15 * s)}px system-ui, sans-serif`;
    const w = g.measureText(sy.text).width + 22 * s;
    const h = 28 * s;
    const cx = this.bossX;
    const bottom = this.bossBarY() - 14 * s;
    const x = Math.min(Math.max(cx - w / 2, 6 * s), this.W - w - 6 * s);
    const y = Math.max(3 * s, bottom - h);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(40,30,60,.9)';
    g.lineWidth = 2.5 * s;
    roundRect(g, x, y, w, h, h / 2);
    g.fill();
    g.stroke();
    // しっぽ（ボスのほうへ）
    g.beginPath();
    g.moveTo(cx - 7 * s, bottom - 1.5 * s);
    g.lineTo(cx, bottom + 9 * s);
    g.lineTo(cx + 7 * s, bottom - 1.5 * s);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx - 7 * s, bottom);
    g.lineTo(cx, bottom + 9 * s);
    g.lineTo(cx + 7 * s, bottom);
    g.stroke();
    g.fillStyle = '#c0283c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(sy.text, x + w / 2, y + h / 2 + s);
    g.restore();
  }

  private drawSide(side: Side): void {
    const g = this.g;
    const s = this.s;
    const size = 34 * s;
    const mirror = side.id === 1;
    // とどめで 踏みこんだ・とびかかった いまの位置。cx は 鏡の中（ボスへ向かう向きが プラス）、rx は 画面の座標
    const cx = side.x + side.lunge;
    const rx = side.x + (mirror ? -side.lunge : side.lunge);
    const lift = Math.min(1, -side.py / (80 * s));
    g.fillStyle = `rgba(40,60,50,${0.22 * (1 - lift * 0.7)})`;
    g.beginPath();
    g.ellipse(rx, this.groundY + 3 * s, 17 * s * (1 - lift * 0.4), 5 * s, 0, 0, Math.PI * 2);
    g.fill();

    g.save();
    if (mirror) {
      g.translate(side.x * 2, 0);
      g.scale(-1, 1);
    }
    // ペットは うしろ（外がわ）を ついてくる。ヒントのあいだは 前に出て 攻撃を押しとどめる（ちからくらべでは いっしょに押す）
    const holding = side.hintShown && (this.incoming(side) !== null || this.phase === 'clash');
    if (side.pet) {
      const px = holding ? side.x + 40 * s : side.x - 36 * s;
      drawPet(g, px, this.groundY, 26 * s, side.pet.art, this.t);
    }

    if (side.down) {
      // たおれている。外がわへ ころんで、頭の上を 星が まわる
      const k = Math.min(1, side.downT / 0.25);
      g.save();
      g.translate(side.x, this.groundY);
      g.rotate(-1.3 * k);
      g.translate(-side.x, -this.groundY);
      drawChar(g, side.x, this.groundY, size, { ...side.look, weapon: '' }, { ...side.char, hurt: 1, air: false });
      g.restore();
      for (let i = 0; i < 3; i++) {
        const ang = this.t * 4 + (i * Math.PI * 2) / 3;
        g.fillStyle = '#ffe17a';
        g.beginPath();
        g.arc(side.x - size * 0.9 + Math.cos(ang) * 12 * s, this.groundY - size * 0.5 + Math.sin(ang) * 5 * s, 3.5 * s, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      // ハンマーを振っているあいだは フィニッシュの絵が ハンマーを描くので、手もとの ぶきは消す（2本に見えないように）
      const swinging = this.phase === 'finish' && finishHoldsWeapon(this.weaponOf(side), this.finView(side));
      drawChar(g, cx, this.groundY + side.py, size, swinging ? { ...side.look, weapon: '' } : side.look, side.char);
      if (side.kind === 'guest' && side.cpu) this.drawAntenna(cx, this.groundY + side.py - size);
    }

    if (side.revive > 0) {
      g.strokeStyle = `rgba(255,244,184,${side.revive})`;
      g.lineWidth = 4 * s * side.revive;
      g.beginPath();
      g.arc(cx, this.groundY - size * 0.5, size * (1.4 - side.revive * 0.6), 0, Math.PI * 2);
      g.stroke();
    }
    if (side.shield > 0) {
      g.strokeStyle = `rgba(143,216,255,${side.shield})`;
      g.lineWidth = 5 * s;
      g.beginPath();
      g.arc(cx + 26 * s, this.groundY - size * 0.5, size * 0.7, -1.1, 1.1);
      g.stroke();
    }
    // パワーアップの しるし
    const pw = powerDef(side.power);
    if (pw && !(pw.id === 'guard' && side.powerUsed) && this.phase !== 'rest') {
      g.font = `${Math.round(16 * s)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      if (mirror) {
        g.save();
        g.translate(side.x * 2, 0);
        g.scale(-1, 1);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      // 跳んでいるときも 頭の上に ついていく（その場に のこすと 跳んだ顔に かさなった）
      g.fillText(pw.icon, rx, this.groundY + (side.down ? 0 : side.py) - size - 18 * s);
      if (mirror) g.restore();
    }
    g.restore();
  }

  /** CPU の しるし。頭の上の アンテナ */
  private drawAntenna(x: number, headY: number): void {
    const g = this.g;
    const s = this.s;
    g.strokeStyle = '#5b6672';
    g.lineWidth = Math.max(1.5, 2 * s);
    g.beginPath();
    g.moveTo(x, headY + 4 * s);
    g.lineTo(x, headY - 10 * s);
    g.stroke();
    g.fillStyle = Math.sin(this.t * 6) > 0 ? '#ff6b6b' : '#ffd36b';
    g.beginPath();
    g.arc(x, headY - 12 * s, 3.5 * s, 0, Math.PI * 2);
    g.fill();
  }

  private drawStar(st: Star): void {
    const g = this.g;
    const { x, y } = this.starPos(st);
    const r = (6 + st.dmg * 3.5) * this.s;
    g.save();
    g.translate(x, y);
    g.rotate(st.t * 12);
    g.fillStyle = GEM_COLORS[st.from];
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1.5, 1.6 * this.s);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const ang = (i * Math.PI) / 5 - Math.PI / 2;
      if (i === 0) g.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      else g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private finView(side: Side): FinishView {
    const s = this.s;
    const mirror = side.id === 1;
    const mx = (x: number) => (mirror ? this.W - x : x);
    // ボスへ向かう向き。右の子は 鏡の中で描くので、渡す座標は どちらも「左の子と同じ向き」になる
    const dir = mirror ? -1 : 1;
    return {
      t: this.finT,
      s,
      W: this.W,
      H: this.H,
      // ふみこんだ・引いた いまの手もとから出す（本編と同じ）
      fromX: mx(side.x + dir * (side.lunge + 26 * s)),
      fromY: this.groundY - 14 * s,
      toX: mx(this.bossX),
      toY: this.groundY - this.bossSize() * 0.5,
      homeX: mx(side.x),
      homeY: this.groundY,
      charSize: 34 * s,
      // 2人とも じぶんの ぶきで とどめを刺しにいく（ハンマーは とびかかる）
      leap: true,
    };
  }

  /** ふたりで とどめ。それぞれの ぶきで 同時に。右の子は 鏡にして描く */
  private drawSideFinish(side: Side): void {
    const g = this.g;
    const def = this.weaponOf(side);
    g.save();
    if (side.id === 1) {
      g.translate(this.W, 0);
      g.scale(-1, 1);
    }
    drawFinish(g, def, this.finView(side));
    g.restore();
  }

  private drawFloats(): void {
    const g = this.g;
    g.textAlign = 'center';
    g.font = `800 ${Math.round(15 * this.s)}px system-ui, sans-serif`;
    for (const f of this.floats) {
      g.globalAlpha = Math.min(1, f.life / 0.4);
      g.lineWidth = 4 * this.s;
      g.strokeStyle = 'rgba(30,40,50,.75)';
      // 画面の はしで切れないよう 内がわへ寄せる（「○○が おさえてる！」は はしの子の上に出る）
      const half = g.measureText(f.text).width / 2 + 6 * this.s;
      const x = Math.min(Math.max(f.x, half), this.W - half);
      g.strokeText(f.text, x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, x, f.y);
    }
    g.globalAlpha = 1;
  }

  private drawBanner(): void {
    const g = this.g;
    const k = Math.min(1, this.banner.life / 0.3, (this.banner.full - this.banner.life) / 0.2 + 0.001);
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, k));
    g.textAlign = 'center';
    let size = Math.round(22 * this.s);
    g.font = `900 ${size}px system-ui, sans-serif`;
    // 長い ことば（「おしかえされた… もういちど！」）は 画面の はばに おさまるよう 小さくする
    const tw = g.measureText(this.banner.text).width;
    if (tw > this.W * 0.92) {
      size = Math.floor((size * this.W * 0.92) / tw);
      g.font = `900 ${size}px system-ui, sans-serif`;
    }
    g.lineWidth = Math.max(3, size * 0.27);
    g.strokeStyle = 'rgba(30,40,50,.8)';
    // ボスの上の ほうせき・体力のバーに かからない高さ（大きいボスほど 上へ）
    const y = Math.max(size, Math.min(this.H * 0.26, this.bossBarY() - 26 * this.s));
    g.strokeText(this.banner.text, this.W / 2, y);
    g.fillStyle = '#fff4b8';
    g.fillText(this.banner.text, this.W / 2, y);
    g.restore();
  }

  private showBanner(text: string, sec: number): void {
    this.banner = { text, life: sec, full: sec };
  }

  private floatAt(x: number, y: number, text: string, color: string): void {
    this.floats.push({ x, y, text, color, life: 1.2 });
  }

  private burst(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const v = (60 + rnd() * 160) * this.s;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * this.s, life: 0.7, max: 0.7, r: (2 + rnd() * 2.5) * this.s, color });
    }
  }

  private ring(x: number, y: number, color: string): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const v = 150 * this.s;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35, max: 0.35, r: 2.5 * this.s, color });
    }
  }
}

/** 5つの とがりの 星の道すじ（塗る・ふちどるは 呼ぶ側） */
function starPath(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

/** こたえを入れた式（たおれたときに 下の板に出す） */
function solvedText(q: Question): string {
  return solvedParts(q).ans;
}

/** やすみの画面の「つぎのボス」。かげだけ見せる */
function paintBossShadow(canvas: HTMLCanvasElement, def: BossDef): void {
  const size = 96;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * 1.4 * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size * 1.4}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size * 1.4, size);
  drawBoss(g, size * 0.7, size * 0.92, size * 0.62, def, { t: 0.3, mode: 'idle', hit: 0, squash: 1 });
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgba(40,30,60,.85)';
  g.fillRect(0, 0, size * 1.4, size);
  g.globalCompositeOperation = 'source-over';
}
