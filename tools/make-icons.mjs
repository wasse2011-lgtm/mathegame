/**
 * アイコン (public/icons/*.png) を生成する。
 * 実行には Playwright が必要:  npx playwright@1.49.1 install chromium && node tools/make-icons.mjs
 * 生成物はリポジトリにコミットしてあるので、絵を変えたいときだけ実行すればよい。
 *
 * maskable 版は絵を内側 80% に寄せてある。Android はアイコンを端末ごとの形
 * （丸・角丸・雫）で切り抜くので、フチいっぱいに描いた絵だと「＋」の先が
 * 欠ける。空と地面は切り抜かれてもよいように、そのままフチまで塗る。
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// inset は絵を内側に寄せる割合。0 でフチいっぱい、0.1 で内側 80% に収まる
const page = (size, inset = 0) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}canvas{display:block}</style>
<canvas id="c" width="${size}" height="${size}"></canvas>
<script>
const S = ${size};
const P = S * ${inset};        // 絵の左上
const U = S - P * 2;           // 絵の一辺
const g = document.getElementById('c').getContext('2d');

function rr(x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

// そら と じめん。切り抜かれる前提なので、ここだけはフチまで塗る
const sky = g.createLinearGradient(0, 0, 0, S);
sky.addColorStop(0, '#8fd0ef');
sky.addColorStop(1, '#dff1fb');
g.fillStyle = sky;
g.fillRect(0, 0, S, S);
const groundY = P + U * 0.74;
g.fillStyle = '#7ec96f';
g.fillRect(0, groundY, S, S - groundY);
g.fillStyle = '#5da84f';
g.fillRect(0, groundY, S, U * 0.03);

// たしざんの「＋」
g.strokeStyle = 'rgba(255,255,255,.9)';
g.lineWidth = U * 0.055;
g.lineCap = 'round';
g.beginPath();
g.moveTo(P + U * 0.7, P + U * 0.2); g.lineTo(P + U * 0.7, P + U * 0.36);
g.moveTo(P + U * 0.62, P + U * 0.28); g.lineTo(P + U * 0.78, P + U * 0.28);
g.stroke();

// キャラ（ジャンプ中）
const size = U * 0.4;
const cx = P + U * 0.44;
const footY = P + U * 0.68;
const x = cx - size / 2;
const y = footY - size;
const INK = '#2b3440';

g.fillStyle = INK;
rr(x + size * 0.16, footY - size * 0.1, size * 0.24, size * 0.16, size * 0.07); g.fill();
rr(x + size * 0.6, footY - size * 0.1, size * 0.24, size * 0.16, size * 0.07); g.fill();

g.fillStyle = '#e08a29';
g.beginPath();
g.moveTo(x + size * 0.14, y + size * 0.22);
g.lineTo(x + size * 0.1, y - size * 0.16);
g.lineTo(x + size * 0.44, y + size * 0.08);
g.closePath(); g.fill();
g.beginPath();
g.moveTo(x + size * 0.86, y + size * 0.22);
g.lineTo(x + size * 0.9, y - size * 0.16);
g.lineTo(x + size * 0.56, y + size * 0.08);
g.closePath(); g.fill();

g.fillStyle = '#f7ab4e';
rr(x, y, size, size, size * 0.3); g.fill();

g.fillStyle = INK;
const ey = y + size * 0.42;
g.beginPath(); g.ellipse(x + size * 0.32, ey, size * 0.075, size * 0.095, 0, 0, 7); g.fill();
g.beginPath(); g.ellipse(x + size * 0.68, ey, size * 0.075, size * 0.095, 0, 0, 7); g.fill();
g.strokeStyle = INK;
g.lineWidth = Math.max(2, size * 0.055);
g.beginPath(); g.arc(cx, y + size * 0.6, size * 0.13, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();

g.fillStyle = 'rgba(255,138,128,.45)';
g.beginPath(); g.arc(x + size * 0.17, y + size * 0.62, size * 0.08, 0, 7); g.fill();
g.beginPath(); g.arc(x + size * 0.83, y + size * 0.62, size * 0.08, 0, 7); g.fill();
</script>`;

// CHROMIUM_PATH を渡すと、Playwright が管理していない Chromium も使える
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const icons = [
  ['icon-192', 192, 0],
  ['icon-512', 512, 0],
  ['apple-touch-icon', 180, 0],
  // ホーム画面で端末の形に切り抜かれる版。安全域は中央 80% の円
  ['icon-maskable-512', 512, 0.1],
];
for (const [name, size, inset] of icons) {
  const ctx = await browser.newContext({ viewport: { width: size, height: size } });
  const p = await ctx.newPage();
  await p.setContent(page(size, inset));
  const buf = await p.locator('#c').screenshot({ omitBackground: true });
  writeFileSync(join(outDir, `${name}.png`), buf);
  console.log('wrote', name, size, inset ? `(inset ${inset})` : '');
  await ctx.close();
}
await browser.close();
