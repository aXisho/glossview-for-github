import type { GlossNode } from "../parser";
import { renderChildren } from "../renderer";
import { colorClass, safeColor } from "../render-utils";

export function renderDetails(node: GlossNode): HTMLElement {
  const color = safeColor(node.attrs.color);
  const details = document.createElement("details");
  details.className = `gloss-details${colorClass(color)}`;

  if (node.attrs.open === "true") {
    details.open = true;
  }

  const summary = document.createElement("summary");
  summary.textContent = node.attrs.title ?? "Details";
  details.appendChild(summary);

  details.appendChild(renderChildren(node.children));
  return details;
}
