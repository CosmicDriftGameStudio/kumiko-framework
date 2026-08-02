// fw#1657: gen-migration-guide.ts had no test — the duplicate-section bug
// (a feature's "### heading" repeated once per breaking entry in the same
// version, plus packages/framework/src/changes.json double-counted via the
// generic "packages" enterprise-style scan) shipped straight into the
// committed doc because nothing pinned `collectChangelogs()`'s contract.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { collectChangelogs, keepVerifiedDateIfUnchanged } from "../gen-migration-guide";

function writeChangesJson(filePath: string, entries: unknown[]): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entries));
}

describe("collectChangelogs", () => {
  let baseDir: string;

  function setup(): void {
    baseDir = mkdtempSync(join(tmpdir(), "gen-migration-guide-test-"));
    // Reproduce the framework repo's own directory shape.
    writeChangesJson(join(baseDir, "packages/framework/src/changes.json"), [
      { version: "1.0.0", type: "breaking", title: "core change one" },
      { version: "1.0.0", type: "breaking", title: "core change two" },
    ]);
    writeChangesJson(
      join(baseDir, "packages/bundled-features/src/auth-email-password/changes.json"),
      [{ version: "1.0.0", type: "breaking", title: "auth change" }],
    );
    writeChangesJson(join(baseDir, "packages/enterprise-widget/src/changes.json"), [
      { version: "1.0.0", type: "breaking", title: "enterprise change" },
    ]);
  }

  test("returns each feature key exactly once", () => {
    setup();
    try {
      const changelogs = collectChangelogs(undefined, baseDir);
      const keys = [...changelogs.keys()];
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("framework-core is not re-picked-up by the generic packages scan", () => {
    setup();
    try {
      const changelogs = collectChangelogs(undefined, baseDir);
      expect(changelogs.has("framework-core")).toBe(true);
      expect(changelogs.get("framework-core")).toHaveLength(2);
      expect(changelogs.has("enterprise:framework")).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("framework-style and enterprise-style feature dirs are both collected under distinct keys", () => {
    setup();
    try {
      const changelogs = collectChangelogs(undefined, baseDir);
      expect(changelogs.get("auth-email-password")).toHaveLength(1);
      expect(changelogs.get("enterprise:enterprise-widget")).toHaveLength(1);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

// The CI step regenerates the guide and then runs `git diff --exit-code`.
// A fresh `verified` stamp on unchanged content made every day after the
// last commit fail the pipeline.
describe("keepVerifiedDateIfUnchanged", () => {
  const doc = (date: string, body: string) =>
    `---\ntitle: Migration Guide\nverified: ${date}\n---\n\n${body}\n`;
  let dir: string;
  let outPath: string;

  function withCommitted(content: string): void {
    dir = mkdtempSync(join(tmpdir(), "gen-migration-guide-verified-"));
    outPath = join(dir, "migration-guide.md");
    writeFileSync(outPath, content);
  }

  test("same body → committed date survives (no diff, green pipeline)", () => {
    withCommitted(doc("2026-08-01", "one breaking change"));
    try {
      const result = keepVerifiedDateIfUnchanged(
        doc("2026-08-02", "one breaking change"),
        outPath,
        "2026-08-02",
      );
      expect(result).toContain("verified: 2026-08-01");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("changed body → today's date wins", () => {
    withCommitted(doc("2026-08-01", "one breaking change"));
    try {
      const result = keepVerifiedDateIfUnchanged(
        doc("2026-08-02", "two breaking changes"),
        outPath,
        "2026-08-02",
      );
      expect(result).toContain("verified: 2026-08-02");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no committed file yet → today's date", () => {
    const missing = join(tmpdir(), "gen-migration-guide-does-not-exist.md");
    const generated = doc("2026-08-02", "first run");
    expect(keepVerifiedDateIfUnchanged(generated, missing, "2026-08-02")).toBe(generated);
  });
});
