import type { GlossNode } from "../parser";
import { SAFE_URL_RE } from "../gloss-spec";
import { renderChildren } from "../renderer";
import { colorClass, positiveInteger, safeColor } from "../render-utils";

function isSafeHref(href: string | undefined): href is string {
  return !!href && SAFE_URL_RE.test(href);
}

/**
 * For container/child directives the child inherits the container's `color`
 * unless it sets one of its own. The renderer reads inherited colour from the
 * `data-gloss-inherit-color` attribute on the closest container element so that
 * we don't have to thread state through `renderChildren`.
 */
function inheritColorFor(node: GlossNode, parentColor: string): string {
  return safeColor(node.attrs.color, parentColor);
}

export function renderLayout(node: GlossNode): HTMLElement {
  switch (node.name) {
    case "card": {
      const color = safeColor(node.attrs.color);
      const inner = document.createElement("div");
      inner.className = `gloss-card${colorClass(color)}`;

      if (node.attrs.title) {
        const titleDiv = document.createElement("div");
        titleDiv.className = "gloss-card-title";
        titleDiv.textContent = node.attrs.title;
        inner.appendChild(titleDiv);
      }

      inner.appendChild(renderChildren(node.children));

      if (isSafeHref(node.attrs.href)) {
        const a = document.createElement("a");
        a.href = node.attrs.href;
        a.className = "gloss-card-link";
        a.style.display = "block";
        a.style.width = "100%";
        a.style.textDecoration = "none";
        a.style.color = "inherit";
        a.appendChild(inner);
        return a;
      }

      return inner;
    }

    case "grid": {
      const parentColor = safeColor(node.attrs.color);
      const parentBorder = node.attrs.border === "none" ? "none" : "solid";

      const cellChildren = node.children.filter(
        (c): c is GlossNode => c.kind === "gloss" && c.name === "cell",
      );
      const cellCount = cellChildren.length;

      // §3: `cols` defaults to the number of `cell` children (min 1). An invalid
      // value is treated as that default per §6.1.
      const colsAttr = positiveInteger(node.attrs.cols);
      const cols = colsAttr ?? Math.max(1, cellCount);

      const div = document.createElement("div");
      const borderClass = parentBorder === "none" ? " gloss-border-none" : "";
      div.className = `gloss-grid${colorClass(parentColor)}${borderClass}`;
      div.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      for (const child of node.children) {
        if (child.kind === "gloss" && child.name === "cell") {
          div.appendChild(renderCell(child, parentColor, parentBorder));
        } else {
          div.appendChild(renderChildren([child]));
        }
      }
      return div;
    }

    case "cell": {
      return renderCell(node, "", "solid");
    }

    case "steps": {
      const parentColor = safeColor(node.attrs.color);
      const ol = document.createElement("ol");
      ol.className = `gloss-steps${colorClass(parentColor)}`;
      let stepIndex = 0;
      for (const child of node.children) {
        if (child.kind === "gloss" && child.name === "step") {
          stepIndex++;
          ol.appendChild(renderStep(child, parentColor, stepIndex));
        } else {
          ol.appendChild(renderChildren([child]));
        }
      }
      return ol;
    }

    case "step": {
      return renderStep(node, "", 1);
    }

    default: {
      const div = document.createElement("div");
      div.appendChild(renderChildren(node.children));
      return div;
    }
  }
}

function renderCell(node: GlossNode, parentColor: string, parentBorder: "solid" | "none"): HTMLElement {
  const div = document.createElement("div");
  const color = inheritColorFor(node, parentColor);
  // §3: `border` is `solid`/`none`; any other value (or omission) inherits the
  // parent grid's border per §6.1.
  const ownBorder = node.attrs.border;
  const effectiveBorder: "solid" | "none" =
    ownBorder === "none" ? "none" : ownBorder === "solid" ? "solid" : parentBorder;
  const borderClass = effectiveBorder === "none" ? " gloss-border-none" : " gloss-border-solid";
  div.className = `gloss-cell${colorClass(color)}${borderClass}`;
  if (node.attrs.title) {
    const strong = document.createElement("strong");
    strong.textContent = node.attrs.title;
    div.appendChild(strong);
  }
  div.appendChild(renderChildren(node.children));
  return div;
}

function renderStep(node: GlossNode, parentColor: string, index: number): HTMLElement {
  const li = document.createElement("li");
  const color = inheritColorFor(node, parentColor);
  li.className = `gloss-step${colorClass(color)}`;
  const strong = document.createElement("strong");
  strong.textContent = node.attrs.title ?? `Step ${index}`;
  li.appendChild(strong);
  li.appendChild(renderChildren(node.children));
  return li;
}
