import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import type { ExtraRouteDefinition } from "../../api/extra-route.ts";
import { defineFeature } from "../../engine/index.ts";
import { failNotFound, isKumikoError } from "../../errors/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const feature = defineFeature("query-failure", (r) => {
  r.queryHandler({
    name: "missing",
    schema: z.object({ id: z.string() }),
    access: { roles: ["anonymous", "Admin"] },
    handler: async (query) => failNotFound("thing", query.payload.id),
  });
  r.queryHandler({
    name: "probe",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async (_query, ctx) => {
      try {
        await ctx.dispatch.query("query-failure:query:missing", { id: "x" });
        return { caughtStatus: null };
      } catch (error) {
        return { caughtStatus: isKumikoError(error) ? error.httpStatus : -1 };
      }
    },
  });
});

const extraRoutes: ExtraRouteDefinition[] = [
  {
    method: "GET",
    path: "/public/missing-thing",
    entry: "anonymous",
    handler: async (c, deps) =>
      c.json(
        await deps.systemQuery(
          "query-failure:query:missing",
          { id: "x" },
          TestUsers.admin.tenantId,
        ),
      ),
  },
];

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], extraRoutes });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("a returned query failure", () => {
  test("/api/query answers with the failure's status", async () => {
    const err = await stack.http.queryErr(
      "query-failure:query:missing",
      { id: "x" },
      TestUsers.admin,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("ctx.dispatch.query rejects with the failure's error", async () => {
    const data = await stack.http.queryOk<{ caughtStatus: number | null }>(
      "query-failure:query:probe",
      {},
      TestUsers.admin,
    );
    expect(data).toEqual({ caughtStatus: 404 });
  });

  test("an extra route that does not catch it answers with the error's status", async () => {
    const res = await stack.app.request("/public/missing-thing");
    expect(res.status).toBe(404);
  });
});
