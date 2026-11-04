import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import type { defineFeature } from "../../define-feature.ts";
import { BootValidationError } from "../boot-rule.ts";

export function ruleIdsOf(features: Parameters<typeof validateBootRaw>[0]): readonly string[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

export const OPEN_TO_ALL = {
  openToAll: { reason: "test handler callable by any signed-in test user" },
};

export function listQuery(r: Parameters<Parameters<typeof defineFeature>[1]>[0], fields: string[]) {
  r.queryHandler({
    name: "order:list",
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }),
    access: OPEN_TO_ALL,
    outputSchema: z.object({
      rows: z.array(z.object(Object.fromEntries(fields.map((f) => [f, z.string()])))),
      nextCursor: z.string().nullable(),
    }),
  });
}
