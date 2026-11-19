// PAT create wired to the real auth-mfa code verifier instead of a stub: the verifier reads
// the enrollment through the create handler's own escape hatch.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { base32Decode } from "../../auth-mfa/base32.ts";
import { createAuthMfaFeature } from "../../auth-mfa/feature.ts";
import { mfaVerifierFromFeature } from "../../auth-mfa/feature-exports.ts";
import { userMfaEntity } from "../../auth-mfa/schema/user-mfa.ts";
import { currentTotpCode } from "../../auth-mfa/totp.ts";
import { AuthMfaHandlers } from "../../auth-mfa/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { makeSessionHelpers } from "../../sessions/__tests__/test-helpers.ts";
import { createSessionsFeature } from "../../sessions/feature.ts";
import { userSessionEntity } from "../../sessions/schema/user-session.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createPersonalAccessTokensFeature } from "../feature.ts";
import { apiTokenEntity } from "../schema/api-token.ts";
import { PatErrors, PatHandlers, PatQueries } from "../web/constants.ts";

const TENANT = testTenantId(1);
const TOKEN_REQUEST = { name: "test", scopes: ["tokens:read"], currentPassword: "pw" };

let stack: TestStack;
let sessions: ReturnType<typeof makeSessionHelpers>;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  const authMfa = createAuthMfaFeature({
    setupTokenSecret: "test-setup-token-secret-do-not-use-in-prod",
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature(),
      authMfa,
      createPersonalAccessTokensFeature({
        scopes: { tokens: { label: "Tokens", read: [PatQueries.mine] } },
        mfaVerifier: mfaVerifierFromFeature(authMfa),
      }),
      createAuthFoundationFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  sessions = makeSessionHelpers(stack, TENANT);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafeCreateEntityTable(stack.db, apiTokenEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function actorFor(email: string): Promise<SessionUser> {
  const { userId } = await sessions.seedUser(email, "pw");
  return { id: userId, tenantId: TENANT, roles: ["User"] };
}

async function enrollTotp(actor: SessionUser): Promise<Buffer> {
  const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
    AuthMfaHandlers.enableStart,
    { accountLabel: `${actor.id}@example.com` },
    actor,
  );
  const secret = base32Decode(
    new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "",
  );
  await stack.http.writeOk(
    AuthMfaHandlers.enableConfirm,
    { setupToken: start.setupToken, code: currentTotpCode(secret) },
    actor,
  );
  return secret;
}

describe("PAT create with the auth-mfa verifier", () => {
  test("a user without MFA mints a token", async () => {
    const actor = await actorFor("pat-no-mfa@example.com");

    const minted = await stack.http.writeOk<{ token: string }>(
      PatHandlers.create,
      TOKEN_REQUEST,
      actor,
    );

    expect(minted.token.length).toBeGreaterThan(20);
  });

  test("an enrolled user mints a token with the current code and is refused with a wrong one", async () => {
    const actor = await actorFor("pat-with-mfa@example.com");
    const secret = await enrollTotp(actor);

    const refused = await stack.http.writeErr(
      PatHandlers.create,
      { ...TOKEN_REQUEST, mfaCode: "000000" },
      actor,
    );
    expect(refused.details).toMatchObject({ reason: PatErrors.reauthRequired });

    const minted = await stack.http.writeOk<{ token: string }>(
      PatHandlers.create,
      { ...TOKEN_REQUEST, mfaCode: currentTotpCode(secret) },
      actor,
    );
    expect(minted.token.length).toBeGreaterThan(20);
  });
});
