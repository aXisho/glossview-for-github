# GlossView for GitHub

[English](./README.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

A Chrome extension that renders [Gloss Markdown](https://github.com/aXisho/glossmd) directives on GitHub pages. When you browse a `.gloss.md` file on GitHub, the extension intercepts the page and transforms directive markup into rich UI — details, cards, tabs, badges, grids, steps, and more.

## What it does

GitHub already renders Gloss Markdown source readably out of the box as fenced code blocks, inline code spans, and passthrough GitHub Markdown such as Alerts. This extension upgrades the experience further:

**File view** (`.gloss.md` blob pages):

1. Detects that the current GitHub URL ends with `.gloss.md`.
2. Reads the Markdown body from GitHub's page data, or from the same-origin edit page when needed.
3. Parses the Gloss Markdown directive tree.
4. Re-renders the page's markdown container with the full Gloss Markdown output: directive blocks are replaced with styled DOM elements (tabbed interfaces, collapsible details, cards, grids, etc.), and plain Markdown text is rendered via [marked.js](https://marked.js.org/).

**Edit page preview** (`/edit/` URLs):

When you click the **Preview** tab while editing a `.gloss.md` file, a small page-world bridge captures the current editor text from GitHub's preview request or CodeMirror state. The content script then re-renders the preview container from that text with the same Gloss renderer used on file views, so unsaved edits are reflected without waiting for a commit.

**Wiki pages**:

Wiki pages whose URL contains `.gloss` (e.g. `/owner/repo/wiki/Page-Name.gloss`) are detected and rendered automatically. The extension fetches GitHub's same-origin wiki edit page and renders from the Markdown body in that page, so it does not depend on GitHub's raw wiki endpoint.

**Gist pages**:

Gist files whose names end in `.gloss.md` are detected and rendered automatically, fetching the raw content from `gist.githubusercontent.com`.

## Supported directives

| Directive | Form | Description |
|-----------|------|-------------|
| `details` | ` ```details ` fence | Collapsible section |
| `card` | ` ```card ` fence | Bordered card |
| `toc` | ` ```toc ` fence | Auto-generated table of contents |
| `tabs` / `tab` | ` ````tabs ` + nested ` ```tab ` | Tabbed content |
| `steps` / `step` | ` ````steps ` + nested ` ```step ` | Numbered step list |
| `grid` / `cell` | ` ````grid ` + nested ` ```cell ` | CSS grid layout |
| `badge` | `` `text`{badge ...} `` | Inline pill badge |
| `small` | `` `text`{small} `` | Small muted text |
| `kbd` | `` `text`{kbd} `` | Keyboard key rendering |
| `heading` | `` ## Title {heading color=blue} `` | Background-coloured heading |

GitHub Alerts, math, and GitHub-flavoured footnotes (`[^id]`) can be used with the same notation as GitHub itself.

Code blocks inside rendered content include a hover copy button.

## Installation (load unpacked)

The extension is not yet published to the Chrome Web Store. To install locally:

1. Build the extension (see below).
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `dist/glossview-for-github/` directory.

## Building

```bash
npm install
npm run build
```

This copies static extension files, bundles `src/content.ts` (and all imported files) into `dist/glossview-for-github/src/content.js` using [Vite](https://vite.dev/), includes the page-world editor bridge, then creates `dist/glossview-for-github-1.0.0.zip`. Generated JavaScript is kept out of `src/`.

To watch for changes during development:

```bash
npm run watch
```

After any rebuild, click the reload button on the extension card at `chrome://extensions`.

## Testing

```bash
npm test
```

Unit tests run with [Vitest](https://vitest.dev/).

## How it works

```
GitHub blob view (.gloss.md)
  └─ content.ts runs at document_idle
       ├─ isGlossMdPath() → true
       ├─ getMarkdownSourceFromDocument(document)
       ├─ if needed, fetch /edit/... with same-origin credentials
       ├─ read textarea / embedded code data → Markdown body
       ├─ parseGlossMd(raw) → GlossChild[] tree
       ├─ renderChildren(tree) → DocumentFragment
       └─ container.replaceChildren(fragment) → DOM updated

GitHub edit page preview (/edit/ URL, Preview tab)
  └─ editor-bridge.js runs in the page world
       ├─ captures current editor text from preview fetch/XHR or CodeMirror
       └─ stores it on documentElement for the isolated content script
  └─ content.ts reruns on tab-switch / preview DOM changes
       ├─ isEditPage() → true
       ├─ findEditContainer() → .markdown-body in preview panel
       ├─ requestEditorContent() → current unsaved source text
       ├─ parseGlossMd(raw) + renderChildren(tree)
       └─ container.replaceChildren(fragment)

GitHub Wiki page (/wiki/ URL containing .gloss)
  └─ content.ts runs at document_idle
       ├─ isGlossMdPath() → true
       ├─ getWikiEditUrl() → /wiki/Page.gloss/_edit
       ├─ fetch edit page with same-origin credentials
       ├─ read textarea[name="wiki[body]"] → Markdown body
       └─ applyAndWatch(container, raw) → same render path as blob view

GitHub Gist page
  └─ content.ts scans .js-gist-file-update-container elements
       ├─ filename ends in .gloss.md
       ├─ rawUrl from [href*="/raw/"] link
       └─ applyAndWatch(container, raw) → same render path as blob view
```

The parser (`src/parser.ts`) recognizes Gloss Markdown directive forms such as fenced code blocks, inline code + brace attrs, and heading attributes, then produces a tree of `GlossNode` / `TextNode` values. GitHub Alerts, math, and footnotes remain Markdown passthrough. The renderer (`src/renderer.ts`) walks the tree and delegates each directive to its handler in `src/directives/`. HTML output from marked.js is sanitized with [DOMPurify](https://github.com/cure53/DOMPurify), and code-fence language names are normalized before being used in DOM class names.

## Permissions

- `https://github.com/*` — inject content script on GitHub pages.
- `https://gist.github.com/*` — inject content script on Gist pages.
- `https://gist.githubusercontent.com/*` — fetch raw Gist file content.

No background service worker. No storage. No external data collection.

## License

[MIT License](./LICENSE)

### Third-party attributions

The CSS styles in this extension are derived from [k1LoW/mo](https://github.com/k1LoW/mo) (via [glmo](https://github.com/aXisho/glmo)), which is also MIT licensed.

Copyright © 2026 Ken'ichiro Oyama &lt;k1lowxb@gmail.com&gt;
