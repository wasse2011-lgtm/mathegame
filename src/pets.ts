/**
 * ペット（つれて歩く なかま）。
 *
 * ・コインでたまごを買って増やす。コインのいちばん大きな使いみち。
 * ・レア度の高い子は「やさしくなる」方向にだけ効く。むずかしくはしない。
 *     - おそくする: 障害物が来るまでの時間が少しのびる
 *     - せなかにのる: 時間切れのとき 1ステージに1回だけ助けてくれる
 *   どちらも「まちがい」の記録そのものは変えない。★も図鑑も、ちゃんと
 *   正解したぶんだけしか進まない（引きの良し悪しで学習の記録が甘くならない）。
 */

import { persist, profile } from './save';

export type Rarity = 'n' | 'r' | 'sr' | 'ur';

export interface RarityDef {
  id: Rarity;
  label: string;
  /** 枠やラベルの色 */
  color: string;
  /** 背景の淡い色 */
  soft: string;
  /** 障害物が来るまでの時間を何割のばすか */
  slow: number;
  /** 1ステージに何回 助けてもらえるか */
  rescue: number;
}

export const RARITIES: RarityDef[] = [
  { id: 'n', label: 'ふつう', color: '#8aa0b0', soft: '#eef3f6', slow: 0, rescue: 0 },
  { id: 'r', label: 'レア', color: '#4aa3dd', soft: '#e8f4fd', slow: 0.08, rescue: 0 },
  { id: 'sr', label: 'スーパーレア', color: '#a86ad0', soft: '#f4ecfb', slow: 0.14, rescue: 0 },
  { id: 'ur', label: 'でんせつ', color: '#e8912a', soft: '#fff3df', slow: 0.2, rescue: 1 },
];

export function rarityDef(r: Rarity): RarityDef {
  return RARITIES.find((x) => x.id === r) ?? RARITIES[0];
}

/** 絵の作り。画像は持たず、この指定から Canvas で描く（petart.ts） */
export interface PetArt {
  body: string;
  shade: string;
  shape: 'blob' | 'round' | 'egg' | 'bug' | 'worm' | 'bird' | 'ghost' | 'jelly' | 'snail' | 'beast';
  ear?: 'cat' | 'round' | 'floppy' | 'antenna' | 'horn' | 'crest' | 'mane';
  wing?: 'bug' | 'butterfly' | 'bird' | 'big' | 'fire';
  tail?: 'short' | 'long' | 'fluffy' | 'fire' | 'glow';
  beak?: 'small' | 'duck';
  /** 水玉・しま模様の色 */
  spots?: string;
  /** おなかの白い部分 */
  belly?: boolean;
  spike?: boolean;
  horn?: boolean;
  pincer?: boolean;
  legs?: number;
  /** 走るとき浮いてついてくる */
  fly?: boolean;
  face?: 'dot' | 'big' | 'sleepy';
  /** かたつむりの殻 */
  shell?: string;
}

export interface PetDef {
  id: string;
  name: string;
  rarity: Rarity;
  /** 牧場でタップしたときの一言 */
  note: string;
  art: PetArt;
}

/**
 * 30 ぴき。ふつう 12・レア 9・スーパーレア 5・でんせつ 4。
 * 数を増やすときは、レア度ごとの比率を大きく崩さないこと
 * （でんせつが増えるほど、ふつうのたまごの当たりが薄まる）。
 */
export const PETS: PetDef[] = [
  // ---- ふつう (12) ----
  {
    id: 'hiyoko', name: 'ひよこ', rarity: 'n', note: 'たまごから いちばん よく でてくる',
    art: { shape: 'bird', body: '#ffd94a', shade: '#e8b81f', beak: 'small', face: 'dot' },
  },
  {
    id: 'niwatori', name: 'にわとり', rarity: 'n', note: 'あさ いちばんに おこしてくれる',
    art: { shape: 'bird', body: '#f7f4ee', shade: '#d9d2c6', beak: 'small', ear: 'crest', face: 'dot' },
  },
  {
    id: 'aomushi', name: 'あおむし', rarity: 'n', note: 'いつか ちょうちょに なるらしい',
    art: { shape: 'worm', body: '#8dc75a', shade: '#6ba53c', ear: 'antenna', face: 'dot' },
  },
  {
    id: 'tentou', name: 'てんとうむし', rarity: 'n', note: 'あかい せなかに くろい まる',
    art: { shape: 'bug', body: '#e4675c', shade: '#b94439', spots: '#2b3440', wing: 'bug', legs: 6, face: 'dot' },
  },
  {
    id: 'kaeru', name: 'かえる', rarity: 'n', note: 'ぴょんぴょん ついてくる',
    art: { shape: 'round', body: '#6fc46f', shade: '#4a9c4a', belly: true, legs: 4, face: 'big' },
  },
  {
    id: 'slime', name: 'スライム', rarity: 'n', note: 'ぷるぷる。さわると つめたい',
    art: { shape: 'blob', body: '#6fd0e0', shade: '#3fa8bd', face: 'dot' },
  },
  {
    id: 'katatsumuri', name: 'かたつむり', rarity: 'n', note: 'ゆっくりだけど まいにち くる',
    art: { shape: 'snail', body: '#e6d9c2', shade: '#c2b096', shell: '#c98f4e', ear: 'antenna', face: 'dot' },
  },
  {
    id: 'dangomushi', name: 'だんごむし', rarity: 'n', note: 'びっくりすると まるくなる',
    art: { shape: 'bug', body: '#8b93a0', shade: '#5f6873', legs: 6, face: 'dot' },
  },
  {
    id: 'otama', name: 'おたまじゃくし', rarity: 'n', note: 'そのうち かえるに なる…かも',
    art: { shape: 'round', body: '#4f5b68', shade: '#333c46', tail: 'long', face: 'dot' },
  },
  {
    id: 'ari', name: 'あり', rarity: 'n', note: 'じぶんより おおきい コインを はこぶ',
    art: { shape: 'bug', body: '#3d3a44', shade: '#26232c', ear: 'antenna', legs: 6, face: 'dot' },
  },
  {
    id: 'chocho', name: 'ちょうちょ', rarity: 'n', note: 'ひらひら とんで ついてくる',
    art: { shape: 'bug', body: '#7b6a90', shade: '#5b4d6d', wing: 'butterfly', ear: 'antenna', fly: true, face: 'dot' },
  },
  {
    id: 'kobato', name: 'こばと', rarity: 'n', note: 'こまかい パンくずが すき',
    art: { shape: 'bird', body: '#cfd8e0', shade: '#a5b2bd', beak: 'small', wing: 'bird', fly: true, face: 'dot' },
  },

  // ---- レア (9) ----
  {
    id: 'kabuto', name: 'カブトムシ', rarity: 'r', note: 'りっぱな つのが じまん',
    art: { shape: 'bug', body: '#6b4a2f', shade: '#452e1c', horn: true, wing: 'bug', legs: 6, face: 'dot' },
  },
  {
    id: 'kuwagata', name: 'クワガタ', rarity: 'r', note: 'はさむ ちからは いちばん',
    art: { shape: 'bug', body: '#3a3038', shade: '#231c22', pincer: true, wing: 'bug', legs: 6, face: 'dot' },
  },
  {
    id: 'nezumi', name: 'こねずみ', rarity: 'r', note: 'ポケットに かくれるのが すき',
    art: { shape: 'round', body: '#b8bcc4', shade: '#8d929b', ear: 'round', tail: 'long', face: 'dot' },
  },
  {
    id: 'harinezumi', name: 'はりねずみ', rarity: 'r', note: 'せなかは ちくちく、おなかは ふわふわ',
    art: { shape: 'round', body: '#d8c3a5', shade: '#8a6f52', spike: true, ear: 'round', face: 'dot' },
  },
  {
    id: 'kobuta', name: 'こぶた', rarity: 'r', note: 'はなが ぴくぴく うごく',
    art: { shape: 'round', body: '#f4b4bd', shade: '#dd8e9a', ear: 'floppy', tail: 'short', face: 'dot' },
  },
  {
    id: 'ahiru', name: 'あひる', rarity: 'r', note: 'みずたまりを みつける てんさい',
    art: { shape: 'bird', body: '#fbf6e4', shade: '#ded6bd', beak: 'duck', face: 'dot' },
  },
  {
    id: 'tokage', name: 'とかげ', rarity: 'r', note: 'しっぽが きらきら ひかる',
    art: { shape: 'beast', body: '#5fc08a', shade: '#3d9668', tail: 'long', legs: 4, ear: 'crest', face: 'dot' },
  },
  {
    id: 'kurage', name: 'くらげ', rarity: 'r', note: 'ふわふわ うかんで ついてくる',
    art: { shape: 'jelly', body: '#c9b8f0', shade: '#9d86d6', fly: true, face: 'dot' },
  },
  {
    id: 'hotaru', name: 'ほたる', rarity: 'r', note: 'くらい ところで おしりが ひかる',
    art: { shape: 'bug', body: '#4a5a3c', shade: '#31402a', tail: 'glow', ear: 'antenna', wing: 'bug', fly: true, face: 'dot' },
  },

  // ---- スーパーレア (5) ----
  {
    id: 'kogitsune', name: 'こぎつね', rarity: 'sr', note: 'しっぽで かぜを おこす',
    art: { shape: 'round', body: '#f0954a', shade: '#d1732c', ear: 'cat', tail: 'fluffy', belly: true, face: 'dot' },
  },
  {
    id: 'fukurou', name: 'ふくろう', rarity: 'sr', note: 'よるじゅう ずかんを よんでいる',
    art: { shape: 'bird', body: '#a58463', shade: '#7a5f45', beak: 'small', wing: 'bird', ear: 'cat', fly: true, face: 'big' },
  },
  {
    id: 'korisu', name: 'こりす', rarity: 'sr', note: 'ほっぺに どんぐりを ためこむ',
    art: { shape: 'round', body: '#c98f56', shade: '#a06c3c', ear: 'round', tail: 'fluffy', belly: true, face: 'dot' },
  },
  {
    id: 'saboten', name: 'サボテンくん', rarity: 'sr', note: 'みずを あげなくても げんき',
    art: { shape: 'blob', body: '#5fa85f', shade: '#3f7f3f', spike: true, ear: 'horn', face: 'dot' },
  },
  {
    id: 'obake', name: 'おばけ', rarity: 'sr', note: 'こわくない。さみしがりや',
    art: { shape: 'ghost', body: '#f2f4f8', shade: '#d3d9e2', fly: true, face: 'big' },
  },

  // ---- でんせつ (4) ----
  {
    id: 'dragon', name: 'ドラゴン', rarity: 'ur', note: 'そらを とび、せなかに のせてくれる',
    art: { shape: 'beast', body: '#4fb3a3', shade: '#2f8a7c', wing: 'big', horn: true, tail: 'long', ear: 'crest', legs: 4, fly: true, belly: true, face: 'dot' },
  },
  {
    id: 'pegasus', name: 'ペガサス', rarity: 'ur', note: 'しろい つばさで かぜを きる',
    art: { shape: 'beast', body: '#f7f6f2', shade: '#ccd4de', wing: 'bird', ear: 'mane', tail: 'fluffy', legs: 4, fly: true, face: 'dot' },
  },
  {
    id: 'unicorn', name: 'ユニコーン', rarity: 'ur', note: 'つのが にじいろに ひかる',
    art: { shape: 'beast', body: '#fdf1f6', shade: '#e2b9d6', ear: 'mane', horn: true, tail: 'fluffy', legs: 4, fly: true, face: 'dot' },
  },
  {
    id: 'phoenix', name: 'フェニックス', rarity: 'ur', note: 'ほのおの はねを ひろげて とぶ',
    art: { shape: 'bird', body: '#f5893c', shade: '#d5591f', wing: 'fire', tail: 'fire', beak: 'small', ear: 'crest', fly: true, face: 'dot' },
  },
];

export const PET_COUNT = PETS.length;

export function petById(id: string): PetDef | null {
  return PETS.find((p) => p.id === id) ?? null;
}

/** 手に入れた数。0 はまだ仲間になっていない */
export function petCount(id: string): number {
  return profile().pets[id] ?? 0;
}

export function hasPet(id: string): boolean {
  return petCount(id) > 0;
}

/** なかよし度 1〜5。おなじ子が出るたびに 1 あがる */
export const MAX_FRIEND = 5;

export function friendLevel(id: string): number {
  return Math.min(petCount(id), MAX_FRIEND);
}

export function ownedPets(): PetDef[] {
  return PETS.filter((p) => hasPet(p.id));
}

export function ownedCountByRarity(r: Rarity): { owned: number; total: number } {
  const list = PETS.filter((p) => p.rarity === r);
  return { owned: list.filter((p) => hasPet(p.id)).length, total: list.length };
}

export interface PetPower {
  /** 障害物が来るまでの時間を何割のばすか */
  slow: number;
  /** 1ステージに何回 助けてくれるか */
  rescue: number;
}

export const NO_POWER: PetPower = { slow: 0, rescue: 0 };

/** いま つれている子の力。なかよし度 1 あがるごとに +2%（最大 +8%） */
export function powerOf(pet: PetDef | null): PetPower {
  if (!pet) return NO_POWER;
  const r = rarityDef(pet.rarity);
  const bonus = (friendLevel(pet.id) - 1) * 0.02;
  return { slow: r.slow > 0 ? r.slow + bonus : 0, rescue: r.rescue };
}

/** つれて歩いている子（いなければ null） */
export function activePet(): PetDef | null {
  const id = profile().pet;
  if (!id) return null;
  const def = petById(id);
  return def && hasPet(def.id) ? def : null;
}

export function petPower(): PetPower {
  return powerOf(activePet());
}

export function setActivePet(id: string): void {
  const p = profile();
  p.pet = p.pet === id ? '' : id;
  persist();
}

// ---------------------------------------------------------------- ガチャ

/** たまごの値段。コインは1ステージで 30〜100枚うごくので、その 1〜3回ぶん */
export const PET_EGG_COST = 120;
export const PET_EGG_SHINY_COST = 360;
/** おなじ子が出たときに もどってくるコイン */
export const DUP_REFUND = 24;

/** レア度の出かた。合計 1 になるように書く */
const NORMAL_ODDS: Record<Rarity, number> = { n: 0.66, r: 0.26, sr: 0.07, ur: 0.01 };
const SHINY_ODDS: Record<Rarity, number> = { n: 0.25, r: 0.4, sr: 0.27, ur: 0.08 };

export function eggOdds(shiny: boolean): Record<Rarity, number> {
  return shiny ? SHINY_ODDS : NORMAL_ODDS;
}

function rollRarity(shiny: boolean): Rarity {
  const odds = eggOdds(shiny);
  let r = Math.random();
  for (const def of RARITIES) {
    r -= odds[def.id];
    if (r <= 0) return def.id;
  }
  return 'n';
}

export interface PetRoll {
  pet: PetDef;
  /** すでに持っていた子か */
  dup: boolean;
  /** 出たあとの なかよし度 */
  friend: number;
  /** かえってきたコイン */
  refund: number;
  shiny: boolean;
  /** そのまま つれて歩くことになったか */
  equipped: boolean;
}

/**
 * たまごを割る。コインが足りなければ null。
 *
 * 引いたレア度の中に まだ持っていない子がいれば、必ずその中から出す。
 * （毎回まったくの一様だと、30ぴきの後半でほとんど重複になり、
 *   コインを入れても図鑑が進まなくなる）
 * 全部そろっているレア度を引いたときは重複になり、なかよし度が上がる。
 */
export function rollPetEgg(shiny: boolean): PetRoll | null {
  const p = profile();
  const cost = shiny ? PET_EGG_SHINY_COST : PET_EGG_COST;
  if (p.coins < cost) return null;

  const rarity = rollRarity(shiny);
  const inRarity = PETS.filter((x) => x.rarity === rarity);
  const fresh = inRarity.filter((x) => !hasPet(x.id));
  const pool = fresh.length ? fresh : inRarity;
  const pet = pool[Math.floor(Math.random() * pool.length)];

  const dup = hasPet(pet.id);
  p.coins -= cost;
  p.pets[pet.id] = (p.pets[pet.id] ?? 0) + 1;
  const refund = dup ? DUP_REFUND : 0;
  p.coins += refund;

  // はじめての子は、そのまま つれて歩く（子どもは必ず「いま すぐ 見たい」）。
  // ただしレア度が下がる乗りかえはしない。ドラゴンを連れているのに
  // あり を引いた瞬間、気づかないまま「助けてくれる力」が消えてしまう。
  const rank = (r: Rarity) => RARITIES.findIndex((x) => x.id === r);
  const cur = activePet();
  const equipped = !dup && (!cur || rank(pet.rarity) >= rank(cur.rarity));
  if (equipped) p.pet = pet.id;

  persist();
  return { pet, dup, friend: friendLevel(pet.id), refund, shiny, equipped };
}
