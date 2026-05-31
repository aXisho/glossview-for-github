import { marked, Renderer } from "marked";
import markedFootnote from "marked-footnote";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import type { GlossChild, GlossNode, InlineParagraph } from "./parser";
import { renderTabs } from "./directives/tabs";
import { renderDetails } from "./directives/details";
import { renderInline } from "./directives/inline";
import { renderLayout } from "./directives/layout";
import { renderToc } from "./directives/toc";
import { codeFenceInfo, headingLevel, positiveInteger, safeColor, Slugger } from "./render-utils";

// ── highlight.js ──────────────────────────────────────────────────────────────

hljs.registerLanguage("javascript", javascript); hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript); hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);         hljs.registerLanguage("py", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);             hljs.registerLanguage("rs", rust);
hljs.registerLanguage("bash", bash);             hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);             hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("xml", xml);               hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);               hljs.registerLanguage("c", cpp);
hljs.registerLanguage("csharp", csharp);         hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("ruby", ruby);             hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);         hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("ini", ini);               hljs.registerLanguage("toml", ini);

function hljsHighlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang }).value; } catch { /* fall through */ }
  }
  return escapeHtml(code);
}

// ── marked: custom renderer for syntax-highlighted code blocks ───────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function addCopyButton(pre: HTMLElement): void {
  const code = pre.querySelector("code");
  if (!code) return;
  const btn = document.createElement("button");
  btn.className = "gloss-copy-btn";
  btn.setAttribute("aria-label", "Copy code");
  btn.textContent = "Copy";
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(code.textContent ?? "").then(() => {
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    }).catch(() => {});
  });
  // Wrap pre in a container so the button sits outside pre's overflow context
  const wrapper = document.createElement("div");
  wrapper.className = "gloss-pre-wrapper";
  pre.replaceWith(wrapper);
  wrapper.appendChild(pre);
  wrapper.appendChild(btn);
}

function appendSanitizedHtml(target: Node, html: string): void {
  const tmp = document.createElement("span");
  tmp.innerHTML = DOMPurify.sanitize(html);
  while (tmp.firstChild) target.appendChild(tmp.firstChild);
}

const GITHUB_ALERT_TITLES: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

function enhanceGithubAlerts(root: ParentNode): void {
  for (const blockquote of Array.from(root.querySelectorAll("blockquote"))) {
    const first = blockquote.firstElementChild;
    if (!(first instanceof HTMLElement) || first.tagName !== "P") continue;

    const marker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.textContent ?? "");
    if (!marker) continue;

    const type = marker[1].toLowerCase();
    const alert = document.createElement("div");
    alert.className = `markdown-alert markdown-alert-${type}`;

    const title = document.createElement("p");
    title.className = "markdown-alert-title";
    title.textContent = GITHUB_ALERT_TITLES[type] ?? marker[1];
    alert.appendChild(title);

    first.innerHTML = first.innerHTML.replace(/^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i, "");
    if (!first.textContent?.trim() && first.children.length === 0) first.remove();

    while (blockquote.firstChild) alert.appendChild(blockquote.firstChild);
    blockquote.replaceWith(alert);
  }
}

const renderer = new Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  const { language, filename } = codeFenceInfo(lang ?? "");

  const highlighted = hljsHighlight(text, language);
  const cls = language ? ` class="language-${language} hljs"` : ' class="hljs"';
  const codeBlock = `<pre><code${cls}>${highlighted}</code></pre>`;

  if (filename) {
    return `<div class="gloss-code-block"><div class="gloss-code-filename">${escapeHtml(filename)}</div>${codeBlock}</div>\n`;
  }
  return `${codeBlock}\n`;
};
marked.use({ renderer });
marked.use(markedFootnote());
marked.use({ hooks: { postprocess: (html) => DOMPurify.sanitize(html) } });

// ── renderGlossNode ─────────────────────────────────────────────────────────────

export function renderGlossNode(node: GlossNode): HTMLElement | DocumentFragment {
  switch (node.name) {
    case "tabs": case "tab":
      return renderTabs(node);
    case "details": return renderDetails(node);
    case "badge": case "small": case "kbd":
      return renderInline(node);
    case "heading":
      return renderHeading(node);
    case "grid": case "cell": case "card": case "steps": case "step":
      return renderLayout(node);
    case "toc":
      return renderToc(node);
    default: {
      const el = node.inline ? document.createElement("span") : document.createElement("div");
      el.className = `gloss-unknown gloss-unknown-${node.name}`;
      el.appendChild(renderChildren(node.children));
      return el;
    }
  }
}

function renderHeading(node: GlossNode): HTMLElement {
  const color = safeColor(node.attrs.color);
  const level = headingLevel(node.attrs.level);
  const tagName = `h${level}` as const;
  const el = document.createElement(tagName);
  el.className = `gloss-heading${color ? ` gloss-heading-color-${color}` : ""}`;
  const indent = positiveInteger(node.attrs.indent) ?? 0;
  if (indent > 0) {
    el.dataset.glossIndent = String(indent);
    el.dataset.glossLevel = String(level);
  }
  // The heading id is assigned later by renderChildren's de-duplicating pass,
  // in document order, so it stays consistent with GitHub's anchor ids.
  for (const c of node.children) {
    if (c.kind === "text") appendSanitizedHtml(el, marked.parseInline(c.content) as string);
    else if (c.kind === "gloss") el.appendChild(renderGlossNode(c));
    else el.appendChild(renderInlineParagraph(c));
  }
  return el;
}

// ── renderChildren ────────────────────────────────────────────────────────────

export function renderChildren(children: GlossChild[]): DocumentFragment {
  const frag = document.createDocumentFragment();

  // marked-footnote requires all footnote references and definitions to appear
  // in the same marked.parse() call. Keep Markdown text in one combined string
  // and replace placeholders with parser-created Gloss block/inline paragraph
  // nodes after parsing.
  const PLACEHOLDER = "glossmd-ph";
  const slots = new Map<number, Element>();  // index → pre-built DOM node

  let md = "";
  for (const child of children) {
    if (child.kind === "text") {
      md += `${child.content}\n\n`;
      continue;
    }

    if (child.kind === "inline-para") {
      const idx = slots.size;
      const container = document.createElement("div");
      container.appendChild(renderInlineParagraph(child));
      slots.set(idx, container);
      md += `<div data-${PLACEHOLDER}="${idx}"></div>\n\n`;
      continue;
    }

    const idx = slots.size;
    const el = document.createElement("div");
    el.appendChild(renderGlossNode(child));
    slots.set(idx, el);
    md += `<div data-${PLACEHOLDER}="${idx}"></div>\n\n`;
  }

  // Parse the combined markdown once so footnotes resolve correctly.
  const html = marked.parse(md.trim()) as string;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = DOMPurify.sanitize(html);
  enhanceGithubAlerts(wrapper);

  for (const pre of Array.from(wrapper.querySelectorAll<HTMLElement>("pre"))) {
    addCopyButton(pre);
  }

  // Replace placeholder divs with pre-built DOM nodes in document order.
  for (const ph of Array.from(wrapper.querySelectorAll<HTMLElement>(`[data-${PLACEHOLDER}]`))) {
    const el = slots.get(parseInt(ph.getAttribute(`data-${PLACEHOLDER}`)!, 10));
    if (el) ph.replaceWith(...Array.from(el.childNodes));
  }

  // Assign GitHub-compatible, de-duplicated heading ids in document order. This
  // runs after placeholder replacement so directive headings (and headings
  // nested inside directive containers) are present and slugged in one pass.
  const slugger = new Slugger();
  for (const h of wrapper.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) {
    const id = slugger.slug(h.textContent ?? "");
    if (id) h.id = id;
  }

  for (const heading of Array.from(wrapper.querySelectorAll<HTMLElement>("[data-gloss-indent]"))) {
    const indent = parseFloat(heading.dataset.glossIndent!);
    const level = parseInt(heading.dataset.glossLevel ?? heading.tagName.slice(1), 10);
    delete heading.dataset.glossIndent;
    delete heading.dataset.glossLevel;
    if (!(indent > 0)) continue;
    const wrapDiv = document.createElement("div");
    wrapDiv.className = "gloss-nested-section";
    wrapDiv.style.marginLeft = `${indent * 1.5}rem`;
    const toMove: Node[] = [];
    let sib: ChildNode | null = heading.nextSibling;
    while (sib) {
      const next = sib.nextSibling;
      if (sib instanceof HTMLElement && /^H[1-6]$/.test(sib.tagName)) {
        const siblingLevel = parseInt(sib.tagName.slice(1), 10);
        if (siblingLevel <= level) break;
      }
      toMove.push(sib);
      sib = next;
    }
    heading.replaceWith(wrapDiv);
    wrapDiv.appendChild(heading);
    for (const n of toMove) wrapDiv.appendChild(n);
  }

  while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
  return frag;
}

// ── renderInlineChildren (for badge/kbd/mark/small content) ──────────────────

function renderInlineParagraph(para: InlineParagraph): HTMLParagraphElement {
  const p = document.createElement("p");
  for (const child of para.children) {
    if (child.kind === "text") {
      appendSanitizedHtml(p, marked.parseInline(child.content.replace(/\n/g, " ")) as string);
    } else if (child.kind === "gloss") {
      p.appendChild(renderGlossNode(child));
    } else {
      p.appendChild(renderInlineParagraph(child));
    }
  }
  return p;
}

export function renderInlineChildren(children: GlossChild[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    if (child.kind === "text") {
      try {
        const html = marked.parseInline(child.content) as string;
        appendSanitizedHtml(frag, html);
      } catch {
        frag.appendChild(document.createTextNode(child.content));
      }
    } else if (child.kind === "gloss") {
      frag.appendChild(renderGlossNode(child));
    } else {
      frag.appendChild(renderInlineParagraph(child));
    }
  }
  return frag;
}
