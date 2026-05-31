import { parseAttrs } from "./attrs";
import { ALLOWED_COLORS } from "./gloss-spec";

export function safeColor(color: string | undefined, fallback = ""): string {
  return color && (ALLOWED_COLORS as readonly string[]).includes(color) ? color : fallback;
}

export function colorClass(color: string): string {
  return color ? ` gloss-color-${color}` : "";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Keep letters, numbers, whitespace, underscore and hyphen. GitHub
    // preserves underscores in heading anchors, so they must survive here.
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

/**
 * GitHub-compatible de-duplicating slug generator. The first occurrence of a
 * slug is used verbatim; subsequent collisions get `-1`, `-2`, … suffixes,
 * matching github-slugger (and therefore the anchor ids GitHub emits).
 */
export class Slugger {
  private occurrences = new Map<string, number>();

  slug(text: string): string {
    let result = slugify(text);
    if (!result) return "";
    const original = result;
    while (this.occurrences.has(result)) {
      const next = this.occurrences.get(original)! + 1;
      this.occurrences.set(original, next);
      result = `${original}-${next}`;
    }
    this.occurrences.set(result, 0);
    return result;
  }

  reset(): void {
    this.occurrences.clear();
  }
}

export function positiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^[1-9]\d*$/.test(value)) return null;
  return Number(value);
}

export function integerInRange(value: string | undefined, min: number, max: number): number | null {
  const parsed = positiveInteger(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null;
}

export function headingLevel(value: string | undefined, fallback = 2): 1 | 2 | 3 | 4 | 5 | 6 {
  const parsed = parseInt(value ?? "", 10);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  const level = Math.min(Math.max(base, 1), 6);
  return level as 1 | 2 | 3 | 4 | 5 | 6;
}

export function codeLanguageToken(language: string): string {
  const token = language.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(token) ? token : "";
}

export function codeFenceInfo(info: string): { language: string; filename: string } {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(info.trim());
  if (!match) return { language: "", filename: "" };
  return {
    language: codeLanguageToken(match[1]),
    filename: parseAttrs(match[2] ?? "").filename ?? "",
  };
}
