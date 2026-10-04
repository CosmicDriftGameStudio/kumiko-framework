// An app's own error reason carries a docsUrl on the wire only when errorDocs covers it.
import { afterAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/define-feature.js";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { UnprocessableError, writeFailure } from "../index.js";

const APP_REASON = "order_locked";

const feature = defineFeature("docsdemo", (r) => {
  r.writeHandler(
    "fail",
    z.object({}),
    async () => writeFailure(new UnprocessableError(APP_REASON)),
    { access: { roles: ["Admin"] } },
  );
});

type ErrorBody = { error: { docsUrl?: string; details?: { reason?: string } } };

async function failingWrite(stack: TestStack): Promise<ErrorBody> {
  const res = await stack.http.writeWithHeaders("docsdemo:write:fail", {}, TestUsers.admin, {});
  return (await res.json()) as ErrorBody; // @cast-boundary http-response
}

describe("errorDocs over HTTP", () => {
  const stacks: TestStack[] = [];
  afterAll(async () => {
    for (const stack of stacks) await stack.cleanup();
  });

  test("app reason without errorDocs: body has no docsUrl", async () => {
    const stack = await setupTestStack({ features: [feature] });
    stacks.push(stack);
    const body = await failingWrite(stack);
    expect(body.error.details?.reason).toBe(APP_REASON);
    expect(body.error.docsUrl).toBeUndefined();
  });

  test("app reason covered by errorDocs: body links to the app docs", async () => {
    const stack = await setupTestStack({
      features: [feature],
      errorDocs: { baseUrl: "https://docs.acme.example", reasons: [APP_REASON] },
    });
    stacks.push(stack);
    const body = await failingWrite(stack);
    expect(body.error.docsUrl).toBe(`https://docs.acme.example/errors/${APP_REASON}`);
  });
});
