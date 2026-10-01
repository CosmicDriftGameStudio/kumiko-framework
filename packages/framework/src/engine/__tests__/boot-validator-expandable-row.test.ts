import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";
import type { EntityListExpandableRow } from "../types/index.js";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const postsQuerySchema = z.object({
  rows: z.array(z.object({ id: z.string(), datum: z.string() })),
  nextCursor: z.string().nullable(),
});

function campaignFeature(expandableRow: EntityListExpandableRow) {
  return defineFeature("campaigns", (r) => {
    r.entity(
      "campaign",
      createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.queryHandler("post:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
      access: OPEN_TO_ALL,
      outputSchema: postsQuerySchema,
    });
    r.writeHandler(
      "mark-posted",
      z.object({}),
      async () => ({ isSuccess: true as const, data: null }),
      { access: { roles: ["Admin"] } },
    );
    r.screen({
      id: "campaign-list",
      type: "entityList",
      entity: "campaign",
      columns: ["name"],
      expandableRow,
    });
  });
}

const validRow: EntityListExpandableRow = {
  kind: "relatedList",
  title: "Posts",
  query: "campaigns:query:post:list",
  parentParam: "campaign",
  columns: ["datum"],
  rowActions: [
    {
      kind: "writeHandler",
      id: "mark-posted",
      label: "Mark posted",
      handler: "campaigns:write:mark-posted",
    },
  ],
};

describe("validateBoot — entityList.expandableRow", () => {
  test("a valid expandableRow boots", () => {
    expect(() => validateBoot([campaignFeature(validRow)])).not.toThrow();
  });

  test("a dead query QN throws", () => {
    expect(() =>
      validateBoot([campaignFeature({ ...validRow, query: "campaigns:query:post:ghost" })]),
    ).toThrow(/expandableRow "Posts" query "campaigns:query:post:ghost" is not a registered/);
  });

  test("a column missing from the sub-list query's row shape throws", () => {
    expect(() =>
      validateBoot([campaignFeature({ ...validRow, columns: ["ghost-column"] })]),
    ).toThrow(
      /expandableRow "Posts" column "ghost-column" is not present in query "campaigns:query:post:list"'s outputSchema/,
    );
  });

  test("a rowAction handler that is not registered throws", () => {
    expect(() =>
      validateBoot([
        campaignFeature({
          ...validRow,
          rowActions: [
            {
              kind: "writeHandler",
              id: "mark-posted",
              label: "Mark posted",
              handler: "campaigns:write:ghost",
            },
          ],
        }),
      ]),
    ).toThrow(/expandableRow "Posts" rowAction "mark-posted" handler "campaigns:write:ghost"/);
  });

  test("an entity navigate target without entityId throws (sub-list rows are query rows)", () => {
    expect(() =>
      validateBoot([
        campaignFeature({
          ...validRow,
          rowActions: [{ kind: "navigate", id: "open", label: "Open", entity: "campaign" }],
        }),
      ]),
    ).toThrow(/entityList expandableRow\) rowAction "open" navigate-target entity "campaign"/);
  });

  test("parentFilter together with parentParam throws", () => {
    expect(() =>
      validateBoot([
        campaignFeature({
          ...validRow,
          parentFilter: { field: "campaign" },
          parentParam: "campaign",
        }),
      ]),
    ).toThrow(/expandableRow "Posts": declares both parentFilter and parentParam/);
  });

  test("a function column renderer throws", () => {
    expect(() =>
      validateBoot([
        campaignFeature({
          ...validRow,
          // kumiko-lint-ignore as-cast intentional type violation under test
          columns: [{ field: "datum", renderer: ((v: unknown) => String(v)) as never }],
        }),
      ]),
    ).toThrow(/column "datum" renderer is a function/);
  });

  test("a toolbarAction visible condition on a field the host entity lacks throws", () => {
    expect(() =>
      validateBoot([
        campaignFeature({
          ...validRow,
          toolbarActions: [
            {
              kind: "writeHandler",
              id: "mark-posted",
              label: "Mark posted",
              handler: "campaigns:write:mark-posted",
              visible: { field: "ghost", eq: "x" },
            },
          ],
        }),
      ]),
    ).toThrow(/toolbarAction "mark-posted".*"ghost"/);
  });
});
