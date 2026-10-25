// Wrapper-specific integration test for composeFeatures and auth-routes wiring.
// Unlike password-reset.integration.ts, which instantiates the feature directly,
// this exercises the exact bootstrap path produced by runProdApp / runDevApp:
//
//   composeFeatures([], { includeBundled: true, authOptions: {...} })
//     → setupTestStack(features=..., authConfig=...)
//     → POST /api/auth/request-password-reset
//
// This catches the failure where composeFeatures.authOptions is not passed to
// createAuthEmailPasswordFeature: routes still mount, but the request-password-reset
// and reset-password handlers are missing, so dispatch cannot resolve the
// QualifiedName and production returns 5xx. The white-box test in
// compose-features.test.ts only checks Object.keys(writeHandlers); this test
// exercises the complete HTTP round trip and cannot miss the dispatch error.
//
// No mocking: setupTestStack starts real DB and Redis services. Reset and
// verification send mail through delivery (ctx.notify → channel-email), while
// the in-memory transport captures the real message without a mock API.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  AuthErrors,
  AuthHandlers,
  AuthQueries,
  hashPassword,
  signToken,
  TokenPurpose,
  verifyToken,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  configValuesTable,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
  notificationPreferencesTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import { tenantEntity, tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/testing";
import { UserHandlers, userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { LOCALE_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { buildComposeAuthOptions, composeFeatures } from "../compose-features.ts";
import type { RunProdAppAuthOptions } from "../run-prod-app.ts";
import { resolveAuthMail } from "../run-prod-app-boot-context.ts";

// resolveMailLocale only recognizes locales with a registered mail bundle;
// an empty bundle is enough to make "de" negotiable here.
registerMailTranslations("de", {});

const RESET_HMAC = randomBytes(32).toString("base64");
const VERIFY_HMAC = randomBytes(32).toString("base64");
const APP_RESET_URL = "https://app.example.com/reset-password";
const APP_VERIFY_URL = "https://app.example.com/verify-email";
const TEST_TENANT_ID: TenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
const systemAdmin = TestUsers.systemAdmin;

// Pulls the magic-link out of the mail's text part, where the URL appears
// verbatim (the HTML part entity-encodes "=" inside the href).
function tokenUrlFromMailText(text: string): URL {
  const match = text.match(/https?:\/\/[^\s\]]*\?token=[^\s\]]*/);
  if (!match) throw new Error("no magic-link url in mail text");
  return new URL(match[0]);
}

async function bootStack(
  authOptionsKind: "with-both" | "with-reset-only" | "without-auth-options",
): Promise<{ stack: TestStack; emailTransport: ReturnType<typeof createInMemoryTransport> }> {
  const emailTransport = createInMemoryTransport();

  // Matches runProdApp/runDevApp: composeFeatures is the single source of the
  // feature list. delivery and channel-email are added as app features because
  // reset and verification send mail through ctx.notify.
  const features = composeFeatures(
    [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
    ],
    {
      includeBundled: true,
      ...(authOptionsKind !== "without-auth-options" && {
        authOptions: {
          passwordReset: { hmacSecret: RESET_HMAC, tokenTtlMinutes: 15, appUrl: APP_RESET_URL },
          ...(authOptionsKind === "with-both" && {
            emailVerification: {
              hmacSecret: VERIFY_HMAC,
              tokenTtlMinutes: 60,
              mode: "off",
              appUrl: APP_VERIFY_URL,
            },
          }),
        },
      }),
    },
  );

  const stack = await setupTestStack({
    features,
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      // Routes always mount, regardless of authOptionsKind. This is the bug
      // condition: routes exist while their handlers may be missing.
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
      ...(authOptionsKind === "with-both" && {
        emailVerification: {
          requestHandler: AuthHandlers.requestEmailVerification,
          confirmHandler: AuthHandlers.verifyEmail,
        },
      }),
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
  await seedNotificationTemplates(stack.db, stack.registry);

  return { stack, emailTransport };
}

// Boots via resolveAuthMail's `auth.mail` convenience with its own
// hmacSecret, distinct from the resolveAuthMail call-site secret.
async function bootMailConventionStack(
  mailHmacSecret: string,
  callSiteSecret = "unused-call-site-secret",
): Promise<{ stack: TestStack; emailTransport: ReturnType<typeof createInMemoryTransport> }> {
  const emailTransport = createInMemoryTransport();

  const mailAuth = resolveAuthMail<RunProdAppAuthOptions>(
    {
      admin: {
        email: "admin@example.com",
        password: "pw-long-enough",
        displayName: "Admin",
        memberships: [],
      },
      mail: {
        baseUrl: "https://app.example.com",
        hmacSecret: mailHmacSecret,
        paths: {
          resetPassword: (locale) => (locale === "de" ? "/de/reset-password" : "/reset-password"),
        },
      },
    },
    callSiteSecret,
    { SMTP_HOST: "localhost" },
  );

  const features = composeFeatures(
    [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
    ],
    {
      includeBundled: true,
      authOptions: buildComposeAuthOptions(mailAuth),
    },
  );

  const stack = await setupTestStack({
    features,
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
      accountUnlock: {
        requestHandler: AuthHandlers.requestAccountUnlock,
        confirmHandler: AuthHandlers.confirmAccountUnlock,
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
  await seedNotificationTemplates(stack.db, stack.registry);

  return { stack, emailTransport };
}

async function seedUser(
  stack: TestStack,
  opts: { email: string; password: string },
): Promise<{ id: string }> {
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
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TEST_TENANT_ID,
    roles: ["User"],
  });
  return { id: created.id };
}

describe("composeFeatures wiring — passwordReset", () => {
  let suite: Awaited<ReturnType<typeof bootStack>>;

  beforeAll(async () => {
    suite = await bootStack("with-both");
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(suite.stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    suite.emailTransport.sent.length = 0;
  });

  test("full reset roundtrip: request → email → reset → login with new password", async () => {
    // Verifies that composeFeatures(authOptions.passwordReset) registers the
    // handler in the feature and mounts the /api/auth/... routes, so the wrapper
    // path is consistent with the direct feature path.
    await seedUser(suite.stack, { email: "alice@example.com", password: "old-password-1234" });

    const requestRes = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "alice@example.com",
    });
    expect(requestRes.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(1);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    expect(sent.to).toBe("alice@example.com");

    // Extracts the token from the mail URL as a real user would, exercising the
    // complete URL-to-handler round trip through delivery.
    const resetUrl = tokenUrlFromMailText(sent.text ?? "");
    expect(`${resetUrl.origin}${resetUrl.pathname}`).toBe(APP_RESET_URL);
    const token = resetUrl.searchParams.get("token");
    expect(token).toBeTruthy();
    if (!token) return;

    const resetRes = await suite.stack.http.raw("POST", "/api/auth/reset-password", {
      token,
      newPassword: "brand-new-pw-9876",
    });
    expect(resetRes.status).toBe(200);

    // The new password works for /api/auth/login, proving the user-visible
    // end-to-end result rather than merely checking that password_hash changed.
    const loginRes = await suite.stack.http.raw("POST", "/api/auth/login", {
      email: "alice@example.com",
      password: "brand-new-pw-9876",
    });
    expect(loginRes.status).toBe(200);
  });

  test("invalid token via wrapper-routes → 422 invalid_reset_token", async () => {
    await seedUser(suite.stack, { email: "carol@example.com", password: "keep-me-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/reset-password", {
      token: "tampered.totally.fake",
      newPassword: "should-not-stick-1234",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidResetToken);
  });
});

describe("composeFeatures wiring — emailVerification", () => {
  let suite: Awaited<ReturnType<typeof bootStack>>;

  beforeAll(async () => {
    suite = await bootStack("with-both");
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(suite.stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    suite.emailTransport.sent.length = 0;
  });

  test("emailVerification authOption durchgereicht → request handler dispatched", async () => {
    // Verifies that authOptions.emailVerification is forwarded in the same way as
    // passwordReset; the failure case is forwarding one option but not the other.
    await seedUser(suite.stack, { email: "bob@example.com", password: "any-pw-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/request-email-verification", {
      email: "bob@example.com",
    });
    expect(res.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(1);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no verification email sent");
    expect(sent.to).toBe("bob@example.com");
    const verifyUrl = tokenUrlFromMailText(sent.text ?? "");
    expect(`${verifyUrl.origin}${verifyUrl.pathname}`).toBe(APP_VERIFY_URL);
    expect(verifyUrl.searchParams.get("token")).toBeTruthy();
  });
});

describe("composeFeatures wiring — asymmetric activation", () => {
  // Verifies that passwordReset and emailVerification are forwarded independently.
  // A refactor must not couple the options, because an app enabling only one flow
  // must not lose that flow's handlers or mail.

  let suite: Awaited<ReturnType<typeof bootStack>>;

  beforeAll(async () => {
    suite = await bootStack("with-reset-only");
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(suite.stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    suite.emailTransport.sent.length = 0;
  });

  test("only passwordReset configured → reset flow live, verify flow fail-closed", async () => {
    await seedUser(suite.stack, { email: "alice@example.com", password: "any-pw-1234" });

    const resetRes = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "alice@example.com",
    });
    expect(resetRes.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(1);

    // This bootStack variant does not mount verification routes because
    // authConfig.emailVerification is absent. The endpoint therefore returns 404,
    // rather than the enumeration-safe 200 response from a mounted route, and no
    // second mail is sent.
    const verifyRes = await suite.stack.http.raw("POST", "/api/auth/request-email-verification", {
      email: "alice@example.com",
    });
    expect(verifyRes.status).toBe(404);
    expect(suite.emailTransport.sent).toHaveLength(1);
  });
});

describe("composeFeatures wiring — accountLockout", () => {
  // Verifies that authOptions.accountLockout is forwarded like
  // passwordReset and emailVerification. The regression was that runDevApp did
  // not accept the option at all (no field on RunDevAppAuthOptions) and
  // buildComposeAuthOptions would have dropped it anyway. Unlike those flows,
  // accountLockout has no dedicated routes, so login behavior proves that the
  // option reached createLoginHandler's accountLockout parameter.
  let stack: TestStack;
  const MAX_ATTEMPTS = 2;

  beforeAll(async () => {
    const features = composeFeatures([], {
      includeBundled: true,
      authOptions: {
        accountLockout: { maxFailedAttempts: MAX_ATTEMPTS, lockoutDurationMinutes: 1 },
      },
    });
    stack = await setupTestStack({
      features,
      extraContext: { configResolver: createConfigResolver() },
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
          [AuthErrors.accountLocked]: 423,
        },
      },
    });
    await unsafeCreateEntityTable(stack.db, userEntity);
    await unsafeCreateEntityTable(stack.db, tenantEntity);
    await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  afterEach(async () => {
    await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    await stack.redis.flushNamespace();
  });

  test("MAX_ATTEMPTS wrong passwords via the wrapper path lock the account (423)", async () => {
    await seedUser(stack, { email: "lockout@example.com", password: "right-pw-1234" });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await stack.http.raw("POST", "/api/auth/login", {
        email: "lockout@example.com",
        password: `wrong-${i}`,
      });
      expect(res.status).toBe(401);
    }

    // Correct password no longer helps once locked — proves the option
    // actually reached createLoginHandler's accountLockout param, not just
    // the type.
    const lockedRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "lockout@example.com",
      password: "right-pw-1234",
    });
    expect(lockedRes.status).toBe(423);
    const body = (await lockedRes.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.accountLocked);
  });
});

describe("composeFeatures wiring — fail-closed without authOptions", () => {
  // The white-box variant in compose-features.test.ts only checks
  // Object.keys(writeHandlers); this verifies the user-visible behavior: when the user exists and
  // POST request-password-reset is called, the wrapper path must produce a mail.
  // Otherwise the missing mail identifies a composeFeatures-authOptions failure.
  //
  // The request route is enumeration-safe by design (always-200 and silently
  // swallows handler failures; see registerTokenRequestRoute in auth-routes.ts).
  // A missing handler therefore produces "200 + 0 mails" rather than 4xx/5xx,
  // so the captured mail count is required to detect the regression.

  let suite: Awaited<ReturnType<typeof bootStack>>;

  beforeAll(async () => {
    suite = await bootStack("without-auth-options");
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  afterEach(async () => {
    await resetTestTables(suite.stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    suite.emailTransport.sent.length = 0;
  });

  test("authOptions missing → POST returns enumeration-safe 200, BUT NO emails (the actual bug proof)", async () => {
    // The user exists, proving that the missing mail is caused by the
    // composeFeatures configuration rather than enumeration-safe user lookup.
    await seedUser(suite.stack, { email: "noop@example.com", password: "any-pw-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "noop@example.com",
    });

    // 200 is expected because registerTokenRequestRoute swallows handler failures.
    // The missing mail is the failure signal: compared with the with-both case,
    // zero mails for the same existing user isolates the composeFeatures bug.
    expect(res.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(0);
  });

  test("login-options reports no optional flow without auth options", async () => {
    const res = await suite.stack.http.raw("POST", "/api/query", {
      type: AuthQueries.loginOptions,
      payload: {},
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { passwordReset: false, accountUnlock: false },
    });
  });
});

describe("composeFeatures wiring — auth.mail convenience locale + secret", () => {
  // mailHmacSecret and callSiteSecret are deliberately different values: a
  // live reset roundtrip must validate against mailHmacSecret, not callSiteSecret.
  const mailHmacSecret = randomBytes(32).toString("base64");
  const callSiteSecret = randomBytes(32).toString("base64");
  let suite: Awaited<ReturnType<typeof bootMailConventionStack>>;

  beforeAll(async () => {
    suite = await bootMailConventionStack(mailHmacSecret, callSiteSecret);
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(suite.stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    suite.emailTransport.sent.length = 0;
  });

  test("X-Locale: de → reset link carries the localized path and its token is accepted", async () => {
    await seedUser(suite.stack, { email: "greta@example.com", password: "old-password-1234" });

    const res = await suite.stack.http.raw(
      "POST",
      "/api/auth/request-password-reset",
      { email: "greta@example.com" },
      { [LOCALE_HEADER_NAME]: "de" },
    );
    expect(res.status).toBe(200);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    const resetUrl = tokenUrlFromMailText(sent.text ?? "");
    expect(resetUrl.pathname).toBe("/de/reset-password");
    const token = resetUrl.searchParams.get("token");
    if (!token) throw new Error("no token in mail link");
    expect(verifyToken(token, TokenPurpose.passwordReset, mailHmacSecret).ok).toBe(true);
    expect(verifyToken(token, TokenPurpose.passwordReset, callSiteSecret).ok).toBe(false);

    const confirmRes = await suite.stack.http.raw("POST", "/api/auth/reset-password", {
      token,
      newPassword: "brand-new-pw-9876",
    });
    expect(confirmRes.status).toBe(200);
  });

  test("auth.mail without an accountUnlock block still mails an unlock link to /unlock-account", async () => {
    await seedUser(suite.stack, { email: "ida@example.com", password: "old-password-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/request-account-unlock", {
      email: "ida@example.com",
    });
    expect(res.status).toBe(200);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    const unlockUrl = tokenUrlFromMailText(sent.text ?? "");
    expect(unlockUrl.origin).toBe("https://app.example.com");
    expect(unlockUrl.pathname).toBe("/unlock-account");
    const token = unlockUrl.searchParams.get("token");
    if (!token) throw new Error("no token in mail link");
    const confirmRes = await suite.stack.http.raw("POST", "/api/auth/confirm-account-unlock", {
      token,
    });
    expect(confirmRes.status).toBe(200);
  });

  test("login-options reports both flows as available", async () => {
    const res = await suite.stack.http.raw("POST", "/api/query", {
      type: AuthQueries.loginOptions,
      payload: {},
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { passwordReset: true, accountUnlock: true } });
  });

  test("no X-Locale → reset link falls back to the default path", async () => {
    await seedUser(suite.stack, { email: "henry@example.com", password: "old-password-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "henry@example.com",
    });
    expect(res.status).toBe(200);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    expect(tokenUrlFromMailText(sent.text ?? "").pathname).toBe("/reset-password");
  });

  test("a token signed with the resolveAuthMail call-site secret is rejected", async () => {
    const seeded = await seedUser(suite.stack, {
      email: "ivy@example.com",
      password: "old-password-1234",
    });
    const { token } = signToken(seeded.id, TokenPurpose.passwordReset, 15, callSiteSecret);

    const res = await suite.stack.http.raw("POST", "/api/auth/reset-password", {
      token,
      newPassword: "should-not-stick-1234",
    });
    expect(res.status).toBe(422);
  });
});
