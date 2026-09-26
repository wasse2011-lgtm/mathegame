/**
 * ステージの縮小マップ。リザルトの左に縦に置く。
 *
 * 10問で1ステージが終わると画面がリザルトに切りかわるので、
 * 「さっきまでどこを走っていたのか」「つぎはどこか」が見えなくなる。
 * マップの「みち」と同じ並び（上から順・ボスは👑・★がつくと色が変わる）にして、
 * ふたつの画面で同じ絵を指させるようにする。
 *
 * うらマップ（ハード・ベリーハード）も、みちの地図と同じ向きにする。
 * ハードは 下から上へ進む（ボスが上）ので、ここでも 1 を下、👑 を上に置く。
 */

import { bossStage, isBoss, tierDef, worldById, type Tier } from './curriculum';
import { stageStars } from './save';

/**
 * @param host  中身を差し替える入れ物
 * @param worldId 見せるワールド
 * @param here  「いま」の印をつけるステージ番号
 * @param tier  むずかしさ（0 ふつう・1 ハード・2 ベリーハード）
 */
export function renderMiniMap(host: HTMLElement, worldId: number, here: number, tier: Tier = 0): void {
  const w = worldById(worldId);
  const def = tierDef(tier);
  host.replaceChildren();
  host.style.setProperty('--wc', w.color);
  host.style.setProperty('--tc', def.color);
  host.classList.toggle('tier1', tier === 1);
  host.classList.toggle('tier2', tier === 2);

  const head = document.createElement('span');
  head.className = 'mini-head';
  head.textContent = `${def.icon || w.emoji}${w.id}`;
  host.appendChild(head);

  const cells: HTMLElement[] = [];
  for (let stage = 1; stage <= bossStage(w); stage++) {
    const boss = isBoss(w, stage);
    const got = stageStars(w.id, stage, tier);
    const cell = document.createElement('span');
    cell.className = 'mini-cell';
    if (boss) cell.classList.add('boss');
    if (got > 0) cell.classList.add('done');
    if (stage === here) cell.classList.add('now');
    cell.textContent = boss ? '👑' : String(stage);
    cells.push(cell);
  }
  host.append(...(tier === 1 ? cells.reverse() : cells));
}
