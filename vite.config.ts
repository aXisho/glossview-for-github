import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

function escapeNonAscii(): Plugin {
  return {
    name: "escape-non-ascii",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") {
          chunk.code = chunk.code.replace(/[^\x00-\x7F]/gu, (ch) => {
            const cp = ch.codePointAt(0)!;
            if (cp <= 0xFFFF) {
              return `\\u${cp.toString(16).padStart(4, "0")}`;
            }
            const hi = Math.floor((cp - 0x10000) / 0x400) + 0xD800;
            const lo = ((cp - 0x10000) % 0x400) + 0xDC00;
            return `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
          });
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    target: "chrome120",
    outDir: "dist/glossview-for-github/src",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("src/content.ts", import.meta.url)),
      name: "GlossViewForGithub",
      formats: ["iife"],
      fileName: () => "content.js",
    },
    rollupOptions: {
      plugins: [escapeNonAscii()],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "vmThreads",
  },
});
