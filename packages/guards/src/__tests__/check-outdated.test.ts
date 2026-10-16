import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstalledPackage } from "../_lib/installed-packages";
import {
  findMajorLagWarning,
  interpretDeprecationLookup,
  type LatestRelease,
  type RegistryClient,
} from "../_lib/npm-registry";
import { findDeprecatedPackages, runOutdatedCheck } from "../check-outdated";

function fakeRegistry(
  deprecated: Record<string, string>,
  releases: Record<string, LatestRelease> = {},
  unreachable: readonly string[] = [],
): RegistryClient {
  return {
    deprecation: async (name, version) => {
      const key = `${name}@${version}`;
      if (unreachable.includes(key)) return { kind: "unknown", reason: "ConnectionRefused" };
      const message = deprecated[key];
      return message === undefined ? { kind: "current" } : { kind: "deprecated", message };
    },
    latestRelease: async (name) => releases[name] ?? null,
  };
}

describe("findMajorLagWarning", () => {
  const nowMs = Date.parse("2026-10-16T00:00:00Z");
  const release: LatestRelease = { version: "5.0.0", publishedAt: "2020-01-01T00:00:00.000Z" };

  test("warns when a newer major has been out for more than the lag window", () => {
    expect(findMajorLagWarning("example", "4.2.0", release, 12, nowMs)).toEqual({
      name: "example",
      current: "4.2.0",
      latest: "5.0.0",
      latestPublished: "2020-01-01T00:00:00.000Z",
    });
  });

  test("silent on the latest major and for a fresh release", () => {
    expect(findMajorLagWarning("example", "5.1.0", release, 12, nowMs)).toBeNull();
    expect(
      findMajorLagWarning("example", "4.2.0", release, 12, Date.parse("2020-03-01T00:00:00Z")),
    ).toBeNull();
  });

  test("an unparsable publish date is no finding", () => {
    expect(
      findMajorLagWarning("example", "4.2.0", { version: "5.0.0", publishedAt: "soon" }, 12, nowMs),
    ).toBeNull();
  });
});

describe("interpretDeprecationLookup", () => {
  test("a deprecation string is a finding", () => {
    expect(interpretDeprecationLookup({ ok: true, exitCode: 0, value: "use other" })).toEqual({
      kind: "deprecated",
      message: "use other",
    });
  });

  test("bun info's 'Property not found' answer means the version is not deprecated", () => {
    expect(
      interpretDeprecationLookup({
        ok: true,
        exitCode: 1,
        value: { error: "Property not found", version: "zod@4.1.0", property: "deprecated" },
      }),
    ).toEqual({ kind: "current" });
  });

  test("no registry answer is unknown with the reason, never 'not deprecated'", () => {
    expect(
      interpretDeprecationLookup({ ok: false, reason: "ConnectionRefused: view request failed" }),
    ).toEqual({ kind: "unknown", reason: "ConnectionRefused: view request failed" });
  });
});

describe("findDeprecatedPackages", () => {
  test("reports deprecated versions and keeps unanswered lookups apart from clean ones", async () => {
    const scan = await findDeprecatedPackages(
      [
        { name: "old", version: "1.0.0" },
        { name: "old", version: "2.0.0" },
        { name: "fine", version: "1.0.0" },
        { name: "offline", version: "1.0.0" },
      ],
      fakeRegistry({ "old@1.0.0": "gone" }, {}, ["offline@1.0.0"]),
    );
    expect(scan.deprecated).toEqual([{ name: "old", version: "1.0.0", message: "gone" }]);
    expect(scan.unresolved).toEqual([
      { name: "offline", version: "1.0.0", reason: "ConnectionRefused" },
    ]);
  });
});

describe("runOutdatedCheck", () => {
  const installed: InstalledPackage[] = [
    { name: "old", version: "1.0.0", license: "MIT", path: "/nm/old/package.json" },
  ];

  test("no installed packages is a loud failure", async () => {
    expect(await runOutdatedCheck({ repoRoot: "/nowhere", reportMode: false, installed: [] })).toBe(
      1,
    );
  });

  test("an installed package that is not a direct dependency is not blocking", async () => {
    const registry = fakeRegistry({ "old@1.0.0": "gone" });
    expect(
      await runOutdatedCheck({ repoRoot: "/nowhere", reportMode: false, installed, registry }),
    ).toBe(0);
  });

  describe("with direct dependencies the registry cannot answer", () => {
    let repoRoot = "";
    const directInstalled: InstalledPackage[] = [
      { name: "alpha", version: "1.0.0", license: "MIT", path: "/nm/alpha/package.json" },
      { name: "beta", version: "2.0.0", license: "MIT", path: "/nm/beta/package.json" },
    ];

    function writeRepo(): string {
      repoRoot = mkdtempSync(join(tmpdir(), "outdated-unknown-"));
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({ name: "fixture", dependencies: { alpha: "^1.0.0", beta: "^2.0.0" } }),
      );
      return repoRoot;
    }

    afterEach(() => {
      if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
      repoRoot = "";
    });

    async function runWithCapturedOutput(unreachable: readonly string[]) {
      const log = spyOn(console, "log").mockImplementation(() => {});
      const error = spyOn(console, "error").mockImplementation(() => {});
      try {
        const exitCode = await runOutdatedCheck({
          repoRoot: writeRepo(),
          reportMode: false,
          installed: directInstalled,
          registry: fakeRegistry({}, {}, unreachable),
        });
        const output = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
        return { exitCode, output };
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    }

    test("a partial registry gap warns with the reason and does not claim a clean result", async () => {
      const { exitCode, output } = await runWithCapturedOutput(["beta@2.0.0"]);
      expect(exitCode).toBe(0);
      expect(output).toContain("deprecation status UNKNOWN for 1 of 2 direct dependencies");
      expect(output).toContain("beta@2.0.0  — ConnectionRefused");
      expect(output).not.toContain("No deprecated direct dependencies found");
    });

    test("an unreachable registry for every direct dependency fails the check", async () => {
      const { exitCode, output } = await runWithCapturedOutput(["alpha@1.0.0", "beta@2.0.0"]);
      expect(exitCode).toBe(1);
      expect(output).toContain("nothing checked");
      expect(output).not.toContain("No deprecated direct dependencies found");
    });
  });
});
