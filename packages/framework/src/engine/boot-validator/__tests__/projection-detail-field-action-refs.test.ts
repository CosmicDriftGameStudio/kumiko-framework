import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function bootWithFieldAction(action: object): void {
  const feature = defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:detail",
      schema: z.object({}),
      handler: async () => ({}),
      access: OPEN,
      outputSchema: z.object({ title: z.string() }),
    });
    r.writeHandler({
      name: "rename",
      schema: z.object({ id: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN,
    });
    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "shop:query:order:detail",
      layout: { sections: [{ title: "s", fields: [{ field: "title", actions: [action] }] }] },
    } as never);
  });
  validateBoot(withBootValidatorFixture([feature]));
}

const rename = {
  kind: "writeHandler",
  id: "rename",
  label: "actions.rename",
  handler: "shop:write:rename",
};

describe("field action field references", () => {
  test("a visible condition on a field the record lacks names the field and the action", () => {
    expect(() => bootWithFieldAction({ ...rename, visible: { field: "ghost", eq: 1 } })).toThrow(
      /fieldAction "title\.rename" visible\.field references unknown field "ghost"/,
    );
  });

  test("a payload source field the record lacks is rejected", () => {
    expect(() => bootWithFieldAction({ ...rename, payload: { pick: ["ghost"] } })).toThrow(
      /fieldAction "title\.rename" payload references unknown field "ghost"/,
    );
  });

  test("references to fields of the record boot", () => {
    expect(() =>
      bootWithFieldAction({ ...rename, visible: { field: "title", eq: "x" } }),
    ).not.toThrow();
  });
});
