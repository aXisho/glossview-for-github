// Gloss Markdown parser — returns a GlossChild[] tree (not HTML strings).
//
// Recognizes:
//   - Fenced block directives: ```name attrs ... ```
//   - Nested container directives: ````tabs ... \n ```tab ... ``` ... ````
//   - Inline directives: `text`{name attrs}
//   - Heading attributes: ## Text {heading attrs}

import { parseAttrs } from "./attrs";
import {
  ALLOWED_COLORS,
  FENCED_BLOCK_NAMES,
  INLINE_DIRECTIVES,
  SAFE_URL_PATTERN,
  SAFE_URL_RE,
  parseDirectiveAttrs,
  shouldParseFencedDirective,
} from "./gloss-spec";

export { ALLOWED_COLORS, SAFE_URL_PATTERN, SAFE_URL_RE, parseAttrs };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GlossNode {
  kind: "gloss";
  name: string;
  attrs: Record<string, string>;
  children: GlossChild[];
  inline: boolean;
  selfClosing: boolean;
}

export interface TextNode {
  kind: "text";
  content: string;
}

export interface InlineParagraph {
  kind: "inline-para";
  children: GlossChild[];
}

export type GlossChild = GlossNode | TextNode | InlineParagraph;

// ── Directive vocabulary ──────────────────────────────────────────────────────

// Heading attributes: Markdown ATX heading text followed by `{heading attrs}`.
// Captures: 1 = `#` count (1..6), 2 = heading text, 3 = attrs text.
const HEADING_PROMOTION_RE =
  /^ {0,3}(#{1,6})\s+(?!.*\s#+\s+\{heading(?:\s|}))(.*?)\s+\{heading(\s+[^}\n]*)?\}\s*$/i;
const PLAIN_HEADING_RE = /^ {0,3}(#{1,6})\s+/;

// ── Inline directive splitter ─────────────────────────────────────────────────
//
// Splits a single line into a mix of text segments and inline GlossNodes.
// Pattern: `text`{name attrs}
//
// The text follows the GFM code-span rule: a run of N backticks opens the span,
// and the next run of exactly N backticks closes it. This lets the text contain
// fewer backticks than the delimiter (e.g. ``a`b``{kbd}). The brace block must
// immediately follow the closing run and close on the same line.

function normalizeCodeSpanText(text: string): string {
  const normalized = text.replace(/\r?\n/g, " ");
  if (
    normalized.length >= 2 &&
    normalized.startsWith(" ") &&
    normalized.endsWith(" ") &&
    /[^ ]/.test(normalized.slice(1, -1))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function splitInlineLine(line: string): GlossChild[] {
  const out: GlossChild[] = [];
  let lastIdx = 0;
  let pos = 0;

  while (pos < line.length) {
    const matchStart = line.indexOf("`", pos);
    if (matchStart === -1) break;

    let openEnd = matchStart + 1;
    while (openEnd < line.length && line[openEnd] === "`") openEnd++;
    const markerLen = openEnd - matchStart;

    let closeStart = -1;
    let search = openEnd;
    while (search < line.length) {
      const tick = line.indexOf("`", search);
      if (tick === -1) break;
      let tickEnd = tick + 1;
      while (tickEnd < line.length && line[tickEnd] === "`") tickEnd++;
      if (tickEnd - tick === markerLen) {
        closeStart = tick;
        break;
      }
      search = tickEnd;
    }

    if (closeStart === -1) break;

    const closeEnd = closeStart + markerLen;
    if (line[closeEnd] !== "{") {
      pos = closeEnd;
      continue;
    }

    const braceEnd = line.indexOf("}", closeEnd + 1);
    if (braceEnd === -1) {
      pos = closeEnd;
      continue;
    }

    const directiveText = line.slice(closeEnd + 1, braceEnd);
    const directiveMatch = /^([a-z][a-z0-9-]*)(?:\s+([^}\n]*))?$/i.exec(directiveText);
    if (!directiveMatch) {
      pos = braceEnd + 1;
      continue;
    }

    const name = directiveMatch[1].toLowerCase();
    const attrsStr = (directiveMatch[2] ?? "").trim();

    if (!INLINE_DIRECTIVES.has(name)) {
      pos = braceEnd + 1;
      continue;
    }

    if (matchStart > lastIdx) {
      out.push({ kind: "text", content: line.slice(lastIdx, matchStart) });
    }

    out.push({
      kind: "gloss",
      name,
      attrs: parseDirectiveAttrs(name, attrsStr),
      children: [{ kind: "text", content: normalizeCodeSpanText(line.slice(openEnd, closeStart)) }],
      inline: true,
      selfClosing: false,
    });

    lastIdx = braceEnd + 1;
    pos = lastIdx;
  }

  if (lastIdx < line.length) {
    out.push({ kind: "text", content: line.slice(lastIdx) });
  }

  return out;
}

// Apply inline splitting to every line of a text body.
//
// Lines inside a fenced code block are emitted verbatim: per §2/§8 the body of a
// (non-directive) code fence is a code block, so a `` `x`{name} `` sequence in
// there is part of the code, not an inline directive. We follow the same
// CommonMark fence rule used elsewhere — a fence opens on `` ``` ``/`~~~` (length
// ≥ 3) and closes on a line of the same character, length ≥ the opener, with no
// trailing info string.
const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

function isFenceClose(line: string, fenceChar: string, minLen: number): boolean {
  const escaped = fenceChar === "`" ? "`" : "\\~";
  return new RegExp(`^[ \\t]{0,3}${escaped}{${minLen},}\\s*$`).test(line);
}

function applyInlineToText(text: string): GlossChild[] {
  if (!text) return [];
  // Quick path: no backticks at all → no inline directives possible.
  if (text.indexOf("`") < 0) return [{ kind: "text", content: text }];

  const lines = text.split("\n");
  const out: GlossChild[] = [];
  let fenceChar = "";
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;

    if (fenceLen > 0) {
      // Inside a code fence: pass the line through verbatim and check for close.
      if (isFenceClose(line, fenceChar, fenceLen)) {
        fenceChar = "";
        fenceLen = 0;
      }
      appendText(out, line);
      if (!isLast) appendText(out, "\n");
      continue;
    }

    const fenceMatch = FENCE_LINE_RE.exec(line);
    if (fenceMatch && !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))) {
      // Opening fence — start verbatim mode, emit the line as-is.
      fenceChar = fenceMatch[1][0];
      fenceLen = fenceMatch[1].length;
      appendText(out, line);
      if (!isLast) appendText(out, "\n");
      continue;
    }

    const segments = splitInlineLine(line);

    if (segments.length === 0) {
      if (!isLast) appendText(out, "\n");
      continue;
    }

    for (const seg of segments) out.push(seg);
    if (!isLast) appendText(out, "\n");
  }

  return mergeTextRuns(out);
}

function appendText(arr: GlossChild[], content: string): void {
  const last = arr[arr.length - 1];
  if (last && last.kind === "text") {
    last.content += content;
  } else {
    arr.push({ kind: "text", content });
  }
}

function mergeTextRuns(children: GlossChild[]): GlossChild[] {
  const out: GlossChild[] = [];
  for (const c of children) {
    if (c.kind === "text") {
      const last = out[out.length - 1];
      if (last && last.kind === "text") {
        last.content += c.content;
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

// ── Fenced block detection ────────────────────────────────────────────────────
//
// Recognizes a code fence whose info string starts with a known directive
// name. Honors CommonMark's fence-length rule: a fence is closed only by a
// fence of the same character of equal or greater length.

const FENCE_OPEN_RE = /^([ \t]{0,3})(`{3,}|~{3,})\s*([a-z][a-z0-9-]*)(\s+[^\n]*)?$/i;

interface FenceCapture {
  /** Number of source lines consumed (including opening and closing fences). */
  consumed: number;
  /** Directive name on the info string. */
  name: string;
  /** Attribute text (everything after the name on the info line). */
  attrsText: string;
  /** Body lines between the opening and closing fence (closing not included). */
  bodyLines: string[];
  /** True if no matching closing fence was found (unterminated directive). */
  unterminated: boolean;
}

function detectFence(lines: string[], start: number): FenceCapture | null {
  if (start >= lines.length) return null;
  const m = FENCE_OPEN_RE.exec(lines[start]);
  if (!m) return null;

  const indent = m[1];
  const marker = m[2];
  const name = m[3].toLowerCase();
  const attrsText = (m[4] ?? "").trim();
  if (marker[0] === "`" && attrsText.includes("`")) return null;

  // Match closing fence: same char, length ≥ opening, optionally indented.
  const fenceChar = marker[0];
  const minLen = marker.length;
  const closeRe = new RegExp(`^[ \\t]{0,3}\\${fenceChar}{${minLen},}\\s*$`);

  const body: string[] = [];
  let i = start + 1;
  let unterminated = true;

  while (i < lines.length) {
    if (closeRe.test(lines[i])) {
      unterminated = false;
      i++;
      break;
    }
    body.push(lines[i]);
    i++;
  }

  // Strip the opening fence's base indent from body lines (best-effort).
  const stripped = indent ? body.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)) : body;

  return {
    consumed: i - start,
    name,
    attrsText,
    bodyLines: stripped,
    unterminated,
  };
}

// ── parse ─────────────────────────────────────────────────────────────────────

export function parseGlossMd(source: string): GlossChild[] {
  const lines = source.split("\n");
  const tree = parseLines(lines);
  mergeInlineParas(tree);
  return tree;
}

function parseLines(lines: string[], parentName?: string): GlossChild[] {
  const out: GlossChild[] = [];
  /** Accumulated raw text awaiting flush. Lines are joined with `\n`. */
  let textBuf: string[] = [];
  let inFenceBuf = false;
  let fenceBufChar = "";
  let fenceBufLen = 0;
  const headingStack: Array<{ level: number; indent: number }> = [];

  /** Flush accumulated text as TextNode(s), applying inline directive splitting. */
  const flushText = (): void => {
    if (textBuf.length === 0) return;
    const raw = textBuf.join("\n");
    textBuf = [];
    if (!raw) return;
    const parts = applyInlineToText(raw);
    for (const p of parts) out.push(p);
  };

  /** True if the line opens a non-directive fenced block we should pass through verbatim. */
  const isPassThroughFenceOpen = (line: string): { marker: string } | null => {
    // A normal Markdown fence (no Gloss directive name in info string).
    const m = /^[ \t]{0,3}(`{3,}|~{3,})\s*(\S+)?/.exec(line);
    if (!m) return null;
    const marker = m[1];
    const lang = m[2];
    if (marker[0] === "`" && line.slice(line.indexOf(marker) + marker.length).includes("`")) return null;
    if (lang && FENCED_BLOCK_NAMES.has(lang.toLowerCase()) && shouldParseFencedDirective(lang.toLowerCase(), parentName)) {
      return null;
    }
    return { marker };
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];

    // ── Inside a pass-through (non-directive) fenced code block ──────────────
    if (inFenceBuf) {
      textBuf.push(line);
      if (isFenceClose(line, fenceBufChar, fenceBufLen)) {
        inFenceBuf = false;
        fenceBufChar = "";
        fenceBufLen = 0;
      }
      i++;
      continue;
    }

    // ── Gloss fenced block ───────────────────────────────────────────────────
    if (line.trimStart().startsWith("`") || line.trimStart().startsWith("~")) {
      const fc = detectFence(lines, i);
      if (fc && FENCED_BLOCK_NAMES.has(fc.name) && shouldParseFencedDirective(fc.name, parentName)) {
        if (fc.unterminated) {
          textBuf.push(...lines.slice(i, i + fc.consumed));
          i += fc.consumed;
          continue;
        }
        flushText();
        const innerChildren = parseLines(fc.bodyLines, fc.name);
        mergeInlineParas(innerChildren);
        out.push({
          kind: "gloss",
          name: fc.name,
          attrs: parseDirectiveAttrs(fc.name, fc.attrsText),
          children: innerChildren,
          inline: false,
          selfClosing: false,
        });
        i += fc.consumed;
        continue;
      }
    }

    // ── Non-directive fence open: enter pass-through mode (text accumulation) ─
    {
      const fo = isPassThroughFenceOpen(line);
      if (fo) {
        textBuf.push(line);
        inFenceBuf = true;
        fenceBufChar = fo.marker[0];
        fenceBufLen = fo.marker.length;
        i++;
        continue;
      }
    }

    // ── Heading attributes: `# ` … `###### ` followed by `{heading …}` ────
    {
      const hm = HEADING_PROMOTION_RE.exec(line);
      if (hm) {
        flushText();
        const level = hm[1].length;
        const text = hm[2];
        const attrsText = (hm[3] ?? "").trim();
        const attrs = parseDirectiveAttrs("heading", attrsText);
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const inheritedIndent = headingStack[headingStack.length - 1]?.indent ?? 0;
        const indent = inheritedIndent + (attrs.nest === "true" ? 1 : 0);
        attrs.level = String(level);
        if (indent > 0) attrs.indent = String(indent);
        headingStack.push({ level, indent });
        out.push({
          kind: "gloss",
          name: "heading",
          attrs,
          children: [{ kind: "text", content: text }],
          inline: false,
          selfClosing: false,
        });
        i++;
        continue;
      }
    }

    {
      const hm = PLAIN_HEADING_RE.exec(line);
      if (hm) {
        const level = hm[1].length;
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const inheritedIndent = headingStack[headingStack.length - 1]?.indent ?? 0;
        headingStack.push({ level, indent: inheritedIndent });
      }
    }

    // ── Ordinary line: accumulate as text ────────────────────────────────────
    textBuf.push(line);
    i++;
  }

  flushText();
  return mergeTextRuns(out);
}

// ── mergeInlineParas ─────────────────────────────────────────────────────────

function mergeInlineParas(children: GlossChild[]): void {
  for (const child of children) {
    if (child.kind === "gloss" && !child.inline) {
      mergeInlineParas(child.children);
    }
  }

  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.kind !== "gloss" || !node.inline) {
      i++;
      continue;
    }

    const run: GlossChild[] = [];

    if (i > 0 && children[i - 1].kind === "text") {
      const prev = children[i - 1] as TextNode;
      const nlIdx = prev.content.lastIndexOf("\n");
      const tail = nlIdx >= 0 ? prev.content.slice(nlIdx + 1) : prev.content;
      const head = nlIdx >= 0 ? prev.content.slice(0, nlIdx + 1) : "";
      if (tail) run.push({ kind: "text", content: tail });
      if (head) {
        prev.content = head;
      } else {
        children.splice(i - 1, 1);
        i--;
      }
    }

    let j = i;
    while (j < children.length) {
      const c = children[j];
      if (c.kind === "gloss" && c.inline) {
        run.push(c);
        j++;
        continue;
      }
      if (c.kind === "text") {
        const nlIdx = c.content.indexOf("\n");
        if (nlIdx === -1) {
          run.push(c);
          j++;
          continue;
        }
        if (nlIdx > 0) run.push({ kind: "text", content: c.content.slice(0, nlIdx) });
        c.content = c.content.slice(nlIdx);
        break;
      }
      break;
    }

    children.splice(i, j - i, { kind: "inline-para", children: run });
    i++;
  }
}
