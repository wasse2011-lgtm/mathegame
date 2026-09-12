/**
 * 効果音。音声ファイルは持たず、Web Audio で合成する（オフラインでも確実に鳴る）。
 *
 * iOS の落とし穴:
 *  1. AudioContext は最初のユーザー操作の中でしか resume できない
 *  2. 消音スイッチが ON だと既定では鳴らない → Safari 16.4+ の audioSession を playback にする
 *  3. 電話・ほかのアプリの音・アプリを裏に回す、で AudioContext が止まる。このとき
 *     iOS が入れる state は仕様にない **'interrupted'** で、'suspended' だけを見て
 *     起こしていると二度と戻らない（＝開き直したあと、音が鳴らないままになる）
 *
 * なので「最初の1回だけ unlock する」作りにはしない。**どのタップでも、
 * 止まっていたら起こす**（installAudioWake）。せっていの「おと」を消して戻す操作も
 * タップなので、ここを通れば必ず鳴る状態に戻る。
 */

import { save } from './save';

interface AudioSessionLike { type: string }

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** 直近に resume を頼んだ時刻。返事を待っているあいだは「起きなかった」と数えない */
let lastResume = 0;
/** 間をあけて resume を頼んだのに起きなかった回数 */
let misses = 0;
/** 作りなおした回数。iOS は同時に持てる AudioContext が少ないので上限を置く */
let rebuilds = 0;
const MAX_REBUILD = 3;
/** これだけ起こしそこねたら、resume では戻れないと見て作りなおす */
const MISS_LIMIT = 2;

/** 消音スイッチが入っていても鳴らす（未対応ブラウザでは何も起きない）。
 *  割りこみのあとに iOS が戻すことがあるので、起こすたびに入れなおす */
function claimSession(): void {
  const session = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
  if (session && session.type !== 'playback') session.type = 'playback';
}

function build(): void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
    return;
  }
  misses = 0;
  lastResume = 0;
  resume();
}

/**
 * 止まっている AudioContext を起こす。
 * 'suspended' だけでなく iOS の 'interrupted' も拾うため、'running' 以外は必ず頼む。
 */
function resume(): void {
  if (!ctx || ctx.state === 'running') return;
  const now = performance.now();
  // 頼んでもすぐには起きない（resume は非同期）。間をあけた分だけ「起きなかった」と数える
  if (now - lastResume >= 600) {
    lastResume = now;
    misses++;
  }
  void ctx.resume().then(
    () => {
      misses = 0;
    },
    () => undefined, // ユーザー操作の外では断られる。次のタップでまた頼む
  );
}

/** 割りこみから resume で戻れないとき。古いほうは閉じて、持つ数を増やさない */
function rebuild(): void {
  rebuilds++;
  const old = ctx;
  ctx = null;
  master = null;
  drone = null; // 古い ctx の持ちもの。新しいほうには付けかえられない
  try {
    void old?.close();
  } catch {
    /* 閉じられなくても作りなおす */
  }
  build();
}

/**
 * 音を鳴らせる状態にする。ユーザー操作の中から呼ぶ（iOS はそこでしか起きない）。
 * 作っていなければ作り、止まっていれば起こす。
 */
export function unlockAudio(): void {
  claimSession();
  if (!ctx || ctx.state === 'closed') {
    build();
    return;
  }
  if (ctx.state === 'running') {
    misses = 0;
    return;
  }
  // 何度 頼んでも起きないなら、iOS 側の割りこみから resume では戻れていない。
  // 作りなおすしか手がない
  if (misses >= MISS_LIMIT && rebuilds < MAX_REBUILD) {
    rebuild();
    return;
  }
  resume();
}

/**
 * どのタップでも、止まっていたら起こす。起動時に1回だけ呼ぶ。
 *
 * 外さずに置いておくのが肝。最初の1回で外してしまうと、割りこみ（電話・開き直し）の
 * あとに戻す手が「たまたま unlockAudio を呼んでいる画面」に限られ、せっていの
 * トグルのように呼んでいない場所では鳴らないままになる。
 * ほとんどの呼び出しは state を見るだけで終わるので、負荷にはならない。
 */
export function installAudioWake(): void {
  const wake = (): void => {
    if (ctx && ctx.state === 'running') return;
    unlockAudio();
  };
  for (const ev of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(ev, wake, { capture: true, passive: true });
  }
}

/** AudioContext が起きてから cb を呼ぶ。起きないままなら何もしない */
function whenRunning(cb: () => void, waitMs = 1200): void {
  const c = ctx;
  if (!c) return;
  if (c.state === 'running') {
    cb();
    return;
  }
  if (waitMs <= 0) return;
  window.setTimeout(() => {
    if (ctx !== c) return; // 作りなおされた
    whenRunning(cb, waitMs - 80);
  }, 80);
}

/**
 * せっていの「おと」を切りかえたときの後始末。
 *
 * ON に戻したとき、その場で sfx.tap() を鳴らしても音は出ない。止まっていた
 * AudioContext が起きるのは resume の返事が来てから（非同期）なので、
 * 起きるのを待って鳴らす。ここが「戻しても鳴らない」の見え方そのものだった。
 * OFF にしたときは、鳴りっぱなしになる持続音をここで止める。
 */
export function applySoundSetting(): void {
  if (!save.settings.sound) {
    stopDrone();
    return;
  }
  unlockAudio();
  whenRunning(() => sfx.tap());
}

type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

/**
 * 止まっているあいだは鳴らさずに捨てる。
 *
 * 止まった AudioContext では currentTime が進まないので、そのあいだに積んだ音は
 * **起きた瞬間に全部同時に鳴る**（割りこみ中に遊んでいた分がまとめて爆発する）。
 * 起こすのはタップの側（installAudioWake）に任せて、ここでは捨てる。
 */
function tone(freq: number, dur: number, opts: { at?: number; wave?: Wave; vol?: number; to?: number } = {}): void {
  if (!ctx || !master || ctx.state !== 'running' || !save.settings.sound) return;
  const t0 = ctx.currentTime + (opts.at ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.wave ?? 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t0 + dur);

  const v = opts.vol ?? 0.5;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise(dur: number, vol = 0.3): void {
  if (!ctx || !master || ctx.state !== 'running' || !save.settings.sound) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.buffer = buf;
  src.connect(gain).connect(master);
  src.start();
}

/**
 * 低い持続音。最後の1問のあいだだけ鳴らして、「ここが山場」を耳でも伝える。
 *
 * 携帯のスピーカーは 100Hz あたりから下がほとんど出ないので、「低い」といっても
 * 110Hz より下げると無音になる。低さは音程ではなく、ゆっくりした脈で出す。
 */
let drone: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

export function startDrone(): void {
  if (!ctx || !master || ctx.state !== 'running' || !save.settings.sound || drone) return;
  const t0 = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(110, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.6);

  // 鼓動のように揺らす。まっ平らな持続音より、迫ってくる感じが出る
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.setValueAtTime(3.1, t0);
  depth.gain.setValueAtTime(0.055, t0);
  lfo.connect(depth).connect(gain.gain);

  osc.connect(gain).connect(master);
  osc.start(t0);
  lfo.start(t0);
  drone = { osc, lfo, gain };
}

export function stopDrone(): void {
  if (!ctx || !drone) return;
  const { osc, lfo, gain } = drone;
  drone = null;
  const t0 = ctx.currentTime;
  gain.gain.cancelScheduledValues(t0);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  osc.stop(t0 + 0.25);
  lfo.stop(t0 + 0.25);
}

// ドミソド — 連続正解で音が上がっていくと、耳だけでコンボが分かる
const LADDER = [523.25, 659.25, 783.99, 1046.5, 1318.5];

export const sfx = {
  tap(): void {
    tone(440, 0.06, { wave: 'square', vol: 0.18 });
  },
  jump(): void {
    tone(320, 0.16, { wave: 'sine', vol: 0.35, to: 720 });
  },
  correct(combo: number): void {
    const base = LADDER[Math.min(combo, LADDER.length - 1)];
    tone(base, 0.1, { wave: 'triangle', vol: 0.4 });
    tone(base * 1.5, 0.14, { at: 0.07, wave: 'triangle', vol: 0.3 });
  },
  coin(): void {
    tone(988, 0.05, { wave: 'square', vol: 0.22 });
    tone(1319, 0.11, { at: 0.05, wave: 'square', vol: 0.2 });
  },
  wrong(): void {
    tone(196, 0.16, { wave: 'sawtooth', vol: 0.22, to: 150 });
  },
  stumble(): void {
    noise(0.22, 0.22);
    tone(150, 0.24, { wave: 'square', vol: 0.2, to: 90 });
  },
  star(i: number): void {
    tone(660 + i * 220, 0.16, { wave: 'triangle', vol: 0.34 });
  },
  clear(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(f, 0.22, { at: i * 0.09, wave: 'triangle', vol: 0.34 });
    });
  },
  /** 8連続の「ちょうぜつダッシュ」 */
  fanfare(): void {
    [784, 988, 1175, 1568].forEach((f, i) => {
      tone(f, 0.16, { at: i * 0.06, wave: 'square', vol: 0.26 });
    });
  },
  /** 最後の1問が出た合図。持続音（startDrone）の入り口になる低い一撃 */
  final(): void {
    tone(146.83, 0.6, { wave: 'square', vol: 0.26, to: 98 });
    tone(73.42, 0.7, { wave: 'triangle', vol: 0.18 });
    noise(0.3, 0.14);
  },

  /** まちがえた式のやりなおし（リベンジ）が始まる */
  revenge(): void {
    [392, 523.25, 659.25].forEach((f, i) => {
      tone(f, 0.2, { at: i * 0.1, wave: 'triangle', vol: 0.32 });
    });
  },

  /** にがてな式を、初回で正解して倒した */
  beat(): void {
    tone(659.25, 0.12, { wave: 'square', vol: 0.26 });
    tone(987.77, 0.18, { at: 0.08, wave: 'triangle', vol: 0.3 });
    noise(0.12, 0.16);
  },

  /** でんせつのペットが出た。ここだけ長めに鳴らす */
  legend(): void {
    noise(0.2, 0.2);
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => {
      tone(f, 0.3, { at: 0.1 + i * 0.09, wave: 'triangle', vol: 0.36 });
      tone(f * 2, 0.24, { at: 0.1 + i * 0.09, wave: 'sine', vol: 0.16 });
    });
  },
  /** ペットが助けてくれた（せなかにのる） */
  rescue(): void {
    tone(392, 0.24, { wave: 'sine', vol: 0.34, to: 1046 });
    [880, 1174.7, 1568].forEach((f, i) => {
      tone(f, 0.18, { at: 0.1 + i * 0.07, wave: 'triangle', vol: 0.3 });
    });
  },
  /** ガチャのたまごが割れる */
  crack(): void {
    noise(0.14, 0.26);
    [659.25, 880, 1174.7].forEach((f, i) => {
      tone(f, 0.2, { at: 0.08 + i * 0.08, wave: 'triangle', vol: 0.34 });
    });
  },

  /**
   * なかまの鳴き声。さわったときに返す。
   * ペットは 30ぴき いるので、1ぴきずつ音を作らず「からだの形」で分ける。
   */
  voice(kind: 'bird' | 'bug' | 'beast' | 'blob' | 'ghost' | 'small'): void {
    switch (kind) {
      case 'bird':
        tone(1400, 0.06, { wave: 'sine', vol: 0.22, to: 2000 });
        tone(1800, 0.07, { at: 0.08, wave: 'sine', vol: 0.2, to: 1300 });
        break;
      case 'bug':
        tone(320, 0.16, { wave: 'sawtooth', vol: 0.14 });
        tone(330, 0.16, { at: 0.05, wave: 'sawtooth', vol: 0.12 });
        break;
      case 'beast':
        tone(160, 0.26, { wave: 'sawtooth', vol: 0.24, to: 110 });
        break;
      case 'blob':
        tone(240, 0.18, { wave: 'sine', vol: 0.3, to: 660 });
        break;
      case 'ghost':
        tone(520, 0.34, { wave: 'sine', vol: 0.18, to: 300 });
        break;
      default:
        tone(880, 0.07, { wave: 'triangle', vol: 0.24, to: 1200 });
        tone(1100, 0.08, { at: 0.08, wave: 'triangle', vol: 0.2, to: 800 });
    }
  },

  /** ボスの遠距離攻撃が放たれる */
  shoot(kind: 'rock' | 'beam' | 'fire'): void {
    if (kind === 'beam') {
      tone(1400, 0.22, { wave: 'sawtooth', vol: 0.2, to: 520 });
    } else if (kind === 'fire') {
      noise(0.3, 0.18);
      tone(220, 0.26, { wave: 'sawtooth', vol: 0.16, to: 140 });
    } else {
      noise(0.16, 0.2);
      tone(160, 0.2, { wave: 'square', vol: 0.2, to: 110 });
    }
  },

  /** 攻撃をよけた瞬間 */
  dodge(): void {
    noise(0.1, 0.14);
    tone(880, 0.1, { wave: 'sine', vol: 0.26, to: 1760 });
  },

  /** ボスのうなり声。突撃の合図にも使う */
  roar(): void {
    tone(120, 0.5, { wave: 'sawtooth', vol: 0.3, to: 70 });
    tone(180, 0.45, { at: 0.05, wave: 'square', vol: 0.16, to: 90 });
    noise(0.45, 0.16);
  },

  /**
   * にがて たいじ。ビームを ためているあいだの のぼっていく音。
   * 「いま ためている」が耳で分かると、撃った瞬間が気持ちよくなる。
   */
  charge(): void {
    tone(220, 0.3, { wave: 'sine', vol: 0.22, to: 1040 });
    tone(330, 0.26, { at: 0.04, wave: 'triangle', vol: 0.12, to: 1560 });
  },

  /**
   * さいごの1問の フィニッシュ。ぶきを ためているあいだ。
   *
   * charge() は にがて たいじ 用で 0.3 秒で終わる。フィニッシュの ため
   * （FIN_CHARGE）はそれより長いので、音が先に切れて「もう終わったのか」に
   * なってしまう。最後まで のぼりつづける音を別に持つ。
   */
  finishCharge(): void {
    tone(175, 0.8, { wave: 'sine', vol: 0.2, to: 990 });
    tone(262, 0.72, { at: 0.06, wave: 'triangle', vol: 0.11, to: 1480 });
    // ためきったところの ひと呼吸（放つ直前）
    tone(1568, 0.1, { at: 0.76, wave: 'triangle', vol: 0.16 });
  },

  /** ためきって 放つ瞬間 */
  finishFire(): void {
    noise(0.16, 0.2);
    tone(932, 0.14, { wave: 'sawtooth', vol: 0.2, to: 233 });
  },

  /** にがて たいじ。ビームが当たって にがてが はじけとぶ */
  blast(): void {
    tone(1568, 0.18, { wave: 'sawtooth', vol: 0.26, to: 392 });
    noise(0.34, 0.32);
    [523.25, 784, 1046.5, 1568].forEach((f, i) => {
      tone(f, 0.24, { at: 0.08 + i * 0.05, wave: 'triangle', vol: 0.3 });
    });
  },

  /** ボスを踏みつける */
  stomp(): void {
    noise(0.32, 0.34);
    tone(90, 0.34, { wave: 'square', vol: 0.32, to: 55 });
    tone(523.25, 0.18, { at: 0.14, wave: 'triangle', vol: 0.3 });
  },

  /** ボスにやられた */
  gameover(): void {
    [392, 330, 262, 196].forEach((f, i) => {
      tone(f, 0.3, { at: i * 0.16, wave: 'triangle', vol: 0.3 });
    });
    noise(0.3, 0.2);
  },
};
