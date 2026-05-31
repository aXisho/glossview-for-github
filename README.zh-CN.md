# GlossView for GitHub

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

在 GitHub 页面上渲染 [Gloss Markdown](https://github.com/aXisho/glossmd) directive 的 Chrome 扩展。当你在 GitHub 上浏览 `.gloss.md` 文件时，扩展会拦截页面，将 directive 标记转换为丰富的 UI——details、卡片、标签页、徽章、网格、步骤等。

## 功能介绍

GitHub 本身会把 Gloss Markdown 源码渲染为可读的围栏代码块、行内代码，以及 Alert 等 passthrough GitHub Markdown。此扩展在此基础上进一步提升体验：

**文件视图**（`.gloss.md` blob 页面）：

1. 检测当前 GitHub URL 是否以 `.gloss.md` 结尾。
2. 从 GitHub 页面数据读取 Markdown 正文，必要时从同源的 edit 页面读取。
3. 解析 Gloss Markdown directive 树。
4. 用完整的 Gloss Markdown 输出重新渲染页面的 markdown 容器：directive 块被替换为带样式的 DOM 元素（标签页界面、可折叠 details、卡片、网格等），纯 Markdown 文本通过 [marked.js](https://marked.js.org/) 渲染。

**编辑页预览**（`/edit/` URL）：

在编辑 `.gloss.md` 文件时点击 **Preview** 标签，运行在页面 JavaScript world 中的小型 bridge 会从 GitHub 的 preview 请求或 CodeMirror 状态中捕获当前编辑器文本。content script 随后使用与文件视图相同的 Gloss 渲染器，从该文本重新渲染整个预览容器，因此无需提交也能反映未保存的编辑。

**Wiki 页面**：

自动检测 URL 中包含 `.gloss` 的 Wiki 页面（例如 `/owner/repo/wiki/Page-Name.gloss`）。扩展会获取 GitHub 同源的 Wiki 编辑页，并从该页面中的 Markdown 正文渲染，因此不依赖 GitHub 的 raw wiki endpoint。

**Gist 页面**：

自动检测文件名以 `.gloss.md` 结尾的 Gist 文件，从 `gist.githubusercontent.com` 获取原始内容并渲染。

## 支持的 directive

| Directive | 语法 | 说明 |
|-----------|------|------|
| `details` | ` ```details ` 围栏 | 可折叠区块 |
| `card` | ` ```card ` 围栏 | 带边框的卡片 |
| `toc` | ` ```toc ` 围栏 | 自动生成目录 |
| `tabs` / `tab` | ` ````tabs ` + 嵌套 ` ```tab ` | 标签页内容 |
| `steps` / `step` | ` ````steps ` + 嵌套 ` ```step ` | 编号步骤列表 |
| `grid` / `cell` | ` ````grid ` + 嵌套 ` ```cell ` | CSS 网格布局 |
| `badge` | `` `text`{badge ...} `` | 行内徽章 |
| `small` | `` `text`{small} `` | 小号灰色文字 |
| `kbd` | `` `text`{kbd} `` | 键盘按键样式 |
| `heading` | `` ## Title {heading color=blue} `` | 带背景色的标题 |

GitHub Alert、数学公式和 GitHub Flavored 脚注（`[^id]`）可使用与 GitHub 本身相同的语法。

渲染内容中的代码块在悬停时会显示复制按钮。

## 安装（加载未打包扩展）

扩展尚未发布到 Chrome Web Store。本地安装步骤：

1. 构建扩展（见下文）。
2. 在 Chrome 中打开 `chrome://extensions`。
3. 启用**开发者模式**（右上角开关）。
4. 点击**加载已解压的扩展程序**，选择 `dist/glossview-for-github/` 目录。

## 构建

```bash
npm install
npm run build
```

构建流程会复制静态扩展文件，使用 [Vite](https://vite.dev/) 将 `src/content.ts`（及所有导入文件）打包为 `dist/glossview-for-github/src/content.js`，同时包含页面侧 editor bridge，并生成 `dist/glossview-for-github-1.0.0.zip`。生成的 JavaScript 不会放入 `src/`。

开发时监听变更：

```bash
npm run watch
```

每次重新构建后，在 `chrome://extensions` 的扩展卡片上点击重新加载按钮。

## 测试

```bash
npm test
```

单元测试使用 [Vitest](https://vitest.dev/) 运行。

## 工作原理

```
GitHub blob 视图 (.gloss.md)
  └─ content.ts 在 document_idle 时运行
       ├─ isGlossMdPath() → true
       ├─ getMarkdownSourceFromDocument(document)
       ├─ 必要时带 same-origin credentials 获取 /edit/...
       ├─ textarea / 嵌入代码数据 → Markdown 正文
       ├─ parseGlossMd(raw) → GlossChild[] 树
       ├─ renderChildren(tree) → DocumentFragment
       └─ container.replaceChildren(fragment) → DOM 更新

GitHub 编辑页预览 (/edit/ URL, Preview 标签)
  └─ editor-bridge.js 在页面 JavaScript world 中运行
       ├─ 从 preview fetch/XHR 或 CodeMirror 捕获当前编辑内容
       └─ 保存到 documentElement，供 isolated world 的 content script 读取
  └─ content.ts 在标签切换 / preview DOM 变化时重新运行
       ├─ isEditPage() → true
       ├─ findEditContainer() → 预览面板中的 .markdown-body
       ├─ requestEditorContent() → 当前未保存源码文本
       ├─ parseGlossMd(raw) + renderChildren(tree)
       └─ container.replaceChildren(fragment)

GitHub Wiki 页面 (/wiki/ URL 中包含 .gloss)
  └─ content.ts 在 document_idle 时运行
       ├─ isGlossMdPath() → true
       ├─ getWikiEditUrl() → /wiki/Page.gloss/_edit
       ├─ 带 same-origin credentials 获取编辑页
       ├─ textarea[name="wiki[body]"] → Markdown 正文
       └─ applyAndWatch(container, raw) → 与 blob 视图相同的渲染路径

GitHub Gist 页面
  └─ content.ts 扫描 .js-gist-file-update-container 元素
       ├─ 文件名以 .gloss.md 结尾
       ├─ 从 [href*="/raw/"] 链接获取 rawUrl
       └─ applyAndWatch(container, raw) → 与 blob 视图相同的渲染路径
```

解析器（`src/parser.ts`）识别围栏代码块、行内代码＋花括号属性、标题属性等 Gloss Markdown directive 语法，生成 `GlossNode` / `TextNode` 树。GitHub Alert、数学公式和脚注保持为 Markdown passthrough。渲染器（`src/renderer.ts`）遍历树，将每个 directive 委托给 `src/directives/` 中的对应处理器。marked.js 输出的 HTML 通过 [DOMPurify](https://github.com/cure53/DOMPurify) 净化，代码围栏语言名在用作 DOM class 名之前也会被规范化。

## 权限

- `https://github.com/*` — 向 GitHub 页面注入 content script。
- `https://gist.github.com/*` — 向 Gist 页面注入 content script。
- `https://gist.githubusercontent.com/*` — 获取原始 Gist 文件内容。

无后台 Service Worker。无存储。不收集任何外部数据。

## 许可证

[MIT License](./LICENSE)

### 第三方致谢

本扩展的 CSS 样式派生自 [k1LoW/mo](https://github.com/k1LoW/mo)（经由 [glmo](https://github.com/aXisho/glmo)），同样采用 MIT 许可证。

Copyright © 2026 Ken'ichiro Oyama &lt;k1lowxb@gmail.com&gt;
