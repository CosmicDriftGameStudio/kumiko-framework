// Recipient resolution under an active PII-KMS: an app's resolveEmail reads the
// stored user.email column, which is ciphertext. Every notify target kind
// (single user, user list, tenant broadcast) must still hand the mailer the
// plaintext address — channel-email's PII guard refuses ciphertext recipients.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  qn,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  expectSuccess,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { seedUser } from "../../auth-email-password/seeding.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { configValuesTable } from "../../config/table.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers, TenantQueries } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createDeliveryFeature } from "../feature.ts";
import { notificationPreferencesTable } from "../tables.ts";
import { createDeliveryTestContext } from "../testing.ts";
import { createPlainFallbackEmailFeature } from "./plain-email-channel.ts";

const emailTransport = createInMemoryTransport();
const BIDX_KEY = Buffer.alloc(32, 9).toString("base64");

const appFeature = defineFeature("app", (r) => {
  r.requires({ features: ["delivery"] });
  const open = { openToAll: { reason: "test handler callable by any signed-in test user" } };

  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({
        kind: z.enum(["user", "users", "tenant"]),
        userIds: z.array(z.string()),
        tenantId: z.string(),
      }),
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        const { kind, userIds, tenantId } = event.payload;
        const to =
          kind === "user"
            ? (userIds[0] as string)
            : kind === "users"
              ? userIds
              : { tenant: tenantId as TenantId };
        await notify(qn("app", "notify", "pinged"), {
          to,
          data: { title: "Ping", body: "hello" },
        });
        return { isSuccess: true, data: { sent: true } };
      },
      access: open,
    }),
  );
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
let tenantId: TenantId;
const randomKeySuffix = () => crypto.randomUUID().slice(0, 8);
let userIds: string[];
let plainEmails: string[];

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createPlainFallbackEmailFeature({
        transport: emailTransport,
        // Raw stored column, exactly like an app that reads user.email directly.
        resolveEmail: async (userId, ctx) => {
          const row = await fetchOne<{ email: string }>(ctx.db, userTable, {
            id: userId,
            tenantId: SYSTEM_TENANT_ID,
          });
          return row?.email ?? null;
        },
      }),
      appFeature,
    ],
    extraContext: (deps) =>
      createDeliveryTestContext(deps, { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // KMS before the seeds so the user rows carry the encrypted prod state.
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  configureBlindIndexKey(BIDX_KEY);
  emailTransport.sent.length = 0;

  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, tenantTable, eventsTable]);
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key: `pii-${randomKeySuffix()}`, name: "PII" },
    TestUsers.systemAdmin,
  );
  tenantId = created.id as TenantId;
  plainEmails = ["member.one@example.com", "member.two@example.com"];
  userIds = [];
  for (const email of plainEmails) {
    const { id } = await seedUser(stack.db, {
      email,
      displayName: email,
      passwordHash: "x",
      emailVerified: true,
    });
    expectSuccess(
      await stack.dispatcher.write(
        TenantHandlers.addMember,
        { userId: id, tenantId, roles: ["User"] },
        createSystemUser(TestUsers.systemAdmin.tenantId, ["SystemAdmin"]),
      ),
    );
    userIds.push(id);
  }
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function ping(kind: "user" | "users" | "tenant"): Promise<void> {
  await stack.http.writeOk(qn("app", "write", "ping"), { kind, userIds, tenantId }, tenantAdmin());
}

describe("notify recipient address under KMS", () => {
  test("precondition: stored user.email is ciphertext", async () => {
    const rows = await selectMany<{ email: string }>(stack.db, userTable, {});
    expect(rows.length).toBe(2);
    expect(rows.every((r) => isPiiCiphertext(r.email))).toBe(true);
  });

  test("to: { tenant } delivers to the plaintext member addresses", async () => {
    await ping("tenant");
    expect(emailTransport.sent.map((m) => m.to).sort()).toEqual([...plainEmails].sort());
  });

  test("to: userId delivers to the plaintext address", async () => {
    await ping("user");
    expect(emailTransport.sent.map((m) => m.to)).toEqual(plainEmails.slice(0, 1));
  });

  test("to: userId[] delivers to the plaintext addresses", async () => {
    await ping("users");
    expect(emailTransport.sent.map((m) => m.to).sort()).toEqual([...plainEmails].sort());
  });

  test("an erased subject is skipped, not mailed to the erased sentinel", async () => {
    await kms.eraseKey({ kind: "user", userId: userIds[0] as string });
    await ping("tenant");
    expect(emailTransport.sent.map((m) => m.to)).toEqual(plainEmails.slice(1));
  });
});

function tenantAdmin() {
  return createTestUser({ roles: ["Admin"], tenantId });
}
