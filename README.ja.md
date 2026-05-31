# GlossView for GitHub

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

GitHub ページ上で [Gloss Markdown](https://github.com/aXisho/glossmd) の directive を描画する Chrome 拡張機能です。GitHub で `.gloss.md` ファイルを閲覧すると、拡張機能がページに介入し、directive マークアップをリッチな UI（details、カード、タブ、バッジ、グリッド、ステップなど）に変換します。

## できること

GitHub は Gloss Markdown のソースを、フェンスコードブロック、インラインコード、Alert などの passthrough GitHub Markdown としてそのまま読める形で描画します。この拡張機能はその体験をさらに向上させます。

**ファイルビュー**（`.gloss.md` blob ページ）：

1. 現在の GitHub URL が `.gloss.md` で終わることを検出する。
2. GitHub ページ内のデータ、または必要に応じて同一オリジンの edit ページから Markdown 本文を取得する。
3. Gloss Markdown の directive ツリーを解析する。
4. ページの markdown コンテナを完全な Gloss Markdown 出力で再描画する。directive ブロックはスタイル付きの DOM 要素（タブ UI、折りたたみ details、カード、グリッドなど）に置き換えられ、テキストは [marked.js](https://marked.js.org/) で描画される。

**編集ページプレビュー**（`/edit/` URL）：

`.gloss.md` ファイルの編集中に **Preview** タブをクリックすると、ページ側で動く小さなブリッジが GitHub の preview リクエストまたは CodeMirror の状態から現在のエディタ内容を取得します。content script はその内容を使って、ファイルビューと同じ Gloss レンダラーでプレビューコンテナ全体を再描画するため、コミット前の未保存編集も反映されます。

**Wiki ページ**：

URL に `.gloss` が含まれる Wiki ページ（例: `/owner/repo/wiki/Page-Name.gloss`）を自動検出します。拡張機能は GitHub の同一オリジンの Wiki 編集ページを取得し、そのページ内の Markdown 本文から描画するため、GitHub の raw wiki endpoint には依存しません。

**Gist ページ**：

ファイル名が `.gloss.md` で終わる Gist ファイルを自動検出し、`gist.githubusercontent.com` から生コンテンツを取得して描画します。

## サポートする directive

| Directive | 記法 | 説明 |
|-----------|------|------|
| `details` | ` ```details ` フェンス | 折りたたみセクション |
| `card` | ` ```card ` フェンス | ボーダー付きカード |
| `toc` | ` ```toc ` フェンス | 自動生成目次 |
| `tabs` / `tab` | ` ````tabs ` + ネストした ` ```tab ` | タブコンテンツ |
| `steps` / `step` | ` ````steps ` + ネストした ` ```step ` | 番号付きステップリスト |
| `grid` / `cell` | ` ````grid ` + ネストした ` ```cell ` | CSS グリッドレイアウト |
| `badge` | `` `text`{badge ...} `` | インラインピルバッジ |
| `small` | `` `text`{small} `` | 小さいミュートテキスト |
| `kbd` | `` `text`{kbd} `` | キーボードキー表示 |
| `heading` | `` ## Title {heading color=blue} `` | 背景色付き見出し |

GitHub Alert、数式、GitHub Flavored の脚注（`[^id]`）は、GitHub 本体と同じ記法で使用できます。

描画済みコンテンツ内のコードブロックにはホバー時のコピーボタンが表示されます。

## インストール（ローカルビルド）

現時点では Chrome Web Store への公開はありません。ローカルにインストールするには：

1. 拡張機能をビルドする（下記参照）。
2. Chrome で `chrome://extensions` を開く。
3. **デベロッパーモード**（右上のトグル）を有効にする。
4. **パッケージ化されていない拡張機能を読み込む** をクリックし、`dist/glossview-for-github/` ディレクトリを選択する。

## ビルド

```bash
npm install
npm run build
```

静的な拡張ファイルをコピーし、`src/content.ts`（およびインポートされるファイル）を [Vite](https://vite.dev/) で `dist/glossview-for-github/src/content.js` にバンドルし、ページ側で動く editor bridge も含めたうえで `dist/glossview-for-github-1.0.0.zip` を作成します。生成された JavaScript は `src/` には含まれません。

開発中の変更監視：

```bash
npm run watch
```

リビルド後は `chrome://extensions` の拡張機能カードのリロードボタンをクリックしてください。

## テスト

```bash
npm test
```

ユニットテストは [Vitest](https://vitest.dev/) で実行されます。

## 仕組み

```
GitHub blob ビュー (.gloss.md)
  └─ content.ts が document_idle で実行
       ├─ isGlossMdPath() → true
       ├─ getMarkdownSourceFromDocument(document)
       ├─ 必要なら同一オリジン credential 付きで /edit/... を取得
       ├─ textarea / 埋め込みコードデータ → Markdown 本文
       ├─ parseGlossMd(raw) → GlossChild[] ツリー
       ├─ renderChildren(tree) → DocumentFragment
       └─ container.replaceChildren(fragment) → DOM 更新

GitHub 編集ページプレビュー (/edit/ URL, Preview タブ)
  └─ editor-bridge.js がページ側の JavaScript world で実行
       ├─ preview fetch/XHR または CodeMirror から現在の編集内容を取得
       └─ isolated world の content script が読めるよう documentElement に保存
  └─ content.ts がタブ切り替え / preview DOM 変更時に再実行
       ├─ isEditPage() → true
       ├─ findEditContainer() → プレビューパネルの .markdown-body
       ├─ requestEditorContent() → 現在の未保存ソーステキスト
       ├─ parseGlossMd(raw) + renderChildren(tree)
       └─ container.replaceChildren(fragment)

GitHub Wiki ページ (/wiki/ URL に .gloss が含まれる)
  └─ content.ts が document_idle で実行
       ├─ isGlossMdPath() → true
       ├─ getWikiEditUrl() → /wiki/Page.gloss/_edit
       ├─ 同一オリジン credential 付きで編集ページを取得
       ├─ textarea[name="wiki[body]"] → Markdown 本文
       └─ applyAndWatch(container, raw) → blob ビューと同じ描画パス

GitHub Gist ページ
  └─ content.ts が .js-gist-file-update-container 要素をスキャン
       ├─ ファイル名が .gloss.md で終わる
       ├─ [href*="/raw/"] リンクから rawUrl を取得
       └─ applyAndWatch(container, raw) → blob ビューと同じ描画パス
```

パーサー（`src/parser.ts`）は fenced コードブロック、インラインコード＋ブレース属性、見出し属性などの Gloss Markdown directive 記法を認識し、`GlossNode` / `TextNode` のツリーを生成します。GitHub Alert、数式、脚注は Markdown passthrough のまま扱います。レンダラー（`src/renderer.ts`）はツリーを走査し、`src/directives/` 内の各ハンドラに委譲します。marked.js の HTML 出力は [DOMPurify](https://github.com/cure53/DOMPurify) でサニタイズされ、コードフェンスの言語名は DOM の class 名に使う前に正規化されます。

## パーミッション

- `https://github.com/*` — GitHub ページへのコンテンツスクリプト注入。
- `https://gist.github.com/*` — Gist ページへのコンテンツスクリプト注入。
- `https://gist.githubusercontent.com/*` — 生 Gist ファイルの取得。

バックグラウンドサービスワーカーなし。ストレージなし。外部データ収集なし。

## ライセンス

[MIT License](./LICENSE)

### サードパーティ帰属

本拡張機能の CSS スタイルは [k1LoW/mo](https://github.com/k1LoW/mo)（[glmo](https://github.com/aXisho/glmo) 経由）から派生しており、こちらも MIT ライセンスです。

Copyright © 2026 Ken'ichiro Oyama &lt;k1lowxb@gmail.com&gt;
