/**
 * ふたりで ボス の「でんどういり」の 額縁。8体 ぜんぶ倒したときの 演出（duo.ts）と、
 * えらぶ画面の「でんどう」の かざり棚（duo-menu.ts）の 両方で 同じ 額縁を使う。
 *
 * 額縁の色は 段階で かえる（ふつう＝どう、ハード＝ぎん、ベリーハード＝きん と ほのお）。
 * 2人の すがたは でんどういり したときの まま（あとで きせかえても かわらない）。
 */

import { tierDef, type Tier } from './curriculum';
import type { DuoFame, DuoFameKid } from './save';
import { paintSkinIcon, type Look } from './sprites';

export function fameLook(k: DuoFameKid): Look {
  return { skin: k.skin as Look['skin'], hat: k.hat, acc: k.acc, color: k.color, weapon: k.weapon };
}

/** 2026-10-25 → 2026/10/25 */
export function fameDate(day: string): string {
  return day.replace(/-/g, '/');
}

/**
 * 額縁を作る。big は 演出の 大きい額縁（ハンコは .stamped を付けたときに おす）、
 * そうでなければ かざり棚の 小さい額縁（ハンコは はじめから おしてある）
 */
export function buildFameFrame(f: DuoFame, big: boolean): HTMLElement {
  const tier = Math.min(2, Math.max(0, f.tier)) as Tier;
  const t = tierDef(tier);
  const el = document.createElement('div');
  el.className = `fame-frame t${tier}${big ? ' big' : ' mini stamped'}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `でんどういり ${t.name} ${f.kids[0].name}と ${f.kids[1].name} ${fameDate(f.day)}`);
  const title = document.createElement('p');
  title.className = 'fame-title';
  title.textContent = '🏆 でんどういり';
  const tierEl = document.createElement('p');
  tierEl.className = 'fame-tier';
  tierEl.textContent = `${t.icon}${t.name} ぜんぶ たおした`;
  tierEl.style.setProperty('--tier', t.color);
  const pair = document.createElement('div');
  pair.className = 'fame-pair';
  f.kids.forEach((k, i) => {
    const fig = document.createElement('figure');
    fig.className = 'fame-kid';
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    const cap = document.createElement('figcaption');
    cap.textContent = k.name;
    fig.append(c, cap);
    pair.appendChild(fig);
    paintSkinIcon(c, fameLook(k), big ? 112 : 52);
    if (i === 0) {
      const and = document.createElement('span');
      and.className = 'fame-and';
      and.setAttribute('aria-hidden', 'true');
      and.textContent = '＆';
      pair.appendChild(and);
    }
  });
  const meta = document.createElement('p');
  meta.className = 'fame-meta';
  meta.textContent = big
    ? `${fameDate(f.day)}　ふたりで ${f.correct}もん せいかい`
    : `${fameDate(f.day)}・${f.correct}もん`;
  const stamp = document.createElement('span');
  stamp.className = 'fame-stamp';
  stamp.setAttribute('aria-hidden', 'true');
  stamp.innerHTML = 'でんどう<br>いり';
  el.append(title, tierEl, pair, meta, stamp);
  return el;
}
