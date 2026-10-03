import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { LOCALE_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferencesTable } from "../../delivery/tables.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createRendererSimpleFeature, createSimpleRenderer } from "../../renderer-simple/index.js";
import { hashPassword } from "../../shared/index.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenantMembership } from "../../tenant/testing.js";
import { createUserFeature } from "../../user/feature.js";
import { UserHandlers } from "../../user/index.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { AuthHandlers } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";

// Reset mails now go through delivery (ctx.notify → channel-email). The
// in-memory transport captures what would be sent; route:{email} delivers
// directly (no jobRunner in the test stack → inline send).
const emailTransport = createInMemoryTransport();

registerMailTranslations("de", localeDeBundle);

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");
const resetSecret = randomBytes(32).toString("base64");
const appResetUrl = "https://app.example.com/reset";

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: createSimpleRenderer({
          productName: "Acme",
          defaultLocale: "en",
          footerText: { de: "Acme GmbH, Deutschland", en: "Acme Inc., Worldwide" },
          footerLinks: [
            {
              label: { de: "Datenschutz", en: "Privacy" },
              url: {
                de: "https://acme.example/de/datenschutz",
                en: "https://acme.example/en/privacy",
              },
            },
          ],
        }),
        // route:{email} delivers directly — resolveEmail (userId→address) is
        // never hit by the reset flow, but the channel requires it.
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        passwordReset: { hmacSecret: resetSecret, tokenTtlMinutes: 15, appUrl: appResetUrl },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
    },
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
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  emailTransport.sent.length = 0;
});

async function seedUser(opts: {
  email: string;
  password: string;
  tenantId?: TenantId;
}): Promise<{ id: string; tenantId: TenantId }> {
  const hash = await hashPassword(opts.password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: opts.email,
      passwordHash: hash,
      displayName: opts.email.split("@")[0] ?? "user",
    },
    systemAdmin,
  );
  const tenantId = opts.tenantId ?? "00000000-0000-4000-8000-000000000001";
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId,
    roles: ["User"],
  });
  return { id: created.id, tenantId };
}

async function requestResetMailHtml(email: string, locale?: string): Promise<string> {
  await seedUser({ email, password: "initial-pw!" });
  const res = await stack.http.raw(
    "POST",
    "/api/auth/request-password-reset",
    { email },
    locale ? { [LOCALE_HEADER_NAME]: locale } : undefined,
  );
  expect(res.status).toBe(200);
  expect(emailTransport.sent).toHaveLength(1);
  const sent = emailTransport.sent[0];
  if (!sent) throw new Error("no email sent");
  return sent.html;
}

describe("password-reset mail branding per locale", () => {
  test("de: German footer text and German privacy link", async () => {
    const html = await requestResetMailHtml("brand-de@example.com", "de");
    expect(html).toContain("Acme GmbH, Deutschland");
    expect(html).toContain('href="https://acme.example/de/datenschutz"');
    expect(html).toContain(">Datenschutz</a>");
    expect(html).not.toContain("Acme Inc.");
  });

  test("en: English footer text and English privacy link", async () => {
    const html = await requestResetMailHtml("brand-en@example.com", "en");
    expect(html).toContain("Acme Inc., Worldwide");
    expect(html).toContain('href="https://acme.example/en/privacy"');
    expect(html).toContain(">Privacy</a>");
    expect(html).not.toContain("Datenschutz");
  });
});
