export interface ParseAttrsOptions {
  booleanAttrs?: Iterable<string>;
}

/**
 * Parse a Gloss Markdown attribute list.
 *
 * Supported forms:
 * - key=value
 * - key="value with spaces"
 * - booleanKey, only when configured through booleanAttrs
 */
export function parseAttrs(attrsString: string, options: ParseAttrsOptions = {}): Record<string, string> {
  const result: Record<string, string> = {};
  if (!attrsString.trim()) return result;

  const booleanAttrs = new Set(Array.from(options.booleanAttrs ?? [], (attr) => attr.toLowerCase()));
  const re = /(?:^|\s)([a-z][a-z0-9-]*)(?:=(?:"((?:[^"\\]|\\.)*)"|(\S*)))?(?=$|\s)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrsString)) !== null) {
    const key = match[1].toLowerCase();
    let value: string;
    if (match[2] !== undefined) {
      value = match[2]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (match[3] !== undefined) {
      value = match[3];
    } else {
      if (!booleanAttrs.has(key)) continue;
      value = "true";
    }

    result[key] = value;
  }
  return result;
}
