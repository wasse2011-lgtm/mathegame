/**
 * dist/ を 1枚の HTML にまとめる。
 *   npm run build:single   →   dist/tashizan-jump.html
 *
 * サーバーなしで開けるので、AirDrop やメール添付で iPhone に送ってそのまま遊べる。
 * （Service Worker とホーム画面追加は使えないので、常用するなら通常のビルドを配信する）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html がありません。先に `npm run build` を実行してください。');
  process.exit(1);
}

let html = readFileSync(join(dist, 'index.html'), 'utf8');

// </script> が JS の中に現れると HTML が途中で閉じてしまうので逃がす
const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

// <script type="module" src="./assets/xxx.js"> を中身で置き換える
html = html.replace(/<script[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_m, file) => {
  const code = readFileSync(join(dist, file), 'utf8');
  return `<script type="module">\n${escapeScript(code)}\n</script>`;
});

// <link rel="stylesheet" href="./assets/xxx.css"> を中身で置き換える
html = html.replace(/<link[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g, (_m, file) => {
  const css = readFileSync(join(dist, file), 'utf8');
  return `<style>\n${css}\n</style>`;
});

// 単体ファイルでは読めない参照を落とす
html = html.replace(/\s*<link[^>]*rel="manifest"[^>]*>/g, '');
html = html.replace(/\s*<link[^>]*rel="(apple-touch-icon|icon)"[^>]*>/g, '');

// ファビコンだけはデータ URI で埋め込む
const iconPath = join(root, 'public', 'icons', 'icon-192.png');
if (existsSync(iconPath)) {
  const b64 = readFileSync(iconPath).toString('base64');
  html = html.replace('</head>', `  <link rel="icon" href="data:image/png;base64,${b64}" />\n</head>`);
}

const out = join(dist, 'tashizan-jump.html');
writeFileSync(out, html);
console.log(`wrote ${out}  (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
