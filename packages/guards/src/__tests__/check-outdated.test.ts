import { describe, expect, test } from "bun:test";
import type { InstalledPackage } from "../_lib/installed-packages";
import { findMajorLagWarning, type LatestRelease, type RegistryClient } from "../_lib/npm-registry";
import { findDeprecatedPackages, runOutdatedCheck } from "../check-outdated";

function fakeRegistry(
  deprecated: Record<string, string>,
  releases: Record<string, LatestRelease> = {},
): RegistryClient {
  return {
    deprecatedMessage: async (name, version) => deprecated[`${name}@${version}`] ?? null,
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

describe("findDeprecatedPackages", () => {
  test("reports installed versions the registry marks deprecated, skips unknown packages", async () => {
    const found = await findDeprecatedPackages(
      [
        { name: "old", version: "1.0.0" },
        { name: "old", version: "2.0.0" },
        { name: "fine", version: "1.0.0" },
        { name: "offline", version: "1.0.0" },
      ],
      fakeRegistry({ "old@1.0.0": "gone" }),
    );
    expect(found).toEqual([{ name: "old", version: "1.0.0", message: "gone" }]);
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
});
