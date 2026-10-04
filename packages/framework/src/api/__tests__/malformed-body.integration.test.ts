import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { Routes } from "../api-constants.js";

const dispatchRoutes = [Routes.write, Routes.query, Routes.command, Routes.batch, Routes.stream];

let stack: TestStack;
let authorization: string;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  authorization = `Bearer ${await stack.jwt.sign(TestUsers.admin)}`;
});

afterAll(async () => {
  await stack.cleanup();
});

async function post(path: string, body: string): Promise<Response> {
  return stack.app.request(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body,
  });
}

describe("dispatch routes reject unusable request bodies with 400", () => {
  for (const route of dispatchRoutes) {
    test(`${route}: malformed JSON`, async () => {
      const res = await post(route, "{not json");
      expect(res.status).toBe(400);
    });

    test(`${route}: JSON that is not an object`, async () => {
      const res = await post(route, "[1,2]");
      expect(res.status).toBe(400);
    });
  }

  for (const route of [Routes.write, Routes.query, Routes.command, Routes.stream]) {
    test(`${route}: empty object has no handler type`, async () => {
      const res = await post(route, "{}");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("validation_error");
    });
  }
});
