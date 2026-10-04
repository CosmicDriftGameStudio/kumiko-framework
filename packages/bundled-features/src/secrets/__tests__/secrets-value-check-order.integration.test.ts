// The write role is checked before the value schema, so a caller without the
// role cannot use the 400-vs-403 difference as an oracle for what a valid
// value looks like.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { defineFeature, type SecretKeyHandle } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import {
  createEnvMasterKeyProvider,
  type SecretsContext,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { createSecretsFeature } from "../feature.js";
import { createSecretsContext } from "../secrets-context.js";
import { tenantSecretsTable } from "../table.js";
import { isInvalidSecretValueError } from "../write-gate.js";

const INVALID_VALUE = "not-a-url";

let urlKey: SecretKeyHandle | undefined;
const urlKeyFeature = defineFeature("secrets-url-test", (r) => {
  urlKey = r.secret("webhook.url", {
    label: { en: "Webhook URL" },
    scope: "tenant",
    writeRoles: ["SystemAdmin"],
    valueSchema: z.string().url(),
  });
});

const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });
const systemAdmin = createTestUser({ roles: ["SystemAdmin"] });

let stack: TestStack;
let programmaticSecrets: SecretsContext;

beforeAll(async () => {
  const provider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] }), urlKeyFeature],
    extraContext: ({ db, registry }) => {
      programmaticSecrets = createSecretsContext({ db, masterKeyProvider: provider, registry });
      return { secrets: programmaticSecrets };
    },
  });
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("secrets:write:set with an invalid value", () => {
  test("a caller without the write role gets 403, not a validity verdict", async () => {
    const err = await stack.http.writeErr(
      "secrets:write:set",
      { key: urlKey?.name, value: INVALID_VALUE },
      tenantAdmin,
    );
    expect(err.code).toBe("access_denied");
    expect(err.i18nKey).toBe("secrets.errors.writeDenied");
  });

  test("a caller with the write role gets 400 for the same value", async () => {
    const err = await stack.http.writeErr(
      "secrets:write:set",
      { key: urlKey?.name, value: INVALID_VALUE },
      systemAdmin,
    );
    expect(err.code).toBe("validation_error");
    expect(err.i18nKey).toBe("secrets.errors.invalidValue");
  });
});

describe("ctx.secrets.set (programmatic)", () => {
  const secrets = () => programmaticSecrets;

  test("rejects a value the declared valueSchema refuses, without echoing it", async () => {
    const err = await secrets()
      .set(systemAdmin.tenantId, urlKey?.name ?? "", INVALID_VALUE)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).i18nKey).toBe("secrets.errors.invalidValue");
    expect(JSON.stringify(err)).not.toContain(INVALID_VALUE);
    expect(await secrets().has(systemAdmin.tenantId, urlKey?.name ?? "")).toBe(false);
  });

  test("stores a valid value", async () => {
    await secrets().set(systemAdmin.tenantId, urlKey?.name ?? "", "https://example.com/hook");
    expect(await secrets().has(systemAdmin.tenantId, urlKey?.name ?? "")).toBe(true);
  });
});

describe("isInvalidSecretValueError", () => {
  test("recognises the error ctx.secrets.set throws for an invalid value", async () => {
    const err = await programmaticSecrets
      .set(systemAdmin.tenantId, urlKey?.name ?? "", INVALID_VALUE)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isInvalidSecretValueError(err)).toBe(true);
  });

  test("does not recognise other validation errors or non-errors", () => {
    expect(isInvalidSecretValueError(new ValidationError({ fields: [] }))).toBe(false);
    expect(isInvalidSecretValueError("secrets.errors.invalidValue")).toBe(false);
    expect(isInvalidSecretValueError(undefined)).toBe(false);
  });
});
