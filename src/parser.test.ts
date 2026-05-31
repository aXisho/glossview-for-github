import { describe, expect, it } from "vitest";
import { SAFE_URL_RE, parseAttrs, parseGlossMd } from "./parser";

describe("parseAttrs", () => {
  it("parses quoted and unquoted attributes", () => {
    expect(parseAttrs('title="Hello world" color=blue disabled')).toEqual({
      title: "Hello world",
      color: "blue",
    });
  });

  it("parses bare attributes only when they are configured as boolean", () => {
    expect(parseAttrs("title open", { booleanAttrs: ["open"] })).toEqual({
      open: "true",
    });
    expect(parseAttrs("foo_bar=1")).toEqual({});
  });

  it("accepts only the lowercase literals true/false for boolean attributes (§6.3)", () => {
    expect(parseAttrs("open=true", { booleanAttrs: ["open"] })).toEqual({ open: "true" });
    expect(parseAttrs("open=false", { booleanAttrs: ["open"] })).toEqual({ open: "false" });
  });

  it("leaves boolean value validation to directive-specific parsing", () => {
    for (const invalid of ["open=True", "open=1", "open=yes", "open=FALSE", "open=0"]) {
      expect(parseAttrs(invalid, { booleanAttrs: ["open"] })).toEqual({
        open: invalid.slice("open=".length),
      });
    }
  });

  it("normalizes attribute names to lowercase", () => {
    expect(parseAttrs('TITLE="Hello world" Color=blue DISABLED')).toEqual({
      title: "Hello world",
      color: "blue",
    });
  });

  it("unescapes only the spec escape sequences (\\\" and \\\\)", () => {
    // §6.2 defines only `\"` and `\\`. `\n` is not an escape sequence, so it
    // stays as a literal backslash + n.
    expect(parseAttrs(String.raw`label="Line\n\"quoted\""`)).toEqual({
      label: String.raw`Line\n"quoted"`,
    });
    expect(parseAttrs(String.raw`path="a\\b"`)).toEqual({ path: String.raw`a\b` });
  });
});

describe("parseGlossMd — callouts (GitHub Alert form)", () => {
  it("leaves GitHub Alerts as Markdown instead of Gloss directive nodes", () => {
    const src = "> [!NOTE]\n> Read the docs.";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("leaves alert-like toc notation as Markdown", () => {
    const src = "> [!toc title=\"Contents\" depth=3]";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });
});

describe("parseGlossMd — fenced block directives", () => {
  it("parses a details directive with attrs", () => {
    const nodes = parseGlossMd([
      "```details title=\"Trace\" color=red",
      "Body text.",
      "```",
    ].join("\n"));

    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "details",
        attrs: { title: "Trace", color: "red" },
        inline: false,
        selfClosing: false,
      },
    ]);
  });

  it("matches fenced directive names case-insensitively", () => {
    const nodes = parseGlossMd([
      "```Details TITLE=\"Trace\" COLOR=red",
      "Body text.",
      "```",
    ].join("\n"));

    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "details",
        attrs: { title: "Trace", color: "red" },
      },
    ]);
  });

  it("leaves non-directive code blocks alone (as text passthrough)", () => {
    const src = [
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");

    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toContain("```js");
  });

  it("does not treat backtick fences with backticks in the info string as directives", () => {
    const src = [
      "```details title=\"`code`\"",
      "Body text.",
      "```",
    ].join("\n");

    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("allows backticks in directive attributes when the directive uses a tilde fence", () => {
    const nodes = parseGlossMd([
      "~~~details title=\"`code`\"",
      "Body text.",
      "~~~",
    ].join("\n"));

    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "details",
        attrs: { title: "`code`" },
      },
    ]);
  });

  it("parses nested container/child via fence-length difference", () => {
    const src = [
      "````tabs",
      "```tab title=\"C++\"",
      "code",
      "```",
      "",
      "```tab title=\"Blueprint\"",
      "nodes",
      "```",
      "````",
    ].join("\n");

    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    const tabs = nodes[0] as { name: string; children: Array<{ kind: string; name?: string }> };
    expect(tabs.name).toBe("tabs");
    const tabChildren = tabs.children.filter((c) => c.kind === "gloss" && c.name === "tab");
    expect(tabChildren).toHaveLength(2);
  });

  it("leaves GitHub Alerts inside Gloss fenced blocks as Markdown", () => {
    const src = [
      "````tabs",
      "```tab title=\"X\"",
      "> [!WARNING] note",
      "> body",
      "```",
      "````",
    ].join("\n");

    const nodes = parseGlossMd(src);
    const tabs = nodes[0] as { children: Array<{ kind: string; name?: string; children?: unknown[] }> };
    const tab = tabs.children.find((c) => c.kind === "gloss" && c.name === "tab");
    expect(tab).toBeDefined();
    const tabChildren = (tab as { children: Array<{ kind: string; name?: string }> }).children;
    expect(tabChildren).toHaveLength(1);
    expect(tabChildren[0].kind).toBe("text");
  });

  it("drops unknown and invalid directive attribute values", () => {
    const nodes = parseGlossMd(
      [
        "```details title=\"Valid\" open=yes color=orange extra=1",
        "Body",
        "```",
        "",
        "```toc depth=7 title=\"Contents\"",
        "```",
        "",
        "```card href=\"javascript:alert(1)\" color=blue",
        "Body",
        "```",
      ].join("\n"),
    );

    expect(nodes).toMatchObject([
      { kind: "gloss", name: "details", attrs: { title: "Valid" } },
      { kind: "gloss", name: "toc", attrs: { title: "Contents" } },
      { kind: "gloss", name: "card", attrs: { color: "blue" } },
    ]);
  });

  it("requires child directives to be inside their matching container", () => {
    const src = ["```step title=\"Outside\"", "Body", "```"].join("\n");
    expect(parseGlossMd(src)).toEqual([{ kind: "text", content: src }]);
  });

  it("leaves unterminated Gloss fences as Markdown passthrough", () => {
    const src = ["```details title=\"Open\"", "Body with `Stable`{badge color=green}"].join("\n");
    expect(parseGlossMd(src)).toEqual([{ kind: "text", content: src }]);
  });

  it("leaves non-matching child directives inside containers as Markdown code blocks", () => {
    const src = ["````tabs", "```step title=\"Wrong child\"", "Body", "```", "````"].join("\n");
    const nodes = parseGlossMd(src);
    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "tabs",
        children: [{ kind: "text", content: '```step title="Wrong child"\nBody\n```' }],
      },
    ]);
  });
});

describe("parseGlossMd — toc directive", () => {
  it("recognizes fenced toc as an empty block directive", () => {
    const nodes = parseGlossMd(["```toc title=\"Contents\" depth=3", "```"].join("\n"));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: "gloss",
      name: "toc",
      attrs: { title: "Contents", depth: "3" },
      selfClosing: false,
      inline: false,
    });
  });
});

describe("parseGlossMd — inline directives", () => {
  it("parses `text`{name attrs}", () => {
    const nodes = parseGlossMd("API is `Stable`{badge color=green} today.");
    expect(nodes).toMatchObject([
      {
        kind: "inline-para",
        children: [
          { kind: "text", content: "API is " },
          {
            kind: "gloss",
            name: "badge",
            attrs: { color: "green" },
            inline: true,
            children: [{ kind: "text", content: "Stable" }],
          },
          { kind: "text", content: " today." },
        ],
      },
    ]);
  });

  it("matches inline directive names case-insensitively", () => {
    const nodes = parseGlossMd("API is `Stable`{Badge COLOR=green} today.");
    expect(nodes).toMatchObject([
      {
        kind: "inline-para",
        children: [
          { kind: "text", content: "API is " },
          {
            kind: "gloss",
            name: "badge",
            attrs: { color: "green" },
          },
          { kind: "text", content: " today." },
        ],
      },
    ]);
  });

  it("leaves bare inline code spans untouched", () => {
    const nodes = parseGlossMd("Use `npm install` to install.");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
  });

  it("parses kbd inline", () => {
    const nodes = parseGlossMd("Press `Ctrl + S`{kbd}.");
    const para = nodes[0] as { children: Array<{ name?: string }> };
    expect(para.children[1].name).toBe("kbd");
  });

  it("lets multi-backtick inline directives contain backticks (GFM code-span rule)", () => {
    const nodes = parseGlossMd("Use ``a`b``{kbd} here.");
    expect(nodes).toMatchObject([
      {
        kind: "inline-para",
        children: [
          { kind: "text", content: "Use " },
          {
            kind: "gloss",
            name: "kbd",
            inline: true,
            children: [{ kind: "text", content: "a`b" }],
          },
          { kind: "text", content: " here." },
        ],
      },
    ]);
  });

  it("normalizes inline directive text like a GFM code span", () => {
    const nodes = parseGlossMd("Use ` Ctrl + S `{kbd}.");
    expect(nodes).toMatchObject([
      {
        kind: "inline-para",
        children: [
          { kind: "text", content: "Use " },
          { kind: "gloss", name: "kbd", children: [{ kind: "text", content: "Ctrl + S" }] },
          { kind: "text", content: "." },
        ],
      },
    ]);
  });

  it("interprets multiple inline directives on one line independently", () => {
    const nodes = parseGlossMd("`A`{badge} and `B`{kbd}");
    expect(nodes).toMatchObject([
      {
        kind: "inline-para",
        children: [
          { kind: "gloss", name: "badge", children: [{ kind: "text", content: "A" }] },
          { kind: "text", content: " and " },
          { kind: "gloss", name: "kbd", children: [{ kind: "text", content: "B" }] },
        ],
      },
    ]);
  });

  it("does not treat a space-separated brace block as an inline directive", () => {
    const src = "`Stable` {badge color=green}";
    const nodes = parseGlossMd(src);
    expect(nodes).toEqual([{ kind: "text", content: src }]);
  });
});

describe("parseGlossMd — heading promotion", () => {
  it("promotes ## Title {heading color=blue} to a heading GlossNode", () => {
    const nodes = parseGlossMd("## Section Title {heading color=blue}");
    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "heading",
        attrs: { color: "blue", level: "2" },
        children: [{ kind: "text", content: "Section Title" }],
        inline: false,
        selfClosing: false,
      },
    ]);
  });

  it("matches heading directive names case-insensitively", () => {
    const nodes = parseGlossMd("## Section Title {Heading COLOR=blue}");
    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "heading",
        attrs: { color: "blue", level: "2" },
      },
    ]);
  });

  it("promotes heading attributes with GFM heading indentation", () => {
    const nodes = parseGlossMd("   ## Section Title {heading color=blue}");
    expect(nodes).toMatchObject([
      {
        kind: "gloss",
        name: "heading",
        attrs: { color: "blue", level: "2" },
        children: [{ kind: "text", content: "Section Title" }],
      },
    ]);
  });

  it("does not promote heading attributes indented as code blocks", () => {
    const src = "    ## Section Title {heading color=blue}";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("does not promote heading attributes after a closing hash sequence", () => {
    const src = "## Section Title ## {heading color=blue}";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("captures heading level from the marker length", () => {
    const nodes = parseGlossMd("###### Sub {heading}");
    expect((nodes[0] as { attrs: Record<string, string> }).attrs.level).toBe("6");
  });

  it("does not promote the removed inline heading form", () => {
    const src = "## `Section Title`{heading color=blue}";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("computes inherited visual indent for nested heading sections", () => {
    const nodes = parseGlossMd([
      "## Parent {heading color=blue nest}",
      "",
      "### Child {heading color=green}",
      "",
      "### Deeper {heading color=green nest}",
    ].join("\n"));
    const headings = nodes.filter((n) => n.kind === "gloss" && (n as { name: string }).name === "heading") as Array<{ attrs: Record<string, string> }>;
    expect(headings.map((h) => h.attrs.indent)).toEqual(["1", "1", "2"]);
  });

  it("ignores an invalid nest value and does not indent (§6.1/§6.3)", () => {
    const nodes = parseGlossMd("## Heading {heading nest=yes}");
    const heading = nodes[0] as { attrs: Record<string, string> };
    expect(heading.attrs.nest).toBeUndefined();
    expect(heading.attrs.indent).toBeUndefined();
  });
});

describe("parseGlossMd — details boolean attribute", () => {
  it("keeps the open flag for valid boolean values", () => {
    const open = parseGlossMd(["```details title=\"X\" open", "body", "```"].join("\n"));
    expect((open[0] as { attrs: Record<string, string> }).attrs.open).toBe("true");
  });

  it("drops an invalid open value so the section stays collapsed (§6.1/§6.3)", () => {
    for (const bad of ["open=yes", "open=1", "open=True"]) {
      const nodes = parseGlossMd(["```details title=\"X\" " + bad, "body", "```"].join("\n"));
      expect((nodes[0] as { attrs: Record<string, string> }).attrs.open).toBeUndefined();
    }
  });
});

describe("SAFE_URL_RE", () => {
  it("matches the spec href forms", () => {
    for (const href of [
      "http://example.com",
      "https://example.com",
      "HTTPS://example.com",
      "#anchor",
      "/docs/guide.md",
      "./guide.md",
      "../guide.md",
      "foo.md",
      "docs/guide.md",
    ]) {
      expect(SAFE_URL_RE.test(href)).toBe(true);
    }

    for (const href of ["javascript:alert(1)", "data:text/html,test", "vbscript:msgbox", "//example.com", "mailto:test@example.com"]) {
      expect(SAFE_URL_RE.test(href)).toBe(false);
    }

    for (const href of ["https://example.com javascript:alert(1)", "/docs/guide.md javascript:alert(1)", "foo bar.md"]) {
      expect(SAFE_URL_RE.test(href)).toBe(false);
    }
  });
});

describe("parseGlossMd — unknown inline directives", () => {
  it("leaves removed inline directives as text", () => {
    const src = "The score is `1,247`{big} today.";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });
});

describe("parseGlossMd — grid attributes", () => {
  it("captures cols and border on grid", () => {
    const nodes = parseGlossMd([
      "````grid cols=2 border=none",
      "```cell",
      "A",
      "```",
      "````",
    ].join("\n"));
    const grid = nodes[0] as { name: string; attrs: Record<string, string> };
    expect(grid.name).toBe("grid");
    expect(grid.attrs.cols).toBe("2");
    expect(grid.attrs.border).toBe("none");
  });

  it("does not require cols (auto-fit case)", () => {
    const nodes = parseGlossMd([
      "````grid border=none",
      "```cell",
      "A",
      "```",
      "",
      "```cell",
      "B",
      "```",
      "````",
    ].join("\n"));
    const grid = nodes[0] as { name: string; attrs: Record<string, string>; children: Array<{ name: string }> };
    expect(grid.attrs.cols).toBeUndefined();
    const cells = grid.children.filter((c) => c.name === "cell");
    expect(cells).toHaveLength(2);
  });
});

describe("parseGlossMd — grid border=none", () => {
  it("records border=none on grid and cell", () => {
    const nodes = parseGlossMd([
      "````grid cols=2 border=none",
      "```cell",
      "A",
      "```",
      "",
      "```cell border=solid",
      "B",
      "```",
      "````",
    ].join("\n"));
    expect(nodes).toHaveLength(1);
    const grid = nodes[0] as { attrs: Record<string, string>; children: Array<{ attrs: Record<string, string>; name: string }> };
    expect(grid.attrs.border).toBe("none");
    const cells = grid.children.filter((c) => c.name === "cell");
    expect(cells[0].attrs.border).toBeUndefined();
    expect(cells[1].attrs.border).toBe("solid");
  });
});

describe("parseGlossMd — math notation", () => {
  it("leaves ```math fenced blocks as ordinary Markdown code", () => {
    const src = ["```math", "E = mc^2", "```"].join("\n");
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("leaves removed inline math directives as text", () => {
    const src = "The equation `E = mc^2`{math} is famous.";
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });
});


describe("parseGlossMd — pass-through behaviour", () => {
  it("does not parse alerts inside fenced code blocks (verbatim passthrough)", () => {
    const src = [
      "Before.",
      "```",
      "> [!WARNING] inside",
      "> body",
      "```",
      "After.",
    ].join("\n");

    const nodes = parseGlossMd(src);
    // No callout GlossNode should appear; entire run is text.
    const hasCallout = nodes.some((n) => n.kind === "gloss" && (n as { name: string }).name === "warning");
    expect(hasCallout).toBe(false);
  });

  it("keeps pass-through fences open until a closing fence of the same character", () => {
    const src = ["```js", "```~~~", "`Stable`{badge color=green}", "```"].join("\n");
    const nodes = parseGlossMd(src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("text");
    expect((nodes[0] as { content: string }).content).toBe(src);
  });

  it("does not close pass-through fences with four-space-indented fence text", () => {
    const src = ["```js", "    ```", "`Stable`{badge color=green}", "```"].join("\n");
    const nodes = parseGlossMd(src);
    expect(nodes).toEqual([{ kind: "text", content: src }]);
  });
});
