/**
 * プレイ画面。
 *
 * 設計上の要点:
 *  ・ジャンプのタイミング判定はしない。正解した瞬間に障害物のほうが加速して
 *    足元を通り抜ける。腕前ではなく計算だけで越えられるようにするため。
 *  ・タイマーは出さない。近づいてくる障害物そのものが残り時間。
 *  ・通常ステージはぶつかってもゲームオーバーにしない。コインを数枚落として先へ進む。
 *  ・景色と障害物はステージごとに変える（theme.ts）。同じ絵が続くと飽きる。
 *
 * ボス戦だけはルールが違う（ここが「本気を出す場所」になる）:
 *  ・まちがえたらその場で負け。だから問題数は10問と短い。
 *  ・ボスは画面の右に立ち、石・炎・ビームを撃ってくる。正解＝跳んでよける。
 *  ・最後の4問は攻撃が1割はやくなり、いちばん最後はボスが突撃してくる。
 *    そこで正解すると、飛び上がって踏みつけて倒す。
 *
 * 通常ステージにも山場と救いを1つずつ置いてある:
 *  ・最後の1問だけ、障害物がひとまわり大きく、低い持続音が鳴り、粒が倍になる。
 *  ・10問のあとに「リベンジ」。まちがえた式だけをもう一度出し、ぜんぶ正解したら
 *    ミスを1つ取り消す（まちがいが取り返せるものになる）。
 *
 * 「にがて たいじ」（mode: 'hunt'）だけは、走るのをやめて立ち止まる:
 *  ・出る式は「にがて」と記録されたものだけ。敵は近づいてこない。
 *  ・時間切れが無い。まちがえてもコインは落とさず、正解するまで何度でも押せる。
 *  ・正解した瞬間、こちらがビームを撃って倒す。ここは急かさずに気持ちよく終わる場。
 *
 * ヒントは「呼ばれたときだけ」出す:
 *  ・こちらから勝手に出すことはしない。ボタンはいつでも押せる状態で出ている。
 *  ・回数の制限があるのは、いちばん最後のボス（さいごのワールドのボス）だけ。
 *    ほかの面では何回でも呼べる。分からないまま時間切れになるより、
 *    絵を見て「なぜそうなるか」を通ったほうが、次につながる。
 */

import { sfx, startDrone, stopDrone } from './audio';
import { bossDef, drawBoss, drawShot, shotFor, type BossDef, type BossState, type Shot } from './boss';
import {
  BOSS_RUSH_RATE,
  BOSS_RUSH_TAIL,
  answerTimeFor,
  blankFor,
  cherry,
  factKey,
  factsFor,
  isFinalBoss,
  type Fact,
  type World,
} from './curriculum';
import { drawPet, paintPetIcon } from './petart';
import { activePet, petPower, voiceOf, type PetDef } from './pets';
import { QuestionPicker, isWeakFact, recordAnswer, type Question } from './questions';
import {
  COIN_COMBO, COIN_CORRECT, COIN_FINISH, COIN_FIRST_CLEAR, COIN_FIRST_PERFECT, COIN_MISS,
  COIN_PERFECT, COIN_WEAK, REPLAY_RATE, gainTotal, lumpRate, scaled, type CoinGain,
} from './rewards';
import { addPlayTime, profile, save, setStageStars, persist } from './save';
import { drawScene, drawWeather, type SceneView } from './scenery';
import { currentLook, drawChar, drawObstacle, type CharState } from './sprites';
import { cherryArt, frameArt } from './tenframe';
import { themeFor, type ObstacleKind, type Theme } from './theme';
import {
  FIN_CHARGE, FIN_CUT_TOTAL, FIN_FLY, FIN_STOP, FIN_TOTAL,
  drawFinish, drawFinishCutIn, drawFinishDim, finishDim, weaponDef,
  type FinishView, type WeaponDef,
} from './weapons';

/**
 * いちばん最後のボスで押せるヒントの回数。レアなペットはここに上乗せする。
 *
 * 回数を数えるのはこの1面だけ（isFinalBoss）。ほかの面は無制限で、
 * ゲージも「あと○かい」も出さない。
 * ペットを引けていない子が 0 回だと、引きの悪さがそのまま難しさになるので、
 * ここでもペット無しで 2 回は残す（ペットは やさしくする方向にだけ効かせる）。
 */
const FINAL_BOSS_HINTS = 2;

/** ペットが つかれて画面から去るまでの秒数 */
const PET_EXIT_SEC = 1.1;

/** にがて たいじ で、敵が立っている位置（画面幅に対する割合） */
const HUNT_ENEMY_X = 0.7;

/** ビームの時間割（秒）。ため → 発射 → 命中 → 余韻 */
const BEAM_CHARGE = 0.3;
const BEAM_FLY = 0.12;
const BEAM_HOLD = 1.5;

/**
 * SVG の出し入れ。
 * hidden は HTMLElement のプロパティなので、SVGElement に代入しても
 * 属性に反映されず、黙って効かない。属性を直に付け外しする。
 */
function showSvg(el: SVGElement, on: boolean): void {
  if (on) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

/**
 * 走りの種類。
 *   stage … マップのステージ（ボスもここ）。★が付く
 *   daily … きょうの もんだい（1・3・5問）
 *   hunt  … にがて たいじ（立ち止まってビームで倒す）
 *
 * stage === 0 で見分けていたが、マップに属さない走りが2種類になったので
 * 名前で持つ。どちらも saveStars: false・stage: 0 で走る。
 */
export type RunMode = 'stage' | 'daily' | 'hunt';

/** 1回の走りの設定。通常ステージもボスもデイリーもこれで表す */
export interface RunConfig {
  world: World;
  /** 0 はマップに属さない走り（デイリー・にがて たいじ） */
  stage: number;
  /** 省略時は 'stage' */
  mode?: RunMode;
  total: number;
  boss: boolean;
  label: string;
  /** 小ステップの名まえ。走り出しのふだに出す。ボス・デイリーは null */
  stepName?: string | null;
  /** 指定するとワールドの式ではなくこの中から出す */
  facts?: Fact[];
  /**
   * facts を **並べた順に** 出す（にがて たいじ は常にこの形）。
   *
   * きょうの もんだい は「前半はやさしく、さいごの1問だけ いまのレベル」に
   * 並べてから渡す。ふつうの出題（習熟度で重みづけしたランダム）に流すと
   * その並びが崩れて、さいごの1問という約束が成り立たない。
   */
  ordered?: boolean;
  /** 指定するとワールドの既定より優先して穴埋め形式にする／しない */
  blank?: boolean;
  bonusCoins?: number;
  saveStars?: boolean;
  /**
   * 走る前の★（0〜3）。周回のコイン倍率と「はじめて」の判定に使う。
   * startStage ではなく startRun で毎回読みなおすこと。決め打ちにすると、
   * 同じ設定を使いまわす「もういちど」が、★3 のあとも初回レートで払い続ける。
   */
  prevStars?: number;
}

export interface StageResult {
  worldId: number;
  stage: number;
  mode: RunMode;
  stars: number;
  correct: number;
  total: number;
  /** もらったコインの合計 */
  coins: number;
  /** その内訳。リザルトで1行ずつ見せる */
  gain: CoinGain;
  /** この回で初めておぼえた式 */
  learned: string[];
  /** クリア後に持っているコイン */
  totalCoins: number;
  /** ボスにやられて終わった（★もボーナスも付かない） */
  failed: boolean;
  /** 倒した／やられたボスの名前。リザルトの文言に使う */
  bossName: string | null;
  /** リベンジ（まちがえた式のやりなおし）。走らなかった回は null */
  revenge: RevengeResult | null;
  /** はじめてのごほうびの中身。リザルトの見出しに使う。無いときは null */
  firstKind: 'clear' | 'perfect' | 'both' | null;
  /** ★3 を取り終えたステージを もう一度あそんだ回 */
  replay: boolean;
}

export interface RevengeResult {
  total: number;
  correct: number;
  /** ぜんぶ正解した（ミスを1つ取り消した） */
  cleared: boolean;
}

/**
 * 'wrap' はリベンジのしめくくり。帯を見せてからリザルトへ移る。
 * 'beam' は にがて たいじ の とどめ（ためて・撃って・はじけるまで）。
 * 'finish' は さいごの1問の フィニッシュ（えらんだ ぶきで しとめる）。
 */
type Phase = 'ask' | 'clear' | 'reveal' | 'stomp' | 'beam' | 'finish' | 'dead' | 'wrap' | 'over';

/** よけた瞬間に広がる輪 */
interface Ring {
  x: number; y: number; r: number; life: number; max: number; color: string;
}

/** よけるたびに出る掛け声。順に出るので、同じ言葉が続かない */
const CHEERS = ['ナイス！', 'かわした！', 'すごい！', 'あぶない！', 'ばっちり！', 'やるね！'];

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number;
}

/** HUD のコイン表示へ吸いこまれていくコイン */
interface FlyCoin {
  x0: number; y0: number; cx: number; cy: number;
  p: number; speed: number; value: number;
}

/** 「＋3」のように、その場に浮かんで消える文字 */
interface FloatText {
  x: number; y: number; life: number; max: number; text: string; color: string; size: number;
}

const CLEAR_HOLD = 0.8;
const REVEAL_HOLD = 1.25;
const T_APEX = 0.32;

/** 最後の1問で、障害物を何倍にするか */
const FINAL_SCALE = 1.5;

/**
 * リベンジで出しなおす上限。
 * 10問ぜんぶ落とした日に 20問走らせると、いちばん疲れている子がいちばん長く
 * 走ることになる。多い日は、まちがえた順に先頭から5問だけ出す。
 */
const REVENGE_MAX = 5;

/** リベンジは苦手な式ばかり。持ち時間を少しのばして、思い出す間をつくる */
const REVENGE_TIME = 1.25;

/** れんぞく数ごとの掛け声。上に行くほど短く強い言葉にする */
const COMBO_CALLS: { at: number; text: string }[] = [
  { at: 3, text: 'いいね！' },
  { at: 5, text: 'すごい！' },
  { at: 8, text: 'ちょうぜつダッシュ！' },
  { at: 12, text: 'てんさい！' },
  { at: 16, text: 'かみってる！' },
];

export class Runner {
  private canvas = document.getElementById('world') as HTMLCanvasElement;
  private g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  private elQuestion = document.getElementById('question') as HTMLParagraphElement;
  private elAnswers = document.getElementById('answers') as HTMLDivElement;
  private elCoins = document.getElementById('hud-coins') as HTMLElement;
  private elCombo = document.getElementById('hud-combo') as HTMLElement;
  private elPips = document.getElementById('pips') as HTMLElement;
  private elStage = document.getElementById('hud-stage') as HTMLElement;
  private elHint = document.getElementById('hint') as HTMLElement;
  private elFrame = document.getElementById('hint-frame') as unknown as SVGElement;
  private elCherry = document.getElementById('cherry') as unknown as SVGElement;
  private elHintText = document.getElementById('hint-text') as HTMLElement;
  private elHintNudge = document.getElementById('hint-nudge') as HTMLElement;
  private elHintBtn = document.getElementById('btn-hint') as HTMLButtonElement;
  private elHintLeft = document.getElementById('btn-hint-left') as HTMLElement;
  private elDock = document.getElementById('pet-dock') as HTMLElement;
  private elPetFace = document.getElementById('pet-face') as HTMLCanvasElement;
  private elPetEmoji = document.getElementById('pet-emoji') as HTMLElement;
  private elPetState = document.getElementById('pet-state') as HTMLElement;
  private elPetHp = document.getElementById('pet-hp-fill') as HTMLElement;
  private elTagWeak = document.getElementById('tag-weak') as HTMLElement;
  private elTagFinal = document.getElementById('tag-final') as HTMLElement;
  private elTagRevenge = document.getElementById('tag-revenge') as HTMLElement;
  private elPlay = document.getElementById('screen-play') as HTMLElement;
  private elBossBar = document.getElementById('boss-bar') as HTMLElement;
  private elBossName = document.getElementById('boss-name') as HTMLElement;
  private elBossHp = document.getElementById('boss-hp') as HTMLElement;

  private buttons: HTMLButtonElement[] = [];
  private raf = 0;
  private lastTs = 0;
  private running = false;
  private paused = false;

  // ステージ状態
  private cfg!: RunConfig;
  private world!: World;
  private theme: Theme = themeFor(1, 1, false);
  private stage = 1;
  private boss = false;
  /** にがて たいじ（立ち止まって、ビームで倒す） */
  private hunt = false;
  private mode: RunMode = 'stage';
  private total = 0;
  private picker!: QuestionPicker;
  private qIndex = 0;
  private correct = 0;
  private misses = 0;
  private gain: CoinGain = { correct: 0, combo: 0, weak: 0, perfect: 0, bonus: 0, finish: 0, first: 0, lost: 0 };
  /** HUD に出しているコイン。飛んできたコインが着いた分だけ増える */
  private coinsShown = 0;
  private combo = 0;
  private learned: string[] = [];
  private onDone: ((r: StageResult) => void) | null = null;

  // 問題状態
  private q: Question | null = null;
  /**
   * その問題が出てからの秒数。壁時計ではなくゲーム内時間で数えるので、
   * ポーズや裏に回っていた時間は「考えていた時間」に入らない。
   */
  private qElapsed = 0;
  private wrongThisQ = false;
  /** いまの問題が「最後の1問」か（ボス戦は突撃があるので使わない） */
  private isFinal = false;
  /** いまの問題が「にがて」な式か */
  private isWeak = false;
  private phase: Phase = 'ask';
  private hold = 0;
  private hintShown = false;
  /**
   * ヒントボタンで止めているあいだ。update() だけ飛ばして draw() は回すので、
   * ペットが敵を押しとどめている絵が動きつづける。
   */
  private hintPaused = false;
  /** 止めているあいだの経過秒（ペットのふんばり・考えている絵を動かすために進める） */
  private tHold = 0;
  /**
   * この走りでヒントの回数を数えるか。いちばん最後のボスだけ true。
   * false のあいだは hintsLeft を見ない（何回でも押せる）。
   */
  private hintLimited = false;
  /** あと何回 ヒントボタンを押せるか（hintLimited のときだけ意味がある） */
  private hintsLeft = 0;
  /** この走りで押せる回数（＝ペットの体力の満タン）。ゲージの分母 */
  private hintMax = 0;
  /**
   * ヒントを出しきった。つぎにヒントを閉じたところで、ペットは やすみに行く。
   * その場で消すと、敵を押しとどめている最中に消えて絵がつながらない。
   */
  private petTired = false;
  /** 0 = いる、0〜1 = 去っていく途中、1 = いなくなった */
  private petExit = 0;
  /** ワールドのコイン倍率だけ（「はじめて」のごほうびに使う） */
  private worldRate = 1;
  /** ワールド × 周回。ふだんのコインはこれを掛ける */
  private rate = 1;
  /** ノーミス・フィニッシュに掛ける、問題数ぶんの倍率（rewards.ts の lumpRate） */
  private lump = 1;
  /** 走る前の★。0 なら初クリア、3 なら周回 */
  private prevStars = 0;
  /** 画面に描いたペットの位置。ここをタップしてもヒントが出せる */
  private petHit = { x: 0, y: 0, r: 0 };

  // リベンジ（10問のあと、まちがえた式だけをもう一度）
  /** この走りでまちがえた式。同じ式は1つにまとめる */
  private missed = new Map<string, Fact>();
  private revenge = false;
  private revengeQ: Fact[] = [];
  private revengeIndex = 0;
  private revengeCorrect = 0;
  private revengeResult: RevengeResult | null = null;
  /** この走りで遊んだ秒数。ステージが終わるかやめたときに保存する */
  private elapsed = 0;

  // ペット
  private pet: PetDef | null = null;
  /** 障害物が来るまでの時間を何割のばすか（レアなペットの力） */
  private slow = 0;
  /** あと何回 助けてもらえるか。ステージごとに戻る */
  private rescueLeft = 0;
  /** せなかに乗っているあいだの残り秒数 */
  private ride = 0;
  /** ついてくるペットの高さ（プレイヤーより遅れて上下する） */
  private petY = 0;

  // 見た目の状態
  private t = 0;
  private scroll = 0;
  private char: CharState = { t: 0, air: false, hurt: 0, squash: 1 };
  private py = 0;
  private vy = 0;
  private ob = { x: 0, v: 0, kind: 'rock' as ObstacleKind, scale: 1 };
  private particles: Particle[] = [];
  private coinsFlying: FlyCoin[] = [];
  private floats: FloatText[] = [];
  private shake = 0;
  private flash = 0;
  /** 掛け声・お知らせの帯を出している残り時間 */
  private banner = 0;
  private bannerFull = 1.5;
  private bannerText = '';

  // フィニッシュ（さいごの1問の とどめ）
  /** いま身につけている ぶき。走り出すたびに読みなおす */
  private weapon: WeaponDef = weaponDef('');
  /**
   * フィニッシュの進行。null は「いま演出していない」。
   * ボスの踏みつけでも使う（そのときは 当たった瞬間から始める）。
   */
  private fin: { t: number; hit: boolean; fired: boolean; x: number; y: number } | null = null;
  /**
   * いま画面がどれだけ暗いか（0〜1）。
   * 目標（finishDim）へ 少しずつ寄せる。ボスの とどめは 演出の途中から
   * 始まるので、代入にすると そこだけ画面がぱっと暗転して驚かせる。
   */
  private finDim = 0;
  /**
   * 当たった瞬間、絵をぴたりと止めている残り秒数（ヒットストップ）。
   * ここが 0 より大きいあいだ、update() は世界を進めない。
   */
  private finStop = 0;
  /** ぶきの名まえのカットインが出てからの秒数。負のときは出していない */
  private cut = -1;

  // にがて たいじ の状態
  /** ビームを撃ちはじめてからの秒数（ため → 発射 → 命中） */
  private beamT = 0;
  /** ビームが命中したか（1問につき1回だけ はじけさせる） */
  private beamHit = false;
  /** 倒した敵。撃ちぬいたあとは描かない */
  private obDead = false;

  // ボス戦の状態
  private bossDefn: BossDef = bossDef(1);
  private bossState: BossState = { t: 0, mode: 'idle', hit: 0, squash: 1 };
  private bossX = 0;
  private bossV = 0;
  /** つぶれ具合の目標。踏むと 0.24 に向かってしぼむ */
  private bossSquashTo = 1;
  private shot: Shot | null = null;
  /** 攻撃が出てきた位置。残り時間の割合を測るのに使う */
  private shotFrom = 0;
  /** 最後の問題（突撃）かどうか */
  private charging = false;
  /** よけた回数。そのままボスの体力になる */
  private dodges = 0;
  private dodgedThisQ = false;
  /** ボスにやられた */
  private failed = false;
  private stomped = false;
  /** 踏みつけ・被弾のとき、プレイヤーが前後に動く量 */
  private pxOff = 0;
  private rings: Ring[] = [];
  private cheer = { text: '', life: 0 };

  // 画面寸法（CSS ピクセル）
  private W = 320;
  private H = 200;
  private s = 1;
  private groundY = 170;
  /** 画面の上端から canvas の上端まで／画面ぜんたいの高さ（空の色を画面とそろえる） */
  private skyTop = 0;
  private skyH = 600;
  private playerX = 70;
  private gravity = 1400;
  private jumpV = -440;
  private runSpeed = 130;

  constructor() {
    this.elAnswers.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (btn && this.buttons.includes(btn as HTMLButtonElement)) {
        this.answer(this.buttons.indexOf(btn as HTMLButtonElement));
      }
    });
    // 自分から見にいくヒント。押しているあいだ世界が止まる（ペットが敵を押しとどめる）
    this.elHintBtn.addEventListener('click', () => this.pullHint());
    // 絵のほうのペットをさわっても同じ。子どもは画面のペットを押しにいく
    this.canvas.addEventListener('click', (e) => {
      if (this.petHit.r <= 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (Math.hypot(x - this.petHit.x, y - this.petHit.y) > this.petHit.r) return;
      this.pullHint();
    });
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement ?? this.canvas);
    }
  }

  // ---------------------------------------------------------------- 開始・終了

  start(cfg: RunConfig, onDone: (r: StageResult) => void): void {
    this.cfg = cfg;
    this.world = cfg.world;
    this.mode = cfg.mode ?? 'stage';
    this.hunt = this.mode === 'hunt';
    this.theme = themeFor(cfg.world.id, cfg.stage, cfg.boss, this.hunt ? 'hunt' : undefined);
    this.stage = cfg.stage;
    this.boss = cfg.boss;
    this.total = cfg.total;
    // 小ステップごとの問題プールが効くのはここ
    this.picker = new QuestionPicker(
      cfg.facts ?? factsFor(cfg.world, cfg.stage),
      cfg.world.choices,
      cfg.blank ?? blankFor(cfg.world, cfg.stage),
    );
    this.qIndex = 0;
    this.correct = 0;
    this.misses = 0;
    this.gain = { correct: 0, combo: 0, weak: 0, perfect: 0, bonus: 0, finish: 0, first: 0, lost: 0 };
    // 周回のコイン倍率。★3 を取り終えた面をもう一度走るぶんは軽くする
    this.prevStars = cfg.prevStars ?? 0;
    this.worldRate = cfg.world.coinRate ?? 1;
    this.rate = this.worldRate * (this.prevStars >= 3 ? REPLAY_RATE : 1);
    // ノーミス・フィニッシュは「1回ぶん」の額なので、問題数の少ない走りでは
    // そのぶん薄くする。満額のままだと 1問を何度も走るのが得になる（rewards.ts）。
    // 5問で満額なので、10問のステージとボスは掛けても 1 のまま
    this.lump = lumpRate(this.total);
    this.coinsShown = 0;
    this.combo = 0;
    this.learned = [];
    this.onDone = onDone;
    this.elapsed = 0;
    this.particles = [];
    this.coinsFlying = [];
    this.floats = [];
    this.banner = 0;
    this.py = 0;
    this.vy = 0;
    this.char = { t: 0, air: false, hurt: 0, squash: 1 };

    this.missed = new Map();
    this.revenge = false;
    this.revengeQ = [];
    this.revengeIndex = 0;
    this.revengeCorrect = 0;
    this.revengeResult = null;
    this.isFinal = false;
    this.isWeak = false;

    this.beamT = 0;
    this.beamHit = false;
    this.obDead = false;

    // ぶきは走り出すたびに読みなおす（きせかえで持ちかえた直後に走ることがある）
    this.weapon = weaponDef(profile().weapon);
    this.fin = null;
    this.finDim = 0;
    this.finStop = 0;
    this.cut = -1;

    this.bossDefn = bossDef(cfg.world.id);
    this.bossState = { t: 0, mode: 'idle', hit: 0, squash: 1 };
    this.bossSquashTo = 1;
    this.shot = null;
    this.charging = false;
    this.dodges = 0;
    this.dodgedThisQ = false;
    this.failed = false;
    this.stomped = false;
    this.pxOff = 0;
    this.rings = [];
    this.cheer = { text: '', life: 0 };

    // つれているペットの力は、走り出すたびに読みなおす
    this.pet = activePet();
    const power = petPower();
    this.slow = power.slow;
    this.rescueLeft = power.rescue;
    // 回数を数えるのは、いちばん最後のボスだけ。ほかは何回でも呼べる
    this.hintLimited = cfg.boss && isFinalBoss(cfg.world, cfg.stage);
    this.hintMax = FINAL_BOSS_HINTS + power.hints;
    this.hintsLeft = this.hintMax;
    this.hintPaused = false;
    this.petTired = false;
    this.petExit = 0;
    this.petHit = { x: 0, y: 0, r: 0 };
    this.ride = 0;
    this.petY = 0;
    this.paintPetFace();
    this.renderDock();

    this.elStage.textContent = cfg.label;
    this.elBossBar.hidden = !cfg.boss;
    this.elBossName.textContent = this.bossDefn.name;
    this.elBossHp.style.width = '100%';
    this.elAnswers.style.setProperty('--cols', String(cfg.world.choices));
    this.buildPips();
    this.updateHud(false);
    this.resize();
    if (cfg.boss) {
      this.showBanner(`${this.bossDefn.name} が あらわれた！`, 2.2);
      sfx.roar();
    }
    this.nextQuestion();

    this.running = true;
    // ボタンの見た目は running を見て決まる。走り出したことを反映しないと、
    // 1問目のあいだだけ ヒントが押せない顔のままになる
    this.renderDock();
    this.lastTs = 0;
    cancelAnimationFrame(this.raf);
    // paused はここで落とさない。start() は画面を出した「次のフレーム」で走るので、
    // その隙間にアプリを裏へ回されると setPaused(true) のほうが先に来ている。
    // ここで false に戻すと、ポーズ画面が出たままステージが進み、
    // 戻ってきたときには時間切れでミスが付いている。解除は stop() と
    // 「つづける」（setPaused(false)）だけがやる。
    this.raf = this.paused ? 0 : requestAnimationFrame(this.frame);
  }

  /** 走るのをやめる。遊んだ時間はここで必ず記録する（途中でやめても数える） */
  stop(): void {
    this.running = false;
    // ポーズを解除するのはここだけ。start() で落とすと、走り出す直前に
    // 裏へ回されたときのポーズを打ち消してしまう（下の start() のコメント）。
    this.paused = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    addPlayTime(this.elapsed);
    this.elapsed = 0;
    this.hideHint();
    this.renderDock();
    stopDrone();
  }

  setPaused(p: boolean): void {
    // running を見て早期 return すると、start() の直前に裏へ回ったときに
    // 「ポーズ画面が出たまま裏で走り続ける」状態になる。状態は必ず持つ。
    this.paused = p;
    // 止まっているあいだ持続音を鳴らしっぱなしにしない（裏に回したまま鳴り続ける）
    if (p) stopDrone();
    this.renderDock();
    if (!this.running) return;
    if (!p) {
      if (this.isFinal && this.phase === 'ask') startDrone();
      this.lastTs = 0;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  // ---------------------------------------------------------------- レイアウト

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    // 障害物は「残り時間」そのものなので、画面が変わっても残りの割合を保つ。
    // これがないと、横向きにしただけで期限が伸びたり、いきなり時間切れになる。
    const oldSpan = this.spawnX() - this.playerX;
    const oldLeft = this.ob.x - this.playerX;
    // ボスの攻撃と突撃も同じ理由で割合を測っておく
    const oldShotSpan = this.shotFrom - this.playerX;
    const oldShotLeft = this.shot ? this.shot.x - this.playerX : 0;
    const oldBossSpan = this.bossHomeX() - this.playerX;
    const oldBossLeft = this.bossX - this.playerX;

    this.W = Math.round(rect.width);
    this.H = Math.round(rect.height);

    // canvas の外側（式やボタンの後ろ）は CSS のグラデーション。同じ位置・同じ高さで
    // 色を作らないと、canvas の上端に横線が出る
    const screen = this.canvas.closest('.screen');
    const sr = screen?.getBoundingClientRect();
    this.skyTop = sr ? rect.top - sr.top : 0;
    this.skyH = sr && sr.height > 1 ? sr.height : this.H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 3倍は塗り面積が2.25倍になり発熱する
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 画面が広いほどキャラも大きく。縦でも頭打ちにして、はみ出さないようにする。
    this.s = Math.min(Math.max(Math.min(this.W / 210, this.H / 135), 0.85), 2.8);
    this.groundY = this.H - 22 * this.s;
    // 左に寄せすぎるとコンボのトレイルが画面外に出るので 2割ほど内側に置く。
    // にがて たいじ は走らず向かい合うので、ペットと並んでも重ならないところまで下げる
    this.playerX = this.hunt ? Math.max(70, this.W * 0.28) : Math.max(52, this.W * 0.2);
    this.runSpeed = 130 * this.s;

    // ジャンプは「頂点で障害物の上を通る」高さに合わせて逆算する
    const apex = 74 * this.s;
    this.gravity = (2 * apex) / (T_APEX * T_APEX);
    this.jumpV = -this.gravity * T_APEX;

    // にがて たいじ の敵は動かない。割合ではなく、いつも同じ立ち位置に置きなおす
    if (this.hunt) this.ob.x = this.huntX();

    const newSpan = this.spawnX() - this.playerX;
    if (oldSpan > 1 && newSpan > 1 && this.ob.v > 0) {
      const k = newSpan / oldSpan;
      this.ob.x = this.playerX + oldLeft * k;
      this.ob.v *= k;
    }

    const newShotSpan = this.shotFrom0() - this.playerX;
    this.shotFrom = this.shotFrom0();
    if (this.shot && oldShotSpan > 1 && newShotSpan > 1) {
      const k = newShotSpan / oldShotSpan;
      this.shot.x = this.playerX + oldShotLeft * k;
      this.shot.v *= k;
      this.shot.y = this.groundY - 15 * this.s;
      this.shot.r *= k;
    }

    const newBossSpan = this.bossHomeX() - this.playerX;
    if (this.charging && oldBossSpan > 1 && newBossSpan > 1) {
      const k = newBossSpan / oldBossSpan;
      this.bossX = this.playerX + oldBossLeft * k;
      this.bossV *= k;
    } else {
      this.bossX = this.bossHomeX();
    }
  }

  private spawnX(): number {
    return this.W + 28 * this.s;
  }

  /** にがて たいじ で、敵が立っている位置。近づいても遠ざかりもしない */
  private huntX(): number {
    return this.W * HUNT_ENEMY_X;
  }

  /** ボスが立っている位置（突撃していないとき）。はねと尾が入るよう少し内側 */
  private bossHomeX(): number {
    return this.W - 48 * this.s;
  }

  /** 攻撃が飛び出してくる位置 */
  private shotFrom0(): number {
    return this.bossHomeX() - 22 * this.s;
  }

  /** ボスの背の高さ。ワールドが進むほど大きい */
  private bossSize(): number {
    return 44 * this.s * (1 + this.bossDefn.tier * 0.035);
  }

  /** 描画に使うプレイヤーの横位置（踏みつけ・被弾のときだけ動く） */
  private get px(): number {
    return this.playerX + this.pxOff;
  }

  private view(): SceneView {
    return {
      W: this.W, H: this.H, s: this.s, groundY: this.groundY,
      scroll: this.scroll, t: this.t, skyTop: this.skyTop, skyH: this.skyH,
    };
  }

  // ---------------------------------------------------------------- 問題

  private buildPips(): void {
    this.elPips.replaceChildren();
    for (let i = 0; i < this.total; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      this.elPips.appendChild(pip);
    }
  }

  /** リベンジのぶんを、本編の10個のうしろに足す（色を変えて別の列だと分かるように） */
  private addRevengePips(): void {
    for (let i = 0; i < this.revengeQ.length; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip rev';
      this.elPips.appendChild(pip);
    }
  }

  private markPip(ok: boolean): void {
    const at = this.revenge ? this.total + this.revengeIndex : this.qIndex;
    const pip = this.elPips.children[at] as HTMLElement | undefined;
    pip?.classList.add(ok ? 'done' : 'miss');
  }

  /** 式の上のしるし。いまの問題が「にがて」「ラスト」「リベンジ」かを言葉で出す */
  private updateTags(): void {
    this.elTagWeak.hidden = !this.isWeak;
    this.elTagFinal.hidden = !this.isFinal;
    this.elTagRevenge.hidden = !this.revenge;
  }

  /**
   * ヒントを出す。呼ばれたときだけ出す（こちらから勝手には出さない）。
   *
   * 自動ヒントは廃止した。詰まったころあいを見て絵を出していたが、
   * 「出るまで待つ」ほうが得な場面ができてしまい、待っているだけの時間が
   * 生まれていた。いまは、必要だと思った本人が押したときにだけ出す。
   *
   * 出しているあいだはゲームを止める（ペットが敵を押しとどめる）。
   * 止まるので、いちばん最後のボスだけは回数に限りをつけてある（hintLimited）。
   * ★・コイン・ずかんには一切ひびかせない。助けるのは気持ちの面だけ、
   * という petRescue と同じ考えかた。
   */
  private showHint(): void {
    const q = this.q;
    if (!q) return;
    const art = frameArt(q.fact, q.blank);
    if (!art) return;

    if (this.hintLimited) {
      if (this.hintsLeft <= 0) return;
      this.hintsLeft--;
      // 出しきった。この問題が片づいたら、ペットは やすみに行く（tireCheck）
      if (this.hintsLeft <= 0 && this.pet && !this.petGone()) this.petTired = true;
    }
    // にがて たいじ の敵は最初から動かない。止めるものが無いので、そのまま見せる
    if (!this.hunt) {
      this.hintPaused = true;
      this.tHold = 0;
      stopDrone();
    }
    this.showBanner(
      this.pet
        ? this.hunt
          ? `${this.pet.name}が おしえてくれた！`
          : `${this.pet.name}が おさえてる！`
        : this.hunt
          ? 'ヒントを みよう'
          : 'とまってるよ',
      1.2,
    );
    if (this.pet) sfx.voice(voiceOf(this.pet.art));

    // 絵がもう出ているなら、止めるだけでよい（まちがえたあとに もう一度止める、など）
    if (this.hintShown) {
      this.renderDock();
      return;
    }
    this.hintShown = true;

    // viewBox はモードごとに変わる。設定しそこねると絵がつぶれる
    this.elFrame.setAttribute('viewBox', art.viewBox);
    this.elFrame.innerHTML = art.svg;

    // さくらんぼは「学校で習う書きかた」。1けたどうしの繰り上がりのときだけ、
    // 10マスの絵の横に並べて、絵と記号を結びつける
    const c = art.mode === 'carry' && q.fact.a < 10 && q.fact.b < 10 ? cherry(q.fact) : null;
    showSvg(this.elCherry, Boolean(c));
    if (c) {
      // 絵はミニゲーム「さくらんぼ わけ」と同じもの（tenframe.cherryArt）。
      // ここはヒントなので、ぜんぶ出したところ（step 2）を見せる
      const cy = cherryArt(c, 2);
      this.elCherry.setAttribute('viewBox', cy.viewBox);
      this.elCherry.innerHTML = cy.svg;
    }

    this.elHintText.textContent = art.text;
    // 「のこり 3 だから…？」。答えは言わずに、最後のひと押しだけ置く
    this.elHintNudge.textContent = art.nudge;
    this.elHint.hidden = false;
    // 式（.question）はヒントが開くと潰れて絵に重なる。開いているあいだは
    // 中身の高さに戻す（CSS の .screen-play.hinting）
    this.elPlay.classList.add('hinting');
    // レイアウトが縮むぶんは ResizeObserver が拾って canvas を測りなおす
    this.renderDock();
  }

  /** 問題が変わるとき。絵も止めも全部たたむ */
  private hideHint(): void {
    this.elHint.hidden = true;
    showSvg(this.elCherry, false);
    this.elPlay.classList.remove('hinting');
    this.hintShown = false;
    this.resume();
  }

  private resume(): void {
    if (!this.hintPaused) return;
    this.hintPaused = false;
    if (this.isFinal && this.phase === 'ask') startDrone();
  }

  /**
   * 場面を変える。
   *
   * ヒントボタンが押せるかどうかは場面で決まる（答えおわったら押せない）ので、
   * 代入と同時にボタンを描きなおす。ここを通さずに phase を書き換えると、
   * 押せないのに押せる顔をしたボタンが残る。
   */
  private setPhase(p: Phase): void {
    this.phase = p;
    this.renderDock();
  }

  /**
   * いま ヒントを呼べるか。
   *
   * 呼べないのは「答えおわったあと」「絵にできない式」「止めている最中」だけ。
   * 考えている時間の長さでは決めない（待てば出る、にしない）。
   * 回数で止まるのは、いちばん最後のボスだけ（hintLimited）。
   */
  private hintUsable(): boolean {
    if (!this.running || this.paused || this.hintPaused) return false;
    if (this.phase !== 'ask' || !this.q) return false;
    // にがて たいじ は止めるものが無いので、絵が出たらそれで終わり
    // （押しても同じ絵が出るだけになるので、押せなくしておく）
    if (this.hunt && this.hintShown) return false;
    if (this.hintLimited && (this.hintsLeft <= 0 || this.petGone())) return false;
    return Boolean(frameArt(this.q.fact, this.q.blank));
  }

  /** ヒントボタン（と、絵のペット）を押したとき */
  private pullHint(): void {
    if (!this.hintUsable()) return;
    sfx.tap();
    this.showHint();
  }

  // ---------------------------------------------------------------- ペットの体力

  private petGone(): boolean {
    return this.petExit >= 1;
  }

  /**
   * ヒントを出しきったペットは、やすみに行く（いちばん最後のボスだけ）。
   *
   * 回数で止めるより、ペットが つかれて いなくなるほうが、
   * 「あと何回」を数えられない年齢でも体で分かる（ゲージが空 → いなくなる）。
   * つぎに挑むときは元気になって戻ってくる（start でやりなおす）。
   */
  private tireCheck(): void {
    if (!this.petTired || this.petGone() || this.petExit > 0) return;
    this.petTired = false;
    this.petExit = 0.001; // 去っていく途中（0 より大きく、1 未満）
    // いない子には助けにも来られない。ここを残すと、消えたペットが
    // 時間切れのときだけ現れて背中に乗せることになる
    this.rescueLeft = 0;
    if (this.pet) {
      this.showBanner(`${this.pet.name}は つかれて やすんだ`, 1.6);
      sfx.voice(voiceOf(this.pet.art));
    }
    this.renderDock();
  }

  /** ヒントボタンのペットの顔。走りはじめと、いなくなったときだけ描きなおす */
  private paintPetFace(): void {
    const pet = this.pet;
    this.elPetFace.hidden = !pet;
    this.elPetEmoji.hidden = Boolean(pet);
    if (!pet) return;
    paintPetIcon(this.elPetFace, pet.art, 44, { silhouette: this.petGone() });
    // paintPetIcon は style に px を直書きするので、そのままだと横持ち用の
    // 小さいサイズ（CSS）が効かず、ボタンから顔がはみ出す。絵の大きさは CSS に返す
    this.elPetFace.style.width = '';
    this.elPetFace.style.height = '';
  }

  /**
   * ヒントボタンの見た目。ボタンそのものは、いつでもここに出ている。
   *
   * 変わるのは「いま押せるか」だけ:
   *   ready … 押せる（ふだんはこれ。何回でも呼べる）
   *   sleep … いまは押せない（答えたあと・止めている最中）
   *   none  … この式は絵にできない
   *   gone  … 最後のボスで、ヒントを出しきってペットが やすみに行った
   * free（回数制限なし）のときは、体力ゲージも「あと○かい」も出さない。
   */
  private renderDock(): void {
    const gone = this.hintLimited && this.petGone();
    // 絵にできない式（けたが大きすぎる）。ボタンはあるが、出せるものが無い
    const none = Boolean(this.q) && !frameArt(this.q!.fact, this.q!.blank);
    const ready = this.hintUsable();

    this.elHintBtn.disabled = !ready;
    this.elDock.classList.toggle('free', !this.hintLimited);
    this.elDock.classList.toggle('none', none);
    this.elDock.classList.toggle('gone', gone && !none);
    this.elDock.classList.toggle('ready', ready);
    this.elDock.classList.toggle('sleep', !ready && !none && !gone);

    this.elPetState.textContent = none
      ? 'この しきは じぶんで'
      : gone
        ? this.pet
          ? `${this.pet.name}は やすみちゅう`
          : 'ヒントは おしまい'
        : 'ヒント';

    // 数字とゲージは、回数を数える面（最後のボス）だけのもの
    this.elHintLeft.textContent = !this.hintLimited || gone ? '' : String(this.hintsLeft);
    const k = this.hintMax > 0 ? this.hintsLeft / this.hintMax : 0;
    this.elPetHp.style.width = `${Math.max(0, k) * 100}%`;
    this.elPetHp.classList.toggle('low', k > 0 && k <= 0.34);
  }

  /** つぎに出てくる障害物を引く。同じものが2回続かないようにする（ボス戦では使わない） */
  private pickObstacle(): ObstacleKind {
    const pool = this.theme.obstacles;
    if (pool.length <= 1) return pool[0] ?? 'rock';
    let kind = pool[Math.floor(Math.random() * pool.length)];
    if (kind === this.ob.kind) {
      kind = pool[(pool.indexOf(kind) + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length];
    }
    return kind;
  }

  private nextQuestion(): void {
    // リベンジ中は、まちがえた式そのものを順に出す（引き直さない）。
    // にがて たいじ も同じで、選んできた にがてを 1ぴきずつ順に出す
    // （引き直すと、同じ式が2回出て、別の にがてが 出ないままになる）。
    // きょうの もんだい（ordered）も並べた順に出す。さいごの1問だけ
    // 「いまのレベル」という約束が、順番の上に乗っている
    this.q = this.revenge
      ? this.picker.question(this.revengeQ[this.revengeIndex])
      : this.hunt || this.cfg.ordered
        ? this.picker.question(this.orderedFact())
        : this.picker.next();
    this.wrongThisQ = false;
    this.dodgedThisQ = false;
    // 前の問題の演出を持ちこさない。リベンジの相手が「倒したまま」にならないよう、
    // 敵が死んでいる印もここで戻す
    this.fin = null;
    this.finDim = 0;
    this.finStop = 0;
    this.cut = -1;
    this.obDead = false;
    this.pxOff = 0;
    this.setPhase('ask');
    this.qElapsed = 0;
    this.hideHint();
    this.tireCheck();

    // ボス戦の山場は突撃なので、最後の1問の特別扱いは通常ステージだけ。
    // にがて たいじ は急かさない場なので、持続音の鳴る「ラスト1問」も作らない
    this.isFinal = !this.boss && !this.revenge && !this.hunt && this.qIndex === this.total - 1;
    // リベンジで出る式は、いま目の前でまちがえた式。文句なしに「にがて」。
    // にがて たいじ は、そもそも にがてしか連れてきていない
    this.isWeak = this.revenge || this.hunt || isWeakFact(this.q.fact);
    this.updateTags();

    this.elQuestion.textContent = this.q.text;

    this.elAnswers.replaceChildren();
    this.buttons = this.q.choices.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer';
      b.textContent = String(v);
      b.setAttribute('aria-label', `こたえ ${v}`);
      return b;
    });
    this.elAnswers.append(...this.buttons);

    this.launchObstacle(this.revenge ? REVENGE_TIME : 1);

    // 最後の1問。大きな障害物・低い持続音・倍の粒で、ここが山場だと体で分かるようにする。
    // ここで ぶきの名前を出しておくのが肝で、「当てれば これで しとめられる」が
    // 分かってはじめて、最後の1問まで走りきる理由になる
    if (this.isFinal) {
      this.showBanner(`ラスト 1もん！ ${this.weapon.label}`, 1.6);
      sfx.final();
      startDrone();
    }
    // にがて たいじ には ラスト の持続音を鳴らさないが、しめくくりは同じ。
    // 「つぎで さいご」だけは伝える
    if (this.hunt && this.isLastBlow()) this.showBanner(`さいごの 1ぴき！ ${this.weapon.label}`, 1.6);

    // ボタンの見た目は、いまの問題が決まってから（絵にできる式かどうかを見る）
    this.renderDock();
  }

  /** 並べた順に出すモード（にがて たいじ・きょうの もんだい）の、いまの式 */
  private orderedFact(): Fact {
    const pool = this.cfg.facts ?? [];
    return pool[this.qIndex % Math.max(1, pool.length)] ?? { a: 1, b: 1 };
  }

  /**
   * 障害物を右端から出しなおす。
   * ペットの力（this.slow）はここでだけ効かせる。倍率 k は
   * 「ペットに助けてもらった直後の、もう一度ぶん」を少し短くするために使う。
   */
  private launchObstacle(k: number): void {
    // にがて たいじ の敵は、その場に立って待っている。速さも持ち時間も無い
    if (this.hunt) {
      this.ob = { x: this.huntX(), v: 0, kind: 'weak', scale: 1.35 };
      this.obDead = false;
      this.beamT = 0;
      this.beamHit = false;
      return;
    }
    const time = answerTimeFor(this.world, this.stage, save.settings.slow) * (1 + this.slow) * k;
    if (this.boss) {
      this.startBossTurn(time);
      return;
    }
    // にがてな式は専用の相手が出る。「たおすべき相手」が毎回おなじ姿だと伝わる
    const kind = this.isWeak ? 'weak' : this.pickObstacle();
    this.ob = {
      x: this.spawnX(),
      v: (this.spawnX() - this.playerX) / time,
      kind,
      // 最後の1問だけひとまわり大きい。ほかは同じ種類でも少しずつ大きさを変える
      // （並べたときの「作りもの感」が減る）
      scale: this.isFinal ? FINAL_SCALE : 0.88 + Math.random() * 0.3,
    };
  }

  /**
   * ボスの1手。ふつうは遠距離攻撃を1発、最後の問題だけは突撃。
   * 終盤（最後の4問）は同じ距離を 1割 短い時間で詰めてくる。
   */
  private startBossTurn(base: number): void {
    const rush = this.qIndex >= this.total - BOSS_RUSH_TAIL;
    const time = rush ? base / BOSS_RUSH_RATE : base;
    // ボス戦では通常の障害物を使わない。地面のスクロールだけ走る速さで動かす
    this.ob = { x: this.spawnX(), v: 0, kind: 'boss', scale: 1 };
    this.charging = this.qIndex === this.total - 1;
    this.bossX = this.bossHomeX();

    if (this.charging) {
      this.shot = null;
      this.bossState.mode = 'charge';
      this.bossV = (this.bossX - this.playerX) / time;
      this.showBanner('とつげき！ ふみつけろ！', 1.5);
      sfx.roar();
      return;
    }

    // 速くなる最初の1問で、そうと分かるように知らせる
    if (rush && this.qIndex === this.total - BOSS_RUSH_TAIL) {
      this.showBanner(`${this.bossDefn.name} が ほんきだ！`, 1.5);
      sfx.roar();
    }

    const kind = shotFor(this.bossDefn, this.qIndex);
    this.shotFrom = this.shotFrom0();
    this.shot = {
      kind,
      x: this.shotFrom,
      y: this.groundY - 15 * this.s,
      v: (this.shotFrom - this.playerX) / time,
      r: (kind === 'beam' ? 6.5 : 8.5) * this.s * (1 + this.bossDefn.tier * 0.05),
      rot: 0,
      t: 0,
    };
    this.bossState.mode = 'wind';
    sfx.shoot(kind);
  }

  private answer(i: number): void {
    const q = this.q;
    if (this.phase !== 'ask' || !q || this.paused) return;
    // 前の問題の勢いで連打した指が、出たばかりのボタンを踏まないようにする。
    // 止めているあいだは qElapsed が進まないので、この番人は外す。
    // 外さないと「問題が出た直後にヒントを押した」だけで、答えを押せなくなる
    if (this.qElapsed < 0.3 && !this.hintPaused) return;
    const btn = this.buttons[i];
    if (!btn || btn.disabled) return;

    // ヒントは、答えたところで閉じて動きなおす（「わかった！」ボタンは無い）。
    // ここで動かしなおさないと、update() が飛ばされたまま止まりつづける（跳べずに固まる）
    this.resume();
    this.renderDock();
    this.tireCheck();

    // 乗せてもらっている最中に答えたら、そこで降りる。
    // 乗っているあいだは重力を弱めているので、そのまま跳ぶと画面の外まで飛ぶ
    this.ride = 0;

    const value = q.choices[i];
    const ms = this.qElapsed * 1000;

    if (value === q.answer) {
      const firstTry = !this.wrongThisQ;
      btn.classList.add('correct');
      this.buttons.forEach((b) => { b.disabled = true; });

      if (firstTry) {
        const key = factKey(q.fact);
        if (recordAnswer(q.fact, true, ms)) this.learned.push(key);
        // リベンジは「取り返す」ぶんなので、せいかい数（x / 10）には足さない
        if (this.revenge) this.revengeCorrect++;
        else this.correct++;
        this.combo++;

        // リベンジぶんは「せいかい」に入れない。ここに足すと、リザルトの
        // 「せいかい 8もん ＋27」のように、行の見出しと枚数が合わなくなる。
        // やりなおしのごほうびは、にがて げきは のほうで払う（必ず にがて なので 0 にならない）
        // 倍率は1行ずつ掛ける。合計に掛けると、画面を飛んでいくコインの数字と
        // リザルトの内訳が食い違う
        const base = this.revenge ? 0 : scaled(COIN_CORRECT, this.rate);
        const bonus = this.combo >= 5 ? scaled(COIN_COMBO, this.rate) : 0;
        const weakBonus = this.isWeak ? scaled(COIN_WEAK, this.rate) : 0;
        this.gain.correct += base;
        this.gain.combo += bonus;
        this.gain.weak += weakBonus;
        this.spawnCoins(base + bonus + weakBonus);

        sfx.correct(this.combo - 1);
        // にがてを初回で正解した＝倒した。ここは掛け声でいちばん強く返す。
        // にがて たいじ では、ビームが当たった瞬間に出すので ここでは鳴らさない
        if (this.isWeak && !this.hunt) {
          this.cheer = { text: 'にがてを たおした！', life: 1.3 };
          this.burst(this.px, this.groundY - 22 * this.s, 14, '#e4675c');
          sfx.beat();
        }
        this.callOut();
      } else {
        sfx.correct(0);
      }
      this.markPip(firstTry);
      stopDrone();

      // さいごの1問。ここだけ、えらんだ ぶきで 大げさに しとめる。
      // ボスは突撃の踏みつけが とどめなので、そちらは beginStomp のまま
      if (this.isLastBlow()) {
        this.beginFinish();
        this.updateHud(true);
        return;
      }

      // にがて たいじ は跳ばない。立ったまま構えて、ビームで撃ちぬく
      if (this.hunt) {
        this.beginBeam();
        this.updateHud(true);
        return;
      }

      // 正解した瞬間に跳ぶ。突撃を踏むときだけ、いつもより高く跳び上がる
      this.vy = this.jumpV * (this.boss && this.charging ? 1.4 : 1);
      this.char.air = true;
      this.char.squash = 1.18;
      sfx.jump();
      this.burst(this.px, this.groundY - 20 * this.s, 12, '#ffc53d');
      this.flash = 0.22;

      if (this.boss && this.charging) {
        this.beginStomp();
      } else {
        // 跳んでいるあいだに、攻撃（障害物）のほうが加速して足元を通り抜ける
        const target = this.boss && this.shot ? this.shot : this.ob;
        const dist = Math.max(target.x - this.playerX, 10 * this.s);
        target.v = Math.min(dist / T_APEX, 4200);
        this.setPhase('clear');
        this.hold = CLEAR_HOLD;
      }
      this.updateHud(true);
    } else {
      btn.classList.add('wrong');
      btn.disabled = true;
      window.setTimeout(() => btn.classList.add('spent'), 260);

      // ボスは1問でもまちがえたら終わり。やりなおしはさせない
      if (this.boss) {
        this.loseToBoss(q);
        return;
      }

      this.noteWrong(q, ms);
      this.combo = 0;
      this.char.hurt = 0.35;
      if (!this.char.air) {
        this.vy = this.jumpV * 0.36;
        this.char.air = true;
      }
      this.elQuestion.classList.remove('shake');
      void this.elQuestion.offsetWidth;
      this.elQuestion.classList.add('shake');
      sfx.wrong();
      this.updateHud(false);
    }
  }

  /**
   * まちがい（誤答・時間切れ）を1問につき1回だけ記録する。
   *
   * リベンジ中はミス数に足さない。ここを数えると「まちがえた式にもう一度挑むと、
   * さらにミスが増える」ことになり、やりなおしが罰になってしまう。
   * 習熟度（recordAnswer）だけは本編と同じに付ける。★も図鑑も甘くしないため。
   */
  private noteWrong(q: Question, ms: number): void {
    if (this.wrongThisQ) return;
    this.wrongThisQ = true;
    recordAnswer(q.fact, false, ms);
    if (this.revenge) return;
    this.misses++;
    this.picker.markWrong(q.fact);
    this.missed.set(factKey(q.fact), q.fact);
  }

  /** れんぞくが節目に届いたら、帯を出して音を鳴らす */
  private callOut(): void {
    const call = COMBO_CALLS.find((c) => c.at === this.combo);
    if (!call) return;
    this.showBanner(call.text, 1.5);
    sfx.fanfare();
    this.burst(this.W / 2, this.H * 0.34, 18, '#fff0b0');
  }

  /**
   * ペットが助けてくれる。時間切れの障害物をせなかに乗って越え、
   * おなじ問題にもう一度だけ挑める。
   *
   * まちがいの記録（習熟度・ミス数）は timeout() で済ませたものをそのまま残す。
   * ここを甘くすると、レアなペットを引いた子だけ★と図鑑が伸びてしまい、
   * 「引きの良さ」が学習の記録に化ける。助けるのは気持ちの面だけでよい。
   */
  private petRescue(): void {
    this.rescueLeft--;
    this.ride = 1.15;
    this.char.air = true;
    this.char.hurt = 0;
    this.vy = this.jumpV * 0.95;
    this.char.squash = 1.14;
    this.showBanner(`${this.pet?.name ?? 'ペット'}が たすけてくれた！`, 1.4);
    sfx.rescue();
    this.burst(this.playerX, this.groundY - 22 * this.s, 14, '#8fd8ff');
    // もう一度おなじ問題。少しだけ短い持ち時間で出しなおす
    this.launchObstacle(0.85);
    // 最後の1問なら、時間切れで止めた持続音をここから鳴らしなおす
    if (this.isFinal) startDrone();
    // 連打ガード（0.3秒）を入れなおす。助けられた勢いの指で誤答を押さないように
    this.qElapsed = 0;
    this.renderDock();
  }

  /** 時間切れ。答えを見せてから次へ進む（ここで正解を教えるのが一番効く） */
  private timeout(): void {
    const q = this.q;
    if (!q) return;
    this.noteWrong(q, this.qElapsed * 1000);
    this.markPip(false);
    this.combo = 0;
    stopDrone();

    // ペットが助けてくれる（1ステージに1回だけ）。コインも落とさずに済む。
    // まちがいの記録は上でもう付けてあるので、★も図鑑も甘くならない。
    // ボス戦でも、攻撃が当たる「時間切れ」だけは身がわりになってもらえる
    // （まちがえたときは helpers 抜きでその場で負け）
    if (this.rescueLeft > 0) {
      this.petRescue();
      this.updateHud(false);
      return;
    }

    // ボスは助けがなければここで終わり
    if (this.boss) {
      this.loseToBoss(q);
      return;
    }

    // 落とせるのは、いま持っている「この走りぶん」まで。マイナスにはしない。
    // リベンジではコインも落とさない（やりなおしで損をさせない）
    const drop = this.revenge ? 0 : Math.min(COIN_MISS, Math.max(0, this.earned() - this.gain.lost));
    this.gain.lost += drop;
    if (drop > 0) {
      this.coinsShown = Math.max(0, this.coinsShown - drop);
      this.float(this.playerX, this.groundY - 46 * this.s, `−${drop}`, '#e4675c');
    }

    this.char.hurt = 0.7;
    this.shake = 0.3;
    sfx.stumble();

    const idx = q.choices.indexOf(q.answer);
    this.buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === idx) b.classList.add('correct');
      else b.classList.add('spent');
    });

    this.setPhase('reveal');
    this.hold = REVEAL_HOLD;
    this.updateHud(false);
  }

  // ---------------------------------------------------------------- にがて たいじ

  /**
   * ビームを撃つ。にがて たいじ の とどめ。
   *
   * 走って よけるのではなく、こちらから当てにいく。時間切れが無いぶん、
   * 「正解できた」が「たおした」に直につながるようにしてある。
   * ため（BEAM_CHARGE）→ 発射（BEAM_FLY）→ はじける、の順に進む。
   */
  private beginBeam(): void {
    this.setPhase('beam');
    this.hold = BEAM_HOLD;
    this.beamT = 0;
    this.beamHit = false;
    this.char.squash = 1.14;
    sfx.charge();
  }

  /** ビームが当たった瞬間。ここが いちばん派手なところ */
  private beamImpact(): void {
    this.beamHit = true;
    this.obDead = true;
    const x = this.ob.x;
    const y = this.groundY - 26 * this.s;
    this.burst(x, y, 26, '#e4675c');
    this.burst(x, y, 18, '#ffe08a');
    this.burst(x, y, 12, '#ffffff');
    this.rings.push({ x, y, r: 14 * this.s, life: 0.55, max: 0.55, color: '#fff3c4' });
    this.rings.push({ x, y, r: 8 * this.s, life: 0.7, max: 0.7, color: '#ffb0a6' });
    this.cheer = { text: 'たおした！', life: 1.4 };
    this.shake = 0.42;
    this.flash = 0.4;
    sfx.blast();
    sfx.beat();
  }

  private updateBeam(dt: number): void {
    this.beamT += dt;
    // 撃つときの反動。うしろへ ぐっと下がって、すぐ戻る
    const kick = this.beamT - BEAM_CHARGE;
    this.pxOff = kick > 0 && kick < 0.3 ? -6 * this.s * (1 - kick / 0.3) : 0;
    if (!this.beamHit && this.beamT >= BEAM_CHARGE + BEAM_FLY) this.beamImpact();
  }

  // ---------------------------------------------------------------- フィニッシュ

  /**
   * いまの問題が「さいごの1問」か。
   *
   * ここが true のときだけ、正解が フィニッシュ（ぶきでの とどめ）になる。
   * ボスを外してあるのは、ボスの とどめが 突撃を踏みつけることだから
   * （そちらは stompHit で、同じ ぶきの光を出して同じだけコインを払う）。
   * リベンジは「取り返す」おまけの回なので、しめくくりは本編の10問目に置く。
   */
  private isLastBlow(): boolean {
    return !this.boss && !this.revenge && this.qIndex === this.total - 1;
  }

  /**
   * さいごの1問を当てた。ためて、撃って、しとめるまでを1本の演出で見せる。
   *
   * ここは「最後まで やりきった人だけが見られるもの」にしてある。
   * 途中でやめると、この演出も フィニッシュボーナスも手に入らない。
   *
   * 見せかたは3つ重ねてある。どれも「何で倒したのか」を読ませるためのもの:
   *   ・まわりを暗くする（drawFinishDim）… 明るいのは 2人と ぶきの光だけになる
   *   ・ため（FIN_CHARGE と 引きの pxOff、しぼんでいく照準）… 来ると分かる
   *   ・当たった瞬間に絵を止める（FIN_STOP）… 当たったコマが目に残る
   * 名まえは 画面をまたぐ帯ではなく 左上のカットインで言い、放つ前に引っこめる。
   */
  private beginFinish(): void {
    this.setPhase('finish');
    this.hold = FIN_TOTAL;
    const s = this.s;

    // 立ち位置を決める。近すぎると絵が重なり、画面のはしだと
    // まほうじんや はじけるところが切れる。その あいだに収める
    const near = this.playerX + 66 * s;
    const far = Math.max(near, this.W - 54 * s);
    const spot = this.hunt ? this.ob.x : Math.min(Math.max(this.ob.x, near), far);
    // 近すぎたときだけ置きなおす。遠いぶんは「ためのあいだに歩いてきて止まる」
    // ようにして、いきなり瞬間移動させない
    if (this.ob.x < spot) this.ob.x = spot;
    this.ob.v = Math.max(0, (this.ob.x - spot) / FIN_CHARGE);

    this.fin = { t: 0, hit: false, fired: false, x: spot, y: this.groundY - 26 * s };
    this.char.air = false;
    this.char.squash = 0.9;
    // 出ている帯があれば消す。ここから先は字を画面に出さない
    this.banner = 0;
    this.cut = 0;
    sfx.finishCharge();
  }

  /** 当たった瞬間。この走りでいちばん派手なところ */
  private finishImpact(): void {
    const f = this.fin;
    if (!f) return;
    f.hit = true;
    this.obDead = true;
    const { x, y } = f;
    this.burst(x, y, 30, this.weapon.color);
    this.burst(x, y, 20, this.weapon.glow);
    this.burst(x, y, 14, '#ffffff');
    this.rings.push({ x, y, r: 16 * this.s, life: 0.6, max: 0.6, color: this.weapon.glow });
    this.rings.push({ x, y, r: 9 * this.s, life: 0.8, max: 0.8, color: '#ffffff' });
    // 当たったコマで絵を止める。ここで一拍おかないと、ため・命中・余韻が
    // ひとかたまりになって、「じぶんの ぶきで たおした」ところだけが残らない
    this.finStop = FIN_STOP;
    this.cheer = { text: 'たおした！', life: 1.5 };
    this.shake = 0.5;
    this.flash = 0.45;
    // ここで帯は出さない。いちばん見せたい「はじけるところ」を隠してしまう
    sfx.blast();
    sfx.legend();
    this.payFinish();
  }

  /** やりきったごほうび。フィニッシュを見た人にだけ払う */
  private payFinish(): void {
    const bonus = scaled(COIN_FINISH, this.rate * this.lump);
    if (bonus <= 0) return;
    this.gain.finish += bonus;
    // 「＋20」は倒した相手のところに出す。主人公の頭の上だと
    // 掛け声（「たおした！」）と同じ場所になって、どちらも読めなくなる
    this.spawnCoins(bonus, this.fin?.x ?? this.playerX, this.groundY - 62 * this.s);
    this.updateHud(true);
  }

  private updateFinish(dt: number): void {
    const f = this.fin;
    if (!f) return;
    f.t += dt;
    // 暗くなりぐあいは 目標へ寄せていく。ボスの とどめは 演出の途中から
    // 始まるので、代入にすると そこだけ画面がぱっと暗転してしまう
    this.finDim += (finishDim(f.t) - this.finDim) * Math.min(1, dt * 7);
    // ためのあいだに 間合いまで来て、そこで止まる
    if (this.ob.v > 0 && this.ob.x <= f.x) {
      this.ob.x = f.x;
      this.ob.v = 0;
    }
    if (this.weapon.style === 'slash') {
      // けん は踏みこんで斬る。行って、戻ってくる
      const k = Math.min(1, Math.max(0, (f.t - FIN_CHARGE) / (FIN_FLY + 0.35)));
      const reach = Math.max(0, f.x - this.playerX - 26 * this.s);
      this.pxOff = reach * Math.sin(k * Math.PI);
    } else {
      // ため。撃つ直前に ぐっと後ろへ引き、放つと同時に戻る。
      // 引いた体が戻るところが見えると、「いま放った」が体で分かる
      const tense = Math.max(0, Math.min(1, (f.t - (FIN_CHARGE - 0.26)) / 0.26));
      const fire = Math.max(0, Math.min(1, (f.t - FIN_CHARGE) / 0.14));
      this.pxOff = -9 * this.s * tense * (1 - fire);
    }
    // 放った瞬間。ひとふんばりぶん体をのばす
    if (!f.fired && f.t >= FIN_CHARGE) {
      f.fired = true;
      this.char.squash = 1.16;
      sfx.finishFire();
    }
    if (!f.hit && f.t >= FIN_CHARGE + FIN_FLY) this.finishImpact();
  }

  // ---------------------------------------------------------------- ボス戦

  /** 攻撃をよけた瞬間の演出。よけた数がそのままボスの体力を削る */
  private dodgeFx(): void {
    this.dodgedThisQ = true;
    this.dodges++;
    const y = this.groundY - 16 * this.s;
    const kind = this.shot?.kind ?? 'rock';
    this.rings.push({ x: this.playerX, y, r: 10 * this.s, life: 0.45, max: 0.45, color: '#ffffff' });
    this.burst(this.playerX, y, 14, kind === 'fire' ? '#ffb02e' : kind === 'beam' ? '#8fe3ff' : '#e0d6c2');
    this.cheer = { text: CHEERS[(this.dodges - 1) % CHEERS.length], life: 1 };
    this.bossState.hit = 0.22;
    this.flash = 0.14;
    this.updateBossHp();
    sfx.dodge();
  }

  private updateBossHp(): void {
    const max = Math.max(1, this.total - 1);
    this.elBossHp.style.width = `${Math.max(0, 1 - this.dodges / max) * 100}%`;
  }

  /** 突撃してきたボスに飛び乗って踏みつける。ここは当て判定なしの決め演出 */
  private beginStomp(): void {
    this.setPhase('stomp');
    this.hold = 2.6;
    this.stomped = false;
    this.bossState.mode = 'hit';
    this.bossV *= 0.3;
    this.shake = 0.2;
    this.flash = 0.3;
  }

  private stompHit(): void {
    this.stomped = true;
    this.dodges = Math.max(this.dodges, this.total - 1);
    this.bossState.mode = 'down';
    this.bossState.hit = 0.25;
    this.bossSquashTo = 0.24;
    this.bossV = 0;
    this.vy = this.jumpV * 0.55; // 踏んだ反動で跳ね上がる
    this.shake = 0.55;
    this.flash = 0.32;
    this.burst(this.bossX, this.groundY - 10 * this.s, 26, '#ffc53d');
    this.burst(this.bossX, this.groundY - 10 * this.s, 14, '#ffffff');
    this.rings.push({
      x: this.bossX, y: this.groundY - 8 * this.s,
      r: 12 * this.s, life: 0.6, max: 0.6, color: '#fff3c4',
    });
    this.cheer = { text: 'たおした！', life: 1.6 };
    this.updateBossHp();
    sfx.stomp();
    sfx.legend();

    // ボスの とどめも、えらんだ ぶきの光で締める。
    // 当たった瞬間から始めるので、ためも 飛んでいく絵も出さない
    // （踏みつけの動きと重ねると、何が起きたのか読めなくなる）
    this.fin = {
      t: FIN_CHARGE + FIN_FLY,
      hit: true,
      fired: true,
      x: this.bossX,
      y: this.groundY - this.bossSize() * 0.45,
    };
    this.burst(this.fin.x, this.fin.y, 20, this.weapon.color);
    this.burst(this.fin.x, this.fin.y, 12, this.weapon.glow);
    // 名まえは 左上のカットインで言う。帯だと ボスの上にかぶって、
    // 踏みつけたところも ぶきの光も見えなくなる
    this.banner = 0;
    this.cut = 0;
    this.finStop = FIN_STOP;
    this.payFinish();
  }

  /**
   * ボス戦の負け。攻撃が直撃してその場で終わる。
   * 正解だけは見せてから終わる（負けたまま答えが分からないのが一番よくない）。
   */
  private loseToBoss(q: Question): void {
    if (!this.wrongThisQ) {
      this.wrongThisQ = true;
      this.misses++;
      recordAnswer(q.fact, false, this.qElapsed * 1000);
    }
    this.markPip(false);
    this.combo = 0;
    this.failed = true;
    this.char.hurt = 4;
    this.char.air = true;
    this.vy = this.jumpV * 0.4;
    this.ride = 0;
    this.shake = 0.7;
    this.flash = 0.3;
    this.bossState.mode = 'roar';

    const at = this.shot ? this.shot.x : this.bossX;
    const color = this.shot?.kind === 'fire' ? '#ff8a3c' : this.shot?.kind === 'beam' ? '#8fe3ff' : '#c8bda8';
    this.burst(Math.min(at, this.playerX + 20 * this.s), this.groundY - 18 * this.s, 22, color);
    this.burst(this.playerX, this.groundY - 20 * this.s, 12, '#e4675c');
    this.shot = null;
    sfx.stumble();
    sfx.gameover();

    const idx = q.choices.indexOf(q.answer);
    this.buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === idx) b.classList.add('correct');
      else if (!b.classList.contains('wrong')) b.classList.add('spent');
    });

    this.setPhase('dead');
    this.hold = 2.2;
    this.updateHud(false);
  }

  private updateBoss(dt: number): void {
    const st = this.bossState;
    st.t += dt;
    if (st.hit > 0) st.hit -= dt;
    st.squash += (this.bossSquashTo - st.squash) * Math.min(1, dt * 9);
    // 撃った直後だけ振りかぶった姿勢にする
    if (st.mode === 'wind' && this.shot && this.shot.t > 0.3) st.mode = 'idle';

    if (this.shot) {
      const sh = this.shot;
      sh.t += dt;
      sh.x -= sh.v * dt;
      sh.rot += (sh.v / (sh.r * 7)) * dt;
      if (sh.x < -80 * this.s) this.shot = null;
    }

    if (this.charging && this.phase === 'ask') this.bossX -= this.bossV * dt;

    // よけた瞬間（攻撃が足元を通り過ぎた）
    if (this.phase === 'clear' && !this.dodgedThisQ && this.shot && this.shot.x < this.playerX) {
      this.dodgeFx();
    }

    if (this.phase === 'stomp') {
      // ボスは前のめりに止まり、プレイヤーはその頭の上へ跳び移る
      this.bossV += (0 - this.bossV) * Math.min(1, dt * 4);
      this.bossX -= this.bossV * dt;
      this.bossX = Math.max(this.bossX, this.playerX + this.bossSize() * 0.42);
      this.pxOff += (this.bossX - this.playerX - this.pxOff) * Math.min(1, dt * 5);
      if (!this.stomped && this.vy > 0 && this.py >= -this.bossSize() * this.bossState.squash) {
        this.stompHit();
      }
    }

    if (this.phase === 'dead') {
      // 吹き飛ばされて後ろへ下がる
      this.pxOff = Math.max(this.pxOff - 40 * this.s * dt, -22 * this.s);
    }
  }

  /** いま迫っている攻撃が、どこまで来たか（0 = 出たばかり、1 = 到達） */
  private incoming(): number {
    if (!this.boss) return (this.spawnX() - this.ob.x) / (this.spawnX() - this.playerX);
    if (this.charging) {
      const span = this.bossHomeX() - this.playerX;
      return span > 0 ? (this.bossHomeX() - this.bossX) / span : 0;
    }
    if (!this.shot) return 0;
    const span = this.shotFrom - this.playerX;
    return span > 0 ? (this.shotFrom - this.shot.x) / span : 0;
  }

  /** 攻撃が届いてしまったか */
  private arrived(): boolean {
    if (!this.boss) return this.ob.x < this.playerX - 4 * this.s;
    if (this.charging) return this.bossX < this.playerX + this.bossSize() * 0.42;
    return Boolean(this.shot && this.shot.x < this.playerX - 4 * this.s);
  }

  /** ここまでに稼いだぶん（落としたぶんを引く前） */
  private earned(): number {
    return this.gain.correct + this.gain.combo + this.gain.weak;
  }

  private advance(): void {
    if (this.revenge) {
      this.revengeIndex++;
      if (this.revengeIndex >= this.revengeQ.length) this.endRevenge();
      else this.nextQuestion();
      return;
    }

    this.qIndex++;
    if (this.qIndex < this.total) {
      this.nextQuestion();
      return;
    }
    // 本編が終わった。まちがえた式が残っていれば、そこだけもう一度。
    // にがて たいじ は そもそも「まちがえた式のやりなおし」なので、二重にはしない
    if (!this.boss && !this.hunt && !this.failed && this.missed.size > 0) this.startRevenge();
    else this.finish();
  }

  // ---------------------------------------------------------------- リベンジ

  /**
   * まちがえた式だけを、もう一度出す。
   *
   * 直後の再テストがいちばん効くうえに、「まちがえたら、その場で取り返せる」に
   * なると、まちがいそのものが怖くなくなる。だからここでは
   * ・ミスは増えない（noteWrong）
   * ・コインも落ちない（timeout）
   * ・ぜんぶ正解すれば、ミスを1つ取り消す（endRevenge）
   */
  private startRevenge(): void {
    this.revenge = true;
    this.revengeQ = [...this.missed.values()].slice(0, REVENGE_MAX);
    this.revengeIndex = 0;
    this.revengeCorrect = 0;
    this.addRevengePips();
    this.showBanner('リベンジ！ もういちど', 1.8);
    sfx.revenge();
    this.nextQuestion();
  }

  private endRevenge(): void {
    const cleared = this.revengeCorrect === this.revengeQ.length;
    this.revengeResult = { total: this.revengeQ.length, correct: this.revengeCorrect, cleared };
    if (cleared) {
      // ミス1つぶんの取り消し。★の判定がここで1段上がることがある
      this.misses = Math.max(0, this.misses - 1);
      this.showBanner('ミスを 1つ とりけした！', 1.6);
      this.burst(this.W / 2, this.H * 0.34, 22, '#ffe08a');
      sfx.fanfare();
    } else {
      this.showBanner('つぎは たおせる！', 1.4);
    }
    this.revenge = false;
    this.updateTags();
    // 帯を見せてからリザルトへ移る
    this.setPhase('wrap');
    this.hold = cleared ? 1.7 : 1.4;
  }

  private finish(): void {
    this.setPhase('over');
    this.isFinal = false;
    this.isWeak = false;
    this.updateTags();
    this.stop();

    // やられたときは★もボーナスも付かない。ただし、そこまでに稼いだコインは
    // 取り上げない（全部消すと、もう一度ボスに挑む気がなくなる）
    const stars = this.failed ? 0 : this.misses === 0 ? 3 : this.misses <= 2 ? 2 : 1;
    let firstKind: StageResult['firstKind'] = null;
    if (!this.failed) {
      if (stars === 3) this.gain.perfect = scaled(COIN_PERFECT, this.rate * this.lump);
      this.gain.bonus = scaled(this.cfg.bonusCoins ?? 0, this.rate);

      // 「はじめて」は周回では出ないので、周回の割引は掛けない。
      // prevStars を使うので、下の setStageStars との前後関係に依存しない。
      //
      // ★を保存しない走り（デイリー・にがて たいじ）では出さない。
      // ★が付かない＝prevStars が永久に 0 なので、そのまま払うと
      // 「はじめて クリア」のごほうびが毎回もらえてしまう。
      const saves = this.cfg.saveStars !== false;
      const fc = saves && this.prevStars === 0 && stars > 0 ? COIN_FIRST_CLEAR : 0;
      const fp = saves && this.prevStars < 3 && stars === 3 ? COIN_FIRST_PERFECT : 0;
      this.gain.first = scaled(fc + fp, this.worldRate);
      firstKind = fc && fp ? 'both' : fp ? 'perfect' : fc ? 'clear' : null;
    }

    const coins = gainTotal(this.gain);
    const p = profile();
    p.coins += coins;
    if (!this.failed && this.cfg.saveStars !== false) setStageStars(this.world.id, this.stage, stars);
    persist();

    this.onDone?.({
      worldId: this.world.id,
      stage: this.stage,
      mode: this.mode,
      stars,
      correct: this.correct,
      total: this.total,
      coins,
      gain: { ...this.gain },
      learned: this.learned,
      totalCoins: p.coins,
      failed: this.failed,
      bossName: this.boss ? this.bossDefn.name : null,
      revenge: this.revengeResult,
      firstKind,
      replay: this.prevStars >= 3,
    });
  }

  // ---------------------------------------------------------------- HUD

  private updateHud(pop: boolean): void {
    this.elCoins.textContent = String(profile().coins + this.coinsShown);
    const badge = this.elCoins.parentElement;
    if (pop && badge) {
      badge.classList.remove('pop');
      void badge.offsetWidth;
      badge.classList.add('pop');
    }
    if (this.combo >= 2) {
      this.elCombo.hidden = false;
      const b = this.elCombo.querySelector('b');
      if (b) b.textContent = String(this.combo);
      this.elCombo.classList.remove('pop');
      void this.elCombo.offsetWidth;
      this.elCombo.classList.add('pop');
    } else {
      this.elCombo.hidden = true;
    }
  }

  // ---------------------------------------------------------------- コインの演出

  /**
   * もらったコインを、キャラから HUD のコイン表示へ飛ばす。
   * 数字がいきなり増えるより、飛んでいくものが見えるほうが「もらった」が伝わる。
   */
  private spawnCoins(value: number, floatX = this.playerX, floatY = this.groundY - 52 * this.s): void {
    const n = Math.min(value, 6);
    const per = Math.floor(value / n);
    let rest = value - per * n;
    const tx = this.W - 16 * this.s;
    const ty = 12 * this.s;
    for (let i = 0; i < n; i++) {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      this.coinsFlying.push({
        x0: this.playerX + (Math.random() - 0.5) * 22 * this.s,
        y0: this.groundY - (26 + Math.random() * 16) * this.s,
        cx: tx, cy: ty,
        p: -i * 0.16,
        speed: 1.5 + Math.random() * 0.35,
        value: per + extra,
      });
    }
    this.float(floatX, floatY, `＋${value}`, '#e0a400');
  }

  private float(x: number, y: number, text: string, color: string): void {
    this.floats.push({ x, y, life: 0.9, max: 0.9, text, color, size: 17 * this.s });
  }

  // ---------------------------------------------------------------- ループ

  private frame = (ts: number): void => {
    if (!this.running || this.paused) return;
    if (!this.lastTs) this.lastTs = ts;
    // 低電力モードでは 30fps に落ちるので、フレーム数ではなく経過時間で進める
    const dt = Math.min((ts - this.lastTs) / 1000, 1 / 20);
    this.lastTs = ts;
    if (this.hintPaused) {
      // 世界は止めるが、絵は動かす。ペットが敵を押しとどめている画を見せたいので
      // update() だけ飛ばす。lastTs は毎フレーム進むので dt が溜まらず、
      // 再開しても障害物がワープしない（ポーズのように raf を止めると溜まる）。
      this.tHold += dt;
      // 帯や光りかたは「見せるためのもの」なので、止めているあいだも進める。
      // ここを update() の中だけに置いていたので、「サボテンくんが おさえてる！」が
      // ヒントを出した瞬間ではなく、答えて動きだしてから出ていた。
      this.tickEffects(dt);
      this.draw();
    } else {
      this.update(dt);
      this.draw();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /**
   * 見せるためだけの持ち時間（帯・画面のゆれ・光り・掛け声）。
   *
   * 世界を止めているあいだ（ヒント）も、ここだけは進める。止めてしまうと
   * 「いま出したはずの帯」が、動きだすまで画面に出てこない。
   */
  private tickEffects(dt: number): void {
    if (this.shake > 0) this.shake -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.banner > 0) this.banner -= dt;
    if (this.cheer.life > 0) this.cheer.life -= dt;
    if (this.cut >= 0) {
      this.cut += dt;
      if (this.cut > FIN_CUT_TOTAL) this.cut = -1;
    }
  }

  private update(dt: number): void {
    // ヒットストップ。当たったコマのまま、世界だけを止める。
    // 光り・ゆれ・カットインはここでも進めるので、固まったようには見えない。
    // hold も止まるぶん、フィニッシュはこの秒数だけ長くなる
    if (this.finStop > 0) {
      this.finStop -= dt;
      this.tickEffects(dt);
      return;
    }
    this.t += dt;
    this.elapsed += dt;
    // にがて たいじ では走らない。位相を止めておかないと、動かない地面の上で
    // 足だけ動きつづけて「走っているのに進まない」絵になる。
    // フィニッシュも同じ。足を止めて向かい合う
    this.char.t = this.hunt || this.phase === 'finish' ? 0 : this.t;
    if (this.char.hurt > 0) this.char.hurt -= dt;
    this.tickEffects(dt);
    this.char.squash += (1 - this.char.squash) * Math.min(1, dt * 9);

    if (this.ride > 0) {
      // せなかに乗っているあいだは、決まった高さでふわりと浮く。
      // 重力を弱めるだけにすると1秒で画面の外まで上がってしまい、
      // 助けてもらった瞬間にキャラが消える
      this.ride -= dt;
      this.char.air = true;
      this.py += (-64 * this.s - this.py) * Math.min(1, dt * 6);
      this.vy = this.ride <= 0 ? -30 * this.s : 0; // 降りぎわに ふわっと放される
    } else if (this.char.air) {
      this.vy += this.gravity * dt;
      this.py += this.vy * dt;
      if (this.py >= 0) {
        this.py = 0;
        this.vy = 0;
        this.char.air = false;
        this.char.squash = 0.86;
      }
    }
    // ペットは少し遅れてついてくる
    this.petY += (this.py * 0.65 - this.petY) * Math.min(1, dt * 7);

    this.ob.x -= this.ob.v * dt;
    // にがて たいじ は立ち止まっている。地面まで流すと、動かない敵だけが
    // 取り残されて滑って見える。フィニッシュも同じで、そこだけ景色を止めて
    // 向かい合う（走りながら撃つと、何が起きたのか見えない）
    if (!this.hunt && this.phase !== 'finish') {
      this.scroll += Math.min(Math.max(this.boss ? this.runSpeed : this.ob.v, this.runSpeed), this.runSpeed * 3) * dt;
    }

    if (this.boss) this.updateBoss(dt);
    if (this.phase === 'beam') this.updateBeam(dt);
    // フィニッシュは phase で見ない。ボスの踏みつけ（phase は 'stomp'）でも
    // 同じ ぶきの光を出すので、あるかどうかだけで進める
    if (this.fin) this.updateFinish(dt);

    // つかれたペットが、画面の外へ歩いていくところ
    if (this.petExit > 0 && this.petExit < 1) {
      this.petExit = Math.min(1, this.petExit + dt / PET_EXIT_SEC);
      if (this.petExit >= 1) {
        this.paintPetFace();
        this.renderDock();
      }
    }

    if (this.phase === 'ask') {
      this.qElapsed += dt;
      // ヒントはこちらからは出さない。押されたときだけ（pullHint）。
      // にがて たいじ には時間切れも無いので、ここで見るものが無い
      if (!this.hunt && this.arrived()) this.timeout();
    }

    if (this.hold > 0 && this.phase !== 'ask' && this.phase !== 'over') {
      this.hold -= dt;
      if (this.hold <= 0) {
        if (this.phase === 'stomp' || this.phase === 'dead' || this.phase === 'wrap') this.finish();
        else this.advance();
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.r += 260 * this.s * dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.coinsFlying.length - 1; i >= 0; i--) {
      const c = this.coinsFlying[i];
      c.p += c.speed * dt;
      if (c.p >= 1) {
        this.coinsFlying.splice(i, 1);
        this.coinsShown += c.value;
        this.updateHud(true);
        sfx.coin();
      }
    }

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      f.y -= 42 * this.s * dt;
      if (f.life <= 0) this.floats.splice(i, 1);
    }
  }

  /** 粒をまく。最後の1問だけは倍にして、同じ動きでも手ごたえを変える */
  private burst(x: number, y: number, n: number, color: string): void {
    const count = this.isFinal ? n * 2 : n;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 260,
        vy: -80 - Math.random() * 240,
        life: 0.65, max: 0.65, color,
        r: (2 + Math.random() * 2.4) * this.s,
      });
    }
  }

  // ---------------------------------------------------------------- 描画

  private draw(): void {
    const g = this.g;
    const { W, H, s } = this;
    g.clearRect(0, 0, W, H);

    g.save();
    if (this.shake > 0) {
      g.translate((Math.random() - 0.5) * 7 * s, (Math.random() - 0.5) * 7 * s);
    }

    drawScene(g, this.theme, this.view());

    // フィニッシュの暗転。景色のあと、主人公と相手を描く前に敷く。
    // こうすると暗くなるのは うしろの世界だけで、向かい合っている2人と
    // ぶきの光は明るいまま残る。どこを見ればいいかが 字なしで決まる
    if (this.finDim > 0.002) drawFinishDim(g, this.finView(), this.finDim);

    // 影（空中では小さく薄く）
    const lift = Math.min(1, -this.py / (80 * s));
    g.fillStyle = `rgba(40,60,50,${0.22 * (1 - lift * 0.7)})`;
    g.beginPath();
    g.ellipse(this.px, this.groundY + 3 * s, 17 * s * (1 - lift * 0.4), 5 * s, 0, 0, Math.PI * 2);
    g.fill();

    if (this.boss) {
      this.drawBossScene();
    } else if (this.hunt) {
      // 倒したあとは描かない。撃ちぬかれた粒だけが残る
      if (!this.obDead) this.drawHuntEnemy();
    } else if (!this.obDead && this.ob.x > -80 * s) {
      // 止めているあいだは、押し返してくるぶんだけ手前へずらして描く。
      // 絵の時間（this.t は止まっている）も進めて、相手だけは動きつづけさせる
      drawObstacle(g, this.incomingX(), this.groundY, 30 * s * this.ob.scale, this.ob.kind, this.holdT());
      if (this.ob.v > this.runSpeed * 2.2) this.drawSpeedLines();
    }

    if (this.combo >= 8) this.drawRushLines();
    if (this.combo >= 5) this.drawAura();
    if (this.combo >= 3) this.drawTrail();

    // ペットは主人公の手前に描く。奥に描くと、主人公（34*s 幅）に隠れて
    // 「連れている」ことが画面から読めない。せなかに乗せているあいだ（ride > 0）
    // だけは、乗っている感じを出すために奥へまわす。
    if (this.ride > 0) this.drawFollower();
    this.drawPlayer();
    if (this.ride <= 0) this.drawFollower();
    // ビームは主人公の手もとから出る。キャラより手前に描く
    if (this.phase === 'beam') this.drawBeam();
    // フィニッシュも同じ。手もとから出て、相手のところで はじける
    if (this.fin) drawFinish(g, this.weapon, this.finView());
    // ペットを連れていなくても、止まっていることは画で分かるようにする
    if (this.hintPaused && !this.pet) this.drawStopMark();

    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    drawWeather(g, this.theme, this.view());
    this.drawRings();
    this.drawFlyingCoins();
    this.drawFloats();
    if (this.cheer.life > 0) this.drawCheer();

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
      g.fillRect(0, 0, W, H);
    }

    if (this.banner > 0) this.drawBanner();
    // ぶきの名まえ。画面の左上だけを使い、放つ前に引っこむので
    // とどめの瞬間には字がひとつも残らない
    if (this.cut >= 0) drawFinishCutIn(g, this.weapon, this.finView(), this.cut);

    g.restore();
  }

  /**
   * フィニッシュの絵に渡す寸法ひとそろい。
   * 暗転・ぶき本体・カットインで同じものを使う（出どころがずれない）。
   */
  private finView(): FinishView {
    const s = this.s;
    return {
      t: this.fin?.t ?? 0,
      s, W: this.W, H: this.H,
      // 手もと（drawWeaponHeld が ぶきを置いている高さ）から出す。
      // ここをずらすと、持っている絵と光の出どころが別の場所になる
      fromX: this.px + 20 * s,
      fromY: this.groundY - 18 * s,
      toX: this.fin?.x ?? this.ob.x,
      toY: this.fin?.y ?? this.groundY - 26 * s,
    };
  }

  // ---------------------------------------------------------------- にがて たいじ の絵

  /**
   * 立ちはだかっている にがて。
   *
   * 走るステージの障害物と同じ絵を使うが、こちらは近づいてこない。
   * 待っているあいだ ゆっくり息をしているように見せて、
   * 「急かされてはいないが、たしかに相手がいる」ことを伝える。
   */
  private drawHuntEnemy(): void {
    const g = this.g;
    const s = this.s;
    const size = 30 * s * this.ob.scale;

    // 足もとの影。動かない相手なので、影も動かない
    g.fillStyle = 'rgba(40,60,50,.22)';
    g.beginPath();
    g.ellipse(this.ob.x, this.groundY + 3 * s, size * 0.5, 5 * s, 0, 0, Math.PI * 2);
    g.fill();

    // ため中はこちらを警戒して ふるえる
    const shiver = this.phase === 'beam' ? Math.sin(this.beamT * 40) * 2 * s : 0;
    drawObstacle(g, this.ob.x + shiver, this.groundY, size, this.ob.kind, this.t);
  }

  /**
   * こちらのビーム。
   *
   * ため（光の玉がふくらむ）→ 発射（横一文字にのびる）→ 命中（はじける）。
   * よけるのではなく こちらから当てにいく絵にすることで、
   * 「にがてを たおした」が、正解した本人の手柄として残る。
   */
  private drawBeam(): void {
    const g = this.g;
    const s = this.s;
    const y = this.groundY - 26 * s;
    const from = this.px + 12 * s;
    const to = this.ob.x;

    if (this.beamT < BEAM_CHARGE) {
      // ため。手もとの光が大きくなり、まわりの粒が吸いこまれてくる
      const k = this.beamT / BEAM_CHARGE;
      const r = (4 + k * 11) * s;
      const grad = g.createRadialGradient(from, y, 0, from, y, r * 1.8);
      grad.addColorStop(0, 'rgba(255,255,255,.95)');
      grad.addColorStop(0.5, 'rgba(143,227,255,.75)');
      grad.addColorStop(1, 'rgba(143,227,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(from, y, r * 1.8, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 2 * s;
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const a = this.beamT * 9 + (i * Math.PI * 2) / 5;
        const d = (26 - k * 18) * s;
        g.beginPath();
        g.moveTo(from + Math.cos(a) * d, y + Math.sin(a) * d * 0.7);
        g.lineTo(from + Math.cos(a) * (d - 7 * s), y + Math.sin(a) * (d - 7 * s) * 0.7);
        g.stroke();
      }
      return;
    }

    // 発射。命中してからも すこしのあいだ残す（当たった手ごたえ）
    const fly = Math.min(1, (this.beamT - BEAM_CHARGE) / BEAM_FLY);
    const tip = from + (to - from) * fly;
    const after = Math.max(0, this.beamT - BEAM_CHARGE - BEAM_FLY);
    const fade = Math.max(0, 1 - after / 0.45);
    if (fade <= 0) return;

    g.save();
    g.globalAlpha = fade;
    const h = (7 + Math.sin(this.beamT * 40) * 1.5) * s;
    const glow = g.createLinearGradient(0, y - h * 2, 0, y + h * 2);
    glow.addColorStop(0, 'rgba(143,227,255,0)');
    glow.addColorStop(0.5, 'rgba(143,227,255,.75)');
    glow.addColorStop(1, 'rgba(143,227,255,0)');
    g.fillStyle = glow;
    g.fillRect(from, y - h * 2, tip - from, h * 4);
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.fillRect(from, y - h * 0.5, tip - from, h);
    g.restore();
  }

  // ---------------------------------------------------------------- ボスの絵

  private drawBossScene(): void {
    const g = this.g;
    const s = this.s;
    const size = this.bossSize();
    // 止めているあいだ、迫っているほう（突撃ならボス本体、ふだんは攻撃）が押してくる
    const push = this.holdPush();
    const bossX = this.charging ? this.bossX - push : this.bossX;

    // 迫ってくるほど画面のふちが赤くなる。数字を出さない「残り時間」
    const near = this.phase === 'ask' ? Math.max(0, this.incoming() - 0.55) / 0.45 : 0;
    if (near > 0) {
      const grad = g.createLinearGradient(0, 0, this.W * 0.5, 0);
      grad.addColorStop(0, `rgba(228,103,92,${0.3 * near})`);
      grad.addColorStop(1, 'rgba(228,103,92,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, this.W, this.H);
    }

    g.fillStyle = 'rgba(40,60,50,.2)';
    g.beginPath();
    g.ellipse(bossX, this.groundY + 3 * s, size * 0.6, 6 * s, 0, 0, Math.PI * 2);
    g.fill();

    // 止めているあいだも、ボスだけは息をしている（凍って見えないように）
    const st = this.hintPaused
      ? { ...this.bossState, t: this.bossState.t + this.tHold }
      : this.bossState;
    drawBoss(g, bossX, this.groundY, size, this.bossDefn, st);

    // 攻撃も同じだけ手前へ。押しているのは見た目だけで、shot.x は動かさない
    if (this.shot) drawShot(g, { ...this.shot, x: this.shot.x - push }, this.bossDefn);
  }

  private drawRings(): void {
    const g = this.g;
    for (const r of this.rings) {
      g.globalAlpha = Math.max(0, r.life / r.max) * 0.8;
      g.strokeStyle = r.color;
      g.lineWidth = Math.max(2, 4 * this.s * (r.life / r.max));
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** よけたときの掛け声。上へ流れて消える */
  private drawCheer(): void {
    const g = this.g;
    const s = this.s;
    const k = 1 - this.cheer.life / 1.6;
    g.save();
    g.globalAlpha = Math.min(1, this.cheer.life * 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${22 * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    // 画面のはしで切れないところに寄せる。割合だけで寄せると、
    // 「にがてを たおした！」のような長い掛け声は左端が切れて読めない
    const half = g.measureText(this.cheer.text).width / 2 + 6 * s;
    const x = Math.min(Math.max(this.px, half), Math.max(half, this.W - half));
    const y = this.groundY - (46 + k * 26) * s;
    g.lineWidth = 6 * s;
    g.strokeStyle = '#fff';
    g.lineJoin = 'round';
    g.strokeText(this.cheer.text, x, y);
    g.fillStyle = '#e07b1f';
    g.fillText(this.cheer.text, x, y);
    g.restore();
  }

  /**
   * つれているペット。ふだんは少し後ろを走り、助けてもらっている間だけ
   * プレイヤーの真下（＝せなかに乗せている位置）に来る。
   */
  private drawFollower(): void {
    if (!this.pet) return;
    const g = this.g;
    const s = this.s;
    const size = 26 * s;

    // ヒントを出しきった。うしろへ歩いて画面から出ていく
    if (this.petExit > 0) {
      this.petHit = { x: 0, y: 0, r: 0 };
      if (this.petExit >= 1) return;
      this.drawLeaving(size);
      return;
    }

    // ヒントで止めているあいだは、前に出て敵を押しとどめる
    if (this.hintPaused) {
      this.drawHolding(size);
      return;
    }

    // 1 に近いほど「せなかに乗せている」。降りるときは 0 へ戻り、位置も走る位置へ滑る
    const k = Math.min(1, Math.max(0, this.ride / 0.35));
    // 走る位置。主人公は ±17*s、ペットは ±13*s を占めるので、中心どうしが
    // 30*s 離れていないと必ず重なる。以前は 26*s しかなく、どう頑張っても
    // 4*s ぶんかぶっていた。余白を 6*s とって 36*s あける。
    const follow = Math.max(this.px - 36 * s, 12 * s);
    const x = follow + (this.px - follow) * k;
    const y = this.groundY + this.petY + (this.py + size * 0.5 - this.petY) * k;

    if (k > 0.02) {
      drawPet(g, x, y, size * (1 + 0.3 * k), this.pet.art, this.t);
      return;
    }

    // それでも間隔が足りない狭い画面では、少し下げて小さく描き、奥行きで逃がす
    const gap = this.px - x;
    const tight = Math.min(1, Math.max(0, (30 * s - gap) / (18 * s)));

    const lift = Math.min(1, -this.petY / (80 * s));
    g.fillStyle = `rgba(40,60,50,${0.18 * (1 - lift * 0.7)})`;
    g.beginPath();
    g.ellipse(x, this.groundY + 3 * s, 11 * s * (1 - lift * 0.4), 3.5 * s, 0, 0, Math.PI * 2);
    g.fill();

    // まだ助けてもらえるときは、ふんわり光らせておく（HUD を増やさずに伝える）
    if (this.rescueLeft > 0) {
      const r = (20 + Math.sin(this.t * 5) * 2) * s;
      const cy = y - size * (this.pet.art.fly ? 0.7 : 0.45);
      const grad = g.createRadialGradient(x, cy, r * 0.5, x, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(140,215,255,.5)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.fill();
    }

    // 夜・ボスの暗い空では、ペットの輪郭が背景に沈む。細い白フチで立たせる
    g.save();
    g.shadowColor = 'rgba(255,255,255,.85)';
    g.shadowBlur = 4 * s;
    drawPet(g, x, y + 4 * s * tight, size * (1 - 0.12 * tight), this.pet.art, this.t);
    g.restore();

    // ここを覚えておいて、絵のペットをさわってもヒントが出せるようにする。
    // 指はボタンより大きいので、見た目より広めに取る
    this.petHit = { x, y: y - size * 0.45, r: size * 1.15 };
  }

  /**
   * ヒントを出しきったペットが、やすみに行くところ。
   *
   * 「あと0回」と数字で言われても、数の大きさがまだ分からない年齢には届かない。
   * 出しきったら ペットが 💤 を出して うしろへ歩いていく、という絵にしておくと、
   * つぎからは押す前に一度考えるようになる（つぎのステージでは戻ってくる）。
   */
  private drawLeaving(size: number): void {
    if (!this.pet) return;
    const g = this.g;
    const s = this.s;
    const k = this.petExit;
    const from = Math.max(this.px - 36 * s, 12 * s);
    const x = from - k * (from + 40 * s);
    const y = this.groundY;

    g.save();
    g.globalAlpha = Math.max(0, 1 - k * 0.8);
    drawPet(g, x, y, size, this.pet.art, this.t);

    // 💤。ふくらみながら上へ流れる
    g.globalAlpha = Math.max(0, 1 - k) * 0.9;
    g.font = `${(12 + k * 8) * s}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('💤', x + 12 * s, y - size * (1 + k * 0.9));
    g.restore();
  }

  /**
   * ヒントで止めているあいだ、迫ってきていたものが押し返してくる量（px）。
   *
   * 止まっているのに全部が凍っていると、時間まで止まったように見えて
   * 「押しとどめている」ことが伝わらない。ゆっくり体重をかけては戻る、
   * という往復に細かいふるえを足して、こらえ合っている絵にする。
   * 進むのは見た目だけで、ob.x（＝残り時間）には一切ふれない。
   */
  /**
   * 絵を動かすための時間。止めているあいだは update() が回らず this.t が
   * 進まないので、押しとどめられている相手だけは tHold のぶん進めて描く。
   */
  private holdT(): number {
    return this.hintPaused ? this.t + this.tHold : this.t;
  }

  private holdPush(): number {
    if (!this.hintPaused) return 0;
    // 回りこむまで（drawHolding の 0.25秒）は押させない。押し合いはそのあとから
    const k = Math.min(1, this.tHold / 0.25);
    const lean = (1 - Math.cos(this.tHold * 2.2)) * 0.5; // 0〜1 をゆっくり往復
    return k * (lean * 7 + Math.sin(this.tHold * 13) * 0.9) * this.s;
  }

  /** いま迫っているものの、画面に描く位置（止めているあいだは押し返しぶんだけ手前） */
  private incomingX(): number {
    const base = this.boss ? (this.shot?.x ?? this.bossX) : this.ob.x;
    return base - this.holdPush();
  }

  /**
   * 主人公。ヒントで止めているあいだは、走るのをやめて「考えている」姿にする。
   *
   * update() が止まるので、そのまま描くと走りの途中の絵で固まる。
   * 足を止め（位相 0）、息をするように上下させ、あたまの上に ？ の吹き出しを出す。
   * 止まっているのは世界のほうで、本人は考えている、と画で言うため。
   */
  private drawPlayer(): void {
    const g = this.g;
    const s = this.s;
    const size = 34 * s;
    if (!this.hintPaused) {
      drawChar(g, this.px, this.groundY + this.py, size, currentLook(), this.char);
      return;
    }

    const bob = Math.sin(this.tHold * 2.6) * 1.8 * s;
    // 考えこんで、すこし前かがみになる
    const lean = 0.04 + Math.sin(this.tHold * 1.7) * 0.02;
    g.save();
    g.translate(this.px, this.groundY);
    g.rotate(lean);
    g.translate(-this.px, -this.groundY);
    // 位相 0 ＝ 足をそろえて立っている姿。走りの絵で固まらないようにする
    drawChar(g, this.px, this.groundY + this.py + bob, size, currentLook(), { ...this.char, t: 0 });
    g.restore();

    this.drawThinkBubble(this.px, this.groundY + this.py + bob - size);
  }

  /** 「考えちゅう」の吹き出し。？ が ふくらんだり ちぢんだりする */
  private drawThinkBubble(x: number, headY: number): void {
    const g = this.g;
    const s = this.s;
    const pop = Math.min(1, this.tHold * 5);
    if (pop <= 0) return;
    const cx = x + 18 * s;
    const cy = headY - 14 * s - Math.sin(this.tHold * 2.2) * 2 * s;
    const r = (13 + Math.sin(this.tHold * 3.4) * 1.2) * s * pop;

    g.save();
    g.globalAlpha = pop;
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(80,100,120,.8)';
    g.lineWidth = 2 * s;
    // しっぽ。小さい玉が2つ、あたまから吹き出しへ続く
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.arc(x + (6 + i * 7) * s, cy + (15 - i * 5) * s, (2.4 + i * 1.4) * s * pop, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#2b3440';
    g.font = `700 ${15 * s * pop}px "Hiragino Maru Gothic ProN", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('？', cx, cy + 1 * s);
    g.restore();
  }

  /** ペットを連れていないときの「いま止まっている」しるし */
  private drawStopMark(): void {
    const g = this.g;
    const s = this.s;
    const x = this.incomingX();
    const y = this.groundY - 26 * s;
    const r = (24 + Math.sin(this.tHold * 4) * 2) * s;
    g.save();
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 3 * s;
    g.setLineDash([6 * s, 5 * s]);
    g.lineDashOffset = -this.tHold * 20 * s;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  /**
   * ヒントで止めているあいだの絵。ペットが前に出て、迫っていたものを
   * 両手で押しとどめている。
   *
   * update() は止まっているので障害物は動かない。動いているのはこの絵だけで、
   * 「ペットが止めてくれているから、いま考えていい」ということを画で言う。
   */
  private drawHolding(size: number): void {
    if (!this.pet) return;
    const g = this.g;
    const s = this.s;

    // 迫ってきているものの手前へ、0.25秒かけて回りこむ。
    // 相手が押してくるぶん（holdPush）も込みの位置を見るので、押されれば
    // ペットもいっしょに下がり、離れて宙で踏ん張る絵にならない
    const target = this.incomingX() - 30 * s;
    const from = Math.max(this.px - 36 * s, 12 * s);
    const k = Math.min(1, this.tHold / 0.25);
    const x = from + (Math.max(target, this.px + 18 * s) - from) * (k * k * (3 - 2 * k));
    const y = this.groundY;

    // ふんばり。前傾させて、小刻みにふるえさせる
    const strain = Math.sin(this.tHold * 16) * 0.03;
    g.save();
    g.translate(x, y);
    g.rotate(0.2 + strain);
    g.translate(-x, -y);
    g.shadowColor = 'rgba(255,255,255,.85)';
    g.shadowBlur = 4 * s;
    drawPet(g, x, y, size * 1.15, this.pet.art, this.t);
    g.restore();

    if (k < 0.6) return;

    // 押し合っているしるし。ペットと相手のあいだに短い線を散らす
    g.save();
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 2.5 * s;
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const ly = y - (14 + i * 9) * s;
      const w = (5 + Math.abs(Math.sin(this.tHold * 12 + i)) * 5) * s;
      g.beginPath();
      g.moveTo(x + 14 * s, ly);
      g.lineTo(x + 14 * s + w, ly);
      g.stroke();
    }
    g.restore();

    // 足元の土ぼこり
    g.save();
    g.fillStyle = 'rgba(210,200,180,.55)';
    for (let i = 0; i < 4; i++) {
      const p = ((this.tHold * 0.9 + i * 0.25) % 1);
      g.globalAlpha = 0.55 * (1 - p);
      g.beginPath();
      g.arc(x - (6 + p * 26) * s, y - p * 12 * s, (2.5 + p * 4) * s, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** HUD へ吸いこまれていくコイン。放り上げてから吸い寄せる軌道にする */
  private drawFlyingCoins(): void {
    const g = this.g;
    const s = this.s;
    for (const c of this.coinsFlying) {
      if (c.p < 0) continue;
      const p = Math.min(1, c.p);
      const ease = p * p;
      const x = c.x0 + (c.cx - c.x0) * ease;
      const y = c.y0 + (c.cy - c.y0) * ease - Math.sin(p * Math.PI) * 46 * s;
      // 回っているように見せるため、横幅だけを縮める
      const w = Math.abs(Math.cos(this.t * 7 + c.x0)) * 0.75 + 0.25;
      const r = 7 * s;
      g.fillStyle = '#ffc53d';
      g.beginPath();
      g.ellipse(x, y, r * w, r, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.65)';
      g.beginPath();
      g.ellipse(x - r * 0.22 * w, y - r * 0.25, r * 0.28 * w, r * 0.32, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawFloats(): void {
    const g = this.g;
    for (const f of this.floats) {
      const k = f.life / f.max;
      g.globalAlpha = Math.min(1, k * 1.8);
      g.font = `700 ${f.size}px ${'"Hiragino Maru Gothic ProN", sans-serif'}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(3, f.size * 0.22);
      g.strokeStyle = '#fff';
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  /** 5連続からの光る輪 */
  private drawAura(): void {
    const g = this.g;
    const s = this.s;
    const y = this.groundY + this.py - 17 * s;
    const r = (25 + Math.sin(this.t * 8) * 2) * s;
    const grad = g.createRadialGradient(this.px, y, r * 0.62, this.px, y, r);
    grad.addColorStop(0, 'rgba(255,213,90,0)');
    grad.addColorStop(1, 'rgba(255,197,61,.42)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(this.px, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /** 8連続。画面全体を流れる線で「速い」を出す（実際の速度は変えない） */
  private drawRushLines(): void {
    const g = this.g;
    const { W, H, s } = this;
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 2 * s;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const y = ((i * 53) % (H - 30)) + 14;
      const len = (40 + ((i * 37) % 60)) * s;
      const x = W - ((this.t * 720 * s + i * 180) % (W + len));
      g.moveTo(x, y);
      g.lineTo(x + len, y);
    }
    g.stroke();
  }

  /**
   * 帯を出す。画面をまたぐので、うしろは何も見えなくなる。
   *
   * だから「いま見せたい絵がない」ときだけに使う（問題が出た・ペットが来た・
   * リベンジが始まった）。とどめの演出には使わない — まほうじんや
   * 振りかぶったハンマーが 帯のうしろに隠れて、何で倒したのかが読めなくなる。
   * ぶきの名まえは drawFinishCutIn（画面の左上・放つ前に引っこむ）が言う。
   */
  private showBanner(text: string, sec: number): void {
    this.bannerText = text;
    this.bannerFull = sec;
    this.banner = sec;
  }

  private drawBanner(): void {
    const g = this.g;
    const { W, H, s } = this;
    const t = Math.min(1, (this.bannerFull - this.banner) * 5);
    const alpha = Math.min(1, this.banner * 2.5);
    const y = Math.max(H * 0.34, 22 * s);
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgba(255,197,61,.92)';
    g.fillRect(0, y - 20 * s, W * t, 40 * s);
    g.fillStyle = '#4a3400';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // ペットの名前が入ると長さが変わる。画面からはみ出さないところまで縮める
    let size = 20 * s;
    g.font = `700 ${size}px "Hiragino Maru Gothic ProN", sans-serif`;
    const width = g.measureText(this.bannerText).width;
    if (width > W * 0.92) {
      size *= (W * 0.92) / width;
      g.font = `700 ${size}px "Hiragino Maru Gothic ProN", sans-serif`;
    }
    if (t > 0.9) g.fillText(this.bannerText, W / 2, y);
    g.restore();
  }

  private drawSpeedLines(): void {
    const g = this.g;
    const s = this.s;
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = 2.5 * s;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const y = this.groundY - (8 + i * 11) * s;
      g.moveTo(this.ob.x + 22 * s, y);
      g.lineTo(this.ob.x + (52 + i * 14) * s, y);
    }
    g.stroke();
  }

  private drawTrail(): void {
    const g = this.g;
    const s = this.s;
    g.fillStyle = '#ffc53d';
    for (let i = 1; i <= 4; i++) {
      g.globalAlpha = 0.55 - i * 0.1;
      const x = this.px - (12 + i * 8) * s;
      const y = this.groundY + this.py - 16 * s + Math.sin(this.t * 9 + i) * 3 * s;
      g.beginPath();
      g.arc(x, y, (4 - i * 0.6) * s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
