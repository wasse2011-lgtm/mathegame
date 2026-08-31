/**
 * プレイ画面。
 *
 * 設計上の要点:
 *  ・ジャンプのタイミング判定はしない。正解した瞬間に障害物のほうが加速して
 *    足元を通り抜ける。腕前ではなく計算だけで越えられるようにするため。
 *  ・タイマーは出さない。近づいてくる障害物そのものが残り時間。
 *  ・ぶつかってもゲームオーバーにしない。コインを1枚落として先へ進む。
 */

import { sfx } from './audio';
import { answerTimeFor, cherry, factKey, type Fact, type World } from './curriculum';
import { drawPet } from './petart';
import { activePet, petPower, type PetDef } from './pets';
import { QuestionPicker, recordAnswer, type Question } from './questions';
import { addPlayTime, profile, save, setStageStars, persist } from './save';
import { currentLook, drawChar, drawObstacle, roundRect, type CharState } from './sprites';

/** 1回の走りの設定。通常ステージもボスもデイリーもこれで表す */
export interface RunConfig {
  world: World;
  /** 0 はデイリーチャレンジ（星もマップも使わない） */
  stage: number;
  total: number;
  boss: boolean;
  label: string;
  /** 指定するとワールドの式ではなくこの中から出す */
  facts?: Fact[];
  bonusCoins?: number;
  saveStars?: boolean;
}

export interface StageResult {
  worldId: number;
  stage: number;
  stars: number;
  correct: number;
  total: number;
  coins: number;
  bestKey: string | null;
  bestMs: number;
  /** この回で初めておぼえた式 */
  learned: string[];
  maxCombo: number;
}

type Phase = 'ask' | 'clear' | 'reveal' | 'over';

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number;
}

const CLEAR_HOLD = 0.8;
const REVEAL_HOLD = 1.25;
const T_APEX = 0.32;

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
  private elCherry = document.getElementById('cherry') as unknown as SVGElement;
  private elHintText = document.getElementById('hint-text') as HTMLElement;

  private buttons: HTMLButtonElement[] = [];
  private raf = 0;
  private lastTs = 0;
  private running = false;
  private paused = false;

  // ステージ状態
  private cfg!: RunConfig;
  private world!: World;
  private stage = 1;
  private boss = false;
  private total = 0;
  private picker!: QuestionPicker;
  private qIndex = 0;
  private correct = 0;
  private misses = 0;
  private coins = 0;
  private combo = 0;
  private maxCombo = 0;
  private learned: string[] = [];
  private best: { key: string; ms: number } | null = null;
  private onDone: ((r: StageResult) => void) | null = null;

  // 問題状態
  private q: Question | null = null;
  /**
   * その問題が出てからの秒数。壁時計ではなくゲーム内時間で数えるので、
   * ポーズや裏に回っていた時間は「考えていた時間」に入らない。
   */
  private qElapsed = 0;
  private wrongThisQ = false;
  private phase: Phase = 'ask';
  private hold = 0;
  private hintShown = false;
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
  private ob = { x: 0, v: 0 };
  private particles: Particle[] = [];
  private shake = 0;
  private flash = 0;
  /** 画面いっぱいの帯を出している残り時間 */
  private banner = 0;
  private bannerFull = 1.5;
  private bannerText = '';

  // 画面寸法（CSS ピクセル）
  private W = 320;
  private H = 200;
  private s = 1;
  private groundY = 170;
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
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement ?? this.canvas);
    }
  }

  // ---------------------------------------------------------------- 開始・終了

  start(cfg: RunConfig, onDone: (r: StageResult) => void): void {
    this.cfg = cfg;
    this.world = cfg.world;
    this.stage = cfg.stage;
    this.boss = cfg.boss;
    this.total = cfg.total;
    this.picker = new QuestionPicker(
      cfg.facts ?? cfg.world.facts,
      cfg.world.choices,
      Boolean(cfg.world.blank),
    );
    this.qIndex = 0;
    this.correct = 0;
    this.misses = 0;
    this.coins = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.learned = [];
    this.best = null;
    this.onDone = onDone;
    this.elapsed = 0;
    this.particles = [];
    this.py = 0;
    this.vy = 0;
    this.char = { t: 0, air: false, hurt: 0, squash: 1 };

    // つれているペットの力は、走り出すたびに読みなおす
    this.pet = activePet();
    const power = petPower();
    this.slow = power.slow;
    this.rescueLeft = power.rescue;
    this.ride = 0;
    this.petY = 0;

    this.elStage.textContent = cfg.label;
    this.elAnswers.style.setProperty('--cols', String(cfg.world.choices));
    this.buildPips();
    this.updateHud(false);
    this.resize();
    this.nextQuestion();

    this.running = true;
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
  }

  setPaused(p: boolean): void {
    // running を見て早期 return すると、start() の直前に裏へ回ったときに
    // 「ポーズ画面が出たまま裏で走り続ける」状態になる。状態は必ず持つ。
    this.paused = p;
    if (!this.running) return;
    if (!p) {
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

    this.W = Math.round(rect.width);
    this.H = Math.round(rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 3倍は塗り面積が2.25倍になり発熱する
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 画面が広いほどキャラも大きく。縦でも頭打ちにして、はみ出さないようにする。
    this.s = Math.min(Math.max(Math.min(this.W / 210, this.H / 135), 0.85), 2.8);
    this.groundY = this.H - 22 * this.s;
    // 左に寄せすぎるとコンボのトレイルが画面外に出るので 2割ほど内側に置く
    this.playerX = Math.max(52, this.W * 0.2);
    this.runSpeed = 130 * this.s;

    // ジャンプは「頂点で障害物の上を通る」高さに合わせて逆算する
    const apex = 74 * this.s;
    this.gravity = (2 * apex) / (T_APEX * T_APEX);
    this.jumpV = -this.gravity * T_APEX;

    const newSpan = this.spawnX() - this.playerX;
    if (oldSpan > 1 && newSpan > 1 && this.ob.v > 0) {
      const k = newSpan / oldSpan;
      this.ob.x = this.playerX + oldLeft * k;
      this.ob.v *= k;
    }
  }

  private spawnX(): number {
    return this.W + 28 * this.s;
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

  private markPip(ok: boolean): void {
    const pip = this.elPips.children[this.qIndex] as HTMLElement | undefined;
    pip?.classList.add(ok ? 'done' : 'miss');
  }

  /**
   * さくらんぼ分解のヒント。詰まったとき（一度まちがえた／障害物が近づいた）だけ出す。
   * 最初から出すと考えなくなるので、出すタイミングがすべて。
   */
  private showHint(): void {
    const q = this.q;
    if (!q || this.hintShown || q.blank) return;
    const c = cherry(q.fact);
    if (!c) return;
    this.hintShown = true;

    const circle = (cx: number, cy: number, r: number, cls: string, text: string) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" class="${cls}" />` +
      `<text x="${cx}" y="${cy}" class="cn">${text}</text>`;

    this.elCherry.innerHTML =
      `<line x1="100" y1="30" x2="62" y2="50" class="branch" />` +
      `<line x1="100" y1="30" x2="138" y2="50" class="branch" />` +
      circle(100, 18, 16, 'top', String(q.fact.b)) +
      circle(62, 60, 16, 'leaf need', String(c.need)) +
      circle(138, 60, 16, 'leaf', String(c.rest));

    this.elHintText.textContent = `${q.fact.a} に ${c.need} を あげて ${c.ten}！`;
    this.elHint.hidden = false;
    // レイアウトが縮むぶんは ResizeObserver が拾って canvas を測りなおす
  }

  private hideHint(): void {
    this.elHint.hidden = true;
    this.hintShown = false;
  }

  private nextQuestion(): void {
    this.q = this.picker.next();
    this.wrongThisQ = false;
    this.phase = 'ask';
    this.qElapsed = 0;
    this.hideHint();

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

    this.launchObstacle(1);
  }

  /**
   * 障害物を右端から出しなおす。
   * ペットの力（this.slow）はここでだけ効かせる。倍率 k は
   * 「ペットに助けてもらった直後の、もう一度ぶん」を少し短くするために使う。
   */
  private launchObstacle(k: number): void {
    const time = answerTimeFor(this.world, this.stage, save.settings.slow) * (1 + this.slow) * k;
    this.ob = { x: this.spawnX(), v: (this.spawnX() - this.playerX) / time };
  }

  private answer(i: number): void {
    const q = this.q;
    if (this.phase !== 'ask' || !q || this.paused) return;
    // 前の問題の勢いで連打した指が、出たばかりのボタンを踏まないようにする
    if (this.qElapsed < 0.3) return;
    const btn = this.buttons[i];
    if (!btn || btn.disabled) return;

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
        this.correct++;
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.coins += 1 + (this.combo >= 5 ? 1 : 0);
        if (!this.best || ms < this.best.ms) this.best = { key, ms };
        sfx.correct(this.combo - 1);
        sfx.coin();
        if (this.combo === 8) {
          this.showBanner('ちょうぜつダッシュ！', 1.5);
          sfx.fanfare();
        }
      } else {
        sfx.correct(0);
      }
      this.markPip(firstTry);

      // 正解した瞬間、障害物が跳ぶ足元へ向かって加速する
      this.vy = this.jumpV;
      this.char.air = true;
      this.char.squash = 1.18;
      const dist = Math.max(this.ob.x - this.playerX, 10 * this.s);
      this.ob.v = Math.min(dist / T_APEX, 4200);
      sfx.jump();
      this.burst(this.playerX, this.groundY - 20 * this.s, 12, '#ffc53d');
      this.flash = 0.22;

      this.phase = 'clear';
      this.hold = CLEAR_HOLD;
      this.updateHud(true);
    } else {
      btn.classList.add('wrong');
      btn.disabled = true;
      window.setTimeout(() => btn.classList.add('spent'), 260);

      if (!this.wrongThisQ) {
        this.wrongThisQ = true;
        this.misses++;
        recordAnswer(q.fact, false, ms);
        this.picker.markWrong(q.fact);
      }
      this.combo = 0;
      this.char.hurt = 0.35;
      this.showHint();
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
    // 連打ガード（0.3秒）を入れなおす。助けられた勢いの指で誤答を押さないように
    this.qElapsed = 0;
    this.showHint();
  }

  /** 時間切れ。答えを見せてから次へ進む（ここで正解を教えるのが一番効く） */
  private timeout(): void {
    const q = this.q;
    if (!q) return;
    if (!this.wrongThisQ) {
      this.wrongThisQ = true;
      this.misses++;
      recordAnswer(q.fact, false, this.qElapsed * 1000);
      this.picker.markWrong(q.fact);
    }
    this.markPip(false);
    this.combo = 0;

    if (this.rescueLeft > 0) {
      this.petRescue();
      this.updateHud(false);
      return;
    }

    this.coins = Math.max(0, this.coins - 1);
    this.char.hurt = 0.7;
    this.shake = 0.3;
    sfx.stumble();

    const idx = q.choices.indexOf(q.answer);
    this.buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === idx) b.classList.add('correct');
      else b.classList.add('spent');
    });

    this.phase = 'reveal';
    this.hold = REVEAL_HOLD;
    this.updateHud(false);
  }

  private advance(): void {
    this.qIndex++;
    if (this.qIndex >= this.total) this.finish();
    else this.nextQuestion();
  }

  private finish(): void {
    this.phase = 'over';
    this.stop();

    const stars = this.misses === 0 ? 3 : this.misses <= 2 ? 2 : 1;
    if (stars === 3) this.coins += 10;
    this.coins += this.cfg.bonusCoins ?? 0;

    const p = profile();
    p.coins += this.coins;
    if (this.cfg.saveStars !== false) setStageStars(this.world.id, this.stage, stars);
    persist();

    this.onDone?.({
      worldId: this.world.id,
      stage: this.stage,
      stars,
      correct: this.correct,
      total: this.total,
      coins: this.coins,
      bestKey: this.best?.key ?? null,
      bestMs: this.best?.ms ?? 0,
      learned: this.learned,
      maxCombo: this.maxCombo,
    });
  }

  // ---------------------------------------------------------------- HUD

  private updateHud(pop: boolean): void {
    this.elCoins.textContent = String(profile().coins + this.coins);
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

  // ---------------------------------------------------------------- ループ

  private frame = (ts: number): void => {
    if (!this.running || this.paused) return;
    if (!this.lastTs) this.lastTs = ts;
    // 低電力モードでは 30fps に落ちるので、フレーム数ではなく経過時間で進める
    const dt = Math.min((ts - this.lastTs) / 1000, 1 / 20);
    this.lastTs = ts;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    this.t += dt;
    this.elapsed += dt;
    this.char.t = this.t;
    if (this.char.hurt > 0) this.char.hurt -= dt;
    if (this.shake > 0) this.shake -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.banner > 0) this.banner -= dt;
    this.char.squash += (1 - this.char.squash) * Math.min(1, dt * 9);

    if (this.ride > 0) this.ride -= dt;

    if (this.char.air) {
      // せなかに乗っているあいだは、ゆっくり浮いていられる
      this.vy += this.gravity * (this.ride > 0 ? 0.12 : 1) * dt;
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
    this.scroll += Math.min(Math.max(this.ob.v, this.runSpeed), this.runSpeed * 3) * dt;

    if (this.phase === 'ask') {
      this.qElapsed += dt;
      // 障害物が半分まで来ても答えが出ていなければヒントを出す。
      // 遅すぎると、読んで理解する時間が残らない。
      const gone = (this.spawnX() - this.ob.x) / (this.spawnX() - this.playerX);
      if (gone > 0.5) this.showHint();
      if (this.ob.x < this.playerX - 4 * this.s) this.timeout();
    }

    if ((this.phase === 'clear' || this.phase === 'reveal') && this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) this.advance();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private burst(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
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

    this.drawClouds();
    // 丘は画面が低いときに主張しすぎないよう、高さでも上限をかける
    this.drawHills(0.16, Math.min(118 * s, H * 0.34), 'rgba(255,255,255,.42)');
    this.drawHills(0.34, Math.min(84 * s, H * 0.24), 'rgba(126,201,111,.55)');
    this.drawGround();

    // 影（空中では小さく薄く）
    const lift = Math.min(1, -this.py / (80 * s));
    g.fillStyle = `rgba(40,60,50,${0.22 * (1 - lift * 0.7)})`;
    g.beginPath();
    g.ellipse(this.playerX, this.groundY + 3 * s, 17 * s * (1 - lift * 0.4), 5 * s, 0, 0, Math.PI * 2);
    g.fill();

    if (this.ob.x > -80 * s) {
      drawObstacle(g, this.ob.x, this.groundY, 30 * s, this.boss);
      if (this.ob.v > this.runSpeed * 2.2) this.drawSpeedLines();
    }

    if (this.combo >= 8) this.drawRushLines();
    if (this.combo >= 5) this.drawAura();
    if (this.combo >= 3) this.drawTrail();

    this.drawFollower();
    drawChar(g, this.playerX, this.groundY + this.py, 34 * s, currentLook(), this.char);

    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
      g.fillRect(0, 0, W, H);
    }

    if (this.banner > 0) this.drawBanner();

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

    // 1 に近いほど「せなかに乗せている」。降りるときは 0 へ戻り、位置も走る位置へ滑る
    const k = Math.min(1, Math.max(0, this.ride / 0.35));
    const x = this.playerX - 30 * s * (1 - k);
    const y = this.groundY + this.petY + (this.py + size * 0.5 - this.petY) * k;

    if (k > 0.02) {
      drawPet(g, x, y, size * (1 + 0.3 * k), this.pet.art, this.t);
      return;
    }

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

    drawPet(g, x, y, size, this.pet.art, this.t);
  }

  /** 5連続からの光る輪 */
  private drawAura(): void {
    const g = this.g;
    const s = this.s;
    const y = this.groundY + this.py - 17 * s;
    const r = (25 + Math.sin(this.t * 8) * 2) * s;
    const grad = g.createRadialGradient(this.playerX, y, r * 0.62, this.playerX, y, r);
    grad.addColorStop(0, 'rgba(255,213,90,0)');
    grad.addColorStop(1, 'rgba(255,197,61,.42)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(this.playerX, y, r, 0, Math.PI * 2);
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
    const y = H * 0.34;
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

  private drawClouds(): void {
    const g = this.g;
    const off = (this.scroll * 0.06) % (this.W + 200);
    g.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 3; i++) {
      const cx = ((i * (this.W / 2 + 90) - off) % (this.W + 220)) + 110 - 110;
      const cy = 26 * this.s + i * 18 * this.s;
      const r = (14 + i * 3) * this.s;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.arc(cx + r * 0.9, cy + r * 0.15, r * 0.75, 0, Math.PI * 2);
      g.arc(cx - r * 0.85, cy + r * 0.2, r * 0.62, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawHills(rate: number, radius: number, color: string): void {
    const g = this.g;
    const step = radius * 1.7;
    const off = (this.scroll * rate) % step;
    g.fillStyle = color;
    g.beginPath();
    for (let i = -1; i < this.W / step + 2; i++) {
      const cx = i * step - off + step * 0.4;
      g.moveTo(cx - radius, this.groundY);
      g.arc(cx, this.groundY, radius, Math.PI, 0);
    }
    g.fill();
  }

  private drawGround(): void {
    const g = this.g;
    const { W, s } = this;
    g.fillStyle = '#7ec96f';
    g.fillRect(0, this.groundY, W, this.H - this.groundY);
    g.fillStyle = '#c99a68';
    g.fillRect(0, this.groundY + 8 * s, W, this.H - this.groundY - 8 * s);
    g.fillStyle = '#5da84f';
    g.fillRect(0, this.groundY, W, 3 * s);

    // 走っている感じを出すための地面の線
    g.fillStyle = 'rgba(255,255,255,.35)';
    const step = 26 * s;
    const off = this.scroll % step;
    for (let i = -1; i < W / step + 1; i++) {
      roundRect(g, i * step - off, this.groundY + 12 * s, 12 * s, 3 * s, 2 * s);
      g.fill();
    }
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
      const x = this.playerX - (12 + i * 8) * s;
      const y = this.groundY + this.py - 16 * s + Math.sin(this.t * 9 + i) * 3 * s;
      g.beginPath();
      g.arc(x, y, (4 - i * 0.6) * s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
