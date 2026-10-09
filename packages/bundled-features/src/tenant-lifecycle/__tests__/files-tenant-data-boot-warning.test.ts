import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { createComplianceProfilesFeature } from "../../compliance-profiles/feature.js";
import { createConfigFeature } from "../../config/feature.js";
import { createFilesTenantDataFeature } from "../../files-tenant-data/index.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { createTenantLifecycleFeature } from "../feature.js";

function tenantLifecycleFeatures() {
  return [
    createConfigFeature(),
    createTenantFeature(),
    createComplianceProfilesFeature(),
    createTenantLifecycleFeature(),
  ];
}

let warnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function filesTenantDataWarnings(): unknown[][] {
  return warnSpy.mock.calls.filter((args: unknown[]) =>
    String(args[0]).includes("files-tenant-data"),
  );
}

describe("tenant-lifecycle boot warning for files without files-tenant-data", () => {
  test("warns when files is mounted without files-tenant-data", () => {
    validateBoot([...tenantLifecycleFeatures(), createFilesFeature()]);

    expect(filesTenantDataWarnings()).toHaveLength(1);
  });

  test("stays quiet when files-tenant-data is mounted too", () => {
    validateBoot([
      ...tenantLifecycleFeatures(),
      createFilesFeature(),
      createFilesTenantDataFeature(),
    ]);

    expect(filesTenantDataWarnings()).toHaveLength(0);
  });

  test("stays quiet when files is not mounted", () => {
    validateBoot(tenantLifecycleFeatures());

    expect(filesTenantDataWarnings()).toHaveLength(0);
  });
});
