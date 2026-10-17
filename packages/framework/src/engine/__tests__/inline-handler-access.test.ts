import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";

const noopHandler = async () => ({ isSuccess: true as const, data: null });

describe("handler registration without access is rejected at boot", () => {
  test("writeHandler without access fails validateBoot", () => {
    const feature = defineFeature("inline-access", (r) => {
      // @ts-expect-error untyped callers (JS, designer output) bypass the compile-time `access` requirement
      r.writeHandler({
        name: "create",
        schema: z.object({}),
        handler: noopHandler,
      });
    });
    expect(() => validateBoot([feature])).toThrow(/is missing an access rule/);
  });

  test("queryHandler without access fails validateBoot", () => {
    const feature = defineFeature("inline-access", (r) => {
      // @ts-expect-error untyped callers (JS, designer output) bypass the compile-time `access` requirement
      r.queryHandler({
        name: "list",
        schema: z.object({}),
        handler: noopHandler,
      });
    });
    expect(() => validateBoot([feature])).toThrow(/is missing an access rule/);
  });
});
