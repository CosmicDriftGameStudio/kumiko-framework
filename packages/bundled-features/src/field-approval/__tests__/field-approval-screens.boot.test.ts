import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineFeature,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CARD_META_MAX,
  cardColumnRoles,
  cardMetaLines,
  normalizeListColumn,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { FIELD_APPROVAL_LIST_SCREEN_ID } from "../constants.ts";
import { createFieldApprovalFeature } from "../feature.ts";

const hostFeature = defineFeature("fa-host", (r) => {
  r.crud(
    createEntity({
      name: "payee",
      fields: {
        iban: createTextField({
          maxLength: 34,
          personal: "self",
          find: "secret",
          access: { approve: ["Accountant"], write: ["Accountant", "PropertyManager"] },
        }),
      },
    }),
    {
      write: { access: { roles: ["Accountant", "PropertyManager"] } },
      read: { access: { roles: ["Accountant", "PropertyManager"] } },
    },
  );
});

const baseFeatures = [
  createConfigFeature(),
  createTenantFeature(),
  createUserFeature(),
  hostFeature,
];

describe("field-approval list screen", () => {
  test("boot-validates with the approval list and its nav entry", () => {
    expect(() =>
      validateBoot([...baseFeatures, createFieldApprovalFeature({ parents: ["payee"] })]),
    ).not.toThrow();
  });

  test("screen and nav are visible only to the approver roles", () => {
    const feature = createFieldApprovalFeature({
      parents: ["payee"],
      approverRoles: ["Accountant"],
    });
    expect(feature.screens[FIELD_APPROVAL_LIST_SCREEN_ID]?.access).toEqual({
      roles: ["Accountant"],
    });
    const nav = Object.values(feature.navs)[0];
    expect(nav?.access).toEqual({ roles: ["Accountant"] });
    expect(nav?.adminArea).toBe("tenant");
  });

  test("an app moves the nav entry into its own group", () => {
    const feature = createFieldApprovalFeature({
      parents: ["payee"],
      nav: { parent: "fa-app:nav:finance", order: 5 },
    });
    const nav = Object.values(feature.navs)[0];
    expect(nav).toMatchObject({ parent: "fa-app:nav:finance", order: 5 });
    expect(() =>
      validateBoot([
        ...baseFeatures,
        defineFeature("fa-app", (r) => {
          r.nav({ id: "finance", label: "fa-app:nav.finance" });
          r.translations({ keys: { "fa-app:nav.finance": { en: "Finance" } } });
        }),
        feature,
      ]),
    ).not.toThrow();
  });
});

describe("field-approval list on the phone card", () => {
  const screen = createFieldApprovalFeature({ parents: ["payee"] }).screens[
    FIELD_APPROVAL_LIST_SCREEN_ID
  ];
  if (screen?.type !== "projectionList") throw new Error("expected the approval list screen");
  const columns = screen.columns.map((spec) => normalizeListColumn(spec));

  test("old and new value stand on their own labelled lines, requester and date share a labelled line", () => {
    const { title, meta } = cardColumnRoles(columns.filter((col) => col.cardAbove !== true));
    expect(title?.field).toBe("recordLabel");
    const lines = cardMetaLines(meta).map((line) => line.map((col) => col.field));
    expect(lines).toEqual([["currentValue"], ["value"], ["requestedByName", "requestedAt"]]);
    expect(lines.length).toBeLessThanOrEqual(CARD_META_MAX);
    for (const col of meta) expect(col.cardLabel).toBe(true);
  });

  test("the requester column shows the name the query carries, no member-directory lookup", () => {
    const requester = columns.find((col) => col.field === "requestedByName");
    expect(requester?.refEntity).toBeUndefined();
    expect(columns.some((col) => col.field === "requestedBy")).toBe(false);
  });
});
