import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../../engine/define-feature.ts";
import { TestUsers } from "../../../seeding/seed-users.ts";

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

// Boot validation would reject this screen; the route gate is the second line of defence.
const dispatchOnlyExportFeature = defineFeature("xd", (r) => {
  r.queryHandler({
    name: "rows",
    schema: z.object({}),
    access: OPEN_TO_ALL,
    dispatchOnly: true,
    outputSchema: z.object({
      rows: z.array(z.object({ id: z.string() })),
      nextCursor: z.string().nullable(),
    }),
    handler: async () => ({ rows: [{ id: "row-1" }], nextCursor: null }),
  });
  r.translations({ keys: {} });
  r.screen({
    id: "rows",
    type: "projectionList",
    query: "xd:query:rows",
    columns: ["id"],
    table: { export: { xlsx: true } },
  });
});

describe("POST /api/export/xlsx with a dispatchOnly query", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [dispatchOnlyExportFeature],
      authConfig: { membershipQuery: "xd:query:nonexistent" },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("answers 404 not_found instead of exporting the query's rows", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);
    const res = await stack.http.raw(
      "POST",
      "/api/export/xlsx",
      { screen: "xd:screen:rows", columns: ["id"] },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});
