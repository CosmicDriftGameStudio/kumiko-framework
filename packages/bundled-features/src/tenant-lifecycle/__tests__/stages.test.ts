import { describe, expect, test } from "bun:test";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { DESTRUCTION_STAGES, isDestructionPipelineComplete, pickNextStage } from "../stages";

// Minimal declaring feature: real tenant-lifecycle feature drags in "tenant" +
// "compliance-profiles" requires, unrelated to what these guard tests exercise.
function declares(extensionName: string) {
  return defineFeature(`declares-${extensionName}`, (r) => {
    r.extendsRegistrar(extensionName, {});
  });
}

const fakeDb = {} as DbRunner; // @cast-boundary test fixture — invalid-options guard throws before ctx.db is ever touched
const fakeTenantId = "00000000-0000-4000-8000-00000000000c" as TenantId;

function stageNamed(name: string) {
  const stage = DESTRUCTION_STAGES.find((s) => s.name === name);
  if (!stage) throw new Error(`stage "${name}" not found in DESTRUCTION_STAGES`);
  return stage;
}

describe("tenant-lifecycle stages", () => {
  test("app-data stage fails loud when a tenantData registration has no destroy function", async () => {
    const broken = defineFeature("broken-tenant-data", (r) => {
      r.useExtension(EXT_TENANT_DATA, "bad-entity", {
        // @ts-expect-error destroy must be a function — proves the guard rejects a non-function value instead of silently skipping it
        destroy: "x",
      });
    });
    const registry = createRegistry([declares(EXT_TENANT_DATA), broken]);
    await expect(
      stageNamed("app-data").run({ db: fakeDb, registry, tenantId: fakeTenantId }),
    ).rejects.toThrow(`${EXT_TENANT_DATA} registration for "bad-entity" has no destroy function`);
  });

  test("files stage fails loud when a storageProvider registration has no destroyTenant function", async () => {
    const broken = defineFeature("broken-storage-provider", (r) => {
      // @ts-expect-error destroyTenant is required — proves the guard rejects an empty options bag instead of silently skipping it
      r.useExtension(EXT_STORAGE_PROVIDER, "bad-entity", {});
    });
    const registry = createRegistry([declares(EXT_STORAGE_PROVIDER), broken]);
    await expect(
      stageNamed("files").run({ db: fakeDb, registry, tenantId: fakeTenantId }),
    ).rejects.toThrow(
      `${EXT_STORAGE_PROVIDER} registration for "bad-entity" has no destroy function`,
    );
  });

  test("pickNextStage halts when any stage was abandoned", () => {
    const completed = new Set(["external-resources", "search-indices"]);
    const abandoned = new Set(["app-data"]);
    expect(pickNextStage(completed, abandoned)).toBeNull();
  });

  test("pickNextStage returns first incomplete stage when healthy", () => {
    const completed = new Set(["external-resources"]);
    expect(pickNextStage(completed, new Set())?.name).toBe("search-indices");
  });

  test("isDestructionPipelineComplete requires every stage", () => {
    const partial = new Set(DESTRUCTION_STAGES.slice(0, 3).map((s) => s.name));
    expect(isDestructionPipelineComplete(partial)).toBe(false);
    const all = new Set(DESTRUCTION_STAGES.map((s) => s.name));
    expect(isDestructionPipelineComplete(all)).toBe(true);
  });
});
