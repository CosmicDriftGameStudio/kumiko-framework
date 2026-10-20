import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type TenantId,
} from "../../engine/index.ts";
import {
  collectSearchableFieldNames,
  configureTenantSearchIndex,
} from "../configure-tenant-index.ts";
import { createInMemorySearchAdapter } from "../in-memory-adapter.ts";
import type { SearchAdapter, SearchAdapterConfig } from "../types.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

const searchable = () =>
  createTextField({ searchable: true, personal: false, reason: "test_fixture" });

const crmFeature = defineFeature("crm", (r) => {
  r.entity({
    name: "customer",
    ...createEntity({
      table: "customers",
      fields: { title: searchable(), email: searchable() },
    }),
  });
  r.entity({
    name: "order",
    ...createEntity({
      table: "orders",
      fields: { title: searchable(), note: searchable() },
    }),
  });
});

describe("collectSearchableFieldNames", () => {
  test("unions searchable fields of all entities, deduplicated, in first-occurrence order", () => {
    expect(collectSearchableFieldNames(createRegistry([crmFeature]))).toEqual([
      "title",
      "email",
      "note",
    ]);
  });

  test("is empty when nothing is searchable", () => {
    expect(collectSearchableFieldNames(createRegistry([]))).toEqual([]);
  });
});

describe("configureTenantSearchIndex", () => {
  test("configures the tenant with the union as searchable and ranking fields", async () => {
    const configured: { tenantId: string; config: SearchAdapterConfig }[] = [];
    const inner = createInMemorySearchAdapter();
    const adapter: SearchAdapter = {
      ...inner,
      configure: async (tenantId, config) => {
        configured.push({ tenantId, config });
        await inner.configure(tenantId, config);
      },
    };

    await configureTenantSearchIndex(adapter, createRegistry([crmFeature]), TENANT_ID);

    expect(configured).toEqual([
      {
        tenantId: TENANT_ID,
        config: {
          searchableFields: ["title", "email", "note"],
          rankingFields: ["title", "email", "note"],
        },
      },
    ]);
  });
});
