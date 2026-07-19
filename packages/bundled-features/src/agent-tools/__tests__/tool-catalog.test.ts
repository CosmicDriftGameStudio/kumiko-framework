import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityDefinition,
  QueryHandlerDef,
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

const FAKE_HANDLER = {} as QueryHandlerDef;

type EntityFixture = {
  readonly qn: string;
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly searchableFields: readonly string[];
};

/** Handler-first fake: one entry per MOUNTED `:list` handler, mirroring what
 *  `registry.getAllQueryHandlers()` + `getHandlerEntity()` would return for a real app. There is
 *  no `getAllEntities()` here on purpose — an entity with no fixture is exactly "no list handler
 *  mounted", the case `buildToolCatalog` must skip. */
function fakeRegistry(fixtures: readonly EntityFixture[]): RegistrySearchView {
  const byQn = new Map(fixtures.map((f) => [f.qn, FAKE_HANDLER]));
  const entityByQn = new Map(fixtures.map((f) => [f.qn, f.entityName]));
  const entityByName = new Map(fixtures.map((f) => [f.entityName, f.entity]));
  const searchableByName = new Map(fixtures.map((f) => [f.entityName, f.searchableFields]));

  return {
    getAllQueryHandlers: () => byQn,
    getHandlerEntity: (qn) => entityByQn.get(qn),
    getEntity: (entityName) => entityByName.get(entityName),
    getSearchableFields: (entityName) => searchableByName.get(entityName) ?? [],
  };
}

function vendorFixture(searchableFields: readonly string[] = []): EntityFixture {
  return {
    qn: "vendor-feature:query:vendor:list",
    entityName: "vendor",
    entity: vendorEntity,
    searchableFields,
  };
}

function invoiceFixture(searchableFields: readonly string[] = []): EntityFixture {
  return {
    qn: "invoice-feature:query:invoice:list",
    entityName: "invoice",
    entity: invoiceEntity,
    searchableFields,
  };
}

describe("buildToolCatalog", () => {
  test("generates a search_<entity> tool only when searchable fields exist", () => {
    const registry = fakeRegistry([vendorFixture(["name"]), invoiceFixture(["description"])]);
    const catalog = buildToolCatalog(registry);
    const names = catalog.tools.map((t) => t.name);

    expect(names).toContain("search_vendor");
    expect(names).toContain("search_invoice");
  });

  test("skips search_<entity> when the entity has no searchable fields", () => {
    const registry = fakeRegistry([vendorFixture([])]);
    const catalog = buildToolCatalog(registry);
    expect(catalog.tools.map((t) => t.name)).not.toContain("search_vendor");
  });

  test("skips an entity entirely when it has no mounted :list handler", () => {
    // getHandlerEntity resolves it, but the qn doesn't end in ":<entity>:list" — e.g. a
    // :detail handler picked up by a naive "any handler mentioning this entity" scan.
    const registry: RegistrySearchView = {
      getAllQueryHandlers: () => new Map([["vendor-feature:query:vendor:detail", FAKE_HANDLER]]),
      getHandlerEntity: () => "vendor",
      getEntity: () => vendorEntity,
      getSearchableFields: () => ["name"],
    };
    const catalog = buildToolCatalog(registry);
    expect(catalog.tools).toEqual([]);
  });

  test("generates one find_<entity>_by_<field> tool per filterable field", () => {
    const registry = fakeRegistry([vendorFixture(["name"])]);
    const catalog = buildToolCatalog(registry);
    const names = catalog.tools.map((t) => t.name);

    expect(names).toContain("find_vendor_by_name");
    expect(names).toContain("find_vendor_by_iban");
    expect(names).toContain("find_vendor_by_status");
    expect(names).not.toContain("find_vendor_by_notes"); // not filterable
  });

  test("select field becomes a string schema with an enum of its options", () => {
    const registry = fakeRegistry([vendorFixture()]);
    const catalog = buildToolCatalog(registry);
    const statusTool = catalog.tools.find((t) => t.name === "find_vendor_by_status");

    expect(statusTool?.inputSchema).toEqual({
      type: "object",
      properties: { status: { type: "string", enum: ["active", "archived"] } },
      required: ["status"],
      additionalProperties: false,
    });
  });

  test("reference field becomes a string schema describing the referenced entity", () => {
    const registry = fakeRegistry([invoiceFixture()]);
    const catalog = buildToolCatalog(registry);
    const vendorIdTool = catalog.tools.find((t) => t.name === "find_invoice_by_vendorId");

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
    const registry = fakeRegistry([vendorFixture(["name", "iban"])]);
    const catalog = buildToolCatalog(registry);
    const searchTool = catalog.tools.find((t) => t.name === "search_vendor");

    expect(searchTool?.description).toContain("name, iban");
  });

  test("empty registry produces an empty catalog", () => {
    const registry = fakeRegistry([]);
    const catalog = buildToolCatalog(registry);
    expect(catalog.tools).toEqual([]);
    expect(catalog.dispatchTable.size).toBe(0);
  });

  test("dispatchTable maps search_<entity> to a search descriptor carrying the real qn", () => {
    const registry = fakeRegistry([vendorFixture(["name"])]);
    const catalog = buildToolCatalog(registry);
    expect(catalog.dispatchTable.get("search_vendor")).toEqual({
      kind: "search",
      entityName: "vendor",
      qn: "vendor-feature:query:vendor:list",
    });
  });

  test("dispatchTable maps find_<entity>_by_<field> to a findBy descriptor carrying the real qn", () => {
    const registry = fakeRegistry([vendorFixture()]);
    const catalog = buildToolCatalog(registry);
    expect(catalog.dispatchTable.get("find_vendor_by_iban")).toEqual({
      kind: "findBy",
      entityName: "vendor",
      fieldName: "iban",
      qn: "vendor-feature:query:vendor:list",
    });
  });
});
