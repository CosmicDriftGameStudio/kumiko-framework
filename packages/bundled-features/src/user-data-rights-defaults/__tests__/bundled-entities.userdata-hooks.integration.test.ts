// userData-Hook Integration-Tests für die Bundled-Entity-Hooks (GDPR-Audit
// 2026-07): user-session, api-token, in-app-message, tenant-invitation,
// notification-preference, config-value.
//
// Zwei Stacks:
//   FULL    — alle Source-Features gemountet; testet Export-Inhalt, Forget-
//             Semantik (hard-delete vs. executor-forget vs. anonymize) und
//             Tenant-Isolation.
//   MINIMAL — nur user/files/udr/defaults; testet das Presence-Gating: jeder
//             Hook muss null/no-op liefern statt gegen fehlende Tabellen zu
//             crashen (der Export-Runner hat kein per-Hook try/catch).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { createChannelInAppFeature, inAppMessagesTable } from "../../channel-in-app";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { configValueEntity, createConfigFeature } from "../../config";
import { createDataRetentionFeature } from "../../data-retention";
import { createDeliveryFeature, notificationPreferenceEntity } from "../../delivery";
import { createFilesFeature } from "../../files";
import {
  apiTokenEntity,
  createPersonalAccessTokensFeature,
  PatQueries,
  type PatScopeConfig,
} from "../../personal-access-tokens";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createTenantFeature, tenantInvitationEntity } from "../../tenant";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature } from "../../user-data-rights";
import { createUserDataRightsDefaultsFeature } from "../feature";
import {
  apiTokenDeleteHook,
  apiTokenExportHook,
  configValueDeleteHook,
  configValueExportHook,
  inAppMessageDeleteHook,
  inAppMessageExportHook,
  notificationPreferenceDeleteHook,
  notificationPreferenceExportHook,
  tenantInvitationDeleteHook,
  tenantInvitationExportHook,
  userSessionDeleteHook,
  userSessionExportHook,
} from "../index";

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
      createDeliveryFeature(),
      createChannelInAppFeature(),
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
  await unsafePushTables(full.db, { inAppMessagesTable });

  minimal = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
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
    db: full.db,
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
  const SYSTEM_TENANT = "00000000-0000-4000-8000-000000000001";
  await seedRow(full.db, userTable, {
    id,
    tenantId: SYSTEM_TENANT,
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
      `INSERT INTO read_user_sessions (id, user_id, tenant_id, created_at, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, now(), now() + interval '1 day', '203.0.113.7', 'TestAgent/1.0')`,
      [id, userId, tenantId],
    );
  }

  test("export liefert ip/userAgent, aber keine Session-Id (jti)", async () => {
    await seedSession(uuid(1), "sess-user-1", TENANT_A);

    const result = await userSessionExportHook(ctx("sess-user-1"));
    expect(result?.entity).toBe("user-session");
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.["ip"]).toBe("203.0.113.7");
    expect(result?.rows[0]?.["userAgent"]).toBe("TestAgent/1.0");
    expect(result?.rows[0]?.["id"]).toBeUndefined();
  });

  test("delete entfernt Sessions des Users, Cross-Tenant bleibt", async () => {
    await seedSession(uuid(2), "sess-user-2", TENANT_A);
    await seedSession(uuid(3), "sess-user-2", TENANT_B);

    await userSessionDeleteHook(ctx("sess-user-2"), "delete");

    const a = await rawSelect(
      "SELECT * FROM read_user_sessions WHERE user_id = $1 AND tenant_id = $2",
      ["sess-user-2", TENANT_A],
    );
    const b = await rawSelect(
      "SELECT * FROM read_user_sessions WHERE user_id = $1 AND tenant_id = $2",
      ["sess-user-2", TENANT_B],
    );
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });
});

describe("api-token userData-hooks", () => {
  async function seedToken(id: string, userId: string): Promise<void> {
    await asRawClient(full.db).unsafe(
      `INSERT INTO read_api_tokens (id, user_id, tenant_id, name, token_hash, prefix, scopes, created_at)
       VALUES ($1, $2, $3, 'My MacBook', $4, 'kum_ab12', '["read"]', now())`,
      [id, userId, TENANT_A, `hash-${id}`],
    );
  }

  test("export liefert Token-Metadata ohne tokenHash", async () => {
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

    const rows = await rawSelect("SELECT * FROM read_api_tokens WHERE user_id = $1", [
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

  test("export liefert Messages, delete entfernt sie", async () => {
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

  test("export matcht Invitations über die User-Email", async () => {
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

  test("userEmailBeforeDelete hat Vorrang (User-Row schon anonymisiert)", async () => {
    await seedInvitation(uuid(26), "vanished@example.com", "admin-1");

    await tenantInvitationDeleteHook(
      ctx("ghost-user-forgotten", { userEmailBeforeDelete: "Vanished@Example.com" }),
      "delete",
    );

    const rows = await rawSelect("SELECT * FROM read_tenant_invitations WHERE id = $1", [uuid(26)]);
    expect(rows).toHaveLength(0);
  });

  test("Inviter-Forget severs invitedBy, Row bleibt (gehört dem Invitee)", async () => {
    // userId als echte UUID — der Email-Lookup geht gegen read_users.id (uuid).
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

  test("export liefert Prefs, forget purged sie via Executor", async () => {
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

  test("export + forget treffen NUR user-scoped Rows, tenant-scope bleibt", async () => {
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

describe("Presence-Gating: Source-Feature nicht gemountet → null/no-op statt Crash", () => {
  test("alle gegateten Hooks no-open auf dem Minimal-Stack", async () => {
    const minCtx = {
      db: minimal.db,
      registry: minimal.registry,
      tenantId: TENANT_A,
      userId: "any-user",
    };

    // sessions ist im Minimal-Stack GEMOUNTET aber die Tabelle existiert
    // nicht — der Gate-Check greift auf Feature-Ebene, deshalb hier nur die
    // fünf wirklich ungemounteten Features. (user-session wird im FULL-Stack
    // getestet.)
    expect(await apiTokenExportHook(minCtx)).toBeNull();
    expect(await inAppMessageExportHook(minCtx)).toBeNull();
    expect(await tenantInvitationExportHook(minCtx)).toBeNull();
    expect(await notificationPreferenceExportHook(minCtx)).toBeNull();
    expect(await configValueExportHook(minCtx)).toBeNull();

    await expect(apiTokenDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(inAppMessageDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(tenantInvitationDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(notificationPreferenceDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
    await expect(configValueDeleteHook(minCtx, "delete")).resolves.toBeUndefined();
  });
});
