import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ConfigAccessor } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { createSecret } from "@cosmicdrift/kumiko-framework/secrets";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.ts";
import { isMailTransportPlugin, type MailTransportPlugin } from "../../mail-foundation/index.ts";
import { createMailTransportSmtpFeature } from "../feature.ts";

const TENANT = "contract-test-tenant";
const originalAllowedPrivateHostsEnv = process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];

beforeAll(() => {
  process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "localhost";
});

afterAll(() => {
  if (originalAllowedPrivateHostsEnv === undefined) {
    delete process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  } else {
    process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
  }
});

function registeredPlugin(): MailTransportPlugin {
  const usage = createMailTransportSmtpFeature().extensionUsages.find(
    (u) => u.extensionName === "mailTransport" && u.entityName === "smtp",
  );
  if (!usage || !isMailTransportPlugin(usage.options)) {
    throw new Error("mail-transport-smtp: plugin not registered under 'smtp'");
  }
  return usage.options;
}

function configWithAuthUser(authUser: string): ConfigAccessor {
  const keys = createMailTransportSmtpFeature().exports.configKeys;
  const values = new Map<string, string | number | boolean>([
    [keys.host.name, "localhost"],
    [keys.port.name, 587],
    [keys.secure.name, false],
    [keys.from.name, "noreply@contract-test.invalid"],
    [keys.authUser.name, authUser],
  ]);
  return (async (handle: string | { readonly name: string }) => {
    const key = typeof handle === "string" ? handle : handle.name;
    return values.get(key);
  }) as ConfigAccessor;
}

function countingSecrets(password: string | undefined): {
  readonly secrets: SecretsContext;
  readonly reads: () => number;
} {
  let reads = 0;
  const secrets: SecretsContext = {
    get: async () => {
      reads += 1;
      return password === undefined ? undefined : createSecret(password);
    },
    has: async () => true,
    set: async () => {},
    delete: async () => true,
    withRunner: () => {
      throw new Error("withRunner is not used by this test");
    },
  };
  return { secrets, reads: () => reads };
}

describe("mailTransportSmtpFeature — optional authentication", () => {
  test("an empty authUser builds a transport without reading the password", async () => {
    const { secrets, reads } = countingSecrets(undefined);
    const ctx = { config: configWithAuthUser(""), secrets, auditUserId: "x" };
    const transport = await registeredPlugin().build(ctx, TENANT);
    expect(typeof transport.send).toBe("function");
    expect(reads()).toBe(0);
  });

  test("an authUser without a stored password fails naming the secret", async () => {
    const { secrets, reads } = countingSecrets(undefined);
    const ctx = { config: configWithAuthUser("smtp-user"), secrets, auditUserId: "x" };
    await expect(registeredPlugin().build(ctx, TENANT)).rejects.toThrow(/smtp-password/);
    expect(reads()).toBe(1);
  });

  test("an authUser with a stored password builds a transport after reading it", async () => {
    const { secrets, reads } = countingSecrets("s3cret-pass");
    const ctx = { config: configWithAuthUser("smtp-user"), secrets, auditUserId: "x" };
    const transport = await registeredPlugin().build(ctx, TENANT);
    expect(typeof transport.send).toBe("function");
    expect(reads()).toBe(1);
  });
});
