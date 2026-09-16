import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPendingEntry,
  isUpgradeJson,
  pendingViolations,
  readMarker,
  resolveInstalledVersion,
} from "../guard-upgrade-state";

function withApp(files: Record<string, string> = {}): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-state-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("readMarker", () => {
  test("valid marker → returns version", () => {
    const app = withApp({
      ".kumiko/upgrade-state.json": JSON.stringify({ version: "0.211.0" }),
    });
    try {
      expect(readMarker(app.dir)).toEqual({ version: "0.211.0" });
    } finally {
      app.cleanup();
    }
  });

  test("missing marker → error mentions the fix command", () => {
    const app = withApp();
    try {
      const result = readMarker(app.dir);
      expect("error" in result && result.error).toContain("kumiko-upgrade --apply");
    } finally {
      app.cleanup();
    }
  });

  test("invalid JSON → error", () => {
    const app = withApp({ ".kumiko/upgrade-state.json": "{not json" });
    try {
      const result = readMarker(app.dir);
      expect("error" in result && result.error).toContain("not valid JSON");
    } finally {
      app.cleanup();
    }
  });

  test("missing version field → error", () => {
    const app = withApp({
      ".kumiko/upgrade-state.json": JSON.stringify({ appliedAt: "2026-01-01" }),
    });
    try {
      const result = readMarker(app.dir);
      expect("error" in result && result.error).toContain('"version"');
    } finally {
      app.cleanup();
    }
  });

  test("non-semver version field → error", () => {
    const app = withApp({
      ".kumiko/upgrade-state.json": JSON.stringify({ version: "--dir=/etc" }),
    });
    try {
      const result = readMarker(app.dir);
      expect("error" in result && result.error).toContain('"version"');
    } finally {
      app.cleanup();
    }
  });

  test("prerelease version is accepted", () => {
    const app = withApp({
      ".kumiko/upgrade-state.json": JSON.stringify({ version: "0.212.0-canary.3" }),
    });
    try {
      expect(readMarker(app.dir)).toEqual({ version: "0.212.0-canary.3" });
    } finally {
      app.cleanup();
    }
  });
});

describe("resolveInstalledVersion", () => {
  test("prefers installedVersion when present", () => {
    expect(
      resolveInstalledVersion({
        currentVersion: "0.211.0",
        installedVersion: "0.215.0",
        pending: [],
      }),
    ).toBe("0.215.0");
  });

  test("falls back to currentVersion when installedVersion is absent", () => {
    expect(resolveInstalledVersion({ currentVersion: "0.211.0", pending: [] })).toBe("0.211.0");
  });

  test("falls back to currentVersion when installedVersion is null", () => {
    expect(
      resolveInstalledVersion({ currentVersion: "0.211.0", installedVersion: null, pending: [] }),
    ).toBe("0.211.0");
  });
});

describe("isPendingEntry / isUpgradeJson", () => {
  test("accepts a well-formed pending entry", () => {
    expect(isPendingEntry({ version: "0.211.0", type: "breaking", title: "x" })).toBe(true);
  });

  test("rejects a pending entry missing a field", () => {
    expect(isPendingEntry({ version: "0.211.0", type: "breaking" })).toBe(false);
  });

  test("accepts valid upgrade JSON with an empty pending array", () => {
    expect(isUpgradeJson({ currentVersion: "0.211.0", pending: [] })).toBe(true);
  });

  test("rejects upgrade JSON with a non-array pending field", () => {
    expect(isUpgradeJson({ currentVersion: "0.211.0", pending: "none" })).toBe(false);
  });

  test("rejects upgrade JSON whose installedVersion is not a string, null, or undefined", () => {
    expect(isUpgradeJson({ currentVersion: "0.211.0", installedVersion: 5, pending: [] })).toBe(
      false,
    );
  });
});

describe("pendingViolations", () => {
  test("empty pending → no violations", () => {
    expect(pendingViolations({ currentVersion: "0.211.0", pending: [] }, "0.211.0")).toHaveLength(
      0,
    );
  });

  test("pending entries → one violation each, naming version/type/title and the fix command", () => {
    const violations = pendingViolations(
      {
        currentVersion: "0.205.0",
        installedVersion: "0.211.0",
        pending: [{ version: "0.211.0", type: "breaking", title: "Some breaking change" }],
      },
      "0.205.0",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("0.211.0");
    expect(violations[0]?.message).toContain("breaking");
    expect(violations[0]?.message).toContain("Some breaking change");
    expect(violations[0]?.message).toContain("kumiko-upgrade --apply");
  });
});
