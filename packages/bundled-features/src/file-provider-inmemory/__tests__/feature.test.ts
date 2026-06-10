// feature.ts contract tests for file-provider-inmemory.

import { describe, expect, test } from "bun:test";
import {
  type FileProviderPlugin,
  isFileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
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

function inmemoryPlugin(): FileProviderPlugin {
  const options = fileProviderInMemoryFeature.extensionUsages.find(
    (u) => u.extensionName === "fileProvider" && u.entityName === "inmemory",
  )?.options;
  if (!isFileProviderPlugin(options)) {
    throw new Error("file-provider-inmemory: inmemory plugin not registered with a build()");
  }
  return options;
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("file-provider-inmemory — build() + per-tenant store", () => {
  test("build liefert Provider; Write erscheint in listKeys(tenant)", async () => {
    const provider = await inmemoryPlugin().build({}, "tenant-build-1");
    await provider.write("doc.txt", bytes("x"));
    expect(listKeys("tenant-build-1")).toContain("doc.txt");
    clearStorage("tenant-build-1");
  });

  test("selber Tenant: zwei builds liefern identitätsstabilen Storage (State bleibt)", async () => {
    const a = await inmemoryPlugin().build({}, "tenant-stable");
    await a.write("first.txt", bytes("1"));
    const b = await inmemoryPlugin().build({}, "tenant-stable");
    expect(await b.exists("first.txt")).toBe(true);
    clearStorage("tenant-stable");
  });

  test("Tenant-Isolation: Write in A erscheint nicht in B", async () => {
    const a = await inmemoryPlugin().build({}, "tenant-iso-a");
    const b = await inmemoryPlugin().build({}, "tenant-iso-b");
    await a.write("only-in-a.txt", bytes("a"));
    expect(listKeys("tenant-iso-a")).toContain("only-in-a.txt");
    expect(listKeys("tenant-iso-b")).not.toContain("only-in-a.txt");
    expect(await b.exists("only-in-a.txt")).toBe(false);
    clearStorage("tenant-iso-a");
    clearStorage("tenant-iso-b");
  });

  test("clearStorage leert den Tenant-Store", async () => {
    const p = await inmemoryPlugin().build({}, "tenant-clear");
    await p.write("gone.txt", bytes("x"));
    expect(listKeys("tenant-clear")).toHaveLength(1);
    clearStorage("tenant-clear");
    expect(listKeys("tenant-clear")).toEqual([]);
  });
});
