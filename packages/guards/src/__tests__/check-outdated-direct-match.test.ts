// Unit tests for isDeclaredInstall in check-outdated.ts.
//
// Regression for a name-only match bug: uuid@8.3.2 from
// node_modules/exceljs/node_modules/uuid (transitive, orphaned) was reported
// as a "direct dependency" even though the workspace declares uuid@^14.0.0.

import { describe, expect, test } from "bun:test";
import { isDeclaredInstall, selectDirectInstalledPackages } from "../check-outdated";

describe("isDeclaredInstall", () => {
  test("rejects a transitive foreign version outside the declared range", () => {
    expect(isDeclaredInstall("8.3.2", "^14.0.0")).toBe(false);
  });

  test("accepts an installed version satisfying the declared range", () => {
    expect(isDeclaredInstall("14.2.0", "^14.0.0")).toBe(true);
  });

  test("keeps workspace: specs (not a comparable range)", () => {
    expect(isDeclaredInstall("14.0.0", "workspace:*")).toBe(true);
  });

  test("keeps catalog: specs (not a comparable range)", () => {
    expect(isDeclaredInstall("14.0.0", "catalog:")).toBe(true);
  });

  test("keeps 'latest' specs (not a comparable range)", () => {
    expect(isDeclaredInstall("1.0.0", "latest")).toBe(true);
  });

  test("accepts a version satisfying a >= range", () => {
    expect(isDeclaredInstall("2.0.0", ">=1.0.0")).toBe(true);
  });
});

describe("selectDirectInstalledPackages", () => {
  test("keeps the sole installed version even when a parent overrides block pins it below the declared range", () => {
    const installed = [{ name: "react", version: "19.2.6" }];
    const declaredSpecs = new Map([["react", ["^19.2.8"]]]);

    expect(selectDirectInstalledPackages(installed, declaredSpecs)).toEqual([
      { name: "react", version: "19.2.6" },
    ]);
  });

  test("drops a transitive foreign version once a matching direct install exists for the same name", () => {
    const installed = [
      { name: "uuid", version: "8.3.2" },
      { name: "uuid", version: "14.0.1" },
    ];
    const declaredSpecs = new Map([["uuid", ["^14.0.0"]]]);

    expect(selectDirectInstalledPackages(installed, declaredSpecs)).toEqual([
      { name: "uuid", version: "14.0.1" },
    ]);
  });

  test("keeps an install satisfying any of several declared specs", () => {
    const installed = [
      { name: "lib", version: "3.1.0" },
      { name: "lib", version: "4.1.0" },
    ];
    const declaredSpecs = new Map([["lib", ["^3.0.0", "^4.0.0"]]]);

    expect(selectDirectInstalledPackages(installed, declaredSpecs)).toEqual(installed);
  });

  test("with an override pin outside the declared range, keeps only instances matching the pin", () => {
    const installed = [
      { name: "pkg", version: "13.0.0" },
      { name: "pkg", version: "3.4.0" },
    ];
    const declaredSpecs = new Map([["pkg", ["^14.0.0"]]]);
    const overrides = new Map([["pkg", "13.0.0"]]);

    expect(selectDirectInstalledPackages(installed, declaredSpecs, overrides)).toEqual([
      { name: "pkg", version: "13.0.0" },
    ]);
  });

  test("keeps all instances when no spec matches and there is no override", () => {
    const installed = [
      { name: "pkg", version: "13.0.0" },
      { name: "pkg", version: "3.4.0" },
    ];
    const declaredSpecs = new Map([["pkg", ["^14.0.0"]]]);

    expect(selectDirectInstalledPackages(installed, declaredSpecs)).toEqual(installed);
  });

  test("keeps all instances when no instance satisfies the override", () => {
    const installed = [
      { name: "pkg", version: "12.0.0" },
      { name: "pkg", version: "3.4.0" },
    ];
    const declaredSpecs = new Map([["pkg", ["^14.0.0"]]]);
    const overrides = new Map([["pkg", "13.0.0"]]);

    expect(selectDirectInstalledPackages(installed, declaredSpecs, overrides)).toEqual(installed);
  });
});
