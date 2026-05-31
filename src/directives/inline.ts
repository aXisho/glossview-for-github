import type { GlossNode } from "../parser";
import { renderInlineChildren } from "../renderer";
import { colorClass, safeColor } from "../render-utils";

export function renderInline(node: GlossNode): HTMLElement {
  switch (node.name) {
    case "badge": {
      const color = safeColor(node.attrs.color);
      const span = document.createElement("span");
      span.className = `gloss-badge${colorClass(color)}`;
      span.appendChild(renderInlineChildren(node.children));
      return span;
    }
    case "small": {
      const small = document.createElement("small");
      small.className = "gloss-small";
      small.appendChild(renderInlineChildren(node.children));
      return small;
    }
    case "kbd": {
      const kbd = document.createElement("span");
      kbd.className = "gloss-kbd";
      kbd.appendChild(renderInlineChildren(node.children));
      return kbd;
    }
    default: {
      const span = document.createElement("span");
      span.appendChild(renderInlineChildren(node.children));
      return span;
    }
  }
}
