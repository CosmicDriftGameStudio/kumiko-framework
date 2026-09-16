import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { EntityDefinition } from "../types/fields";
import type { ScreenDefinition } from "../types/screen";

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

function urlPrefillFieldsOf(featureName: string, screenId: string): unknown {
  const app = buildAppSchema(createRegistry([leasesFeature, billingFeature]));
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

  test("a relatedList toolbarAction without params contributes no fields — the allowlist stays an allowlist", () => {
    expect(urlPrefillFieldsOf("leases", "item-toolbar-silent")).toEqual([]);
  });
});
