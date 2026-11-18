import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineFeature,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
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
