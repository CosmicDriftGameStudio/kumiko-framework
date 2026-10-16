import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstalledPackage } from "../_lib/installed-packages";
import {
  evaluateLicenses,
  type LicenseException,
  loadLicenseExceptions,
  runLicenseCheck,
} from "../check-licenses";

const NOW = Date.parse("2026-10-16T12:00:00Z");

function pkg(name: string, license: string | null, version = "1.0.0"): InstalledPackage {
  return { name, version, license, path: `/nm/${name}/package.json` };
}

function exception(overrides: Partial<LicenseException>): LicenseException {
  return {
    package: "x",
    version: "*",
    license: "MPL-2.0",
    reason: "reviewed",
    reviewedBy: "Reviewer",
    expires: "2027-01-01",
    ...overrides,
  };
}

function blockedNames(packages: InstalledPackage[], exceptions: LicenseException[] = []): string[] {
  return evaluateLicenses(packages, exceptions, NOW).blocked.map(({ pkg: p }) => p.name);
}

describe("evaluateLicenses", () => {
  test("allowlisted licenses pass", () => {
    expect(blockedNames([pkg("a", "MIT"), pkg("b", "Apache-2.0")])).toEqual([]);
  });

  test("denylisted licenses block", () => {
    expect(blockedNames([pkg("gpl", "GPL-3.0"), pkg("busl", "BUSL-1.1")])).toEqual(["gpl", "busl"]);
  });

  test("unknown and missing licenses block", () => {
    expect(blockedNames([pkg("odd", "Custom-1.0"), pkg("none", null)])).toEqual(["odd", "none"]);
  });

  test("gray zone blocks without an exception and passes with a valid one", () => {
    const gray = pkg("mpl", "MPL-2.0");
    expect(blockedNames([gray])).toEqual(["mpl"]);
    expect(blockedNames([gray], [exception({ package: "mpl" })])).toEqual([]);
  });

  test("an expired exception no longer covers the package", () => {
    const gray = pkg("mpl", "MPL-2.0");
    expect(blockedNames([gray], [exception({ package: "mpl", expires: "2026-10-01" })])).toEqual([
      "mpl",
    ]);
  });

  test("a wildcard exception covers a family of packages", () => {
    const packages = [pkg("bin-darwin", "MPL-2.0"), pkg("bin-linux", "MPL-2.0")];
    expect(blockedNames(packages, [exception({ package: "bin-*" })])).toEqual([]);
  });

  test("OR picks the best option, AND needs all parts clean", () => {
    expect(blockedNames([pkg("dual", "(GPL-3.0 OR MIT)")])).toEqual([]);
    expect(blockedNames([pkg("both", "MIT AND GPL-3.0")])).toEqual(["both"]);
  });
});

describe("runLicenseCheck", () => {
  test("no installed packages is a loud failure, never a green run", () => {
    expect(runLicenseCheck({ repoRoot: "/nowhere", reportOnly: false, packages: [] })).toBe(1);
    expect(runLicenseCheck({ repoRoot: "/nowhere", reportOnly: true, packages: [] })).toBe(1);
  });

  test("exit 1 on a blocked package, but 0 with --report", () => {
    const packages = [pkg("gpl", "GPL-3.0")];
    const base = { repoRoot: "/nowhere", packages, exceptions: [], nowMs: NOW };
    expect(runLicenseCheck({ ...base, reportOnly: false })).toBe(1);
    expect(runLicenseCheck({ ...base, reportOnly: true })).toBe(0);
  });

  test("clean packages exit 0", () => {
    expect(
      runLicenseCheck({
        repoRoot: "/nowhere",
        reportOnly: false,
        packages: [pkg("ok", "MIT")],
        exceptions: [],
        nowMs: NOW,
      }),
    ).toBe(0);
  });
});

describe("loadLicenseExceptions", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("the repo's own file is merged with the bundled defaults", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "license-exceptions-")));
    tempDirs.push(repo);
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, "dependency-license-exceptions.json"),
      JSON.stringify({ exceptions: [exception({ package: "repo-only-pkg" })] }),
      "utf-8",
    );
    const names = loadLicenseExceptions([repo]).map((e) => e.package);
    expect(names).toContain("repo-only-pkg");
    expect(names).toContain("lightningcss");
  });

  test("bundled defaults carry reason, reviewer and expiry on every entry", () => {
    for (const entry of loadLicenseExceptions([])) {
      expect(entry.reason).not.toBe("");
      expect(entry.reviewedBy).not.toBe("");
      expect(Number.isNaN(Date.parse(entry.expires))).toBe(false);
    }
    expect(loadLicenseExceptions([])).toHaveLength(9);
  });
});
