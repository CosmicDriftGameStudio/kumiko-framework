import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityDefinition,
  ReferenceFieldDef,
} from "@cosmicdrift/kumiko-framework/engine/types";
import { buildToolCatalog } from "../tool-catalog";
import type { RegistrySearchView } from "../types";

const vendorEntity = createEntity({
  fields: {
    name: createTextField({ searchable: true, filterable: true }),
    iban: createTextField({ filterable: true }),
    notes: createTextField(),
    status: createSelectField({ options: ["active", "archived"] as const, filterable: true }),
  },
});

const invoiceEntity = createEntity({
  fields: {
    vendorId: { type: "reference", entity: "vendor", filterable: true } satisfies ReferenceFieldDef,
    description: createTextField({ searchable: true }),
  },
});

function fakeRegistry(
  entities: ReadonlyMap<string, EntityDefinition>,
  searchableByEntity: Readonly<Record<string, readonly string[]>>,
): RegistrySearchView {
  return {
    getAllEntities: () => entities,
    getSearchableFields: (entityName) => searchableByEntity[entityName] ?? [],
  };
}

describe("buildToolCatalog", () => {
  test("generates a search_<entity> tool only when searchable fields exist", () => {
    const registry = fakeRegistry(
      new Map<string, EntityDefinition>([
        ["vendor", vendorEntity],
        ["invoice", invoiceEntity],
      ]),
      { vendor: ["name"], invoice: ["description"] },
    );

    const catalog = buildToolCatalog(registry);
    const names = catalog.map((t) => t.name);

    expect(names).toContain("search_vendor");
    expect(names).toContain("search_invoice");
  });

  test("skips search_<entity> when the entity has no searchable fields", () => {
    const registry = fakeRegistry(new Map([["vendor", vendorEntity]]), {});
    const catalog = buildToolCatalog(registry);
    expect(catalog.map((t) => t.name)).not.toContain("search_vendor");
  });

  test("generates one find_<entity>_by_<field> tool per filterable field", () => {
    const registry = fakeRegistry(new Map([["vendor", vendorEntity]]), { vendor: ["name"] });
    const catalog = buildToolCatalog(registry);
    const names = catalog.map((t) => t.name);

    expect(names).toContain("find_vendor_by_name");
    expect(names).toContain("find_vendor_by_iban");
    expect(names).toContain("find_vendor_by_status");
    expect(names).not.toContain("find_vendor_by_notes"); // not filterable
  });

  test("select field becomes a string schema with an enum of its options", () => {
    const registry = fakeRegistry(new Map([["vendor", vendorEntity]]), { vendor: [] });
    const catalog = buildToolCatalog(registry);
    const statusTool = catalog.find((t) => t.name === "find_vendor_by_status");

    expect(statusTool?.inputSchema).toEqual({
      type: "object",
      properties: { status: { type: "string", enum: ["active", "archived"] } },
      required: ["status"],
      additionalProperties: false,
    });
  });

  test("reference field becomes a string schema describing the referenced entity", () => {
    const registry = fakeRegistry(new Map([["invoice", invoiceEntity]]), { invoice: [] });
    const catalog = buildToolCatalog(registry);
    const vendorIdTool = catalog.find((t) => t.name === "find_invoice_by_vendorId");

    expect(vendorIdTool?.inputSchema).toEqual({
      type: "object",
      properties: {
        vendorId: { type: "string", description: 'ID referencing "vendor"' },
      },
      required: ["vendorId"],
      additionalProperties: false,
    });
  });

  test("search tool description lists every searchable field", () => {
    const registry = fakeRegistry(new Map([["vendor", vendorEntity]]), {
      vendor: ["name", "iban"],
    });
    const catalog = buildToolCatalog(registry);
    const searchTool = catalog.find((t) => t.name === "search_vendor");

    expect(searchTool?.description).toContain("name, iban");
  });

  test("empty registry produces an empty catalog", () => {
    const registry = fakeRegistry(new Map(), {});
    expect(buildToolCatalog(registry)).toEqual([]);
  });
});
