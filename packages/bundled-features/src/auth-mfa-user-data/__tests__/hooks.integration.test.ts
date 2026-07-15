// userMfaExportHook/userMfaDeleteHook — GDPR export must never surface the
// TOTP secret or recovery codes, and forget must actually remove the row
// (not just leave it dangling for a future projection rebuild to resurrect).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { base32Decode } from "../../auth-mfa/base32";
import { AuthMfaHandlers } from "../../auth-mfa/constants";
import { createAuthMfaFeature } from "../../auth-mfa/feature";
import { userMfaEntity } from "../../auth-mfa/schema/user-mfa";
import { currentTotpCode } from "../../auth-mfa/totp";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { userMfaDeleteHook, userMfaExportHook } from "../hooks";

let stack: TestStack;

const SETUP_TOKEN_SECRET = "test-setup-token-secret-do-not-use-in-prod";

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createAuthMfaFeature({
        setupTokenSecret: SETUP_TOKEN_SECRET,
        issuer: "Kumiko Test",
        challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function enrollUser(userId: string) {
  const user = createTestUser({ id: userId, roles: ["User"] });
  const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
    AuthMfaHandlers.enableStart,
    { accountLabel: `${userId}@example.com` },
    user,
  );
  const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
  const secret = base32Decode(secretParam);
  await stack.http.writeOk(
    AuthMfaHandlers.enableConfirm,
    { setupToken: start.setupToken, code: currentTotpCode(secret) },
    user,
  );
  return user;
}

describe("userMfaExportHook / userMfaDeleteHook", () => {
  test("export confirms enrollment without leaking the TOTP secret or recovery codes", async () => {
    const user = await enrollUser("export-1");

    const snippet = await userMfaExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: user.tenantId,
      userId: user.id,
    });

    expect(snippet).not.toBeNull();
    expect(snippet?.rows).toHaveLength(1);
    const row = snippet?.rows[0] as Record<string, unknown>;
    expect(row["enrolled"]).toBe(true);
    expect(JSON.stringify(row)).not.toContain("totpSecret");
    expect(JSON.stringify(row)).not.toContain("recoveryCodes");
  });

  test("export returns null for a user who never enrolled", async () => {
    const user = createTestUser({ id: "never-enrolled", roles: ["User"] });
    const snippet = await userMfaExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: user.tenantId,
      userId: user.id,
    });
    expect(snippet).toBeNull();
  });

  test("delete hard-removes the row via forget (rebuild-safe)", async () => {
    const user = await enrollUser("delete-1");

    const before = await userMfaExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: user.tenantId,
      userId: user.id,
    });
    expect(before).not.toBeNull();

    await userMfaDeleteHook(
      {
        db: stack.db,
        registry: stack.registry,
        tenantId: user.tenantId,
        userId: user.id,
      },
      "delete",
    );

    const after = await userMfaExportHook({
      db: stack.db,
      registry: stack.registry,
      tenantId: user.tenantId,
      userId: user.id,
    });
    expect(after).toBeNull();
  });
});
