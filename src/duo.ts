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
 *
 * 入力は pointerdown で受ける。2人が ほぼ同時に押すので、指ごとに来る pointerdown のほうが確実
 * （click は 2本の指が同時に触れているとき 片方しか来ないことがある）。
 *
 * ★・図鑑・おぼえた は動かさない（記録は読むだけ）。となりの子が答えを言えるので、
 * 「おぼえた」の証拠としては 本編より弱い。
 */

import { sfx } from './audio';
import { bossDef, drawBoss, drawShot, shotFor, type BossDef, type BossState, type Shot } from './boss';
import { bossStage, tierDef, worldById, type Tier } from './curriculum';
import {
  DUO_BOSSES,
  DUO_BOSS_COUNT,
  DUO_CPU_IDLE,
  DUO_EASE_BACK,
  DUO_EASE_DOWNS,
  DUO_EASE_MAX,
  DUO_FIRST_MEASURE,
  DUO_POWERS,
  DUO_PRIZES,
  DUO_WRONG_LOCK,
  DuoPicker,
  attackTime,
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
  nextMeasure,
  poolLevel,
  powerDef,
  powersOn,
  spotOf,
  statsOf,
  type DuoEntry,
  type DuoPool,
} from './duo-rules';
import { ITEMS, grantPrize } from './items';
import { drawPet, paintPetIcon } from './petart';
import { NO_POWER, petOf, powerFor, type PetDef, type PetPower } from './pets';
import { solvedParts, type Question, type StatReader } from './questions';
import { persist, profile, save, slots, timeUp, today, type DuoLog, type DuoSuspend, type Profile } from './save';
import { drawScene, drawWeather, type SceneView } from './scenery';
import { drawChar, paintSkinIcon, type CharState, type Look } from './sprites';
import { frameArt } from './tenframe';
import { skyCss, themeFor, type Theme } from './theme';
import {
  FIN_CHARGE, FIN_FLY, FIN_TOTAL, DEFAULT_WEAPON, drawFinish, drawFinishDim, finishDim, weaponDef, type FinishView,
} from './weapons';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** 右の相手。きろくの子（枠の番号）か、ゲスト（てで／CPU） */
export type DuoPartner = { kind: 'kid'; slot: number } | { kind: 'guest'; cpu: boolean };

type SideId = 0 | 1;
type Phase = 'off' | 'intro' | 'fight' | 'finish' | 'rest' | 'end';

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
}

interface Star {
  from: SideId;
  x0: number;
  y0: number;
  t: number;
  dmg: number;
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

const freshStats = (): SideStats => ({ attacks: 0, downs: 0, hints: 0, answers: 0, ms: 0, correct: 0, total: 0 });

function rnd(): number {
  return Math.random();
}

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
  private attack: Attack | null = null;
  private nextAttackIn = 0;
  private nextTarget: SideId = 0;
  private shots = 0;
  private stars: Star[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private phaseT = 0;
  private finT = 0;
  private finImpact = false;
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
    return this.phase === 'intro' || this.phase === 'fight' || this.phase === 'finish';
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
    const L = this.makeSide(0, 'kid', left, spot.worldId, false, opts.resume?.ms[0] ?? 0);
    const R = right
      ? this.makeSide(1, 'kid', right, spotOf(right).worldId, false, opts.resume?.ms[1] ?? 0)
      // ゲストは 左の子と同じレベル（記録がないので 世界を決める手がかりが無い）
      : this.makeSide(1, 'guest', null, spot.worldId, opts.partner.kind === 'guest' && opts.partner.cpu, opts.resume?.ms[1] ?? 0);
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
    if (this.phase === 'finish') this.afterBoss(true);
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
      this.suspendAt(this.boss);
      this.endPartnerTime(r);
    }
  }

  // ---------------------------------------------------------------- 人

  private makeSide(id: SideId, kind: 'kid' | 'guest', p: Profile | null, worldId: number, cpu: boolean, ms: number): Side {
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
      worldId,
      pools: duoPools(worldId),
      stat: statsOf(p),
      picker: null,
      pickerLevel: null,
      q: null,
      qT: 0,
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
    const w = worldById(def.world);
    this.theme = themeFor(def.world, bossStage(w), true, undefined, this.tier);
    this.elScreen.style.background = skyCss(this.theme);
    this.elPlay.classList.toggle('dark', this.theme.dark);
    this.attack = null;
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
    const level = poolLevel(this.boss, this.tier === 0 ? side.ease : 0);
    if (side.picker && side.pickerLevel === level) return;
    side.pickerLevel = level;
    side.picker = new DuoPicker(side.pools[level], duoChoices(side.worldId), side.stat);
  }

  private updateHp(): void {
    this.elHp.style.width = `${Math.max(0, (this.hpShown / this.hpMax) * 100)}%`;
  }

  // ---------------------------------------------------------------- 問題

  private newQuestion(side: Side): void {
    if (this.phase !== 'fight' || side.down) return;
    this.ensurePicker(side);
    side.q = side.picker?.next(rnd) ?? null;
    side.qT = 0;
    side.lock = 0;
    side.wait = 0;
    side.cpuPlanned = false;
    side.el.finger.hidden = true;
    this.hideHint(side);
    this.renderQuestion(side);
    this.renderSide(side);
  }

  /** 押せるか。たおれている・止まっている・つぎを待っている あいだは押せない */
  private canAnswer(side: Side): boolean {
    return this.phase === 'fight' && !this.paused && !side.down && side.q !== null && side.lock <= 0 && side.wait <= 0;
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
    const attacked = this.attack !== null && this.attack.side === side.id && !this.attack.dodged;

    if (v === q.answer) {
      side.st.correct++;
      side.st.answers++;
      const ms = side.qT * 1000;
      side.st.ms += ms;
      side.measured = nextMeasure(side.measured, ms);
      side.samples++;
      if (side.samples >= DUO_FIRST_MEASURE) side.trusted = true;
      btn?.classList.add('correct');
      this.showSolved(side, true);
      side.wait = NEXT_SEC;
      this.hideHint(side);
      sfx.correct(1);
      this.throwStar(side);
      if (attacked) this.dodge(side);
      const mate = this.other(side);
      if (mate.down) this.revive(mate);
    } else {
      btn?.classList.add('wrong');
      sfx.wrong();
      if (attacked) {
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
    if (this.attack && this.attack.side === side.id && !this.attack.dodged) {
      this.floatAt(side.x, this.groundY - 70 * this.s, side.pet ? `${side.pet.name}が おさえてる！` : 'とまってるよ', '#ffffff');
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
    let target = sides[this.nextTarget];
    if (target.down) target = this.other(target);
    if (target.down) return;
    const time = attackTime({
      measuredMs: target.trusted ? target.measured : 0,
      worldTime: duoWorldTime(target.worldId),
      boss: this.boss,
      tier: this.tier,
      slow: target.kind === 'kid' && !target.cpu && save.settings.slow,
      ease: this.tier === 0 ? target.ease : 0,
      petSlow: target.petPow.slow,
      powerSlow: target.power === 'slow',
    });
    const dir: 1 | -1 = target.id === 0 ? -1 : 1;
    const from = this.bossX + dir * 30 * this.s;
    const kind = shotFor(this.bossDefn, this.shots++);
    const r = (kind === 'beam' ? 6.5 : 8.5) * this.s * (1 + this.bossDefn.tier * 0.05);
    this.attack = {
      side: target.id,
      dir,
      total: time,
      dodged: false,
      passed: false,
      shot: {
        kind,
        x: from,
        y: this.groundY - 15 * this.s,
        // 持ち時間ちょうどで「体に ふれる」ところまで来る速さ（まんなかまで、ではない）
        v: Math.max(1, Math.abs(from - target.x) - this.contact(r)) / time,
        r,
        rot: 0,
        t: 0,
      },
    };
    this.facing = dir;
    this.bossState.mode = 'wind';
    target.st.attacks++;
    // CPU の答えは 攻撃が来てから考えなおさない（いま考えている式のまま）
    sfx.shoot(kind);
    this.renderSide(target);
    this.renderSide(this.other(target));
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
  private dodge(side: Side): void {
    const a = this.attack;
    if (!a) return;
    a.dodged = true;
    const dist = Math.max(Math.abs(side.x - a.shot.x), 10 * this.s);
    a.shot.v = Math.min(dist / JUMP_APEX, 4200);
    side.vy = this.jumpV;
    side.char.air = true;
    side.char.squash = 1.18;
    side.dodgeRun++;
    // ふつうの自動調整。3回つづけて よけたら 1段もどす
    if (this.tier === 0 && side.ease > 0 && side.dodgeRun >= DUO_EASE_BACK) {
      side.ease--;
      side.dodgeRun = 0;
      side.picker = null;
    }
    sfx.jump();
    this.burst(side.x, this.groundY - 4 * this.s, 8, '#e8d9b8');
  }

  /** 攻撃が 跳んだ子の足もとを 通り抜けた瞬間（「よけた」と分かるのは ここ） */
  private dodgeFx(side: Side): void {
    const a = this.attack;
    const y = this.groundY - 16 * this.s;
    const kind = a?.shot.kind ?? 'rock';
    this.ring(side.x, y, '#ffffff');
    this.burst(side.x, y, 12, kind === 'fire' ? '#ffb02e' : kind === 'beam' ? '#8fe3ff' : '#e0d6c2');
    this.floatAt(side.x, this.groundY - 96 * this.s, ['ナイス！', 'かわした！', 'よけた！'][Math.floor(rnd() * 3)], '#fff4b8');
    sfx.dodge();
  }

  private resolveAttack(target: Side): void {
    this.attack = null;
    this.bossState.mode = 'idle';
    this.nextTarget = this.other(target).id;
    this.nextAttackIn = DUO_BOSSES[this.boss].gap;
  }

  /** 失敗した（まちがい・時間切れ）。まもりが のこっていれば まもる。なければ たおれる */
  private fail(side: Side, why: 'wrong' | 'time'): void {
    const petHelp = tierDef(this.tier).petHelp;
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
    this.attack = null;
    this.bossState.mode = 'idle';
    if (mate.down) {
      this.lose();
      return;
    }
    this.nextTarget = mate.id;
    this.nextAttackIn = DUO_BOSSES[this.boss].gap;
    this.renderSide(side);
    this.renderSide(mate);
  }

  /** まもってもらった。たおれず、こたえを見せてから つぎの式へ */
  private guard(side: Side, text: string): void {
    side.shield = 1;
    this.showSolved(side, false);
    this.hideHint(side);
    side.wait = GUARD_TEACH_SEC;
    side.dodgeRun = 0;
    this.burst(this.attack ? this.attack.shot.x : side.x, this.groundY - 20 * this.s, 12, '#8fd8ff');
    this.floatAt(side.x, this.groundY - 80 * this.s, text, '#bfe9ff');
    sfx.guard();
    this.resolveAttack(side);
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
    this.stars.push({
      from: side.id,
      x0: side.x + (side.id === 0 ? 18 : -18) * this.s,
      y0: this.groundY - 26 * this.s,
      t: 0,
      dmg,
    });
  }

  private starPos(st: Star): { x: number; y: number } {
    const k = Math.min(1, st.t / STAR_SEC);
    const tx = this.bossX;
    const ty = this.groundY - this.bossSize() * 0.55;
    return {
      x: st.x0 + (tx - st.x0) * k,
      y: st.y0 + (ty - st.y0) * k - Math.sin(k * Math.PI) * 40 * this.s,
    };
  }

  private hitBoss(st: Star): void {
    this.hp = Math.max(0, this.hp - st.dmg);
    this.bossState.hit = 0.18;
    const { x, y } = this.starPos(st);
    this.burst(x, y, 8 + Math.round(st.dmg * 4), '#ffe17a');
    this.shake = Math.max(this.shake, 0.12);
    sfx.coin();
    if (this.hp <= 0 && this.phase === 'fight') this.beginFinish();
  }

  // ---------------------------------------------------------------- とどめ・やすみ・おわり

  private beginFinish(): void {
    const sides = this.sides as [Side, Side];
    this.phase = 'finish';
    this.finT = 0;
    this.finImpact = false;
    this.attack = null;
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
    this.showBanner('ふたりで とどめ！', 1.2);
    sfx.finishCharge();
  }

  /** 倒したボスの ぶんを払って、やすみ か おわりへ */
  private afterBoss(silent = false): void {
    const sides = this.sides as [Side, Side];
    const n = this.boss;
    for (const side of sides) {
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
      const opts = pow ? DUO_POWERS.map((d) => ({ id: d.id, icon: d.icon, label: d.label })) : [{ id: 'ok', icon: '👍', label: 'OK' }];
      for (const o of opts) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'drp-btn';
        b.dataset.id = o.id;
        b.innerHTML = `<span aria-hidden="true">${o.icon}</span><b>${o.label}</b>`;
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
    this.attack = null;
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
      $('duo-end-sub').textContent = `${this.boss + 1}たいめ ${this.bossDefn.name} まで いけた！`;
      this.renderTrack($('duo-end-track'), this.boss, this.boss);
      this.renderEndLines(false);
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

  private renderEndLines(cleared: boolean, prizes: string[] = []): void {
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
    this.elPauseBox.hidden = !on;
    $('duo-quit').textContent = this.tier === 0 ? 'やめる（つづきから あそべるよ）' : 'やめる';
    if (this.sides) for (const side of this.sides) this.renderSide(side);
    if (!on) this.lastTs = 0;
  }

  /** ポーズの「やめる」と、ハード以上の ←。ふつうは そのボスから つづけられる */
  private quit(): void {
    this.elPauseBox.hidden = true;
    if (this.tier === 0 && this.fighting()) this.suspendAt(this.boss);
    this.finishLog();
    this.stop();
    this.hooks?.onExit();
  }

  // ---------------------------------------------------------------- 板の表示

  private renderSide(side: Side): void {
    const el = side.el;
    if (!el) return;
    const attacked = this.attack !== null && this.attack.side === side.id && !this.attack.dodged;
    el.root.classList.toggle('attacked', attacked && this.phase === 'fight');
    el.root.classList.toggle('is-down', side.down);
    el.root.classList.toggle('cpu', side.cpu);
    el.name.textContent = side.cpu ? '🤖 CPU' : side.name;
    el.mode.textContent = side.cpu ? 'てで あそぶ' : '🤖 まかせる';

    let state = '';
    if (this.phase === 'rest' || this.phase === 'end') state = '';
    else if (this.phase === 'intro') state = 'じゅんび…';
    else if (this.phase === 'finish') state = 'とどめ！';
    else if (side.down) state = '💫 たおれた';
    else if (attacked) state = '⚠ きてる！';
    else if (side.lock > 0) state = 'ちょっと まってね';
    else if (side.cpu) state = '🤖 うーん…';
    else if (this.phase === 'fight') state = 'じぶんの ペースで こうげき！';
    el.state.textContent = state;

    el.down.hidden = !side.down;
    if (side.down) {
      const mate = this.other(side);
      el.downAns.textContent = side.downAnswer ? `こたえは ${side.downAnswer}` : '';
      el.downText.textContent = `${mate.cpu ? 'CPU' : mate.name}が せいかいすると ふっかつ`;
    }

    // ヒントのボタン。CPU・たおれているときは出さない。ベリーハードは「ヒント なし」
    el.hintBtn.hidden = side.cpu || side.down;
    const none = side.hintsLeft === 0;
    el.hintLabel.textContent = none ? 'ヒント なし' : 'ヒント';
    el.hintLeft.textContent = side.hintsLeft !== null && side.hintsLeft > 0 ? `あと${side.hintsLeft}` : '';
    el.hintBtn.disabled = !this.hintUsable(side);
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
    this.hpShown += (this.hp - this.hpShown) * Math.min(1, dt * 8);
    if (Math.abs(this.hpShown - this.hp) < 0.01) this.hpShown = this.hp;
    this.updateHp();

    for (const side of sides) this.updateSide(side, dt);

    if (this.phase === 'intro') {
      this.phaseT += dt;
      if (this.phaseT >= INTRO_SEC) this.startFight();
    } else if (this.phase === 'fight') {
      this.updateFight(dt);
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
    if (this.phase !== 'fight') return;

    if (!side.down && side.q && side.wait <= 0 && side.lock <= 0) side.qT += dt;
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
    const sides = this.sides as [Side, Side];
    const a = this.attack;
    if (!a) {
      this.nextAttackIn -= dt;
      if (this.nextAttackIn <= 0) this.launch();
      return;
    }
    const target = sides[a.side];
    a.shot.t += dt;
    a.shot.rot += dt * 6;
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
    // 跳んだ子の まんなかを 通りすぎた瞬間に「よけた」を見せる（跳んだ頂点と同じ時刻になる）。
    // そこからは速く ぬけさせる。ぎりぎりで答えたときは のこりの きょりが短く、そのままの速さだと
    // 着地したときに まだ せなかに重なっていて、また当たったように見える
    if (a.dodged && !a.passed && cross >= 0) {
      a.passed = true;
      a.shot.v = Math.max(a.shot.v, 260 * this.s);
      this.dodgeFx(target);
    }
    if (a.dodged && (cross > 90 * this.s || a.shot.x < -60 * this.s || a.shot.x > this.W + 60 * this.s)) {
      this.resolveAttack(target);
      this.renderSide(target);
    }
  }

  private updateFinish(dt: number): void {
    this.finT += dt;
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

  // ---------------------------------------------------------------- 寸法

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    // とんでいる攻撃は「のこり時間」そのもの。画面が変わっても のこりの割合を保つ（runner.ts と同じ）
    const a = this.attack;
    const target = a && this.sides ? this.sides[a.side] : null;
    const oldSpan = target ? target.x - this.bossX : 0;
    const frac = target && Math.abs(oldSpan) > 1 ? (a!.shot.x - this.bossX) / oldSpan : 0;
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
    if (a && target && Math.abs(oldSpan) > 1) {
      const span = target.x - this.bossX;
      a.shot.x = this.bossX + frac * span;
      a.shot.v *= Math.abs(span / oldSpan);
      a.shot.y = this.groundY - 15 * this.s;
    }
  }

  private bossSize(): number {
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
    g.save();
    if (this.shake > 0) g.translate((rnd() - 0.5) * 7 * s, (rnd() - 0.5) * 6 * s);
    drawScene(g, this.theme, this.view());

    // とどめの暗転。景色のあと、2人と ボスを描く前（本編と同じ）
    if (this.phase === 'finish') drawFinishDim(g, this.finView(this.sides[0]), finishDim(this.finT));

    this.drawAttackGlow();
    this.drawBossFig();
    for (const side of this.sides) this.drawSide(side);
    this.drawShot();
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
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.45})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.banner.life > 0) this.drawBanner();
    g.restore();
  }

  /** ねらわれている子の側の ふちが、攻撃が近づくほど赤くなる（数字を出さない のこり時間） */
  private drawAttackGlow(): void {
    const a = this.attack;
    if (!a || a.dodged || this.phase !== 'fight') return;
    const g = this.g;
    const target = (this.sides as [Side, Side])[a.side];
    const span = Math.abs(this.bossX - target.x);
    const left = Math.abs(a.shot.x - target.x);
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
    g.restore();
  }

  private drawShot(): void {
    const a = this.attack;
    if (!a) return;
    const g = this.g;
    // 攻撃の絵は左へ進む向き。右へ撃つときは 鏡にする
    if (a.dir > 0) {
      g.save();
      g.translate(this.W, 0);
      g.scale(-1, 1);
      drawShot(g, { ...a.shot, x: this.W - a.shot.x }, this.bossDefn);
      g.restore();
    } else {
      drawShot(g, a.shot, this.bossDefn);
    }
  }

  private drawSide(side: Side): void {
    const g = this.g;
    const s = this.s;
    const size = 34 * s;
    const mirror = side.id === 1;
    const lift = Math.min(1, -side.py / (80 * s));
    g.fillStyle = `rgba(40,60,50,${0.22 * (1 - lift * 0.7)})`;
    g.beginPath();
    g.ellipse(side.x, this.groundY + 3 * s, 17 * s * (1 - lift * 0.4), 5 * s, 0, 0, Math.PI * 2);
    g.fill();

    g.save();
    if (mirror) {
      g.translate(side.x * 2, 0);
      g.scale(-1, 1);
    }
    // ペットは うしろ（外がわ）を ついてくる。ヒントのあいだは 前に出て 攻撃を押しとどめる
    const a = this.attack;
    const holding = side.hintShown && a !== null && a.side === side.id && !a.dodged;
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
      drawChar(g, side.x, this.groundY + side.py, size, side.look, side.char);
      if (side.kind === 'guest' && side.cpu) this.drawAntenna(side.x, this.groundY + side.py - size);
    }

    if (side.revive > 0) {
      g.strokeStyle = `rgba(255,244,184,${side.revive})`;
      g.lineWidth = 4 * s * side.revive;
      g.beginPath();
      g.arc(side.x, this.groundY - size * 0.5, size * (1.4 - side.revive * 0.6), 0, Math.PI * 2);
      g.stroke();
    }
    if (side.shield > 0) {
      g.strokeStyle = `rgba(143,216,255,${side.shield})`;
      g.lineWidth = 5 * s;
      g.beginPath();
      g.arc(side.x + 26 * s, this.groundY - size * 0.5, size * 0.7, -1.1, 1.1);
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
      g.fillText(pw.icon, side.x, this.groundY - size - 18 * s);
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
    g.fillStyle = st.from === 0 ? '#ffd23d' : '#ffb3d1';
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
    return {
      t: this.finT,
      s,
      W: this.W,
      H: this.H,
      fromX: mx(side.x + (mirror ? -26 : 26) * s),
      fromY: this.groundY - 14 * s,
      toX: mx(this.bossX),
      toY: this.groundY - this.bossSize() * 0.5,
      homeX: mx(side.x),
      homeY: this.groundY,
      charSize: 34 * s,
      // ふみこまない（2人が同時に とどめを刺すので、立ち位置は動かさない）
      leap: false,
    };
  }

  /** ふたりで とどめ。それぞれの ぶきで 同時に。右の子は 鏡にして描く */
  private drawSideFinish(side: Side): void {
    const g = this.g;
    const def = weaponDef(side.look.weapon ?? DEFAULT_WEAPON);
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
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  private drawBanner(): void {
    const g = this.g;
    const k = Math.min(1, this.banner.life / 0.3, (this.banner.full - this.banner.life) / 0.2 + 0.001);
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, k));
    g.textAlign = 'center';
    g.font = `900 ${Math.round(22 * this.s)}px system-ui, sans-serif`;
    g.lineWidth = 6 * this.s;
    g.strokeStyle = 'rgba(30,40,50,.8)';
    const y = this.H * 0.26;
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
