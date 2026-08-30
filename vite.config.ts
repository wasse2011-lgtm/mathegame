import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * public/sw.js のプレースホルダを、実際に出力されたファイル名で埋める。
 *
 * バンドルのファイル名にはハッシュが付くので、Service Worker に一覧を直接
 * 書いておくことはできない。かといって一覧を持たないと、初回訪問のぶんが
 * キャッシュに入らず「一度開いたのに圏外で起動しない」になる。
 * ここで dist/ を見て一覧を作る。
 *
 * VERSION は中身のハッシュ。ビルドごとにキャッシュ名が変わるので、
 * 古い版は activate のときにまとめて消える。
 */
function serviceWorkerPrecache(): Plugin {
  let dist = '';
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(config) {
      dist = resolve(config.root, config.build.outDir);
    },
    // public/ のコピーも含めて dist/ が出そろってから走らせたいので closeBundle
    closeBundle() {
      const swPath = join(dist, 'sw.js');

      let sw: string;
      try {
        sw = readFileSync(swPath, 'utf8');
      } catch {
        this.error('dist/sw.js がありません。public/sw.js が消えていないか確認してください。');
      }

      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(dist);

      const hash = createHash('sha256');
      const urls: string[] = [];
      for (const full of files.sort()) {
        const rel = relative(dist, full).split(sep).join('/');
        // Service Worker 自身と、build:single の出力は入れない
        if (rel === 'sw.js' || rel === 'tashizan-jump.html') continue;
        urls.push(`./${rel}`);
        hash.update(rel);
        hash.update(readFileSync(full));
      }

      // "/mathegame/" のようなディレクトリ指定での起動が最も多い。
      // "./index.html" とは別のキーになるので、両方を入れておく
      urls.unshift('./');

      const version = hash.digest('hex').slice(0, 12);

      // 置換できていない Service Worker を配ると、キャッシュ名が固定になったり
      // アプリ本体がプリキャッシュされなかったりする。黙って通さない
      for (const token of ['__BUILD_ID__', "['__PRECACHE__']"]) {
        if (!sw.includes(token)) {
          this.error(`public/sw.js に ${token} が見つかりません（置換できません）`);
        }
      }

      sw = sw
        .replace('__BUILD_ID__', version)
        .replace("['__PRECACHE__']", JSON.stringify(urls, null, 2));

      writeFileSync(swPath, sw);
      this.info?.(`sw.js: ${urls.length} 件をプリキャッシュ (${version})`);
    },
  };
}

export default defineConfig({
  // GitHub Pages などのサブディレクトリ配信でも動くように相対パスで出力する
  base: './',
  plugins: [serviceWorkerPrecache()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 8192,
  },
  server: {
    host: true,
    port: 5173,
  },
});
