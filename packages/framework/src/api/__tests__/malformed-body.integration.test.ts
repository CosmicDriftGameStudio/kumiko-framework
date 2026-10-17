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

describe("dispatch routes validate command shape and requestId", () => {
  const badBatchBodies: Array<[string, unknown]> = [
    ["a null command", { commands: [null] }],
    ["a command with a numeric type", { commands: [{ type: 1 }] }],
    ["a command with an empty type", { commands: [{ type: "" }] }],
    ["a second command that is not an object", { commands: [{ type: "x:write:y" }, "oops"] }],
    ["a non-string requestId", { commands: [], requestId: 5 }],
  ];

  for (const [name, body] of badBatchBodies) {
    test(`${Routes.batch}: ${name}`, async () => {
      const res = await post(Routes.batch, JSON.stringify(body));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("validation_error");
    });
  }

  for (const route of [Routes.write, Routes.query, Routes.command, Routes.stream]) {
    test(`${route}: non-string requestId`, async () => {
      const res = await post(route, JSON.stringify({ type: "x:write:y", requestId: { a: 1 } }));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("validation_error");
    });
  }
});
