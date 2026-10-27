/**
 * ほかの指が 画面に ふれていても、ボタンを押せるようにする。
 *
 * ブラウザは、ほかの指が 画面に のっているあいだの タップに **click を出さない**
 * （pointerdown・touchstart・touchend は来るのに、click だけが来ない。Chromium で
 * 「1本を置いたまま もう1本で タップ」を ためして たしかめた。iPad でも
 * 「べつの場所を さわったままだと 押せない」と 報告があった）。
 * そのせいで、iPad を持つ 親指が 画面に かかっていると どのボタンも効かず、
 * ふたりで ボスでは となりの子が さわっているあいだ「おうえん」が効かなかった。
 *
 * ほかの指と かさなった タップだけ、指が はなれたときに こちらで click を出す。
 * 1本指の タップには なにもしない（いつもどおり ブラウザの click）。
 * ブラウザが 自分でも click を出したときは、同じ タップの 2つめを 捨てる。
 *
 * 出す click は detail を 1 にする。pointerdown で受けて「detail が 0 の click は
 * キーボード」と見ている ボタン（ふたりで ボスの こたえ など）で、2回 押したことに ならないように。
 */

/** これより うごいたら タップではない（スクロール・スワイプ） */
const TAP_SLOP = 16;
/** これより 長く ふれていたら タップではない（iPad を持つ 指・ながおし） */
const TAP_MAX_MS = 1000;
/** こちらで click を出したあと、ブラウザの click が来たら 捨てる 時間 */
const ECHO_MS = 700;

interface Press {
  x: number;
  y: number;
  t: number;
  target: Element;
  /** ほかの指と かさなったか（ふれた とき・ふれている あいだの どちらでも） */
  multi: boolean;
}

/** 押せる部品。指が ずれて この外で はなれたら 押さない（ブラウザの click と 同じ） */
const PRESSABLE = 'button, a, label, input, select, textarea, [role="button"]';

/** 起動時に 1回だけ呼ぶ */
export function installMultiTouchClick(): void {
  const presses = new Map<number, Press>();
  /**
   * こちらで click を出す 部品と、そこへ来る ブラウザの click を 捨てる 期限。
   * 指が はなれた 時点で 入れる（ブラウザの click が こちらより 先に来ても 2回に ならない）
   */
  const echo = new Map<Element, number>();

  const fire = (target: Element, box: Element, x: number, y: number): void => {
    // 押している あいだに 消えた・押せなくなった・指の下に いない 部品は 押さない
    if (!target.isConnected || target.closest(':disabled')) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !box.contains(hit)) return;
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: true, view: window, detail: 1, clientX: x, clientY: y,
    }));
  };

  window.addEventListener('touchstart', (e) => {
    // いま ふれている指は e.touches が 正しい。touchend を 取りこぼした指は ここで消す
    const live = new Set(Array.from(e.touches, (t) => t.identifier));
    for (const id of presses.keys()) if (!live.has(id)) presses.delete(id);
    const multi = e.touches.length > 1;
    if (multi) for (const p of presses.values()) p.multi = true;
    for (const t of Array.from(e.changedTouches)) {
      if (!(t.target instanceof Element)) continue;
      presses.set(t.identifier, { x: t.clientX, y: t.clientY, t: e.timeStamp, target: t.target, multi });
      // 同じ 部品を もう一度 押した。ここからの click は あたらしい タップのもの
      for (const el of echo.keys()) if (el.contains(t.target)) echo.delete(el);
    }
  }, { capture: true, passive: true });

  window.addEventListener('touchcancel', (e) => {
    for (const t of Array.from(e.changedTouches)) presses.delete(t.identifier);
  }, { capture: true, passive: true });

  window.addEventListener('touchend', (e) => {
    const now = performance.now();
    for (const [el, until] of echo) if (until < now) echo.delete(el);
    for (const t of Array.from(e.changedTouches)) {
      const p = presses.get(t.identifier);
      presses.delete(t.identifier);
      if (!p?.multi || e.timeStamp - p.t > TAP_MAX_MS) continue;
      if (Math.hypot(t.clientX - p.x, t.clientY - p.y) > TAP_SLOP) continue;
      const { target } = p;
      const box = target.closest(PRESSABLE) ?? target;
      const x = t.clientX;
      const y = t.clientY;
      echo.set(box, now + ECHO_MS);
      // pointerup・touchend を ほかが 受けおわってから（ブラウザの click と 同じ 順番）
      window.setTimeout(() => fire(target, box, x, y), 0);
    }
  }, { capture: true, passive: true });

  window.addEventListener('click', (e) => {
    if (!e.isTrusted || !echo.size || !(e.target instanceof Node)) return;
    const now = performance.now();
    for (const [el, until] of echo) {
      if (until < now || !el.contains(e.target)) continue;
      echo.delete(el);
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  }, true);
}
