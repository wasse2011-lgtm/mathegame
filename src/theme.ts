/**
 * ステージごとの景色。
 *
 * 「ずっと同じ野原を走っている」と、子どもは 3ステージで飽きる。
 * かといってワールドごとに 1枚ずつ絵を用意すると 8種類しか作れない。
 *
 * そこで景色を 2軸に分ける:
 *   ・ワールド（8種）… 地面・丘・木や建物・天気・出る障害物
 *   ・時間帯（5種）  … 空の色・太陽／月・星・全体にかける色
 * かけ合わせると 40通りになるので、隣のステージと同じ絵にはならない。
 * 時間帯はステージ番号から決まるので、同じステージはいつ遊んでも同じ景色になる
 * （きのうと違う、が起きると「あのステージ」として覚えられない）。
 */

/**
 * 障害物の種類。ワールドごとに出るものが変わる。
 * 'weak'（にがて）だけは景色に属さず、まちがえた回数の多い式のときに割りこむ。
 */
export type ObstacleKind =
  | 'rock' | 'bush' | 'slime' | 'log' | 'bird' | 'mushroom'
  | 'ghost' | 'cone' | 'box' | 'snowman' | 'crystal' | 'crab' | 'boss' | 'weak';

/** 地面に生えているもの（遠景） */
export type DecoKind = 'tree' | 'flower' | 'mushroom' | 'building' | 'pine' | 'palm' | 'rock' | 'cloud';

/** 画面を流れる粒 */
export type WeatherKind = 'none' | 'petal' | 'leaf' | 'snow' | 'bubble' | 'star' | 'firefly' | 'rain';

export type TimeId = 'day' | 'sunset' | 'night' | 'dawn' | 'boss';

/** ワールドの土地。空の色は時間帯のほうが決める */
interface Land {
  hillFar: string;
  hillNear: string;
  grass: string;
  grassEdge: string;
  dirt: string;
  deco: DecoKind;
  decoA: string;
  decoB: string;
  weather: WeatherKind;
  obstacles: ObstacleKind[];
}

interface TimeDef {
  label: string;
  sky: [string, string];
  /** 地面と丘に混ぜる色。夜ほど強く混ざる */
  tint: string;
  tintK: number;
  sun: 'sun' | 'moon' | 'none';
  sunColor: string;
  stars: boolean;
  cloud: string;
  /** 空が暗いか。式やコイン数を白抜きに切りかえるために使う */
  dark: boolean;
}

/** 解決済みの景色。runner と scenery はこれだけを見る */
export interface Theme {
  timeId: TimeId;
  timeLabel: string;
  sky: [string, string];
  sun: 'sun' | 'moon' | 'none';
  sunColor: string;
  stars: boolean;
  cloud: string;
  dark: boolean;
  hillFar: string;
  hillNear: string;
  grass: string;
  grassEdge: string;
  dirt: string;
  deco: DecoKind;
  decoA: string;
  decoB: string;
  weather: WeatherKind;
  obstacles: ObstacleKind[];
}

const LANDS: Record<number, Land> = {
  1: {
    hillFar: '#cdeec4', hillNear: '#9ad78a', grass: '#7ec96f', grassEdge: '#5da84f', dirt: '#c99a68',
    deco: 'tree', decoA: '#5fa552', decoB: '#8b5e3c', weather: 'petal',
    obstacles: ['rock', 'bush', 'slime'],
  },
  2: {
    hillFar: '#d8f0cf', hillNear: '#a9de95', grass: '#8ed277', grassEdge: '#66b055', dirt: '#d0a675',
    deco: 'flower', decoA: '#ff8fb1', decoB: '#5fa552', weather: 'leaf',
    obstacles: ['slime', 'log', 'bird', 'bush'],
  },
  3: {
    hillFar: '#d5cef0', hillNear: '#a99ede', grass: '#86c98a', grassEdge: '#5aa563', dirt: '#a98cc0',
    deco: 'mushroom', decoA: '#e46a7b', decoB: '#f4e6d2', weather: 'firefly',
    obstacles: ['mushroom', 'ghost', 'rock', 'slime'],
  },
  4: {
    hillFar: '#dfe6ec', hillNear: '#b9c6d2', grass: '#9aa7b2', grassEdge: '#7b8894', dirt: '#8d99a4',
    deco: 'building', decoA: '#e3ded5', decoB: '#6f7d8a', weather: 'none',
    obstacles: ['cone', 'box', 'bird', 'rock'],
  },
  5: {
    hillFar: '#eef6ff', hillNear: '#cfe2f2', grass: '#f2f7fb', grassEdge: '#cfe0ee', dirt: '#a9bccd',
    deco: 'pine', decoA: '#3f7a5a', decoB: '#f2f7fb', weather: 'snow',
    obstacles: ['snowman', 'rock', 'crystal', 'slime'],
  },
  6: {
    hillFar: '#cfeef4', hillNear: '#8fd7dd', grass: '#f2dfae', grassEdge: '#dcc286', dirt: '#e8cf9c',
    deco: 'palm', decoA: '#4fa87a', decoB: '#a9744a', weather: 'bubble',
    obstacles: ['crab', 'rock', 'log', 'bird'],
  },
  7: {
    hillFar: '#9fb0bd', hillNear: '#6f8494', grass: '#5f7f6a', grassEdge: '#48624f', dirt: '#5c5a58',
    deco: 'rock', decoA: '#57646e', decoB: '#3f4a53', weather: 'rain',
    obstacles: ['ghost', 'rock', 'crab', 'box'],
  },
  8: {
    hillFar: '#ffffff', hillNear: '#e4eeff', grass: '#f6faff', grassEdge: '#cfdcf2', dirt: '#c6d5ee',
    deco: 'cloud', decoA: '#ffffff', decoB: '#dbe7fb', weather: 'star',
    obstacles: ['crystal', 'bird', 'ghost', 'slime'],
  },
};

const TIMES: Record<TimeId, TimeDef> = {
  day: {
    label: 'ひるま',
    sky: ['#a9dff6', '#e2f4fd'], tint: '#ffffff', tintK: 0,
    sun: 'sun', sunColor: '#fff3b0', stars: false, cloud: 'rgba(255,255,255,.8)', dark: false,
  },
  dawn: {
    label: 'あさ',
    sky: ['#ffd7e4', '#e3f2ff'], tint: '#ffc7d8', tintK: 0.13,
    sun: 'sun', sunColor: '#ffe8a8', stars: false, cloud: 'rgba(255,255,255,.88)', dark: false,
  },
  sunset: {
    label: 'ゆうがた',
    sky: ['#ff9c62', '#ffdca6'], tint: '#ff7f3c', tintK: 0.24,
    sun: 'sun', sunColor: '#ffeeae', stars: false, cloud: 'rgba(255,214,180,.85)', dark: false,
  },
  night: {
    label: 'よる',
    sky: ['#1d2a55', '#54689b'], tint: '#1b2450', tintK: 0.44,
    sun: 'moon', sunColor: '#f4f0d8', stars: true, cloud: 'rgba(206,218,255,.32)', dark: true,
  },
  boss: {
    label: 'ボス',
    sky: ['#54245a', '#c85160'], tint: '#5f2340', tintK: 0.34,
    sun: 'none', sunColor: '#ffd0a0', stars: true, cloud: 'rgba(255,186,204,.34)', dark: true,
  },
};

/** ステージ番号から時間帯を決める。ボスだけは必ず特別な空にする */
const CYCLE: TimeId[] = ['day', 'dawn', 'sunset', 'night'];

export function timeIdFor(stage: number, boss: boolean): TimeId {
  if (boss) return 'boss';
  if (stage <= 0) return 'dawn'; // デイリー（きょうの 5もん）は朝の空
  return CYCLE[(stage - 1) % CYCLE.length];
}

/** #rrggbb を混ぜる。k=0 で a のまま、k=1 で b になる */
function mix(a: string, b: string, k: number): string {
  if (k <= 0) return a;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255;
    const vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * k);
  };
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(ch(16))}${hex(ch(8))}${hex(ch(0))}`;
}

export function themeFor(worldId: number, stage: number, boss: boolean): Theme {
  const land = LANDS[worldId] ?? LANDS[1];
  const timeId = timeIdFor(stage, boss);
  const time = TIMES[timeId];
  const t = (c: string) => mix(c, time.tint, time.tintK);

  return {
    timeId,
    timeLabel: time.label,
    sky: time.sky,
    sun: time.sun,
    sunColor: time.sunColor,
    stars: time.stars,
    cloud: time.cloud,
    dark: time.dark,
    hillFar: t(land.hillFar),
    hillNear: t(land.hillNear),
    grass: t(land.grass),
    grassEdge: t(land.grassEdge),
    dirt: t(land.dirt),
    deco: land.deco,
    decoA: t(land.decoA),
    decoB: t(land.decoB),
    weather: land.weather,
    obstacles: land.obstacles,
  };
}

/** プレイ画面（canvas の外側）に敷く背景。canvas の空とつながるようにする */
export function skyCss(theme: Theme): string {
  return `linear-gradient(180deg, ${theme.sky[0]}, ${theme.sky[1]})`;
}
