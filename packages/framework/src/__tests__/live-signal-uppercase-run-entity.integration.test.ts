// An r.entity name with an uppercase run ("aiURLCheck") is written by hand-written executors
// under its kebab form "ai-url-check" (toKebab). The per-role read-access map must be keyed the
// same way, or signed-in clients never get the live signal the renderer subscribes to
// (liveEntitiesForQuery listens on the entity segment of the query type, toKebab-ed).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readSseFrames } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../db/event-store-executor.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import { createEntity, createTextField, defineFeature, toKebab } from "../engine/index.ts";
import { TestUsers } from "../seeding/seed-users.ts";

const ENTITY_NAME = "aiURLCheck";

const urlCheckEntity = createEntity({
  table: "uppercase_run_url_checks",
  fields: {
    url: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const urlCheckTable = buildEntityTable(ENTITY_NAME, urlCheckEntity);

const feature = defineFeature("urlchecks", (r) => {
  r.entity({ name: ENTITY_NAME, ...urlCheckEntity });
  r.writeHandler({
    name: "check:create",
    schema: z.object({ url: z.string() }),
    handler: async (event, ctx) => {
      const executor = createEventStoreExecutor(urlCheckTable, urlCheckEntity, {
        entityName: toKebab(ENTITY_NAME),
      });
      return executor.create({ url: event.payload.url }, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });
  r.queryHandler({
    name: "check:list",
    schema: z.object({}),
    handler: async () => [],
    access: { roles: ["Admin"] },
    liveEntities: [ENTITY_NAME],
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(() => stack.cleanup());

describe("live signal for an entity name with an uppercase run", () => {
  test("a signed-in reader gets the signal under the kebab entity the client subscribes to", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);
    const response = await stack.app.request("/api/sse", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);

    await stack.http.writeOk(
      "urlchecks:write:check:create",
      { url: "https://example.test" },
      TestUsers.admin,
    );
    await stack.eventDispatcher?.runOnce();

    const clientChannel = toKebab(ENTITY_NAME);
    const frames = await readSseFrames(response, {
      until: (frame) => frame.event === clientChannel,
    });
    const signal = frames.find((frame) => frame.event === clientChannel);
    expect(JSON.parse(signal?.data ?? "{}").aggregateType).toBe("ai-url-check");
  });
});
