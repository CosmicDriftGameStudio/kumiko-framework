import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createFilesTenantDataFeature } from "@cosmicdrift/kumiko-bundled-features/files-tenant-data";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { composeFeatures } from "../compose-features.js";

const lifecycleApp = () => [createComplianceProfilesFeature(), createTenantLifecycleFeature()];

function composedNames(app: Parameters<typeof composeFeatures>[0]): string[] {
  return composeFeatures(app, { includeBundled: true }).map((f) => f.name);
}

let warnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("composeFeatures files-tenant-data auto-mount", () => {
  test("appends files-tenant-data exactly once when files and tenant-lifecycle are present", () => {
    const names = composedNames([...lifecycleApp(), createFilesFeature()]);
    expect(names.filter((n) => n === "files-tenant-data")).toHaveLength(1);
    expect(names.at(-1)).toBe("files-tenant-data");
  });

  test("does not append it without tenant-lifecycle", () => {
    expect(composedNames([createFilesFeature()])).not.toContain("files-tenant-data");
  });

  test("does not append it without files", () => {
    expect(composedNames(lifecycleApp())).not.toContain("files-tenant-data");
  });

  test("keeps an app-supplied copy without duplicating it", () => {
    const names = composedNames([
      ...lifecycleApp(),
      createFilesFeature(),
      createFilesTenantDataFeature(),
    ]);
    expect(names.filter((n) => n === "files-tenant-data")).toHaveLength(1);
  });

  test("includeBundled=false leaves the feature list untouched", () => {
    const names = composeFeatures([...lifecycleApp(), createFilesFeature()], {
      includeBundled: false,
    }).map((f) => f.name);
    expect(names).not.toContain("files-tenant-data");
  });

  test("the composed set boots without the files-tenant-data warning", () => {
    const composed = composeFeatures([...lifecycleApp(), createFilesFeature()], {
      includeBundled: true,
    });
    validateBoot(composed);
    const filesTenantDataWarnings = warnSpy.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes("files-tenant-data"),
    );
    expect(filesTenantDataWarnings).toHaveLength(0);
  });
});
