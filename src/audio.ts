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
};
