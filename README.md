# たしざんジャンプ

こたえをタップすると跳んで、障害物を越えられる。子ども（5〜8歳）向けの足し算ランナーです。
iPhone / iPad の Safari で動く PWA として作っています。App Store も開発者登録も不要で、
ホーム画面に追加すればアプリのように全画面で遊べます。

企画・設計プラン: https://claude.ai/code/artifact/c5b62188-3d3a-4597-930a-6a03c314541a

---

## あそびかた

1. 画面の上に式が出る（例: `7 + 5 = ?`）
2. 下のボタンから答えをタップする
3. 正解するとキャラが跳んで、障害物が足元を通り抜ける
4. 10問（ボスは15問）でステージクリア。ミスの数で ★1〜3

## 設計の要点

この3つは、遊びやすさと学習効果を両立させるための意図的な割り切りです。

| | 決めたこと | 理由 |
|---|---|---|
| タイミング | ジャンプの当て判定をしない | 正解した瞬間に障害物のほうが加速して足元を通る。腕前ではなく計算だけで越えられる |
| 制限時間 | タイマーを出さない | 近づいてくる障害物そのものが残り時間。数字のカウントダウンより圧が弱い |
| 失敗 | ゲームオーバーにしない | ぶつかってもコインを1枚落として先へ進む。ステージは必ず最後まで走り切れる |

ほかに実装済みのもの:

- **ワールドはつまずき順に区切る** — W3「10の合成」と W5「繰り上がり」を独立させ、そこだけ繰り返し遊べる
- **誤答は実際のまちがいから作る** — ±1（数えまちがい）、繰り上げ忘れ、引いた答え。ランダムな数字は使わない
- **正解の位置と大きさを散らす** — 同じ位置に3連続で置かない。「いちばん大きいのが正解」も「正解じゃない」も覚えられないようにする
- **間違えた式は必ず戻ってくる** — 2問後と5問後に再出題。式ごとに習熟度を持ち、未習得の式を優先して出す
- **時間切れは答えを見せてから進む** — ここで正解を教えるのが一番効く

## iPhone / iPad で試す

### 1. 単一ファイルを送る（いちばん手軽）

```bash
npm install
npm run build:single      # dist/tashizan-jump.html （約 50KB の1枚）
```

できた `tashizan-jump.html` を AirDrop かメールで iPhone に送り、Safari で開けば
そのまま遊べます。サーバーもネットも不要です。
（この形ではホーム画面追加とオフラインキャッシュは使えません）

### 2. 同じ Wi-Fi の PC から配信する（開発中はこれ）

```bash
npm run dev
```

ターミナルに出る `Network: http://192.168.x.x:5173/` を iPhone の Safari で開きます。
コードを直すとその場で反映されるので、子どもの反応を見ながら調整できます。

### 3. GitHub Pages に置く（ホーム画面に入れるならこれ）

1. リポジトリの **Settings → Pages → Source** を `GitHub Actions` にする
2. `main` に push すると `.github/workflows/pages.yml` が動いて配信される
3. iPhone の Safari で開く → 共有ボタン → **ホーム画面に追加**

追加したアイコンから起動すると、アドレスバーのない全画面になります。
Service Worker が入っているので、一度開けば電波がなくても遊べます。

> Pages で公開したページは誰でも見られる状態になります。

## 開発

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # 型チェック + dist/ に出力
npm run build:single  # dist/tashizan-jump.html（1枚にまとめる）
npm run preview       # ビルド結果を確認
```

## ファイル構成

```
index.html            画面の骨組み（タイトル / マップ / プレイ / リザルト）
src/
  main.ts             画面遷移、タイトル、マップ、リザルト、設定
  runner.ts           プレイ画面。ゲームループ、物理、描画
  curriculum.ts       ワールド定義（W1〜W8）とステージごとの制限時間
  questions.ts        出題の選びかたと誤答の作りかた
  save.ts             セーブデータ（localStorage）
  audio.ts            効果音。音声ファイルは持たず Web Audio で合成
  sprites.ts          キャラと障害物の描画
  style.css           見た目と iOS 向けの調整
public/
  manifest.webmanifest, sw.js, icons/
tools/make-icons.mjs   アイコンの生成（絵を変えたいときだけ実行）
tools/build-single.mjs dist/ を 1枚の HTML にまとめる
.github/workflows/pages.yml  GitHub Pages への配信
```

### iOS 向けにやってあること

- `viewport-fit=cover` + `env(safe-area-inset-*)` でノッチとホームバーを避ける
- `touch-action: manipulation` と `gesturestart` の抑止でダブルタップ拡大を止める
  （`user-scalable=no` は iOS Safari では無視されるため）
- `position: fixed` + `overscroll-behavior: none` で引っぱって更新（バウンス）を止める
- 音は最初のタップで unlock。消音スイッチが ON でも鳴るように
  Safari 16.4+ の `navigator.audioSession.type = 'playback'` を設定
- 低電力モードで 30fps に落ちても速度が変わらないよう、フレーム数ではなく経過時間で動かす
- `devicePixelRatio` は 2 で頭打ち（3倍は塗り面積が 2.25 倍になり発熱する）

## これから

- **Phase 2（ハマる層）** — コンボ演出の強化、スキンとぼうし、ガチャ、デイリーチャレンジ、たしざん図鑑100マス
- **Phase 3（学習の質）** — さくらんぼ分解ヒント、苦手トップ5が見える親モード、遊ぶ時間の上限
- **Phase 4（拡張）** — タイムアタック、ひき算モード、きょうだい用プロフィール、Capacitor で App Store 版
