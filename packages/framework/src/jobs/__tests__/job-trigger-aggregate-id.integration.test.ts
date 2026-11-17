import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { JobTriggerEvent } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

type SeenRun = {
  readonly triggerName: string | undefined;
  readonly triggerEvent: JobTriggerEvent | undefined;
};

const seen: SeenRun[] = [];
const pings: (JobTriggerEvent | undefined)[] = [];

const itemEntity = createEntity({
  table: "read_job_trigger_items",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

const jobTriggerFixtureFeature = defineFeature("jobtriggerfixture", (r) => {
  r.crud("item", itemEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
    verbs: { update: false },
  });
  r.writeHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.job(
    "onItemWritten",
    {
      trigger: {
        on: ["jobtriggerfixture:write:item:create", "jobtriggerfixture:write:item:delete"],
      },
    },
    async (_payload, ctx) => {
      seen.push({ triggerName: ctx.triggerName, triggerEvent: ctx.triggerEvent });
    },
  );
  r.job("onPing", { trigger: { on: "jobtriggerfixture:write:ping" } }, async (_payload, ctx) => {
    pings.push(ctx.triggerEvent);
  });
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
  pings.length = 0;
});

describe("JobContext.triggerEvent for write-handler triggers", () => {
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

  test("a plain-data handler result fires the job without triggerEvent", async () => {
    await stack.http.writeOk("jobtriggerfixture:write:ping", {}, TestUsers.admin);
    await stack.drainJobs();

    expect(pings).toEqual([undefined]);
  });
});
