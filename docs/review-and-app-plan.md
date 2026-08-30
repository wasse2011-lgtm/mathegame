# レビューとアプリ化の道すじ

2026-08-30 時点のコードレビュー（8件）と、PWA から App Store / Google Play に出すまでのフロー。

確認したこと:

- `npm run typecheck` 通過（strict, noUnusedLocals, noImplicitReturns ほか有効）
- `npm run build` 通過。JS 43.45 kB (gzip 15.65 kB) / CSS 20.93 kB (gzip 4.92 kB)。
  `sw.js` `manifest.webmanifest` アイコン3枚が `dist/` に入ることも確認
- `npm run verify` A/B/C すべて通過。ただし A に見逃しあり（F3）
- Chromium 390×844（iPhone 相当・タッチ有効）でホーム → マップ → 1-1 を10問完走 →
  リザルトまで通し。JS エラー 0件
- W1・W2 クリア済みのセーブを流し込んだ状態での再現テスト（F1・F2 はここで出た）

---

## 総評

設計の意図がコードのコメントに残っていて、「なぜそうしなかったか」まで書いてある。
アプリ化という観点では、面倒な下ごしらえの大半はもう終わっている。

そのまま残したい設計:

- **割り切りが明文化されている** — 当たり判定なし・タイマーなし・ゲームオーバーなし。
  3つとも「腕前ではなく計算で越えさせる」という一本の理由から出ていてブレていない
- **出題エンジンに検証がある** — `npm run verify` で各ワールド 60,000 問を引き、正解の順位が
  一様かを見る。教育アプリでここまでやっているものは滅多にない
- **iOS の落とし穴が先回りで潰してある** — 音の unlock、`gesturestart` の抑止、
  `devicePixelRatio` の2倍打ち止め、`pagehide` での保存フラッシュ、低電力 30fps 対策
- **保存層が1か所に閉じている** — `save.ts` の `read()` / `write()` だけがストレージに触る。
  ネイティブの保存に差し替えるときに効いてくる
- **通信・広告・課金・アカウントが一切ない** — 両ストアの審査で最大の武器になる

---

## 見つかった問題

要修正 2 / 気になる 4 / 運用 2。

### F1【要修正】開始直前にアプリを裏へ回すと、ポーズ画面の裏で走り続ける

`src/main.ts:371`, `src/runner.ts:143`, `src/runner.ts:193`

`startRun()` は `show('play')` の *次のフレーム* で `runner.start()` を呼ぶ。その隙間に裏へ回すと
`visibilitychange` が `setPaused(true)` を呼ぶが `running` がまだ `false`。戻ってきて rAF が
発火すると `start()` が `this.paused = false` で無条件に上書きし、ポーズ画面が出たまま走り出す。

再現（ポーズ画面を出したまま放置）:

```
{"pause":true,"miss":0,"done":0,"q":"2 + 2 = ?"}   ← 1.0秒後
{"pause":true,"miss":0,"done":0,"q":"2 + 2 = ?"}   ← 4.0秒後
{"pause":true,"miss":1,"done":0,"q":"2 + 2 = ?"}   ← 8.0秒後・時間切れ
{"pause":true,"miss":1,"done":0,"q":"4 + 1 = ?"}   ← 12.0秒後・次の問題へ
```

`setPaused()` には「`running` を見て早期 return すると、start() の直前に裏へ回ったときに
ポーズ画面が出たまま裏で走り続ける」というコメントがあり、この状況自体は想定済みだった。
対策として `paused` の状態は保持しているのに、`start()` がそれを無条件に落としているのが原因。
`start()` で `paused` を `false` に戻さない（呼び出し時に立っていたら維持する）だけで塞がる。

### F2【要修正】デイリーが「最後に開いたワールド」の出題形式を丸ごと借りる

`src/main.ts:257-272`

「きょうの 5もん」は式こそ `weakestFacts()` で選ぶが、`world` に
`worldById(lastPlayedWorld())` をそのまま渡している。`QuestionPicker` は `world.choices` と
`world.blank` を見るので、W3（10のとびら、`blank: true`）まで進んだ子のデイリーは、
W1・W2 から選ばれた式まで穴埋め形式に化ける。制限時間もそのワールドのものになる。

再現（W1・W2 クリア済み = `lastPlayedWorld() === 3` のセーブ）:

```
{"label":"きょうの 5もん","q":"3 + ? = 10","choices":["3","7","6"]}
```

穴埋めは「たし算」ではなく「10の分解」を問う別のスキル（そのために W3 を独立させた、と
`curriculum.ts` にも書かれている）。苦手な式を復習するはずのデイリーが、その子がまだ
通っていない形式に化けるので狙いと逆に働く。

デイリー専用の擬似ワールドを1つ持たせるのが素直（`choices: 3`, `blank: false`,
`answerTime` は固定）。式だけを `weakestFacts()` から借り、形式はワールドに引きずられないようにする。

### F3【気になる】W3 だけ正解の位置が一様でなく、検証がそれを見逃している

`src/questions.ts:59-75`, `tools/verify-questions.mjs:57`

```
W3*  3択 |  40.8%  33.4%  25.8%  | 期待値 33.3%
W2   3択 |  33.1%  33.6%  33.3%  | 期待値 33.3%
```

W3 は「いちばん小さいのを押す」だけで 40.8% 当たる。ほかのワールドは全部 ±0.6pt 以内。

`buildChoices()` は正解の順位を先に一様ランダムで引くが、`blankPool()` が返す候補が上側に
偏っているため下側を埋められない。`7 + ? = 10`（正解 3）なら候補は `4, 2, 10, 7` で、
下側は `2` だけ。正解が小さいほど最小になりやすい。

`verify` の合格閾値が `worst < 0.09` で今の偏りは `0.075`。通ってはいるが、この項目のために
書かれたテストとしては見逃しているのと同じ。直したうえで閾値を `0.04` 前後まで下げる。

直しかた: `blankPool()` に下側の候補を足す。`b - 2`、`b - 3`、それと「引き算してしまった答え」
`sum - b - 1` あたりが実際の間違いとしても自然。

### F4【気になる】README の「あたらしく おぼえた式を必ず見せる」が実際にはほとんど出ない

`README.md`, `src/questions.ts:210`, `src/runner.ts:337`

習熟度は1回の正解につき `+1`、「おぼえた」は `4`。W1 は式が10通りで1ステージ10問なので、
1周では各式が `m = 1` にしかならない。10/10 パーフェクトのリザルトでも「あたらしく おぼえた！」は
出なかった。同じステージを4周して初めて1枚光る。

これは `+1` を `+2` に戻す話ではない（そこは既に一度直した跡があり、判断としては正しい。
3択のまぐれ当たり2回で図鑑が光ってしまう）。ズレているのは README の約束のほうと、
進み方が画面から見えないこと。

リザルトに「あと1回で おぼえた: `7 + 5`」のような、あと一歩の式を出すのが素直。

### F5【気になる】なまえが空白だけだと、名前が未設定のままマップへ進む

`src/main.ts:220-231`

`(value || 'きみ').trim().slice(0, 6)` の順序。`"   "` は truthy なので `'きみ'` に落ちず、
`trim()` で空文字になる。そのまま `show('map')` するので遊べてしまい、ホームに戻ると
名前入力画面がまた出る。`value.trim().slice(0, 6) || 'きみ'` に入れ替えるだけ。

### F6【気になる】見た目 2 件

`src/style.css:246`, `src/style.css:102`

- **HUD** — 390px でコンボ表示が出ると `1-1`・ピップ列・「4れんぞく」・コイン数が右端まで詰まる。
  コインが3桁で「10れんぞく」だと溢れる。`.pips` に `min-width: 0` を効かせるか、
  コンボ中はピップ列を隠す
- **ホームのサブ導線** — 「きせかえ／ずかん／せってい」は `.btn-ghost`（`#5d6b79`）で、
  背景の芝生（`#7ec96f`）に重なる。子どもに押させたい導線としてコントラスト不足

### F7【運用】`npm run verify` が CI で回っていない

`.github/workflows/pages.yml`

Pages のワークフローは `npm run build` だけ。出題の偏りは `questions.ts` を1行変えるだけで戻るし、
`verify` は終了コードまで用意されている（`process.exit(failed ? 1 : 0)`）。
このリポジトリで最も CI に置く価値があるのはここ。

### F8【運用】`esbuild` が `package.json` に無い

`tools/verify-questions.mjs:10`, `package.json`

検証スクリプトは `esbuild` を import するが、宣言されている依存は `typescript` と `vite` だけ。
いま動いているのは vite の依存として `esbuild@0.21.5` がたまたま巻き上げられているからで、
vite を上げてバンドラが変わった瞬間に静かに壊れる。`devDependencies` に明記する。

---

## アプリ化 — まず道を選ぶ

年 99 USD を払うかどうかが最大の分岐。先にここを決めてから手を動かすほうが早い。

| 道 | 費用 | 手間 | 届くもの |
|---|---|---|---|
| A. PWA のまま | 0円 | 済 | Safari →「ホーム画面に追加」。ストアには並ばない |
| B. Android だけ（TWA / Bubblewrap） | $25 買い切り | 1日 | Google Play。中身は今の PWA を包むだけ。iPhone には届かない |
| **C. iOS + Android（Capacitor）** | **$99/年 + $25** | **1〜2週** | **App Store と Google Play。ネイティブ保存・触覚・将来の課金まで** |

**C を勧める。** 元々 iPhone / iPad が対象で、README にも Capacitor と書かれている。
`base: './'` の相対パス出力、通信ゼロ、保存層の分離と、必要な条件はすでに揃っている。
ただし Phase 0 は道 A のままでも効くので、迷っているならそこから。

---

## フロー

### Phase 0 — アプリでも壊れないコードにする（半日 / Capacitor なし）

今のリポジトリだけで完結し、PWA のままでも効く。ここを飛ばして Capacitor を入れると、
原因が Web 側かネイティブ側か分からなくなる。

- **Service Worker をネイティブでは登録しない。** `main.ts:632` の条件に
  `Capacitor.isNativePlatform()` を足す。ネイティブはアセットを同梱するので SW は不要で、
  あると「更新したのに古い画面が出る」を自作することになる。`DEV` と iframe を既に弾いている
  条件式の隣に1つ足すだけ
- **保存の出口を1か所に保つ。** `save.ts` の `write()` / `read()` しかストレージを触っていない
  今の形を崩さない。Phase 2 でここに数行足すだけで済む
- **戻る操作の受け口を作る。** `map-back` / `zukan-back` / `shop-back` / `parent-back` が個別に
  ハンドラを持っているので `goBack()` を1つ作って集約する。Android の戻るボタンをここに繋ぐ
- **縦固定にする。** `manifest.webmanifest` の `orientation` を `"portrait"` へ
- **1024×1024 のアイコン原版を用意する。** `tools/make-icons.mjs` は 192 / 512 を作るが、
  両ストアが要求するのは 1024

### Phase 1 — Capacitor を入れる（半日 / 要 Xcode）

```bash
npm i @capacitor/core @capacitor/cli
npx cap init "たしざんジャンプ" jp.example.tashizanjump --web-dir=dist
npm i @capacitor/ios @capacitor/android
npm run build
npx cap add ios && npx cap add android
npx cap open ios
```

- `vite.config.ts` の `base: './'` はそのままで動く（iOS は `capacitor://localhost`、
  Android は `https://localhost` で配信されるため）。ここが絶対パスだったら詰んでいた
- `capacitor.config.ts` の `server.url` は開発中のライブリロード用。
  **ストアに出すビルドには絶対に残さない**（理由は Phase 4）
- 以降 `npm run build && npx cap sync` がひとまとまりになる。npm script にしておく

### Phase 2 — ネイティブでしか直せないところ（2〜4日）

上3つは必須、下4つは仕上げ。

| やること | 使うもの | なぜ |
|---|---|---|
| **セーブの永続化** | `@capacitor/preferences` | WKWebView の `localStorage` はアプリのコンテナ内にあるが残り続ける保証はない。`flushSave()` のたびに Preferences（UserDefaults / SharedPreferences）へ写し、起動時に `localStorage` が空なら書き戻す。API が非同期なので、**localStorage を正・Preferences を控え**にするのが、今の同期的な `save.ts` を大改造せずに済む形 |
| **中断・復帰** | `@capacitor/app` | `appStateChange` を購読する。`visibilitychange` は iOS の WKWebView では来るが Android では取りこぼす。F1 の修正と同じ入口に繋ぐ |
| **Android の戻るボタン** | `@capacitor/app` | `backButton` を購読しないと、ゲーム中でも押した瞬間にアプリが終了する。Phase 0 の `goBack()` に繋ぎ、ホームでだけ終了を確認 |
| 消音スイッチでも鳴らす | `AppDelegate.swift` | `navigator.audioSession` は Safari の API。ネイティブでは `AVAudioSession` のカテゴリを `.playback` にする数行が要る |
| 起動画面 | `@capacitor/splash-screen`, `@capacitor/status-bar` | 起動直後の白い画面を消し、背景を `#e2f4fd`（manifest の `background_color`）に合わせる |
| アイコン一式 | `@capacitor/assets` | 1024px 1枚から iOS / Android の全サイズを生成 |
| 触覚フィードバック | `@capacitor/haptics` | 任意。正解してジャンプする瞬間に軽い振動。ネイティブにした見返りとして一番わかりやすい差分 |

### Phase 3 — ストアに出す準備（1〜2日）

通信をしないので、いちばん面倒なプライバシー関連が全部「収集なし」で埋まる。

- **Apple Developer Program** — 年 99 USD。個人なら本人確認だけ、法人は D-U-N-S 番号が要る。
  App Store Connect でアプリを作り、Bundle ID を `capacitor.config.ts` の `appId` と一致させる
- **Google Play Console** — $25 の買い切り。「対象ユーザーとコンテンツ」の申告は全アプリ必須で、
  13歳未満を含めるとファミリー ポリシーが適用される。`targetSdk` はその年の要求レベル
  （毎年8月ごろ上がる）に合わせる
- **プライバシーポリシー URL** — 両ストアで必須。GitHub Pages に1枚置けば足りる。
  内容は「収集しない・送信しない・端末内にのみ保存する」で終わる
- **プライバシー申告** — Apple の栄養表示も Google のデータセーフティも「データを収集していません」。
  広告 SDK も解析 SDK も入っていないのでそう書ける
- **スクリーンショット** — iPhone 6.9インチと iPad 13インチ、Android 数点。
  Playwright で `390×844` をサイズ違いで回せば作れる
- **年齢レーティング** — 4+ / 全年齢

### Phase 4 — 審査で刺さりやすい3点

1. **4.2 最低限の機能 —「Web サイトを WebView で包んだだけ」は落ちる。**
   回避策の話ではなく事実として、このアプリはアセットを同梱し、通信なしでオフラインに完結し、
   端末に進捗を保存する。落ちる要因になりうるのは1つだけ — `capacitor.config.ts` に
   `server.url` を残したまま出すこと。残っていると審査から見て「ただのラッパー」と区別がつかない
2. **キッズカテゴリ — 選ぶなら第三者の解析・広告 SDK は一切入れられない。**
   今は入っていないのでそのまま満たしている。将来サポート先や外部リンクを置くなら親ゲートの
   内側に入れる必要がある。既にある「2けたの足し算」の関門はまさにこの用途に合った実装
   （PIN は忘れられる、という判断も正しい）
3. **たまご（ガチャ）の申告 — いまの形なら問題にならない。**
   中身は見た目だけで強さに影響せず、通貨はプレイで得るコインのみ、実際のお金では買えない。
   したがって「シミュレートされたギャンブル」には当たらず確率開示も不要。
   ただし将来コインを課金で売るなら、この3つの前提が全部ひっくり返る

### Phase 5 — 配布と、続けるための仕組み

- **実機に届ける最短経路は TestFlight。** 審査を通す前に家族の iPhone に正規の形で入る。
  Android は内部テストトラックが同じ役割
- Google Play は、新規の個人開発者アカウントだと製品版公開の前に一定期間のクローズドテストが要る。
  ここが一番待たされるので、Android を出すなら先にアカウントを作っておく
- CI は `macos-latest` のジョブを足して `npm run build → npx cap sync → fastlane` で TestFlight まで
  自動化できる。ただし後回しでよい — 先に F7 の `npm run verify` を CI に入れるほうが効く
- `package.json` の `version` を `Info.plist` と `build.gradle` に流す小さなスクリプトを1本。
  3か所を手で合わせるのは必ず忘れる

---

## いま手を付けるなら

1. **F1 と F2 を直す。** どちらも数行で、子どもの体験に直接効く
2. **F7・F8 を直す。** `verify` を CI に入れ、`esbuild` を宣言する。あとの作業がここに乗る
3. **Phase 0 を通す。** Capacitor を入れるかまだ決めていなくても、PWA のまま得をする
4. **年 99 USD を払うか決める。** ここが決まらないと Phase 1 以降は動かない

F3・F4 は急がない。ただし F3 は `verify` の閾値を下げる作業とセットにしておくと、
直したことが定着する。
