import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// getUnscopedAggregateStreamMaxVersion has no tenant filter — a caller can use
// it to probe whether a foreign tenant's aggregate exists (see event-store.ts
// SECURITY doc). Restricted to known seed/system-internal callers; extend
// only for genuine new ones.
const RESTRICTED_SYMBOLS = ["getUnscopedAggregateStreamMaxVersion"];

const ALLOWED_FILES = new Set([
  "packages/framework/src/event-store/event-store.ts",
  "packages/framework/src/event-store/index.ts",
  "packages/bundled-features/src/tenant/seeding.ts",
  "packages/bundled-features/src/tier-engine/feature.ts",
  "packages/framework/src/event-store/__tests__/unscoped-stream-primitives.guard.test.ts",
]);

const REPO_ROOT = `${import.meta.dir}/../../../../..`;

describe("unscoped stream primitives — caller allowlist", () => {
  test("only seed/system-internal paths reference the existence-oracle primitives", async () => {
    // Widened from {framework,bundled-features} — the primitives are exported
    // from the public @cosmicdrift/kumiko-framework/event-store barrel, so any
    // package (server-runtime, dispatcher-live, headless, renderer-web, cli, ...)
    // can import and call them; the allowlist must cover all of them, not just
    // the two packages that happened to have callers when this guard was written.
    const glob = new Glob("packages/*/src/**/*.ts");
    const matches = new Set<string>();
    for await (const relPath of glob.scan({ cwd: REPO_ROOT })) {
      const content = await Bun.file(`${REPO_ROOT}/${relPath}`).text();
      // Strip full-line `//` comments before scanning — a bare
      // `content.includes(symbol)` also matches a symbol only mentioned in
      // prose (e.g. explaining why a helper isn't needed), which would force
      // an unrelated file into the allowlist for a reference that isn't an
      // actual import or call.
      const code = content
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      const referencesSymbol = (symbol: string): boolean =>
        new RegExp(`\\b${symbol}\\s*\\(`).test(code) ||
        // Covers both `import { symbol } from "..."` and a re-export barrel
        // (`export { symbol } from "./event-store"`) — a new barrel that
        // surfaces the oracle primitive must widen the allowlist too.
        new RegExp(`\\b(import|export)\\b[^;]*\\b${symbol}\\b`).test(code);
      if (RESTRICTED_SYMBOLS.some(referencesSymbol)) {
        matches.add(relPath);
      }
    }

    // Positive control — proves the scan actually ran and found the known
    // caller, not just that it (silently) found nothing.
    expect(matches.has("packages/bundled-features/src/tenant/seeding.ts")).toBe(true);

    const offenders = [...matches].filter((relPath) => !ALLOWED_FILES.has(relPath));
    expect(offenders).toEqual([]);
  });
});
