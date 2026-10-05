import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPendingEntry,
  isUpgradeJson,
  pendingManualViolations,
  pendingViolations,
  readMarker,
  resolveInstalledVersion,
  resolveKumikoUpgradeBin,
  runKumikoUpgrade,
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
      expect(readMarker(app.dir)).toEqual({ version: "0.211.0", pendingManual: [] });
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
      expect(readMarker(app.dir)).toEqual({ version: "0.212.0-canary.3", pendingManual: [] });
    } finally {
      app.cleanup();
    }
  });
});

describe("readMarker pendingManual", () => {
  test("keeps well-formed open steps and drops malformed ones", () => {
    const app = withApp({
      ".kumiko/upgrade-state.json": JSON.stringify({
        version: "0.211.0",
        pendingManual: [
          { id: "a1b2c3d4", version: "0.210.0", title: "First" },
          { version: "0.210.0", title: "no id" },
          "junk",
        ],
      }),
    });
    try {
      expect(readMarker(app.dir)).toEqual({
        version: "0.211.0",
        pendingManual: [{ id: "a1b2c3d4", version: "0.210.0", title: "First" }],
      });
    } finally {
      app.cleanup();
    }
  });

  test("a non-array pendingManual is tolerated as empty", () => {
    const app = withApp({
      ".kumiko/upgrade-state.json": JSON.stringify({ version: "0.211.0", pendingManual: "x" }),
    });
    try {
      expect(readMarker(app.dir)).toEqual({ version: "0.211.0", pendingManual: [] });
    } finally {
      app.cleanup();
    }
  });
});

describe("pendingManualViolations", () => {
  test("no open steps → no violations", () => {
    expect(pendingManualViolations([])).toHaveLength(0);
  });

  test("two open steps → two violations, each naming the id, --resolve --reason and --not-applicable", () => {
    const violations = pendingManualViolations([
      { id: "a1b2c3d4", version: "0.210.0", title: "First step" },
      { id: "e5f6a7b8", version: "0.211.0", title: "Second step" },
    ]);
    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toContain("a1b2c3d4");
    expect(violations[0]?.message).toContain("First step");
    expect(violations[0]?.message).toContain("--resolve a1b2c3d4 --reason");
    expect(violations[0]?.message).toContain("--not-applicable");
    expect(violations[1]?.message).toContain("--resolve e5f6a7b8 --reason");
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

describe("resolveKumikoUpgradeBin", () => {
  test("prefers the repo-local node_modules/.bin over a PATH entry", () => {
    const app = withApp({ "node_modules/.bin/kumiko-upgrade": "#!/bin/sh\n" });
    const decoy = withApp({ "kumiko-upgrade": "#!/bin/sh\n" });
    chmodSync(join(decoy.dir, "kumiko-upgrade"), 0o755);
    try {
      expect(resolveKumikoUpgradeBin(app.dir, decoy.dir)).toBe(
        join(app.dir, "node_modules/.bin/kumiko-upgrade"),
      );
      expect(resolveKumikoUpgradeBin(join(decoy.dir, "nowhere"), decoy.dir)).toBe(
        join(decoy.dir, "kumiko-upgrade"),
      );
    } finally {
      app.cleanup();
      decoy.cleanup();
    }
  });
});

describe("runKumikoUpgrade", () => {
  test("a hanging binary is killed after the timeout and reported as a failure", async () => {
    const app = withApp({ "node_modules/.bin/kumiko-upgrade": "#!/bin/sh\nexec sleep 30\n" });
    chmodSync(join(app.dir, "node_modules/.bin/kumiko-upgrade"), 0o755);
    try {
      const startedAt = Date.now();
      const result = await runKumikoUpgrade("0.1.0", app.dir, 300);
      expect(result.ok).toBe(false);
      expect("error" in result && result.error).toContain("timed out after 300 ms");
      expect(Date.now() - startedAt).toBeLessThan(10_000);
    } finally {
      app.cleanup();
    }
  });
});
