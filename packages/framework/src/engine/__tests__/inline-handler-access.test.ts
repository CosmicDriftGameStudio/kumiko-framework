import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.js";

const noopHandler = async () => ({ isSuccess: true as const, data: null });

// Untyped callers (JS, designer output) bypass the compile-time `access` requirement.
const optionsWithoutAccess = {} as never;

describe("inline handler registration requires options.access", () => {
  test("writeHandler with empty options throws at registration", () => {
    expect(() =>
      defineFeature("inline-access", (r) => {
        r.writeHandler("create", z.object({}), noopHandler, optionsWithoutAccess);
      }),
    ).toThrow(/inline form requires schema \+ handler \+ options\.access/);
  });

  test("queryHandler with empty options throws at registration", () => {
    expect(() =>
      defineFeature("inline-access", (r) => {
        r.queryHandler("list", z.object({}), noopHandler, optionsWithoutAccess);
      }),
    ).toThrow(/inline form requires schema \+ handler \+ options\.access/);
  });
});
