import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { collectSearchableFieldNames } from "../configure-tenant-index.ts";

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
