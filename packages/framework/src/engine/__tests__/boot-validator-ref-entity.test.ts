import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const openToAllAccess = {
  access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
};

// fw#3108: refEntity on projectionList/relatedList columns and projectionDetail
// fields must resolve to a registered entity, same as a reference facet
// (fw#2224) — a typo or an unmounted target feature is otherwise a silent
// render-time break instead of a boot error.
describe("validateBoot — refEntity targets (fw#3108)", () => {
  test("projectionList column with a typo'd refEntity throws", () => {
    const feature = defineFeature("ledger", (r) => {
      r.entity(
        "tenant",
        createEntity({
          table: "Tenants",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.queryHandler(
        "schedule:list",
        z.object({}),
        async () => ({ rows: [], nextCursor: null }),
        openToAllAccess,
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: [{ field: "tenantId", refEntity: "tenat" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /column "tenantId" \(refEntity\) targets entity "tenat", which does not resolve to a registered entity\. Known entities in feature "ledger": tenant\./,
    );
  });

  test("projectionList column refEntity targeting an unmounted feature throws with (none)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({}),
        async () => ({ rows: [], nextCursor: null }),
        openToAllAccess,
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: [{ field: "ownerId", refEntity: "owners:owner" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /column "ownerId" \(refEntity\) targets entity "owners:owner".*Known entities in feature "owners": \(none\)\./,
    );
  });

  test("projectionList column refEntity typo on a mounted feature lists that feature's entities", () => {
    const owners = defineFeature("owners", (r) => {
      r.entity(
        "owner",
        createEntity({
          table: "Owners",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
    });
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({}),
        async () => ({ rows: [], nextCursor: null }),
        openToAllAccess,
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: [{ field: "ownerId", refEntity: "owners:ownr" }],
      });
    });
    expect(() => validateBoot([feature, owners])).toThrow(
      /targets entity "owners:ownr".*Known entities in feature "owners": owner\./,
    );
  });

  test("projectionDetail relatedList column with an unknown refEntity throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler(
        "rent:detail",
        z.object({}),
        async () => ({ description: "x" }),
        openToAllAccess,
      );
      r.queryHandler(
        "rent:payments",
        z.object({}),
        async () => ({ rows: [], nextCursor: null }),
        openToAllAccess,
      );
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Payments",
              query: "app:query:rent:payments",
              columns: [{ field: "payerId", refEntity: "payer" }],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /section "Payments" \(relatedList\) column "payerId" \(refEntity\) targets entity "payer", which does not resolve to a registered entity/,
    );
  });

  test("projectionDetail field-section field with an unknown refEntity throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler(
        "rent:detail",
        z.object({}),
        async () => ({ description: "x" }),
        openToAllAccess,
      );
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "app:query:rent:detail",
        layout: {
          sections: [
            {
              id: "overview",
              title: "Overview",
              fields: [{ field: "ownerId", refEntity: "owner" }],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /field "ownerId" \(refEntity\) targets entity "owner", which does not resolve to a registered entity/,
    );
  });

  test("same-feature shorthand and cross-feature refEntity targets pass boot", () => {
    const owners = defineFeature("owners", (r) => {
      r.entity(
        "owner",
        createEntity({
          table: "Owners",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
    });
    const feature = defineFeature("ledger", (r) => {
      r.entity(
        "tenant",
        createEntity({
          table: "Tenants",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.queryHandler(
        "schedule:list",
        z.object({}),
        async () => ({ rows: [], nextCursor: null }),
        openToAllAccess,
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: [
          { field: "tenantId", refEntity: "tenant" },
          { field: "ownerId", refEntity: "owners:owner" },
        ],
      });
    });
    expect(() => validateBoot([feature, owners])).not.toThrow();
  });
});
