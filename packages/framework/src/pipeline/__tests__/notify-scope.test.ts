import { describe, expect, test } from "bun:test";
import type { NotifyOptions } from "../../engine/types/index.js";
import { testTenantId } from "../../seeding/seed-users.js";
import type { AfterCommitHook } from "../dispatcher-utils.js";
import { createDeferringNotify } from "../notify-scope.js";

describe("createDeferringNotify", () => {
  test("delivers the options as they were at call time, not as the handler mutated them later", async () => {
    const scheduled: AfterCommitHook[] = [];
    const delivered: NotifyOptions[] = [];
    const notify = createDeferringNotify({
      registry: undefined,
      tenantId: testTenantId(1),
      notifyAfterCommit: async (_type, options) => {
        delivered.push(options);
        return { kind: "dispatched", deliveries: [] };
      },
      notifyNow: async () => ({ kind: "dispatched", deliveries: [] }),
      scheduleAfterCommit: (hook) => scheduled.push(hook),
    });

    const sharedData: Record<string, unknown> = { title: "first" };
    await notify("any-type", { route: { email: "a@example.com" }, data: sharedData });
    sharedData["title"] = "second";
    await notify("any-type", { route: { email: "b@example.com" }, data: sharedData });

    for (const hook of scheduled) await hook();

    expect(delivered.map((o) => o.data?.["title"])).toEqual(["first", "second"]);
  });
});
