import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import type { FeatureDefinition } from "../types/index.ts";

const validateBoot = (features: FeatureDefinition[]) =>
  validateBootRaw(withBootValidatorFixture(features));

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const countableSchema = z.object({
  limit: z.number().optional(),
  totalCount: z.boolean().optional(),
});

function featureWith(options: {
  readonly section: Record<string, unknown>;
  readonly mode?: "tabs" | "single";
  readonly schema?: z.ZodObject;
}): FeatureDefinition {
  return defineFeature("app", (r) => {
    r.queryHandler({
      name: "lease:detail",
      schema: z.object({}),
      handler: async () => ({ id: "1", openCount: 2 }),
      access: openToAll,
      outputSchema: z.object({ id: z.string(), openCount: z.number() }),
    });
    r.queryHandler({
      name: "lease:positions",
      schema: options.schema ?? countableSchema,
      handler: async () => ({ rows: [], nextCursor: null }),
      access: openToAll,
      outputSchema: z.object({
        rows: z.array(z.object({ id: z.string() })),
        nextCursor: z.string().nullable(),
      }),
    });
    r.screen({
      id: "lease-detail",
      type: "projectionDetail",
      query: "app:query:lease:detail",
      layout: {
        mode: options.mode ?? "tabs",
        sections: [
          { id: "main", title: "Main", fields: ["id"] },
          {
            id: "positions",
            kind: "relatedList",
            title: "Positions",
            query: "app:query:lease:positions",
            columns: ["id"],
            ...options.section,
          },
        ],
      },
    });
  });
}

describe("relatedList count badge", () => {
  test("count: true on a tab whose query accepts limit and totalCount passes", () => {
    expect(() => validateBoot([featureWith({ section: { count: true } })])).not.toThrow();
  });

  test("count together with countField throws", () => {
    expect(() =>
      validateBoot([featureWith({ section: { count: true, countField: "openCount" } })]),
    ).toThrow(/declares both count and countField/);
  });

  test("count outside tabs mode throws", () => {
    expect(() => validateBoot([featureWith({ section: { count: true }, mode: "single" })])).toThrow(
      /count: true only renders in a layout with mode "tabs"/,
    );
  });

  test("count with a query that does not accept totalCount throws", () => {
    expect(() =>
      validateBoot([
        featureWith({
          section: { count: true },
          schema: z.object({ limit: z.number().optional() }),
        }),
      ]),
    ).toThrow(/needs query "app:query:lease:positions" to accept "totalCount"/);
  });

  test("count with a query that does not accept limit throws", () => {
    expect(() =>
      validateBoot([
        featureWith({
          section: { count: true },
          schema: z.object({ totalCount: z.boolean().optional() }),
        }),
      ]),
    ).toThrow(/to accept "limit"/);
  });
});
