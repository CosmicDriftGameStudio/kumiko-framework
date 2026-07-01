import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

// publish-with-oidc.sh's pin-drift guard runs scripts/pin-drift.jq. It must let an
// independently-versioned package through (cli@0.2.x correctly pinning
// dev-server@0.67.x) while still catching a stale/lagging internal pin (#410:
// framework@0.50 when the release is 0.67). Regressing the guard to compare each
// pin against the depending package's OWN version silently re-breaks cli
// publishing — this pins both ends of that behaviour against the real .jq program.

const PROGRAM = fileURLToPath(new URL("../pin-drift.jq", import.meta.url));

function hasJq(): boolean {
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// This suite guards the pin-drift check itself — a silent skip when `jq` is
// missing would look green while providing zero protection. Fail loudly instead.
if (!hasJq()) {
  throw new Error("pin-drift.jq guard test requires `jq` on PATH (CI images ship it; `brew install jq` locally)");
}

const EXPECTED = {
  "@cosmicdrift/kumiko-dev-server": "0.67.0",
  "@cosmicdrift/kumiko-framework": "0.67.0",
} as const;

function runGuard(manifest: Record<string, unknown>): string {
  return execFileSync(
    "jq",
    ["-r", "--argjson", "expected", JSON.stringify(EXPECTED), "-f", PROGRAM],
    { input: JSON.stringify(manifest), encoding: "utf8" },
  ).trim();
}

describe("pin-drift.jq guard", () => {
  test("independent version line (cli pins dev-server@0.67) passes clean", () => {
    expect(runGuard({ dependencies: { "@cosmicdrift/kumiko-dev-server": "0.67.0" } })).toBe("");
  });

  test("stale internal pin (#410) is reported as drift", () => {
    expect(runGuard({ dependencies: { "@cosmicdrift/kumiko-framework": "0.50.0" } })).toBe(
      "@cosmicdrift/kumiko-framework@0.50.0 (expected 0.67.0)",
    );
  });

  test("unsubstituted workspace:* is reported as drift", () => {
    expect(runGuard({ dependencies: { "@cosmicdrift/kumiko-framework": "workspace:*" } })).toBe(
      "@cosmicdrift/kumiko-framework@workspace:* (expected 0.67.0)",
    );
  });

  test("external @cosmicdrift dep outside the workspace is skipped", () => {
    expect(runGuard({ dependencies: { "@cosmicdrift/some-external": "1.2.3" } })).toBe("");
  });

  test("lockstep deps all at the release version pass clean", () => {
    expect(
      runGuard({
        dependencies: {
          "@cosmicdrift/kumiko-framework": "0.67.0",
          "@cosmicdrift/kumiko-dev-server": "0.67.0",
        },
      }),
    ).toBe("");
  });

  test("peerDependency drift is reported", () => {
    expect(runGuard({ peerDependencies: { "@cosmicdrift/kumiko-dev-server": "0.66.0" } })).toBe(
      "@cosmicdrift/kumiko-dev-server@0.66.0 (expected 0.67.0)",
    );
  });

  test("optionalDependency drift is reported (same treatment as dependencies/peerDependencies)", () => {
    expect(runGuard({ optionalDependencies: { "@cosmicdrift/kumiko-framework": "0.60.0" } })).toBe(
      "@cosmicdrift/kumiko-framework@0.60.0 (expected 0.67.0)",
    );
  });
});
