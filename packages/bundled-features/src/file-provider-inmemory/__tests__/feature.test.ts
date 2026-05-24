// feature.ts contract tests for file-provider-inmemory.

import { describe, expect, test } from "bun:test";
import { clearStorage, fileProviderInMemoryFeature, listKeys } from "../feature";

describe("fileProviderInMemoryFeature — shape", () => {
  test("has the expected name", () => {
    expect(fileProviderInMemoryFeature.name).toBe("file-provider-inmemory");
  });

  test("requires only file-foundation (no config, no secrets)", () => {
    expect(fileProviderInMemoryFeature.requires).toContain("file-foundation");
    expect(fileProviderInMemoryFeature.requires).not.toContain("config");
    expect(fileProviderInMemoryFeature.requires).not.toContain("secrets");
  });
});

describe("fileProviderInMemoryFeature — plugin-registration", () => {
  test("registers itself under entityName 'inmemory' for file-foundation's extension", () => {
    const usages = fileProviderInMemoryFeature.extensionUsages;
    expect(
      usages.some((u) => u.extensionName === "fileProvider" && u.entityName === "inmemory"),
    ).toBe(true);
  });
});

describe("listKeys / clearStorage — per-tenant store helpers", () => {
  test("listKeys liefert empty-array für unbekannten Tenant", () => {
    expect(listKeys("never-touched")).toEqual([]);
  });

  test("clearStorage auf unbekannten Tenant ist no-op", () => {
    expect(() => clearStorage("never-touched")).not.toThrow();
  });
});
