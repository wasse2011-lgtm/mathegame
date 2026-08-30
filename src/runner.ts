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
import {
  answerTimeFor,
  factKey,
  isBoss,
  questionCount,
  type World,
} from './curriculum';
import { QuestionPicker, recordAnswer, type Question } from './questions';
import { profile, save, setStageStars, persist } from './save';
import { drawChar, drawObstacle, roundRect, type CharState } from './sprites';

export interface StageResult {
  worldId: number;
  stage: number;
  stars: number;
  correct: number;
  total: number;
  coins: number;
  bestKey: string | null;
  bestMs: number;
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

  private buttons: HTMLButtonElement[] = [];
  private raf = 0;
  private lastTs = 0;
  private running = false;
  private paused = false;

  // ステージ状態
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
  private best: { key: string; ms: number } | null = null;
  private onDone: ((r: StageResult) => void) | null = null;

  // 問題状態
  private q: Question | null = null;
  private askedAt = 0;
  private wrongThisQ = false;
  private phase: Phase = 'ask';
  private hold = 0;

  // 見た目の状態
  private t = 0;
  private scroll = 0;
  private char: CharState = { t: 0, air: false, hurt: 0, squash: 1 };
  private py = 0;
  private vy = 0;
  private ob = { x: 0, v: 0, passed: false };
  private particles: Particle[] = [];
  private shake = 0;
  private flash = 0;

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

  start(world: World, stage: number, onDone: (r: StageResult) => void): void {
    this.world = world;
    this.stage = stage;
    this.boss = isBoss(world, stage);
    this.total = questionCount(world, stage);
    this.picker = new QuestionPicker(world);
    this.qIndex = 0;
    this.correct = 0;
    this.misses = 0;
    this.coins = 0;
    this.combo = 0;
    this.best = null;
    this.onDone = onDone;
    this.particles = [];
    this.py = 0;
    this.vy = 0;
    this.char = { t: 0, air: false, hurt: 0, squash: 1 };

    this.elStage.textContent = this.boss ? `${world.id}-ボス` : `${world.id}-${stage}`;
    this.elAnswers.style.setProperty('--cols', String(world.choices));
    this.buildPips();
    this.updateHud(false);
    this.resize();
    this.nextQuestion();

    this.running = true;
    this.paused = false;
    this.lastTs = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setPaused(p: boolean): void {
    if (!this.running) return;
    this.paused = p;
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

    this.W = Math.round(rect.width);
    this.H = Math.round(rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 3倍は塗り面積が2.25倍になり発熱する
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 画面が広いほどキャラも大きく。縦でも頭打ちにして、はみ出さないようにする。
    this.s = Math.min(Math.max(Math.min(this.W / 210, this.H / 135), 0.85), 2.8);
    this.groundY = this.H - 22 * this.s;
    this.playerX = Math.max(46, this.W * 0.16);
    this.runSpeed = 130 * this.s;

    // ジャンプは「頂点で障害物の上を通る」高さに合わせて逆算する
    const apex = 74 * this.s;
    this.gravity = (2 * apex) / (T_APEX * T_APEX);
    this.jumpV = -this.gravity * T_APEX;
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

  private nextQuestion(): void {
    this.q = this.picker.next();
    this.wrongThisQ = false;
    this.phase = 'ask';
    this.askedAt = performance.now();

    this.elQuestion.textContent = `${this.q.fact.a} + ${this.q.fact.b} = ?`;

    this.elAnswers.replaceChildren();
    this.buttons = this.q.choices.map((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer';
      b.textContent = String(v);
      b.setAttribute('aria-label', `こたえ ${v}`);
      b.dataset.i = String(i);
      return b;
    });
    this.elAnswers.append(...this.buttons);

    const time = answerTimeFor(this.world, this.stage, save.settings.slow);
    this.ob = { x: this.spawnX(), v: (this.spawnX() - this.playerX) / time, passed: false };
  }

  private answer(i: number): void {
    const q = this.q;
    if (this.phase !== 'ask' || !q || this.paused) return;
    const btn = this.buttons[i];
    if (!btn || btn.disabled) return;

    const value = q.choices[i];
    const ms = performance.now() - this.askedAt;

    if (value === q.answer) {
      const firstTry = !this.wrongThisQ;
      btn.classList.add('correct');
      this.buttons.forEach((b) => { b.disabled = true; });

      if (firstTry) {
        recordAnswer(q.fact, true, ms);
        this.correct++;
        this.combo++;
        this.coins += 1 + (this.combo >= 5 ? 1 : 0);
        const key = factKey(q.fact);
        if (!this.best || ms < this.best.ms) this.best = { key, ms };
        sfx.correct(this.combo - 1);
        sfx.coin();
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

  /** 時間切れ。答えを見せてから次へ進む（ここで正解を教えるのが一番効く） */
  private timeout(): void {
    const q = this.q;
    if (!q) return;
    if (!this.wrongThisQ) {
      this.wrongThisQ = true;
      this.misses++;
      recordAnswer(q.fact, false, performance.now() - this.askedAt);
      this.picker.markWrong(q.fact);
    }
    this.markPip(false);
    this.combo = 0;
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
    if (this.boss) this.coins += 30;

    const p = profile();
    p.coins += this.coins;
    setStageStars(this.world.id, this.stage, stars);
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
    this.char.t = this.t;
    if (this.char.hurt > 0) this.char.hurt -= dt;
    if (this.shake > 0) this.shake -= dt;
    if (this.flash > 0) this.flash -= dt;
    this.char.squash += (1 - this.char.squash) * Math.min(1, dt * 9);

    if (this.char.air) {
      this.vy += this.gravity * dt;
      this.py += this.vy * dt;
      if (this.py >= 0) {
        this.py = 0;
        this.vy = 0;
        this.char.air = false;
        this.char.squash = 0.86;
      }
    }

    this.ob.x -= this.ob.v * dt;
    this.scroll += Math.min(Math.max(this.ob.v, this.runSpeed), this.runSpeed * 3) * dt;

    if (this.phase === 'ask' && this.ob.x < this.playerX - 4 * this.s) {
      this.timeout();
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

    if (this.combo >= 3) this.drawTrail();

    drawChar(g, this.playerX, this.groundY + this.py, 34 * s, profile().skin, this.char);

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
      g.globalAlpha = 0.5 - i * 0.09;
      const x = this.playerX - i * 13 * s;
      const y = this.groundY + this.py - 16 * s + Math.sin(this.t * 9 + i) * 3 * s;
      g.beginPath();
      g.arc(x, y, (4 - i * 0.6) * s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
