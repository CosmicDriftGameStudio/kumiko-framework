// KEK-rotation job for kumiko-framework#266 Step 8. Proves two things:
//
//   1. The job actually rewraps totpSecret onto the current KEK version.
//   2. Advisor-flagged trap: rotation must not just touch the live
//      projection — a FULL PROJECTION REBUILD after rotation must still
//      decrypt correctly. Events store CIPHERTEXT (see #967 — "the
//      immutable log never sees plaintext, replay reproduces the row
//      byte-identically"), so a rebuild replays events in order and lands
//      on the LATEST event's ciphertext. That's only true if the rotation
//      job goes through executor.update() (which appends a real event)
//      instead of a raw UPDATE on the projection table — this test is the
//      regression guard for that specific design choice.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { AppContext } from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createEnvelopeCipher,
  createEnvMasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createMutableMasterKeyProvider } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { AuthMfaHandlers } from "../constants";
import { createAuthMfaFeature } from "../feature";
import { mfaReencryptJob } from "../handlers/reencrypt.job";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

const SETUP_TOKEN_SECRET = "test-setup-token-secret-do-not-use-in-prod";
const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";

let stack: TestStack;
const v1Key = randomBytes(32).toString("base64");
const v2Key = randomBytes(32).toString("base64");
const mutableProvider = createMutableMasterKeyProvider(
  createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: v1Key,
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  }),
);

beforeAll(async () => {
  const cipher = createEnvelopeCipher(mutableProvider, {});
  configureEntityFieldEncryption(cipher);
  const resolver = createConfigResolver({ cipher });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthMfaFeature({
        setupTokenSecret: SETUP_TOKEN_SECRET,
        issuer: "Kumiko Test",
        challengeTokenSecret: CHALLENGE_TOKEN_SECRET,
      }),
    ],
    masterKeyProvider: mutableProvider,
    extraContext: { configResolver: resolver, configEncryption: cipher },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

type RawUserMfaRow = { id: string; totpSecret: string; version: number };

async function readRawRow(): Promise<RawUserMfaRow> {
  const rows = await selectMany<RawUserMfaRow>(stack.db, userMfaTable, {});
  const row = rows[0];
  if (!row) throw new Error("no user-mfa row");
  return row;
}

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};

function jobCtx(): AppContext {
  return {
    db: stack.db,
    registry: stack.registry,
    masterKeyProvider: mutableProvider,
    log: noopLog,
  } as AppContext; // @cast-boundary test-seam — job only reads db/registry/masterKeyProvider/log
}

describe("auth-mfa KEK-rotation job — kumiko-framework#266 Step 8", () => {
  test("rotation rewraps totpSecret onto the current KEK, and a full projection rebuild still decrypts correctly", async () => {
    const user = createTestUser({ id: 1, roles: ["User"] });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "user-1@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      user,
    );

    const beforeRow = await readRawRow();
    expect(JSON.parse(beforeRow.totpSecret).kekVersion).toBe(1);

    // Simulate "ops added a new master key version and flipped CURRENT=2" —
    // same simulate-rotation-without-restart helper secrets/rotate uses.
    mutableProvider.replace(
      createEnvMasterKeyProvider({
        env: {
          KUMIKO_SECRETS_MASTER_KEY_V1: v1Key,
          KUMIKO_SECRETS_MASTER_KEY_V2: v2Key,
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
        },
      }),
    );

    await mfaReencryptJob({}, jobCtx());

    const afterJobRow = await readRawRow();
    expect(JSON.parse(afterJobRow.totpSecret).kekVersion).toBe(2);

    // The regression guard: rebuild the projection from scratch (replays
    // every event for this aggregate) and confirm it still lands on the
    // V2 envelope — NOT a resurrected V1 wrap from the original
    // enable-confirm event.
    await rebuildProjection("auth-mfa:projection:user-mfa-entity", {
      db: stack.db,
      registry: stack.registry,
    });

    const afterRebuildRow = await readRawRow();
    expect(JSON.parse(afterRebuildRow.totpSecret).kekVersion).toBe(2);

    // Decrypt-level proof, not just the version tag: a valid TOTP code
    // against the post-rebuild secret still verifies — the plaintext
    // survived rotation + rebuild byte-identically. disable() decrypts
    // totpSecret to check the code, so a decrypt failure (wrong key)
    // would surface here as invalid_totp_code or a hard error, not a
    // silent pass.
    await stack.http.writeOk(AuthMfaHandlers.disable, { code: currentTotpCode(secret) }, user);
  });
});
