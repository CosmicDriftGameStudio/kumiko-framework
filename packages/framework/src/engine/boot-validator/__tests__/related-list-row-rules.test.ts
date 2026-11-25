import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function detailWithSection(extra: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "item:detail",
      schema: z.object({}),
      handler: async () => ({ id: "i1", phase: "open" }),
      access: OPEN_TO_ALL,
      outputSchema: z.object({ id: z.string(), phase: z.string() }),
    });
    r.queryHandler({
      name: "item:rows",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
      outputSchema: z.object({
        rows: z.array(z.object({ id: z.string(), status: z.string() })),
        nextCursor: z.string().nullable(),
      }),
    });
    r.writeHandler({
      name: "go",
      schema: z.object({}),
      handler: async () => ({ isSuccess: true as const, data: null }),
      access: { roles: ["Admin"] },
    });
    r.screen({
      id: "item-detail",
      type: "projectionDetail",
      query: "shop:query:item:detail",
      layout: {
        sections: [
          {
            kind: "relatedList",
            title: "Rows",
            query: "shop:query:item:rows",
            columns: ["id", "status"],
            ...extra,
          },
        ],
      },
    } as never);
  });
}

describe("relatedList rowTone rules", () => {
  test("a rule list over row fields boots", () => {
    expect(() =>
      validateBoot([
        detailWithSection({
          rowTone: [
            { field: "status", eq: "lost", tone: "bad" },
            { field: "status", eq: "edited", tone: "ok" },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  test("a rule with fill boots", () => {
    const rules = [{ field: "status", eq: "lost", tone: "bad", fill: true }] as const;
    expect(() => validateBoot([detailWithSection({ rowTone: rules })])).not.toThrow();
  });

  test("an unknown field in a later rule is rejected", () => {
    expect(() =>
      validateBoot([
        detailWithSection({
          rowTone: [
            { field: "status", eq: "lost", tone: "bad" },
            { field: "ghost", eq: "x", tone: "ok" },
          ],
        }),
      ]),
    ).toThrow(/rowTone references field "ghost"/);
  });

  test("a single unknown-field rule is rejected as before", () => {
    expect(() =>
      validateBoot([detailWithSection({ rowTone: { field: "ghost", eq: "x", tone: "ok" } })]),
    ).toThrow(/rowTone references field "ghost"/);
  });
});

describe("relatedList rowActionsWhen", () => {
  test("a condition on a field of the parent record boots", () => {
    expect(() =>
      validateBoot([detailWithSection({ rowActionsWhen: { field: "phase", eq: "open" } })]),
    ).not.toThrow();
  });

  test("a field the detail query does not return is rejected", () => {
    expect(() =>
      validateBoot([detailWithSection({ rowActionsWhen: { field: "ghost", eq: "open" } })]),
    ).toThrow(/rowActionsWhen references field "ghost"/);
  });

  test("a row field that the parent record lacks is rejected", () => {
    expect(() =>
      validateBoot([detailWithSection({ rowActionsWhen: { field: "status", eq: "open" } })]),
    ).toThrow(/rowActionsWhen references field "status"/);
  });
});

describe("rowAction active", () => {
  test("a condition on a row field of a relatedList action boots", () => {
    expect(() =>
      validateBoot([
        detailWithSection({
          rowActions: [
            {
              id: "go",
              label: "Go",
              handler: "shop:write:go",
              active: { when: { field: "status", eq: "lost" }, style: "danger" },
            },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  test("an unknown field in active.when of a relatedList action is rejected", () => {
    expect(() =>
      validateBoot([
        detailWithSection({
          rowActions: [
            {
              id: "go",
              label: "Go",
              handler: "shop:write:go",
              active: { when: { field: "ghost", eq: "lost" } },
            },
          ],
        }),
      ]),
    ).toThrow(/rowAction "go" active\.field references field "ghost"/);
  });

  function entityListWithActive(field: string) {
    return defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "product",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            id: "archive",
            label: "actions.archive",
            handler: "shop:write:archive",
            active: { when: { field, eq: "x" } },
          },
        ],
      });
      r.writeHandler({
        name: "archive",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { roles: ["Admin"] },
      });
    });
  }

  test("an entityList action checks active.when against the entity fields", () => {
    expect(() => validateBoot([entityListWithActive("name")])).not.toThrow();
    expect(() => validateBoot([entityListWithActive("ghost")])).toThrow(
      /rowAction "archive" active\.field references unknown field "ghost"/,
    );
  });
});
