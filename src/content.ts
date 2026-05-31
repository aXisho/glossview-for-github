/**
 * content.ts — GlossView for GitHub content script
 */

import { parseGlossMd } from "./parser";
import { renderChildren } from "./renderer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGlossMdPath(): boolean {
  const p = window.location.pathname.toLowerCase();
  if (isWikiPage()) {
    const pageName = getWikiPageName()?.toLowerCase();
    return !!pageName && (pageName.endsWith(".gloss") || pageName.endsWith(".gloss.md"));
  }
  return p.endsWith(".gloss.md");
}

function isGistPage(): boolean {
  return window.location.hostname === "gist.github.com";
}

function isEditPage(): boolean {
  return /^\/[^/]+\/[^/]+\/edit\//.test(window.location.pathname);
}

function isRepoFilePage(): boolean {
  return /^\/[^/]+\/[^/]+\/(?:blob|edit)\//.test(window.location.pathname);
}

function isWikiPage(): boolean {
  return /^\/[^/]+\/[^/]+\/wiki\/.+/.test(window.location.pathname);
}

function getWikiPageName(): string | null {
  const m = window.location.pathname.match(/^\/[^/]+\/[^/]+\/wiki\/(.+)$/);
  if (!m) return null;
  return m[1].replace(/\/_(?:edit|history)$/, "");
}

function getCurrentWikiPath(): string | null {
  const pageName = getWikiPageName();
  const m = window.location.pathname.match(/^(\/[^/]+\/[^/]+\/wiki)\//);
  return pageName && m ? `${m[1]}/${pageName}` : null;
}

function getWikiEditUrl(): string | null {
  const wikiPath = getCurrentWikiPath();
  return wikiPath ? `${window.location.origin}${wikiPath}/_edit` : null;
}

function getRepoFileEditUrl(): string | null {
  const m = window.location.pathname.match(/^(\/[^/]+\/[^/]+)\/(?:blob|edit)\/(.+)$/);
  if (!m) return null;
  return `${window.location.origin}${m[1]}/edit/${m[2]}`;
}

function findContainer(): Element | null {
  return (
    document.querySelector(
      'article[data-testid="rendered-markdown-container"] .markdown-body'
    ) ??
    document.querySelector("#wiki-body .markdown-body") ??
    document.querySelector(".wiki-body .markdown-body") ??
    document.querySelector("article.markdown-body") ??
    document.querySelector(".markdown-body") ??
    null
  );
}

function findEditContainer(): Element | null {
  const selectors = [
    '[data-testid="preview-tab-panel"] .markdown-body',
    '[data-testid="preview"] .markdown-body',
    ".js-preview-panel .markdown-body",
    ".js-preview-body .markdown-body",
    ".preview-content .markdown-body",
    ".preview-content.markdown-body",
    ".js-preview-body.markdown-body",
    '[role="tabpanel"] .markdown-body',
  ];

  const explicitCandidates = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<Element>(selector))
  );
  const renderedFallbacks = Array.from(document.querySelectorAll<Element>("div.markdown-body"))
    .filter((el) => (
      el.classList.contains("container-lg") ||
      !!el.querySelector(".markdown-heading, .snippet-clipboard-content, .markdown-alert, [data-sourcepos]")
    ));
  const candidates = Array.from(new Set([...explicitCandidates, ...renderedFallbacks]));

  return (
    candidates.find((el) => el.isConnected && el.getClientRects().length > 0) ??
    candidates.find((el) => el.isConnected) ??
    null
  );
}

// ── Gist support ──────────────────────────────────────────────────────────────

interface GistGlossFile {
  container: Element;
  rawUrl: string;
}

function findGistGlossFiles(): GistGlossFile[] {
  const results: GistGlossFile[] = [];
  for (const fc of document.querySelectorAll(".js-gist-file-update-container")) {
    const nameEl = fc.querySelector(".gist-blob-name");
    if (!nameEl) continue;
    const filename = (nameEl.getAttribute("title") ?? nameEl.textContent ?? "").trim();
    const fn = filename.toLowerCase();
    if (!fn.endsWith(".gloss.md")) continue;

    const rawLink = fc.querySelector<HTMLAnchorElement>('a[href*="/raw/"]');
    if (!rawLink) continue;

    const container = fc.querySelector(".markdown-body");
    if (!container) continue;

    results.push({ container, rawUrl: rawLink.href });
  }
  return results;
}

// ── Hash link handling ────────────────────────────────────────────────────────

const hashLinkContainers = new WeakSet<Element>();

function installHashLinkHandlers(container: Element): void {
  if (hashLinkContainers.has(container)) return;
  hashLinkContainers.add(container);
  container.addEventListener("click", (e) => {
    const a = (e.target as Element).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href?.startsWith("#")) return;
    const id = href.slice(1);
    const target = container.querySelector(`#${CSS.escape(id)}`) ?? document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

const cachedRaw = new Map<string, string>();
const watchedContainers = new Map<Element, MutationObserver>();
const renderedSources = new WeakMap<Element, string>();
let bodyObserver: MutationObserver | null = null;
let wikiSidebarObserver: MutationObserver | null = null;
let wikiSidebarRetryTimer: number | null = null;

const SENTINEL_ATTR = "data-glossview-sentinel";
const EDITOR_CONTENT_ATTR = "data-glossview-content";
const EDITOR_REQUEST_EVENT = "__glossview_request_editor_content";
const EDITOR_RESPONSE_EVENT = "__glossview_editor_content";

// ── Core ──────────────────────────────────────────────────────────────────────

function buildFragment(raw: string): DocumentFragment {
  return renderChildren(parseGlossMd(raw));
}

function isOurRendering(container: Element): boolean {
  return !!container.querySelector(`[${SENTINEL_ATTR}]`);
}

function applyAndWatch(container: Element, raw: string): void {
  let applying = false;

  const apply = (): void => {
    applying = true;
    renderedSources.set(container, raw);
    const frag = buildFragment(raw);
    const sentinel = document.createElement("meta");
    sentinel.setAttribute(SENTINEL_ATTR, "1");
    sentinel.style.display = "none";
    frag.prepend(sentinel);
    container.replaceChildren(frag);
    installHashLinkHandlers(container);
    if (isWikiPage()) {
      installWikiSidebarObserver();
      scheduleWikiSidebarDirectiveStrip();
    }
    queueMicrotask(() => {
      applying = false;
    });
  };

  apply();

  const existing = watchedContainers.get(container);
  if (existing) existing.disconnect();

  const observer = new MutationObserver(() => {
    if (applying) return;
    if (!container.isConnected) {
      observer.disconnect();
      watchedContainers.delete(container);
      return;
    }
    if (!isOurRendering(container)) {
      apply();
    }
  });
  observer.observe(container, { childList: true, subtree: false });
  watchedContainers.set(container, observer);
}

function stripWikiSidebarDirectives(): void {
  const pageName = getWikiPageName();
  if (!pageName) return;

  const currentPageLink = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".js-wiki-sidebar-page-container a[href]")
  ).find((a) => {
    try {
      return new URL(a.href).pathname === getCurrentWikiPath();
    } catch {
      return false;
    }
  });
  const pageBox = currentPageLink?.closest(".js-wiki-sidebar-page-container");
  const tocContainer =
    pageBox?.querySelector<HTMLElement>(".js-wiki-sidebar-toc-container") ??
    document.getElementById(`${pageName}-table-of-contents`);
  if (!tocContainer) return;

  for (const link of tocContainer.querySelectorAll<HTMLAnchorElement>("a")) {
    const text = link.textContent ?? "";
    const stripped = stripDirectiveText(text);
    if (stripped !== text) {
      link.textContent = stripped;
    }
  }
}

function stripDirectiveText(text: string): string {
  return text
    .replace(/\{[a-z][a-z0-9-]*(?:\s+[^}]*)?\}/gi, "")
    .trim();
}

function clearWatched(): void {
  for (const obs of watchedContainers.values()) obs.disconnect();
  watchedContainers.clear();
  clearWikiSidebarObserver();
}

function clearWikiSidebarObserver(): void {
  wikiSidebarObserver?.disconnect();
  wikiSidebarObserver = null;
  if (wikiSidebarRetryTimer !== null) {
    window.clearTimeout(wikiSidebarRetryTimer);
    wikiSidebarRetryTimer = null;
  }
}

function installWikiSidebarObserver(): void {
  if (wikiSidebarObserver || !isWikiPage()) return;

  const target =
    document.querySelector("#wiki-pages-box") ??
    document.querySelector(".wiki-rightbar") ??
    document.querySelector(".Layout-sidebar");
  if (!target) return;

  let pending = false;
  wikiSidebarObserver = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      stripWikiSidebarDirectives();
    });
  });
  wikiSidebarObserver.observe(target, { childList: true, subtree: true, characterData: true });
}

function scheduleWikiSidebarDirectiveStrip(): void {
  if (!isWikiPage()) return;

  requestAnimationFrame(() => {
    installWikiSidebarObserver();
    stripWikiSidebarDirectives();
  });

  if (wikiSidebarRetryTimer !== null) return;

  const delays = [100, 300, 800, 1500];
  let i = 0;
  const retry = (): void => {
    wikiSidebarRetryTimer = null;
    if (!isWikiPage() || i >= delays.length) return;
    installWikiSidebarObserver();
    stripWikiSidebarDirectives();
    wikiSidebarRetryTimer = window.setTimeout(retry, delays[i]);
    i += 1;
  };
  wikiSidebarRetryTimer = window.setTimeout(retry, delays[i]);
  i += 1;
}

/**
 * Watch the document for container churn (turbo navigation, tab switches that
 * swap the article element entirely). When a fresh markdown container appears,
 * re-run main(). Installed once and left in place.
 */
function installBodyObserver(): void {
  if (bodyObserver) return;
  let pending = false;
  bodyObserver = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!isGlossMdPath() && !isGistPage()) return;
      main().catch((err) => console.error("[GlossView]", err));
    });
  });
  bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function mainGist(): Promise<void> {
  const files = findGistGlossFiles();
  for (const { container, rawUrl } of files) {
    if (watchedContainers.has(container) && isOurRendering(container)) continue;

    let raw = cachedRaw.get(rawUrl);
    if (raw === undefined) {
      try {
        const res = await fetch(rawUrl, { cache: "no-cache" });
        if (!res.ok) continue;
        raw = await res.text();
        cachedRaw.set(rawUrl, raw);
      } catch {
        console.warn("[GlossView] Failed to fetch:", rawUrl);
        continue;
      }
    }
    applyAndWatch(container, raw);
  }
}

async function getRawForCurrentPage(): Promise<string | null> {
  const cacheKey = window.location.pathname;
  let raw: string | null | undefined = cachedRaw.get(cacheKey);
  if (raw !== undefined) return raw;

  if (isWikiPage()) {
    raw = getMarkdownSourceFromDocument(document) ?? (await getRawFromWikiEditPage());
    if (raw) {
      cachedRaw.set(cacheKey, raw);
      return raw;
    }
    return null;
  }

  if (isRepoFilePage()) {
    raw = getMarkdownSourceFromDocument(document) ?? (await getRawFromRepoFileEditPage());
    if (raw) {
      cachedRaw.set(cacheKey, raw);
      return raw;
    }
  }

  return null;
}

async function getRawFromWikiEditPage(): Promise<string | null> {
  const editUrl = getWikiEditUrl();
  if (!editUrl) return null;

  try {
    const res = await fetch(editUrl, { credentials: "same-origin" });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const textarea =
      doc.querySelector<HTMLTextAreaElement>('textarea[name="wiki[body]"]') ??
      doc.querySelector<HTMLTextAreaElement>("#wiki_body") ??
      doc.querySelector<HTMLTextAreaElement>("textarea");
    const value = textarea?.value;
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

async function getRawFromRepoFileEditPage(): Promise<string | null> {
  const editUrl = getRepoFileEditUrl();
  if (!editUrl) return null;

  try {
    const res = await fetch(editUrl, { credentials: "same-origin" });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return getMarkdownSourceFromDocument(doc);
  } catch {
    console.warn("[GlossView] Failed to fetch file edit page:", editUrl);
    return null;
  }
}

function getMarkdownSourceFromDocument(doc: Document): string | null {
  return getTextareaSource(doc) ?? getJsonSource(doc) ?? getCodeLineSource(doc);
}

function getTextareaSource(doc: Document): string | null {
  const selectors = [
    'textarea[name="value"]',
    'textarea[name="contents"]',
    'textarea[name="blob_contents"]',
    'textarea[name="wiki[body]"]',
    "#file-content-textarea",
    "#wiki_body",
    "textarea",
  ];

  for (const selector of selectors) {
    const value = doc.querySelector<HTMLTextAreaElement>(selector)?.value;
    if (value && value.trim()) return value;
  }
  return null;
}

function getJsonSource(doc: Document): string | null {
  const candidates: string[] = [];

  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="application/json"]')) {
    const text = script.textContent;
    if (!text) continue;
    try {
      collectSourceCandidates(JSON.parse(text), candidates);
    } catch {
      // Ignore unrelated application/json script tags.
    }
  }

  return bestSourceCandidate(candidates);
}

function collectSourceCandidates(value: unknown, candidates: string[], key = ""): void {
  if (Array.isArray(value)) {
    if (
      /(?:raw)?lines?/i.test(key) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string")
    ) {
      candidates.push((value as string[]).join("\n"));
    }
    for (const item of value) collectSourceCandidates(item, candidates);
    return;
  }

  if (typeof value === "string") {
    if (/(?:content|source|text|raw)/i.test(key) && value.includes("\n")) {
      candidates.push(value);
    }
    return;
  }

  if (!value || typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value)) {
    collectSourceCandidates(childValue, candidates, childKey);
  }
}

function getCodeLineSource(doc: Document): string | null {
  const lineSelectors = [
    ".blob-code-inner",
    "[data-line-number] .react-file-line",
    "[data-code-text]",
  ];

  for (const selector of lineSelectors) {
    const lines = Array.from(doc.querySelectorAll<HTMLElement>(selector))
      .map((el) => el.getAttribute("data-code-text") ?? el.textContent ?? "");
    const candidate = lines.join("\n");
    if (candidate.trim()) return candidate;
  }
  return null;
}

function bestSourceCandidate(candidates: string[]): string | null {
  const nonEmpty = candidates.filter((candidate) => candidate.trim());
  if (nonEmpty.length === 0) return null;
  nonEmpty.sort((a, b) => sourceScore(b) - sourceScore(a));
  return nonEmpty[0];
}

function sourceScore(source: string): number {
  let score = source.length;
  if (/\{[a-z][a-z0-9-]*(?:\s+[^}]*)?\}/i.test(source)) score += 100_000;
  if (/^```/m.test(source)) score += 10_000;
  if (/^#{1,6}\s/m.test(source)) score += 1_000;
  return score;
}

function getCapturedEditorContent(): string | null {
  const raw = document.documentElement.getAttribute(EDITOR_CONTENT_ATTR);
  return raw && raw.trim() ? raw : null;
}

function requestEditorContent(timeoutMs = 600): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;

    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      document.removeEventListener(EDITOR_RESPONSE_EVENT, onResponse as EventListener);
      resolve(value);
    };

    const onResponse = (event: Event): void => {
      const detail = (event as CustomEvent<string | null>).detail;
      if (detail && detail.trim()) finish(detail);
    };

    document.addEventListener(EDITOR_RESPONSE_EVENT, onResponse as EventListener, { once: true });
    document.dispatchEvent(new CustomEvent(EDITOR_REQUEST_EVENT));
    window.setTimeout(() => finish(getCapturedEditorContent()), timeoutMs);
  });
}

async function main(): Promise<void> {
  if (isGistPage()) {
    return mainGist();
  }

  if (!isGlossMdPath()) {
    clearWatched();
    return;
  }

  if (isWikiPage()) {
    installWikiSidebarObserver();
    scheduleWikiSidebarDirectiveStrip();
  } else {
    clearWikiSidebarObserver();
  }

  // Edit page: target the preview tab panel; blob/wiki: the rendered article.
  const container = isEditPage() ? findEditContainer() : findContainer();
  if (!container) return;

  const raw = isEditPage()
    ? (await requestEditorContent()) ?? (await getRawForCurrentPage())
    : await getRawForCurrentPage();
  if (!raw) return;

  if (
    watchedContainers.has(container) &&
    isOurRendering(container) &&
    renderedSources.get(container) === raw
  ) {
    return;
  }
  applyAndWatch(container, raw);
}

// ── Navigation ────────────────────────────────────────────────────────────────

function scheduleMain(delay = 300): void {
  setTimeout(() => {
    main().catch((err) => console.error("[GlossView]", err));
  }, delay);
}

installBodyObserver();
main().catch((err) => console.error("[GlossView]", err));

document.addEventListener("turbo:load", () => {
  cachedRaw.clear();
  scheduleMain(300);
});
document.addEventListener("turbo:render", () => { scheduleMain(400); });
document.addEventListener("pjax:end", () => {
  cachedRaw.clear();
  scheduleMain(300);
});

// On edit pages, tab switches may use CSS show/hide without DOM mutations.
// Schedule main() on any tab-like click so the preview panel is picked up.
document.addEventListener("click", (e) => {
  if (!isGlossMdPath() || !isEditPage()) return;
  const target = e.target as Element;
  const btn = target.closest('[role="tab"], .tabnav-tab, [data-tab], button, a');
  const label = (btn?.textContent ?? btn?.getAttribute("aria-label") ?? "").trim().toLowerCase();
  if (!btn || (!label.includes("preview") && !btn.matches('[role="tab"], .tabnav-tab, [data-tab]'))) {
    return;
  }
  scheduleMain(150);
  scheduleMain(500);
  scheduleMain(1000);
});
