import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages などのサブディレクトリ配信でも動くように相対パスで出力する
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 8192,
  },
  server: {
    host: true,
    port: 5173,
  },
});
