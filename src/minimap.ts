/**
 * ステージの縮小マップ。リザルトの左に縦に置く。
 *
 * 10問で1ステージが終わると画面がリザルトに切りかわるので、
 * 「さっきまでどこを走っていたのか」「つぎはどこか」が見えなくなる。
 * マップの「みち」と同じ並び（上から順・ボスは👑・★がつくと色が変わる）にして、
 * ふたつの画面で同じ絵を指させるようにする。
 */

import { bossStage, isBoss, worldById } from './curriculum';
import { stageStars } from './save';

/**
 * @param host  中身を差し替える入れ物
 * @param worldId 見せるワールド
 * @param here  「いま」の印をつけるステージ番号
 */
export function renderMiniMap(host: HTMLElement, worldId: number, here: number): void {
  const w = worldById(worldId);
  host.replaceChildren();
  host.style.setProperty('--wc', w.color);

  const head = document.createElement('span');
  head.className = 'mini-head';
  head.textContent = `${w.emoji}${w.id}`;
  host.appendChild(head);

  for (let stage = 1; stage <= bossStage(w); stage++) {
    const boss = isBoss(w, stage);
    const got = stageStars(w.id, stage);
    const cell = document.createElement('span');
    cell.className = 'mini-cell';
    if (boss) cell.classList.add('boss');
    if (got > 0) cell.classList.add('done');
    if (stage === here) cell.classList.add('now');
    cell.textContent = boss ? '👑' : String(stage);
    host.appendChild(cell);
  }
}
