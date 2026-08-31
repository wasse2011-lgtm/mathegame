/**
 * 効果音。音声ファイルは持たず、Web Audio で合成する（オフラインでも確実に鳴る）。
 *
 * iOS の落とし穴:
 *  1. AudioContext は最初のユーザー操作の中でしか resume できない
 *  2. 消音スイッチが ON だと既定では鳴らない → Safari 16.4+ の audioSession を playback にする
 */

import { save } from './save';

interface AudioSessionLike { type: string }

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    void ctx.resume();

    // 消音スイッチが入っていても鳴らす（未対応ブラウザでは何も起きない）
    const session = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    ctx = null;
  }
}

type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

function tone(freq: number, dur: number, opts: { at?: number; wave?: Wave; vol?: number; to?: number } = {}): void {
  if (!ctx || !master || !save.settings.sound) return;
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
  if (!ctx || !master || !save.settings.sound) return;
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
  if (!ctx || !master || !save.settings.sound || drone) return;
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
