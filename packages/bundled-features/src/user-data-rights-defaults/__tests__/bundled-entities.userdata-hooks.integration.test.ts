// userData hook integration tests for the bundled entity hooks (GDPR audit):
// user-session, api-token, in-app-message, tenant-invitation,
// notification-preference, config-value.
//
// Two stacks:
//   FULL    — all source features mounted; tests export contents, forget
//             semantics (hard-delete vs. executor-forget vs. anonymize), and
//             tenant isolation.
//   MINIMAL — only user/files/udr/defaults; tests presence gating: every hook
//             must return null/no-op instead of querying missing tables and
//             crashing (the export runner has no per-hook try/catch).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { asRawClient, createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createChannelInAppFeature, inAppMessagesTable } from "../../channel-in-app/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { configValueEntity, createConfigFeature } from "../../config/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { logAttempt } from "../../delivery/attempt-log.ts";
import { DELIVERY_ATTEMPT_ADDRESS_ERASED_EVENT } from "../../delivery/constants.ts";
import {
  createDeliveryFeature,
  deliveryAttemptsTable,
  notificationPreferenceEntity,
} from "../../delivery/index.ts";
import { createFilesFeature } from "../../files/index.ts";
import { createJobsFeature, jobRunLogsTable, jobRunsTable } from "../../jobs/index.ts";
import {
  apiTokenEntity,
  createPersonalAccessTokensFeature,
  PatQueries,
  type PatScopeConfig,
} from "../../personal-access-tokens/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { createTenantFeature, tenantInvitationEntity } from "../../tenant/index.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/index.ts";
import { createUserDataRightsDefaultsFeature } from "../feature.ts";
import {
  apiTokenDeleteHook,
  apiTokenExportHook,
  configValueDeleteHook,
  configValueExportHook,
  deliveryAttemptDeleteHook,
  deliveryAttemptExportHook,
  inAppMessageDeleteHook,
  inAppMessageExportHook,
  jobRunExportHook,
  notificationPreferenceDeleteHook,
  notificationPreferenceExportHook,
  tenantInvitationDeleteHook,
  tenantInvitationExportHook,
  userSessionDeleteHook,
  userSessionExportHook,
} from "../index.ts";

const PAT_SCOPES: PatScopeConfig = {
  tokens: { label: "Tokens", read: [PatQueries.mine] },
};

let full: TestStack;
let minimal: TestStack;

beforeAll(async () => {
  full = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createPersonalAccessTokensFeature({ scopes: PAT_SCOPES }),
      createAuthFoundationFeature(),
      createDeliveryFeature(),
      createChannelInAppFeature(),
      createJobsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });
  await unsafeCreateEntityTable(full.db, userEntity);
  await unsafeCreateEntityTable(full.db, userSessionEntity);
  await unsafeCreateEntityTable(full.db, apiTokenEntity);
  await unsafeCreateEntityTable(full.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(full.db, notificationPreferenceEntity);
  await unsafeCreateEntityTable(full.db, configValueEntity);
  await unsafePushTables(full.db, { inAppMessagesTable, jobRunsTable, jobRunLogsTable });

  minimal = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });
});

afterAll(async () => {
  await full.cleanup();
  await minimal.cleanup();
});

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

function uuid(suffix: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${suffix.toString(16).padStart(12, "0")}`;
}

function ctx(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    db: createTenantDb({ db: full.db, tenantId: TENANT_A, mode: "tenant" }),
    registry: full.registry,
    tenantId: TENANT_A,
    userId,
    ...overrides,
  };
}

async function rawSelect(sql: string, params: unknown[]) {
  const result = await asRawClient(full.db).unsafe(sql, params);
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return ((result as any).rows ?? result) as Array<Record<string, unknown>>;
}

async function seedUser(id: string): Promise<void> {
  await seedRowViaEventStore(full.db, userTable, {
    id,
    email: `user-${id}@example.com`,
    passwordHash: "hashed-password",
    displayName: `User ${id}`,
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
}

describe("user-session userData-hooks", () => {
  async function seedSession(id: string, userId: string, tenantId: string): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO store_user_sessions (id, user_id, tenant_id, created_at, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, now(), now() + interval '1 day', '203.0.113.7', 'TestAgent/1.0')`,
      [id, userId, tenantId],
    );
  }

  test("export returns ip/userAgent, but no Session-Id (jti)", async () => {
    await seedSession(uuid(1), "sess-user-1", TENANT_A);

    const result = await userSessionExportHook(ctx("sess-user-1"));
    expect(result?.entity).toBe("user-session");
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["ip"]).toBe("203.0.113.7");
    expect(result?.rows[0]?.["userAgent"]).toBe("TestAgent/1.0");
    expect(result?.rows[0]?.["id"]).toBeUndefined();
  });

  test("delete removes the user's sessions, cross-tenant sessions remain", async () => {
    await seedSession(uuid(2), "sess-user-2", TENANT_A);
    await seedSession(uuid(3), "sess-user-2", TENANT_B);

    await userSessionDeleteHook(ctx("sess-user-2"), "delete");

    const a = await rawSelect(
      "SELECT * FROM store_user_sessions WHERE user_id = $1 AND tenant_id = $2",
      ["sess-user-2", TENANT_A],
    );
    const b = await rawSelect(
      "SELECT * FROM store_user_sessions WHERE user_id = $1 AND tenant_id = $2",
      ["sess-user-2", TENANT_B],
    );
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });
});

describe("api-token userData-hooks", () => {
  async function seedToken(id: string, userId: string): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO store_api_tokens (id, user_id, tenant_id, name, token_hash, prefix, scopes, created_at)
       VALUES ($1, $2, $3, 'My MacBook', $4, 'kum_ab12', '["read"]', now())`,
      [id, userId, TENANT_A, `hash-${id}`],
    );
  }

  test("export returns token metadata without tokenHash", async () => {
    await seedToken(uuid(10), "pat-user-1");

    const result = await apiTokenExportHook(ctx("pat-user-1"));
    expect(result?.entity).toBe("api-token");
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["name"]).toBe("My MacBook");
    expect(result?.rows[0]?.["prefix"]).toBe("kum_ab12");
    expect(result?.rows[0]?.["tokenHash"]).toBeUndefined();
  });

  test("delete entfernt Tokens (= Revoke)", async () => {
    await seedToken(uuid(11), "pat-user-2");

    await apiTokenDeleteHook(ctx("pat-user-2"), "delete");

    const rows = await rawSelect("SELECT * FROM store_api_tokens WHERE user_id = $1", [
      "pat-user-2",
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("in-app-message userData-hooks", () => {
  async function seedMessage(userId: string, title: string): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO in_app_messages (tenant_id, user_id, notification_type, title, body)
       VALUES ($1, $2, 'test:notify', $3, 'Hallo Marc, dein Export ist da')`,
      [TENANT_A, userId, title],
    );
  }

  test("export returns messages, delete removes them", async () => {
    await seedMessage("inapp-user-1", "Export fertig");

    const result = await inAppMessageExportHook(ctx("inapp-user-1"));
    expect(result?.entity).toBe("in-app-message");
    expect(result?.rows[0]?.["title"]).toBe("Export fertig");

    await inAppMessageDeleteHook(ctx("inapp-user-1"), "delete");
    const rows = await rawSelect("SELECT * FROM in_app_messages WHERE user_id = $1", [
      "inapp-user-1",
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("tenant-invitation userData-hooks", () => {
  async function seedInvitation(
    id: string,
    email: string,
    invitedBy: string,
    tenantId = TENANT_A,
  ): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO read_tenant_invitations (id, tenant_id, email, role, status, invited_by, expires_at)
       VALUES ($1, $2, $3, 'Member', 'pending', $4, now() + interval '7 days')`,
      [id, tenantId, email, invitedBy],
    );
  }

  test("export matches invitations by the user's email", async () => {
    await seedUser(uuid(20));
    await seedInvitation(uuid(21), `user-${uuid(20)}@example.com`, "admin-1");

    const result = await tenantInvitationExportHook(ctx(uuid(20)));
    expect(result?.entity).toBe("tenant-invitation");
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["role"]).toBe("Member");
  });

  test("forget delete purged die Invitee-Row (rebuild-sicher via Executor)", async () => {
    await seedUser(uuid(22));
    await seedInvitation(uuid(23), `user-${uuid(22)}@example.com`, "admin-1");

    await tenantInvitationDeleteHook(ctx(uuid(22)), "delete");

    const rows = await rawSelect("SELECT * FROM read_tenant_invitations WHERE id = $1", [uuid(23)]);
    expect(rows).toHaveLength(0);
  });

  test("anonymize pseudonymisiert die Invitee-Email (unique-index-sicher)", async () => {
    await seedUser(uuid(24));
    await seedInvitation(uuid(25), `user-${uuid(24)}@example.com`, "admin-1");

    await tenantInvitationDeleteHook(ctx(uuid(24)), "anonymize");

    const rows = await rawSelect("SELECT email FROM read_tenant_invitations WHERE id = $1", [
      uuid(25),
    ]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["email"])).toBe(`forgotten-${uuid(25)}@anonymized.invalid`);
  });

  test("userEmailBeforeDelete takes precedence (user row already anonymized)", async () => {
    await seedInvitation(uuid(26), "vanished@example.com", "admin-1");

    await tenantInvitationDeleteHook(
      ctx("ghost-user-forgotten", { userEmailBeforeDelete: "Vanished@Example.com" }),
      "delete",
    );

    const rows = await rawSelect("SELECT * FROM read_tenant_invitations WHERE id = $1", [uuid(26)]);
    expect(rows).toHaveLength(0);
  });

  test("Inviter forget severs invitedBy, row remains (belongs to the invitee)", async () => {
    // userId must be a real UUID because the email lookup queries read_users.id (uuid).
    const inviter = uuid(28);
    await seedInvitation(uuid(27), "someone-else@example.com", inviter);

    await tenantInvitationDeleteHook(ctx(inviter), "delete");

    const rows = await rawSelect(
      "SELECT email, invited_by FROM read_tenant_invitations WHERE id = $1",
      [uuid(27)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["email"]).toBe("someone-else@example.com");
    expect(rows[0]?.["invited_by"]).toBe("anonymized");
  });
});

describe("notification-preference userData-hooks", () => {
  async function seedPreference(id: string, userId: string): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO read_notification_preferences (id, tenant_id, user_id, notification_type, channel, enabled)
       VALUES ($1, $2, $3, 'test:notify', 'email', false)`,
      [id, TENANT_A, userId],
    );
  }

  test("export returns prefs, forget purges them via Executor", async () => {
    await seedPreference(uuid(30), "pref-user-1");

    const result = await notificationPreferenceExportHook(ctx("pref-user-1"));
    expect(result?.entity).toBe("notification-preference");
    expect(result?.rows[0]?.["channel"]).toBe("email");
    expect(result?.rows[0]?.["enabled"]).toBe(false);

    await notificationPreferenceDeleteHook(ctx("pref-user-1"), "delete");
    const rows = await rawSelect("SELECT * FROM read_notification_preferences WHERE user_id = $1", [
      "pref-user-1",
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("config-value userData-hooks", () => {
  async function seedConfig(id: string, key: string, userId: string | null): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO read_config_values (id, tenant_id, key, value, user_id)
       VALUES ($1, $2, $3, '"dark"', $4)`,
      [id, TENANT_A, key, userId],
    );
  }

  test("export + forget affect ONLY user-scoped rows, tenant scope remains", async () => {
    await seedConfig(uuid(40), "ui.theme", "cfg-user-1");
    await seedConfig(uuid(41), "tenant.brand", null);

    const result = await configValueExportHook(ctx("cfg-user-1"));
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["key"]).toBe("ui.theme");

    await configValueDeleteHook(ctx("cfg-user-1"), "delete");
    const userRows = await rawSelect("SELECT * FROM read_config_values WHERE user_id = $1", [
      "cfg-user-1",
    ]);
    const tenantRows = await rawSelect("SELECT * FROM read_config_values WHERE id = $1", [
      uuid(41),
    ]);
    expect(userRows).toHaveLength(0);
    expect(tenantRows).toHaveLength(1);
  });
});

describe("delivery-attempt userData-hooks", () => {
  async function seedAttempt(id: string, recipientId: string, tenantId: string): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO store_delivery_attempts
         (id, tenant_id, notification_type, channel, recipient_id, recipient_address, status, priority)
       VALUES ($1, $2, 'app:notify:ping', 'email', $3, $4, 'sent', 'normal')`,
      [id, tenantId, recipientId, `user-${recipientId}@example.com`],
    );
  }

  test("export returns only the user's attempts in the export tenant", async () => {
    await seedAttempt(uuid(60), "da-user-1", TENANT_A);
    await seedAttempt(uuid(61), "da-user-1", TENANT_B);
    await seedAttempt(uuid(62), "da-user-2", TENANT_A);

    const result = await deliveryAttemptExportHook(ctx("da-user-1"));
    expect(result?.entity).toBe("delivery-attempt");
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["recipientAddress"]).toBe("user-da-user-1@example.com");
    expect(result?.rows[0]?.["channel"]).toBe("email");
  });

  test("export returns null for a user without attempts", async () => {
    expect(await deliveryAttemptExportHook(ctx("da-nobody"))).toBeNull();
  });

  describe("delete erases the address through an event", () => {
    async function logAttemptFor(recipientId: string, tenantId: string): Promise<string> {
      return logAttempt(full.db, full.registry, {
        tenantId,
        notificationType: "app:notify:ping",
        channel: "email",
        recipientId,
        recipientAddress: `${recipientId}@example.com`,
        status: "sent",
        error: null,
        priority: "normal",
      });
    }

    async function addressOf(attemptId: string): Promise<string | null | undefined> {
      const [row] = await selectMany<{ recipientAddress: string | null }>(
        full.db,
        deliveryAttemptsTable,
        { id: attemptId },
      );
      return row?.recipientAddress;
    }

    async function eraseEventCount(attemptId: string): Promise<number> {
      const events = await selectMany(full.db, eventsTable, {
        aggregateId: attemptId,
        type: DELIVERY_ATTEMPT_ADDRESS_ERASED_EVENT,
      });
      return events.length;
    }

    test("clears only the forgotten user's addresses in the hook tenant, idempotently", async () => {
      const own = await logAttemptFor("erase-user", TENANT_A);
      const ownSecond = await logAttemptFor("erase-user", TENANT_A);
      const otherUser = await logAttemptFor("erase-other", TENANT_A);
      const otherTenant = await logAttemptFor("erase-user", TENANT_B);
      expect(await addressOf(own)).toBe("e***@example.com");

      await deliveryAttemptDeleteHook(ctx("erase-user"), "anonymize");

      expect(await addressOf(own)).toBeNull();
      expect(await addressOf(ownSecond)).toBeNull();
      expect(await addressOf(otherUser)).toBe("e***@example.com");
      expect(await addressOf(otherTenant)).toBe("e***@example.com");
      expect(await eraseEventCount(own)).toBe(1);
      expect(await eraseEventCount(otherUser)).toBe(0);

      await deliveryAttemptDeleteHook(ctx("erase-user"), "delete");
      expect(await eraseEventCount(own)).toBe(1);
    });

    test("is a no-op without delivery mounted", async () => {
      const attempt = await logAttemptFor("erase-unmounted", TENANT_A);

      await deliveryAttemptDeleteHook(
        { ...ctx("erase-unmounted"), registry: minimal.registry },
        "anonymize",
      );

      expect(await addressOf(attempt)).toBe("e***@example.com");
      expect(await eraseEventCount(attempt)).toBe(0);
    });
  });
});

describe("job-run userData-hooks", () => {
  async function seedRun(id: string, triggeredById: string | null): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO store_job_runs
         (id, tenant_id, job_name, bull_job_id, status, payload, attempt, started_at, triggered_by_id)
       VALUES ($1::uuid, $2, 'app:job:export', $3, 'completed', '{"scope":"mine"}', 1, now(), $4)`,
      [id, SYSTEM_TENANT_ID, `bull-${id}`, triggeredById],
    );
  }

  test("export filters by triggeredById only (rows live on SYSTEM_TENANT_ID, ctx bound to TENANT_A)", async () => {
    await seedRun(uuid(70), "jr-user-1");
    await seedRun(uuid(71), "jr-user-2");
    await seedRun(uuid(72), null);

    const result = await jobRunExportHook(ctx("jr-user-1"));
    expect(result?.entity).toBe("job-run");
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["jobName"]).toBe("app:job:export");
    expect(result?.rows[0]?.["payload"]).toBe('{"scope":"mine"}');
  });

  test("export returns null for a user without runs", async () => {
    expect(await jobRunExportHook(ctx("jr-nobody"))).toBeNull();
  });
});

describe("Presence gating: Source feature not mounted → null/no-op instead of a crash", () => {
  test("all gated hooks no-open on the minimal stack", async () => {
    const minCtx = {
      db: createTenantDb({ db: minimal.db, tenantId: TENANT_A, mode: "tenant" }),
      registry: minimal.registry,
      tenantId: TENANT_A,
      userId: "any-user",
    };

    // sessions is mounted in the Minimal stack, but its table is absent. The
    // feature-level gate therefore protects only the five genuinely unmounted
    // features here; user-session is tested in the FULL stack.
    expect(await apiTokenExportHook(minCtx)).toBeNull();
    expect(await inAppMessageExportHook(minCtx)).toBeNull();
    expect(await tenantInvitationExportHook(minCtx)).toBeNull();
    expect(await notificationPreferenceExportHook(minCtx)).toBeNull();
    expect(await configValueExportHook(minCtx)).toBeNull();
    expect(await deliveryAttemptExportHook(minCtx)).toBeNull();
    expect(await jobRunExportHook(minCtx)).toBeNull();

    await expect(apiTokenDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(inAppMessageDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(tenantInvitationDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(notificationPreferenceDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(configValueDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
  });
});
