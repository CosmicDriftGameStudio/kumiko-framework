// An app's own error reason links to the app docs on the wire when errorDocs covers it, else to the framework code page.
import { afterAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/define-feature.js";
import { TestUsers } from "../../seeding/seed-users.js";
import { UnprocessableError, writeFailure } from "../index.js";

const APP_REASON = "order_locked";

const feature = defineFeature("docsdemo", (r) => {
  r.writeHandler({
    name: "fail",
    schema: z.object({}),
    handler: async () => writeFailure(new UnprocessableError(APP_REASON)),
    access: { roles: ["Admin"] },
  });
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

  test("app reason without errorDocs: body links to the code page", async () => {
    const stack = await setupTestStack({ features: [feature] });
    stacks.push(stack);
    const body = await failingWrite(stack);
    expect(body.error.details?.reason).toBe(APP_REASON);
    expect(body.error.docsUrl).toBe("https://docs.kumiko.rocks/errors/unprocessable");
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
