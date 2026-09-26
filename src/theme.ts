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

/** 'hunt'（にがて たいじ）はステージ番号からは決まらない。themeFor の引数で名ざしする */
export type TimeId = 'day' | 'sunset' | 'night' | 'dawn' | 'boss' | 'hunt';

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
  // にがて たいじ（HUNT_WORLD.id = 9）。どのワールドでもない、岩だらけの決闘場。
  // 走らない場所なので、地面は動かない前提の落ち着いた色にしてある。
  9: {
    hillFar: '#7c5f7a', hillNear: '#5a4460', grass: '#6b5566', grassEdge: '#4c3a4b', dirt: '#5a4550',
    deco: 'rock', decoA: '#4e3c4c', decoB: '#3a2c39', weather: 'firefly',
    obstacles: ['weak'],
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
  hunt: {
    label: 'にがて たいじ',
    sky: ['#2f2350', '#e2915f'], tint: '#43284a', tintK: 0.3,
    sun: 'none', sunColor: '#ffd0a0', stars: true, cloud: 'rgba(255,204,178,.3)', dark: true,
  },
};

/** ステージ番号から時間帯を決める。ボスだけは必ず特別な空にする */
const CYCLE: TimeId[] = ['day', 'dawn', 'sunset', 'night'];

export function timeIdFor(stage: number, boss: boolean): TimeId {
  if (boss) return 'boss';
  if (stage <= 0) return 'dawn'; // デイリー（きょうの もんだい）は朝の空
  return CYCLE[(stage - 1) % CYCLE.length];
}

/** #rrggbb を混ぜる。k=0 で a のまま、k=1 で b になる */
export function mix(a: string, b: string, k: number): string {
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

/** #rrggbb の明るさ（0〜1）。白抜きの字に切りかえるかを決めるのに使う */
function luma(c: string): number {
  const p = parseInt(c.slice(1), 16);
  return (0.2126 * ((p >> 16) & 255) + 0.7152 * ((p >> 8) & 255) + 0.0722 * (p & 255)) / 255;
}

/**
 * ハード・ベリーハード（うらマップ）の空と土地に かける色。
 *
 * 時間帯（朝・夜…）は ふつうと同じに残して、上から もう1枚 かける。
 * 同じステージは同じ時間帯のまま（「あのステージ」として覚えられる）で、
 * ひと目で「いつもより あぶない場所」に見えるようにする。
 *
 * ハードは 夕やけの赤。ベリーハードは 夜の むらさきで、空は必ず暗くなる（dark）。
 */
interface TierShade {
  sky: string;
  skyK: number;
  land: string;
  landK: number;
  dark: boolean;
}

const TIER_SHADES: Record<number, TierShade | undefined> = {
  1: { sky: '#c9503a', skyK: 0.38, land: '#6a2c24', landK: 0.2, dark: false },
  2: { sky: '#241036', skyK: 0.78, land: '#2a1238', landK: 0.36, dark: true },
};

/**
 * @param time 時間帯を名ざしで決める。ステージ番号を持たない走り
 *             （にがて たいじ）だけが使う。
 * @param tier むずかしさ（0 ふつう・1 ハード・2 ベリーハード）。空と土地に もう1枚 色をかける
 */
export function themeFor(worldId: number, stage: number, boss: boolean, time?: TimeId, tier = 0): Theme {
  const land = LANDS[worldId] ?? LANDS[1];
  const timeId = time ?? timeIdFor(stage, boss);
  const def = TIMES[timeId];
  const shade = TIER_SHADES[tier];
  const t = (c: string) => {
    const base = mix(c, def.tint, def.tintK);
    return shade ? mix(base, shade.land, shade.landK) : base;
  };
  const sky: [string, string] = shade
    ? [mix(def.sky[0], shade.sky, shade.skyK), mix(def.sky[1], shade.sky, shade.skyK * 0.8)]
    : def.sky;
  // 夕やけの赤を かけると、昼の空でも 白い字のほうが読める明るさになる
  // （式・コインの数字の白抜きは dark で切りかわる）
  const dark = def.dark || Boolean(shade && (shade.dark || luma(sky[0]) < 0.62));

  return {
    timeId,
    timeLabel: def.label,
    sky,
    sun: def.sun,
    sunColor: def.sunColor,
    // 暗い空には星を出す（ベリーハードの昼でも、空が夜の色になるので）
    stars: def.stars || Boolean(shade?.dark),
    cloud: def.cloud,
    dark,
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

/**
 * マップの「みち」の見た目。走る景色（LANDS）と同じ土地に見えるように、色と飾りをそろえる。
 *
 * LANDS の色をそのまま使わないのは、走る画面では遠景に回る色（地面と道）が、
 * マップでは主役の2色になるから。まちの灰色の地面に灰色の道、すなはまに すなの道では
 * 道が地面にとけて見えない。ここだけ、地面と道の明るさを はっきり分けてある。
 */
export interface MapLook {
  /** 地面（上 → 下のグラデーション） */
  land: [string, string];
  /** 地面の もよう（水玉）の色 */
  dot: string;
  road: string;
  roadEdge: string;
  /** まだ行っていない区間の点線。明るい道には濃い点、暗い道（まちの車道）には白い点 */
  dash: string;
  /** 道のわきに置く飾り。上から順に くりかえして使う */
  deco: string[];
}

const MAP_LOOKS: Record<number, MapLook> = {
  1: { land: ['#d4f1c2', '#9fd98a'], dot: 'rgba(255,255,255,.35)', road: '#efd4a4', roadEdge: '#c69a62', dash: '#c69a62', deco: ['🌳', '🌼', '🌷', '🐞', '🌿', '🌳', '🍀'] },
  2: { land: ['#dcf5d2', '#a8e19a'], dot: 'rgba(255,255,255,.38)', road: '#f5e0b4', roadEdge: '#cfa96b', dash: '#cfa96b', deco: ['🌸', '🦋', '🍃', '🌷', '🌿', '🌼', '🪁'] },
  3: { land: ['#e6dcfa', '#b8a6e8'], dot: 'rgba(255,255,255,.3)', road: '#f6e7cf', roadEdge: '#a987cf', dash: '#a987cf', deco: ['🍄', '✨', '🔮', '🍄', '🌙', '🚪', '🦉'] },
  4: { land: ['#e4ecf3', '#bfcddb'], dot: 'rgba(255,255,255,.4)', road: '#7f8c99', roadEdge: '#5b6773', dash: '#ffffff', deco: ['🏠', '🏢', '🚦', '🌳', '🚌', '🏪', '🚲'] },
  5: { land: ['#f7fbff', '#d5e5f4'], dot: 'rgba(170,200,230,.35)', road: '#d9c3a3', roadEdge: '#a88c68', dash: '#a88c68', deco: ['🌲', '⛄', '❄️', '🏔️', '🌲', '🦊', '❄️'] },
  6: { land: ['#fdf1cf', '#f0d79e'], dot: 'rgba(255,255,255,.45)', road: '#c89a66', roadEdge: '#9a6c3c', dash: '#fff4dc', deco: ['🌴', '🐚', '🦀', '🌊', '⛱️', '🐬', '⭐'] },
  7: { land: ['#b3c4cf', '#7f95a5'], dot: 'rgba(255,255,255,.18)', road: '#e2dccf', roadEdge: '#a49a88', dash: '#a49a88', deco: ['⚡', '🌧️', '🪨', '🌊', '🌀', '🏮', '🪨'] },
  8: { land: ['#eef4ff', '#c9dcff'], dot: 'rgba(255,255,255,.7)', road: '#ffffff', roadEdge: '#b5c9ee', dash: '#9fb6e6', deco: ['☁️', '⭐', '🌈', '🎈', '🕊️', '☁️', '🌟'] },
};

/**
 * うらマップ（ハード・ベリーハード）の地図の色と飾り。
 *
 * 地面は むずかしさごとの色（ハードは 夕やけの岩場、ベリーハードは 夜の火山）に、
 * もとの せかいの色を 少しだけ残して作る。もとの色に 赤や むらさきを かけるだけだと、
 * のはらの みどりが 泥の色になって「あぶなそう」より「よごれた」に見えた。
 * 道の形・飾り・マスの色は もとの せかいのまま なので、どの せかいの うらなのかは読める。
 * 飾りは もとの せかいのものを半分残し、あいだに 火・岩（ハード）、火山・かみなり・こうもり（ベリーハード）を まぜる。
 */
interface MapShade {
  /** 地面（上 → 下）。ここに もとの せかいの地面を keep だけ まぜる */
  land: [string, string];
  keep: number;
  road: string;
  roadK: number;
  deco: string[];
}

const MAP_SHADES: Record<number, MapShade | undefined> = {
  1: { land: ['#f6cda6', '#c86e48'], keep: 0.26, road: '#7a2e1c', roadK: 0.2, deco: ['🔥', '🪨', '🌵', '🔥'] },
  2: { land: ['#5c3474', '#2a1538'], keep: 0.16, road: '#281034', roadK: 0.42, deco: ['🌋', '⚡', '🔥', '🦇'] },
};

export function mapLook(worldId: number, tier = 0): MapLook {
  const base = MAP_LOOKS[worldId] ?? MAP_LOOKS[1];
  const sh = MAP_SHADES[tier];
  if (!sh) return base;
  const road = mix(base.road, sh.road, sh.roadK);
  const edge = mix(base.roadEdge, sh.road, sh.roadK);
  return {
    land: [mix(sh.land[0], base.land[0], sh.keep), mix(sh.land[1], base.land[1], sh.keep)],
    dot: tier >= 2 ? 'rgba(255,190,120,.16)' : 'rgba(255,220,190,.22)',
    road,
    roadEdge: edge,
    // 点線は 道の明るさで 決める（暗い道に濃い点を打つと見えない）
    dash: luma(road) < 0.55 ? 'rgba(255,255,255,.75)' : edge,
    // もとの飾りと 交互に並べる
    deco: base.deco.flatMap((d, i) => [d, sh.deco[i % sh.deco.length]]),
  };
}

/** プレイ画面（canvas の外側）に敷く背景。canvas の空とつながるようにする */
export function skyCss(theme: Theme): string {
  return `linear-gradient(180deg, ${theme.sky[0]}, ${theme.sky[1]})`;
}
