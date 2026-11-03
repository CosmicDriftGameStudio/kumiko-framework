// Settings of the former contact feature: config values and notification preferences were stored
// under contact:* names. The legacy rows are written through the event path, the way the former
// feature stored them, with every column including the NULL ones.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { configValueEntity, configValuesTable } from "../../config/index.ts";
import { DeliveryHandlers, DeliveryQueries } from "../../delivery/index.ts";
import { upsertPreference } from "../../delivery/upsert-preference.ts";
import { LEGACY_CONTACT_CONFIG_JOB } from "../legacy-contact-config.ts";
import { seedAdmin } from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

const JOB = `helpdesk:job:${LEGACY_CONTACT_CONFIG_JOB}`;
const FORMER_REPLY_TO = "contact:config:reply-to";
const FORMER_TELEGRAM_CHAT = "contact:config:telegram-chat";
const REPLY_TO = "helpdesk:config:reply-to";
const TELEGRAM_CHAT = "helpdesk:config:telegram-chat";
const FORMER_NEW_REQUEST = "contact:notify:new-request";
const NEW_REQUEST = "helpdesk:notify:new-request";

const configExecutor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({}, { jobConsumer: true });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  admin = await seedAdmin(ctx.stack, "settings-admin@example.com");
});

async function storeFormerConfig(key: string, value: string): Promise<void> {
  const created = await configExecutor.create(
    {
      key,
      value: JSON.stringify(value),
      tenantId: SYSTEM_TENANT_ID,
      userId: null,
    },
    TestUsers.systemAdmin,
    createTenantDb({
      db: ctx.stack.db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "system",
      reason: "test stores system-scope config the way the former contact feature did",
    }),
  );
  if (!created.isSuccess) throw new Error(`former config create failed: ${created.error.code}`);
}

async function storedValue(key: string): Promise<unknown> {
  const rows = await selectMany(ctx.stack.db, configValuesTable, { key });
  const raw = rows[0]?.["value"];
  return typeof raw === "string" ? JSON.parse(raw) : undefined;
}

async function runJob(): Promise<void> {
  await ctx.stack.jobRunner?.dispatch(JOB, {});
  await ctx.stack.drainJobs();
}

async function eventCount(): Promise<number> {
  return (await selectMany(ctx.stack.db, eventsTable, {})).length;
}

describe("helpdesk :: settings of the former contact feature", () => {
  test("config values stored under the contact keys are carried over once", async () => {
    await storeFormerConfig(FORMER_REPLY_TO, "support@example.com");
    await storeFormerConfig(FORMER_TELEGRAM_CHAT, "-1001234567890");

    await runJob();

    expect(await storedValue(REPLY_TO)).toBe("support@example.com");
    expect(await storedValue(TELEGRAM_CHAT)).toBe("-1001234567890");
    expect(await storedValue(FORMER_REPLY_TO)).toBe("support@example.com");

    const eventsAfterFirstRun = await eventCount();
    await runJob();
    expect(await eventCount()).toBe(eventsAfterFirstRun);
  });

  test("a helpdesk value that is already set is not overwritten", async () => {
    await storeFormerConfig(FORMER_REPLY_TO, "former@example.com");
    await ctx.stack.http.writeOk(
      "config:write:set",
      { key: REPLY_TO, value: "current@example.com", scope: "system" },
      admin,
    );

    await runJob();

    expect(await storedValue(REPLY_TO)).toBe("current@example.com");
  });

  test("a former value the helpdesk key rejects fails the job with a readable error", async () => {
    await storeFormerConfig(FORMER_REPLY_TO, "not an address");

    const failure = await runJob().then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(failure).toContain(JOB);
    expect(failure).not.toContain("[object Object]");
    expect(await storedValue(REPLY_TO)).toBeUndefined();
  });

  test("a notification preference stored under the contact name applies to the helpdesk notification", async () => {
    const stored = await upsertPreference(
      createTenantDb({ db: ctx.stack.db, tenantId: admin.tenantId }),
      admin,
      {
        tenantId: admin.tenantId,
        userId: admin.id,
        notificationType: FORMER_NEW_REQUEST,
        channel: "email",
        enabled: false,
      },
    );
    expect(stored.isSuccess).toBe(true);

    const rowsOf = async () => {
      const prefs = await ctx.stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
        DeliveryQueries.preferences,
        {},
        admin,
      );
      return prefs.rows
        .filter((row) => row["channel"] === "email")
        .map((row) => [row["notificationType"], row["enabled"]]);
    };
    expect(await rowsOf()).toEqual([[NEW_REQUEST, false]]);

    await ctx.stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: NEW_REQUEST, channel: "email", enabled: true },
      admin,
    );
    expect(await rowsOf()).toEqual([[NEW_REQUEST, true]]);
  });
});
