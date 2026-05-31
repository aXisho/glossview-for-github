import type { GlossNode } from "../parser";
import { integerInRange, slugify } from "../render-utils";

export function renderToc(node: GlossNode): HTMLElement {
  const maxDepth = integerInRange(node.attrs.depth, 1, 6) ?? 3;

  const wrapper = document.createElement("div");
  wrapper.className = "gloss-toc";

  if (node.attrs.title) {
    const titleDiv = document.createElement("div");
    titleDiv.className = "gloss-toc-title";
    titleDiv.textContent = node.attrs.title;
    wrapper.appendChild(titleDiv);
  }

  // Headings aren't in the DOM yet when the fragment is built, so populate
  // the TOC after the current task (once the fragment is inserted).
  requestAnimationFrame(() => populateToc(wrapper, maxDepth));

  return wrapper;
}

function populateToc(wrapper: HTMLElement, maxDepth: number): void {
  // Scope to the markdown container that contains this TOC element
  const scope: ParentNode = wrapper.closest(".markdown-body") ?? document;

  const headings = Array.from(
    scope.querySelectorAll("h1,h2,h3,h4,h5,h6")
  ) as HTMLHeadingElement[];

  interface TocEntry { id: string; text: string; level: number; }

  const entries: TocEntry[] = [];
  for (const el of headings) {
    if (el.closest("section.footnotes, section[data-footnotes]")) continue;
    // GitHub's edit-page preview may not add id attributes to headings.
    // Generate one on the fly so the heading is included in the TOC.
    if (!el.id) {
      const slug = slugify(el.textContent ?? "");
      if (slug) el.id = slug;
    }
    if (!el.id) continue;
    const level = parseInt(el.tagName.slice(1), 10);
    if (level <= maxDepth) {
      entries.push({ id: el.id, text: el.textContent ?? "", level });
    }
  }

  if (entries.length === 0) return;

  const minLevel = Math.min(...entries.map((e) => e.level));
  const ol = document.createElement("ol");

  for (const entry of entries) {
    const li = document.createElement("li");
    li.style.marginLeft = `${(entry.level - minLevel) * 1}rem`;
    const a = document.createElement("a");
    a.href = `#${entry.id}`;
    a.textContent = entry.text.trim();
    li.appendChild(a);
    ol.appendChild(li);
  }

  wrapper.appendChild(ol);
}
