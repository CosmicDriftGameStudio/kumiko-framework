import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { defineCreateWithTenantDefaults } from "../tenant-defaults.ts";

const entity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
});

describe("defineCreateWithTenantDefaults handler payload guard", () => {
  const handlerDef = defineCreateWithTenantDefaults("note", entity, {
    access: { roles: ["Admin"] },
  });

  // The HTTP route validates the payload against the schema first, so only a direct handler call reaches the guard.
  const callWithPayload = (payload: unknown): Promise<unknown> =>
    Reflect.apply(handlerDef.handler, undefined, [{ type: "note:create", payload }, {}]);

  test.each([
    ["an array", ["a"]],
    ["null", null],
    ["a string", "text"],
  ])("rejects %s as InternalError before touching the context", async (_label, payload) => {
    const failure = await callWithPayload(payload).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(InternalError);
    expect(failure).toMatchObject({
      message: "note:create payload must be an object after schema validation",
    });
  });
});
