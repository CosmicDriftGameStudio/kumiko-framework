import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.js";

const noopHandler = async () => ({ isSuccess: true as const, data: null });

describe("handler registration requires an access rule", () => {
  test("writeHandler without access throws at registration", () => {
    expect(() =>
      defineFeature("inline-access", (r) => {
        // @ts-expect-error untyped callers (JS, designer output) bypass the compile-time `access` requirement
        r.writeHandler({
          name: "create",
          schema: z.object({}),
          handler: noopHandler,
        });
      }),
    ).toThrow(
      '[Feature inline-access] r.writeHandler({ name: "create" }) requires an access rule (access: { roles: [...] } or { openToAll: { reason } })',
    );
  });

  test("queryHandler without access throws at registration", () => {
    expect(() =>
      defineFeature("inline-access", (r) => {
        // @ts-expect-error untyped callers (JS, designer output) bypass the compile-time `access` requirement
        r.queryHandler({
          name: "list",
          schema: z.object({}),
          handler: noopHandler,
        });
      }),
    ).toThrow(
      '[Feature inline-access] r.queryHandler({ name: "list" }) requires an access rule (access: { roles: [...] } or { openToAll: { reason } })',
    );
  });

  test("object-form streamHandler without access throws at registration", () => {
    expect(() =>
      defineFeature("inline-access", (r) => {
        // @ts-expect-error untyped callers (JS, designer output) bypass the compile-time `access` requirement
        r.streamHandler({
          name: "chat",
          schema: z.object({}),
          handler: async function* () {},
        });
      }),
    ).toThrow('[Feature inline-access] r.streamHandler({ name: "chat" }) requires an access rule');
  });
});
