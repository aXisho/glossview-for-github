import { parseAttrs } from "./attrs";

export const ALLOWED_COLORS = ["gray", "blue", "green", "yellow", "red", "purple"] as const;

export const SAFE_URL_RE = /^(?:https?:\/\/[^\s]*|#[^\s]*|\/(?!\/)[^\s]*|\.{1,2}\/[^\s]*|[^:/?#\s][^:\s]*)$/i;

export const SAFE_URL_PATTERN = SAFE_URL_RE;

const BLOCK_DIRECTIVES = ["details", "card", "toc"] as const;
const CONTAINER_DIRECTIVES = ["tabs", "steps", "grid"] as const;
const CHILD_DIRECTIVES = ["tab", "step", "cell"] as const;

export const INLINE_DIRECTIVES = new Set(["badge", "small", "kbd"]);

const BOOLEAN_ATTRS_BY_DIRECTIVE: Record<string, readonly string[]> = {
  details: ["open"],
  heading: ["nest"],
};

const CHILD_PARENT: Record<string, string> = {
  tab: "tabs",
  step: "steps",
  cell: "grid",
};

type AttrRule = "string" | "boolean" | "color" | "href" | "depth" | "positive-int" | "border";

const ATTR_RULES_BY_DIRECTIVE: Record<string, Record<string, AttrRule>> = {
  details: { title: "string", open: "boolean", color: "color" },
  card: { title: "string", href: "href", color: "color" },
  toc: { title: "string", depth: "depth" },
  tabs: { color: "color" },
  tab: { title: "string", color: "color" },
  steps: { color: "color" },
  step: { title: "string", color: "color" },
  grid: { cols: "positive-int", color: "color", border: "border" },
  cell: { title: "string", color: "color", border: "border" },
  badge: { color: "color" },
  small: {},
  kbd: {},
  heading: { color: "color", nest: "boolean" },
};

export const FENCED_BLOCK_NAMES = new Set<string>([
  ...BLOCK_DIRECTIVES,
  ...CONTAINER_DIRECTIVES,
  ...CHILD_DIRECTIVES,
]);

export function isAllowedColor(value: string): boolean {
  return (ALLOWED_COLORS as readonly string[]).includes(value);
}

export function isSafeHref(value: string): boolean {
  return SAFE_URL_RE.test(value);
}

function isValidAttrValue(rule: AttrRule, value: string): boolean {
  switch (rule) {
    case "string":
      return true;
    case "boolean":
      return value === "true" || value === "false";
    case "color":
      return isAllowedColor(value);
    case "href":
      return isSafeHref(value);
    case "depth":
      return /^[1-6]$/.test(value);
    case "positive-int":
      return /^[1-9]\d*$/.test(value);
    case "border":
      return value === "solid" || value === "none";
  }
}

export function parseDirectiveAttrs(name: string, attrsText: string): Record<string, string> {
  const attrs = parseAttrs(attrsText, { booleanAttrs: BOOLEAN_ATTRS_BY_DIRECTIVE[name] });
  const rules = ATTR_RULES_BY_DIRECTIVE[name] ?? {};
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(attrs)) {
    const rule = rules[key];
    if (!rule || !isValidAttrValue(rule, value)) continue;
    out[key] = value;
  }

  return out;
}

export function shouldParseFencedDirective(name: string, parentName?: string): boolean {
  const requiredParent = CHILD_PARENT[name];
  return !requiredParent || parentName === requiredParent;
}
