import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.js";
import { defineFeature } from "../define-feature.js";
import { createRegistry } from "../registry.js";
import type { EntityDefinition } from "../types/fields.js";
import type { ScreenDefinition } from "../types/screen.js";

const leaseEntity = {
  fields: { name: { type: "text" }, iban: { type: "text" } },
} as unknown as EntityDefinition;
const itemEntity = {
  fields: { leaseId: { type: "text" }, note: { type: "text" } },
} as unknown as EntityDefinition;

const leasesFeature = defineFeature("leases", (r) => {
  r.entity("lease", leaseEntity);
  r.entity("item", itemEntity);
  r.screen({
    id: "lease-list",
    type: "entityList",
    entity: "lease",
    columns: ["name"],
    rowActions: [
      {
        kind: "navigate",
        id: "add-item",
        label: "add",
        screen: "item-create",
        params: { map: { leaseId: "id" } },
      },
      {
        kind: "navigate",
        id: "pay",
        label: "pay",
        screen: "record-payment",
        params: { pick: ["name"] },
      },
      {
        kind: "navigate",
        id: "edit",
        label: "edit",
        screen: "lease-edit",
        params: { pick: ["iban"] },
      },
      {
        kind: "drawer",
        id: "note",
        label: "note",
        screen: "drawer-only-form",
        params: { pick: ["note"] },
      },
    ],
  });
  r.screen({
    id: "lease-edit",
    type: "entityEdit",
    entity: "lease",
    layout: { sections: [{ title: "x", fields: ["name", "iban"] }] },
    actions: [
      {
        kind: "navigate",
        id: "item-from-lease",
        label: "item",
        screen: "item-from-lease",
        params: { pick: ["name"] },
      },
      {
        kind: "navigate",
        id: "pay-party",
        label: "pay",
        screen: "record-payment",
        params: { map: { partyId: "id" } },
      },
    ],
  });
  r.screen({
    id: "lease-detail",
    type: "projectionDetail",
    query: "leases:query:lease:detail",
    layout: {
      sections: [
        {
          kind: "relatedList",
          title: "Items",
          query: "leases:query:lease:items",
          columns: ["name"],
          toolbarActions: [
            {
              kind: "navigate",
              id: "quick-note",
              label: "Quick note",
              screen: "item-toolbar-note",
              params: { map: { leaseId: "id" } },
            },
            {
              kind: "navigate",
              id: "silent-add",
              label: "Silent add",
              screen: "item-toolbar-silent",
            },
          ],
        },
        {
          kind: "relatedList",
          title: "Custom-key items",
          query: "leases:query:lease:items",
          columns: ["name"],
          parentParam: "customParentId",
          toolbarActions: [
            {
              kind: "navigate",
              id: "silent-add-custom",
              label: "Silent add",
              screen: "item-toolbar-custom-parent",
            },
          ],
        },
        {
          kind: "relatedList",
          title: "Filter-field items",
          query: "leases:query:lease:items",
          columns: ["name"],
          parentParam: "ignoredParentParam",
          parentFilter: { field: "leaseRef" },
          toolbarActions: [
            {
              kind: "navigate",
              id: "silent-add-filter-field",
              label: "Silent add",
              screen: "item-toolbar-filter-field",
            },
          ],
        },
      ],
    },
    metrics: [
      {
        field: "openItems",
        label: "items",
        navigate: { screen: "item-create", params: { map: { note: "summary" } } },
      },
    ],
  });
  r.screen({
    id: "item-create",
    type: "entityEdit",
    entity: "item",
    layout: { sections: [{ title: "x", fields: ["leaseId", "note"] }] },
  });
  r.screen({
    id: "item-from-lease",
    type: "entityEdit",
    entity: "item",
    layout: { sections: [{ title: "x", fields: ["leaseId", "note"] }] },
  });
  r.screen({
    id: "item-toolbar-note",
    type: "entityEdit",
    entity: "item",
    layout: { sections: [{ title: "x", fields: ["leaseId", "note"] }] },
  });
  r.screen({
    id: "item-toolbar-silent",
    type: "entityEdit",
    entity: "item",
    layout: { sections: [{ title: "x", fields: ["leaseId", "note"] }] },
  });
  r.screen({
    id: "item-toolbar-custom-parent",
    type: "entityEdit",
    entity: "item",
    layout: { sections: [{ title: "x", fields: ["leaseId", "note"] }] },
  });
  r.screen({
    id: "item-toolbar-filter-field",
    type: "entityEdit",
    entity: "item",
    layout: { sections: [{ title: "x", fields: ["leaseId", "note"] }] },
  });
  r.screen({
    id: "record-payment",
    type: "actionForm",
    handler: "leases:write:payment:record",
    fields: { name: { type: "text" }, partyId: { type: "text" }, iban: { type: "text" } },
    layout: { sections: [{ title: "x", fields: ["name", "partyId", "iban"] }] },
    urlPrefillFields: ["iban"],
  } as ScreenDefinition);
  r.screen({
    id: "drawer-only-form",
    type: "actionForm",
    handler: "leases:write:item:note",
    fields: { note: { type: "text" } },
    layout: { sections: [{ title: "x", fields: ["note"] }] },
  });
});

const billingFeature = defineFeature("billing", (r) => {
  r.entity("invoice", { fields: { payee: { type: "text" } } } as unknown as EntityDefinition);
  r.screen({
    id: "invoice-list",
    type: "entityList",
    entity: "invoice",
    columns: ["payee"],
    rowActions: [
      {
        kind: "navigate",
        id: "pay",
        label: "pay",
        screen: "record-payment",
        params: { map: { name: "payee" } },
      },
    ],
  });
});

const leaseReportFeature = defineFeature("lease-reports", (r) => {
  r.screen({
    id: "lease-report",
    type: "entityList",
    entity: "lease",
    columns: ["name"],
    rowActions: [
      {
        kind: "navigate",
        id: "open-lease",
        label: "open",
        screen: "lease-edit",
        params: { pick: ["iban"] },
      },
    ],
  });
});

function urlPrefillFieldsOf(featureName: string, screenId: string): unknown {
  const app = buildAppSchema(createRegistry([leasesFeature, billingFeature, leaseReportFeature]));
  const screen = app.features
    .find((f) => f.featureName === featureName)
    ?.screens.find((s) => s.id.endsWith(`:${screenId}`) || s.id === screenId);
  if (screen === undefined) throw new Error(`screen ${featureName}/${screenId} not projected`);
  return "urlPrefillFields" in screen ? screen.urlPrefillFields : undefined;
}

describe("buildAppSchema — urlPrefillFields derived from navigate params", () => {
  test("a cross-entity entityEdit-create target gets exactly the declared params keys", () => {
    expect(urlPrefillFieldsOf("leases", "item-create")).toEqual(["leaseId", "note"]);
  });

  test("keys from several sources and features are unioned; an authored value is overwritten", () => {
    expect(urlPrefillFieldsOf("leases", "record-payment")).toEqual(["name", "partyId"]);
  });

  test("a form no navigate params targets gets an empty list — drawer params do not count", () => {
    expect(urlPrefillFieldsOf("leases", "drawer-only-form")).toEqual([]);
  });

  test("a same-entity entityEdit target opens in update mode and gets no URL prefill", () => {
    expect(urlPrefillFieldsOf("leases", "lease-edit")).toEqual([]);
  });

  test("non-form screens carry no urlPrefillFields", () => {
    expect(urlPrefillFieldsOf("leases", "lease-list")).toBeUndefined();
  });

  test("a relatedList toolbarAction's params.map target gets the mapped field", () => {
    expect(urlPrefillFieldsOf("leases", "item-toolbar-note")).toEqual(["leaseId"]);
  });

  test("a relatedList toolbarAction without params still contributes the implicit parent-id field", () => {
    expect(urlPrefillFieldsOf("leases", "item-toolbar-silent")).toEqual(["id"]);
  });

  test("a relatedList toolbarAction without params uses the section's own parentParam key", () => {
    expect(urlPrefillFieldsOf("leases", "item-toolbar-custom-parent")).toEqual(["customParentId"]);
  });

  test("a relatedList toolbarAction without params prefers parentFilter.field over parentParam", () => {
    expect(urlPrefillFieldsOf("leases", "item-toolbar-filter-field")).toEqual(["leaseRef"]);
  });

  test("an entityList rowAction in another feature targeting the same entity's entityEdit opens in update mode", () => {
    expect(urlPrefillFieldsOf("leases", "lease-edit")).toEqual([]);
  });

  test("an entityEdit action targeting another entity's entityEdit opens create and reads the params", () => {
    expect(urlPrefillFieldsOf("leases", "item-from-lease")).toEqual(["name"]);
  });
});
