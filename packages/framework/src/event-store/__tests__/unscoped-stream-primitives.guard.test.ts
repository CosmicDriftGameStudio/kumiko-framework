import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// getUnscopedAggregateStreamMaxVersion / getUnscopedAggregateStreamTenant have
// no tenant filter — a caller can use them to probe whether a foreign tenant's
// aggregate exists (see event-store.ts SECURITY doc). Restricted to known
// seed/system-internal callers; extend only for genuine new ones.
const RESTRICTED_SYMBOLS = [
  "getUnscopedAggregateStreamMaxVersion",
  "getUnscopedAggregateStreamTenant",
];

const ALLOWED_FILES = new Set([
  "packages/framework/src/event-store/event-store.ts",
  "packages/framework/src/event-store/index.ts",
  "packages/bundled-features/src/tenant/seeding.ts",
  "packages/bundled-features/src/tier-engine/feature.ts",
  "packages/bundled-features/src/auth-email-password/__tests__/email-verification.integration.test.ts",
  "packages/bundled-features/src/auth-email-password/__tests__/password-reset.integration.test.ts",
  "packages/framework/src/event-store/__tests__/unscoped-stream-primitives.guard.test.ts",
]);

const REPO_ROOT = `${import.meta.dir}/../../../../..`;

describe("unscoped stream primitives — caller allowlist", () => {
  test("only seed/system-internal paths reference the existence-oracle primitives", async () => {
    const glob = new Glob("packages/{framework,bundled-features}/src/**/*.ts");
    const matches = new Set<string>();
    for await (const relPath of glob.scan({ cwd: REPO_ROOT })) {
      const content = await Bun.file(`${REPO_ROOT}/${relPath}`).text();
      if (RESTRICTED_SYMBOLS.some((symbol) => content.includes(symbol))) {
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
