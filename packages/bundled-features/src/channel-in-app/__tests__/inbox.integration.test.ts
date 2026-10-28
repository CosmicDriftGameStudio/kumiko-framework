// channel-in-app over the real stack: the probe handler delivers through the real inAppChannel.send
// (real TenantDb, real insert), the assertions read the inbox over HTTP like the shell bell does.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import { createSseBroker } from "@cosmicdrift/kumiko-framework/api";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import type {
  InAppInboxResult,
  InAppNotificationTarget,
} from "@cosmicdrift/kumiko-types/in-app-notification-types";
import * as z from "zod";
import { createConfigFeature } from "../../config/feature.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature } from "../../delivery/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createChannelInAppFeature } from "../feature.ts";
import { inAppChannel } from "../in-app-channel.ts";
import { inAppTarget } from "../in-app-target.ts";
import { inAppMessagesTable } from "../tables.ts";

const reader = createTestUser({ id: 21, roles: ["User"] });
const stranger = createTestUser({ id: 22, roles: ["User"] });

let brokerForProbe: SseBroker | undefined;

const deliverProbeFeature = defineFeature("inapp-probe", (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "deliver",
      schema: z.object({
        userId: z.string(),
        title: z.string(),
        data: z.record(z.string(), z.unknown()).optional(),
        count: z.number().default(1),
      }),
      access: { roles: ["User"] },
      handler: async (event, ctx) => {
        const results = [];
        for (let i = 0; i < event.payload.count; i += 1) {
          results.push(
            await inAppChannel.send(
              event.payload.userId,
              {
                notificationType: "inapp-probe:notify:probe",
                title: `${event.payload.title} ${i + 1}`,
                body: "probe body",
                data: event.payload.data,
              },
              {
                db: ctx.db,
                registry: ctx.registry,
                sseBroker: brokerForProbe,
                tenantId: event.user.tenantId,
              },
            ),
          );
        }
        return { isSuccess: true as const, data: { statuses: results.map((r2) => r2.status) } };
      },
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelInAppFeature(),
      deliverProbeFeature,
    ],
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    inAppMessagesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function deliver(
  userId: string,
  title: string,
  extra: { data?: Record<string, unknown>; count?: number } = {},
): Promise<readonly string[]> {
  const result = await stack.http.writeOk<{ statuses: string[] }>(
    "inapp-probe:write:deliver",
    { userId, title, ...extra },
    reader,
  );
  return result.statuses;
}

function inbox(
  user: typeof reader,
  payload: { limit?: number; unreadOnly?: boolean; cursor?: string } = {},
) {
  return stack.http.queryOk<InAppInboxResult>("channel-in-app:query:inbox", payload, user);
}

describe("channel-in-app inbox", () => {
  test("pages newest-first with a cursor and reports the total of all matching messages", async () => {
    await deliver(reader.id, "Paged", { count: 5 });

    const first = await inbox(reader, { limit: 2 });
    expect(first.rows.map((row) => row.title)).toEqual(["Paged 5", "Paged 4"]);
    expect(first.total).toBe(5);
    expect(first.nextCursor).not.toBeNull();

    const second = await inbox(reader, { limit: 2, cursor: first.nextCursor ?? "" });
    expect(second.rows.map((row) => row.title)).toEqual(["Paged 3", "Paged 2"]);
    expect(second.nextCursor).not.toBeNull();

    const last = await inbox(reader, { limit: 2, cursor: second.nextCursor ?? "" });
    expect(last.rows.map((row) => row.title)).toEqual(["Paged 1"]);
    expect(last.nextCursor).toBeNull();
    expect(last.total).toBe(5);
  });

  test("unreadOnly narrows both the rows and the total", async () => {
    const all = await inbox(reader);
    const toRead = all.rows[0];
    if (!toRead) throw new Error("inbox is empty");
    await stack.http.writeOk("channel-in-app:write:mark-read", { id: toRead.id }, reader);

    const unread = await inbox(reader, { unreadOnly: true });
    expect(unread.total).toBe(all.total - 1);
    expect(unread.rows.every((row) => !row.isRead)).toBe(true);
    expect(unread.rows.map((row) => row.id)).not.toContain(toRead.id);
  });

  test("a target round-trips as a parsed object next to the stored data", async () => {
    const target: InAppNotificationTarget = inAppTarget("tickets:screen:detail", "ticket-7");
    await deliver(reader.id, "Linked", { data: { target, extra: 1 } });

    const rows = (await inbox(reader, { limit: 1 })).rows;
    expect(rows[0]?.title).toBe("Linked 1");
    expect(rows[0]?.target).toEqual(target);
  });

  test("a malformed target is dropped while the notification is still delivered", async () => {
    const statuses = await deliver(reader.id, "Broken link", {
      data: { target: { screenId: "javascript:alert(1)" }, extra: 1 },
    });
    expect(statuses).toEqual(["sent"]);

    const [row] = (await inbox(reader, { limit: 1 })).rows;
    expect(row?.title).toBe("Broken link 1");
    expect(row?.target).toBeNull();
    const stored = await selectMany(stack.db, inAppMessagesTable, { userId: reader.id });
    const storedBroken = stored.find((message) => message["title"] === "Broken link 1");
    expect(JSON.parse(String(storedBroken?.["data"]))).toEqual({ extra: 1 });
  });

  test("another user sees nothing of it", async () => {
    const theirs = await inbox(stranger);
    expect(theirs.rows).toEqual([]);
    expect(theirs.total).toBe(0);
    expect(theirs.nextCursor).toBeNull();
  });

  test("a failing SSE push keeps the delivery sent and the row stored", async () => {
    const memory = createSseBroker();
    brokerForProbe = {
      ...memory,
      pushToChannel: async () => {
        throw new Error("redis down");
      },
    };
    try {
      const statuses = await deliver(reader.id, "Offline push");
      expect(statuses).toEqual(["sent"]);
    } finally {
      brokerForProbe = undefined;
    }
    const titles = (await inbox(reader, { limit: 1 })).rows.map((row) => row.title);
    expect(titles).toEqual(["Offline push 1"]);
  });

  test("the delivered frame carries only a signal, no title or body", async () => {
    const pushed: Array<{ type: string; data: Record<string, unknown> }> = [];
    brokerForProbe = {
      ...createSseBroker(),
      pushToChannel: async (_channel, event) => {
        pushed.push({ type: event.type, data: event.data });
      },
    };
    try {
      await deliver(reader.id, "Signal only");
    } finally {
      brokerForProbe = undefined;
    }
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.type).toBe("channel-in-app:event:delivered");
    expect(Object.keys(pushed[0]?.data ?? {}).sort()).toEqual(["id", "notificationType", "userId"]);
  });
});
