import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { JobTriggerEvent } from "@cosmicdrift/kumiko-types/handlers";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

type SeenRun = {
  readonly triggerName: string | undefined;
  readonly triggerEvent: JobTriggerEvent | undefined;
};

const seen: SeenRun[] = [];

const itemEntity = createEntity({
  name: "item",
  table: "read_job_trigger_items",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

const jobTriggerFixtureFeature = defineFeature("jobtriggerfixture", (r) => {
  r.crud(itemEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
    verbs: { update: false },
  });
  r.job({ name: "onItemWritten", trigger: { on: ["item.created", "item.deleted"] }, handler: async (_payload, ctx) => {
      seen.push({ triggerName: ctx.triggerName, triggerEvent: ctx.triggerEvent });
    } });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [jobTriggerFixtureFeature],
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  seen.length = 0;
});

describe("JobContext.triggerEvent for entity event triggers", () => {
  test("a create trigger carries the new row id as triggerEvent.aggregateId", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "jobtriggerfixture:write:item:create",
      { title: "a" },
      TestUsers.admin,
    );
    await stack.drainJobs();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.triggerEvent?.aggregateId).toBe(created.id);
    expect(typeof seen[0]?.triggerEvent?.id).toBe("string");
  });

  test("a delete trigger carries the deleted row id", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "jobtriggerfixture:write:item:create",
      { title: "a" },
      TestUsers.admin,
    );
    await stack.drainJobs();
    seen.length = 0;

    await stack.http.writeOk(
      "jobtriggerfixture:write:item:delete",
      { id: created.id },
      TestUsers.admin,
    );
    await stack.drainJobs();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.triggerEvent?.aggregateId).toBe(created.id);
  });
});
