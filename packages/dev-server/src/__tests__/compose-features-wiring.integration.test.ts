// Wrapper-spezifischer Integration-Test für composeFeatures + auth-routes-
// Verdrahtung. Ergänzt password-reset.integration.ts (das das Feature
// direkt instantiiert) — hier wird der EXAKTE Bootstrap-Pfad gefahren den
// runProdApp / runDevApp produzieren:
//
//   composeFeatures([], { includeBundled: true, authOptions: {...} })
//     → setupTestStack(features=..., authConfig=...)
//     → POST /api/auth/request-password-reset
//
// Bug-Pattern den dieser Test pinst: composeFeatures.authOptions wird
// NICHT an createAuthEmailPasswordFeature durchgereicht → routes mounten
// (auth-routes-config tut das blind), aber die request-password-reset/
// reset-password Handler fehlen im Feature → dispatcher kennt den
// QualifiedName nicht → 5xx in Production. Whitebox-Variante in
// compose-features.test.ts checkt nur Object.keys(writeHandlers); dieser
// Test fährt den vollen HTTP-Roundtrip und kann den dispatch-error nicht
// übersehen.
//
// Kein Mocking: setupTestStack bootet echte DB + Redis. reset/verify mailen
// via delivery (ctx.notify → channel-email); der In-Memory-Transport fängt
// die echte Mail ab — gewollter Capture ohne Mock-API (CLAUDE.md "Kein Mock
// in *.integration.ts").

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  AuthErrors,
  AuthHandlers,
  hashPassword,
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
import {
  createRendererSimpleFeature,
  simpleRenderer,
} from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { tenantEntity, tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/testing";
import { UserHandlers, userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { deleteMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { composeFeatures } from "../compose-features";

const RESET_HMAC = randomBytes(32).toString("base64");
const VERIFY_HMAC = randomBytes(32).toString("base64");
const APP_RESET_URL = "https://app.example.com/reset-password";
const APP_VERIFY_URL = "https://app.example.com/verify-email";
const TEST_TENANT_ID: TenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
const systemAdmin = TestUsers.systemAdmin;

// Pulls the magic-link out of the rendered mail HTML — the renderer-simple
// button carries it as the only href. Replaces the old callback-captured
// resetUrl now that reset/verify mail via delivery.
function tokenUrlFromHtml(html: string): URL {
  const match = html.match(/href="([^"]*\?token=[^"]*)"/);
  if (!match?.[1]) throw new Error("no magic-link href in mail html");
  return new URL(match[1]);
}

async function bootStack(
  authOptionsKind: "with-both" | "with-reset-only" | "without-auth-options",
): Promise<{ stack: TestStack; emailTransport: ReturnType<typeof createInMemoryTransport> }> {
  const emailTransport = createInMemoryTransport();

  // Genau das was runProdApp/runDevApp machen würde — composeFeatures als
  // single-source der Feature-Liste. delivery + channel-email kommen als
  // App-Features dazu, weil reset/verify ihre Mail via ctx.notify schicken.
  const features = composeFeatures(
    [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
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
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      // Routes IMMER mounten — egal welche authOptionsKind. Genau das
      // ist die Bug-Bedingung: Routes da, Handler eventuell nicht.
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
    await deleteMany(suite.stack.db, userTable, {});
    await deleteMany(suite.stack.db, tenantMembershipsTable, {});
    suite.emailTransport.sent.length = 0;
  });

  test("full reset roundtrip: request → email → reset → login with new password", async () => {
    // Beweis: composeFeatures(authOptions.passwordReset) hat den Handler
    // im Feature registriert UND auth-routes hat die /api/auth/...-Routes
    // gemountet — der Wrapper-Pfad ist konsistent. password-reset.
    // integration.ts beweist das gleiche für direkten Feature-Aufruf;
    // dieser Test pinst dass der Wrapper das Pattern repliziert.
    await seedUser(suite.stack, { email: "alice@example.com", password: "old-password-1234" });

    const requestRes = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "alice@example.com",
    });
    expect(requestRes.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(1);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    expect(sent.to).toBe("alice@example.com");

    // Token aus der Mail-URL extrahieren — wie der echte User es täte (Mail
    // klicken, Browser parsed query-string). Das pinst den vollen
    // URL-zu-Handler-Roundtrip über delivery.
    const resetUrl = tokenUrlFromHtml(sent.html);
    expect(`${resetUrl.origin}${resetUrl.pathname}`).toBe(APP_RESET_URL);
    const token = resetUrl.searchParams.get("token");
    expect(token).toBeTruthy();
    if (!token) return;

    const resetRes = await suite.stack.http.raw("POST", "/api/auth/reset-password", {
      token,
      newPassword: "brand-new-pw-9876",
    });
    expect(resetRes.status).toBe(200);

    // Confirmation: das neue Passwort funktioniert für /api/auth/login.
    // Das ist der echte End-to-End-Beweis (DB-Read würde nur
    // password_hash != old verifizieren — hier prüfen wir die User-
    // visible Konsequenz).
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
    await deleteMany(suite.stack.db, userTable, {});
    await deleteMany(suite.stack.db, tenantMembershipsTable, {});
    suite.emailTransport.sent.length = 0;
  });

  test("emailVerification authOption durchgereicht → request handler dispatched", async () => {
    // Symmetric zum reset-Test — pinst dass authOptions.emailVerification
    // genauso durchgereicht wird wie passwordReset. Bug-Pattern wäre dass
    // der Wrapper EINS funktioniert, ANDERES vergisst.
    await seedUser(suite.stack, { email: "bob@example.com", password: "any-pw-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/request-email-verification", {
      email: "bob@example.com",
    });
    expect(res.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(1);
    const sent = suite.emailTransport.sent[0];
    if (!sent) throw new Error("no verification email sent");
    expect(sent.to).toBe("bob@example.com");
    const verifyUrl = tokenUrlFromHtml(sent.html);
    expect(`${verifyUrl.origin}${verifyUrl.pathname}`).toBe(APP_VERIFY_URL);
    expect(verifyUrl.searchParams.get("token")).toBeTruthy();
  });
});

describe("composeFeatures wiring — asymmetric activation", () => {
  // Pinst dass passwordReset und emailVerification UNABHÄNGIG durchgereicht
  // werden. Bug-Pattern: ein Refactor des Helpers könnte einen Block
  // versehentlich an den anderen koppeln (z.B. emailVerification nur
  // durchreichen wenn passwordReset auch gesetzt ist) — dann würde eine
  // App die NUR Reset-Flow will plötzlich keine Reset-Mails mehr kriegen,
  // oder eine die NUR Verify-Flow will keine Verify-Mails. Asymmetric-
  // activation ist also ein eigenständiger Wrapper-Vertrag.

  let suite: Awaited<ReturnType<typeof bootStack>>;

  beforeAll(async () => {
    suite = await bootStack("with-reset-only");
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  beforeEach(async () => {
    await deleteMany(suite.stack.db, userTable, {});
    await deleteMany(suite.stack.db, tenantMembershipsTable, {});
    suite.emailTransport.sent.length = 0;
  });

  test("nur passwordReset gesetzt → reset-flow live, verify-flow fail-closed", async () => {
    await seedUser(suite.stack, { email: "alice@example.com", password: "any-pw-1234" });

    // Reset-flow funktioniert: Mail wird produziert.
    const resetRes = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "alice@example.com",
    });
    expect(resetRes.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(1);

    // Verify-Routes sind in dieser bootStack-Variante NICHT gemounted
    // (authConfig.emailVerification fehlt). Der Endpoint existiert also
    // gar nicht — Hono returnt 404. Unterscheidet sich vom 200-silent-
    // success-Pfad: hier ist die ROUTE selbst nicht da. Kein zweites Mail.
    const verifyRes = await suite.stack.http.raw("POST", "/api/auth/request-email-verification", {
      email: "alice@example.com",
    });
    expect(verifyRes.status).toBe(404);
    expect(suite.emailTransport.sent).toHaveLength(1);
  });
});

describe("composeFeatures wiring — fail-closed ohne authOptions", () => {
  // Der Bug den der Review-Agent gefangen hat. Whitebox-Variante in
  // compose-features.test.ts checkt nur Object.keys(writeHandlers); hier
  // pinst der Test das User-visible Verhalten: WENN user existiert + POST
  // request-password-reset gefeuert wird, MUSS der Wrapper-Pfad eine Mail
  // produzieren. Tut er das nicht, ist der composeFeatures-authOptions-
  // Bug zurück.
  //
  // Subtilität: auth-routes mountet die request-Route by-design als
  // enumeration-safe (always-200, silently swallow handler-Failures —
  // siehe registerTokenRequestRoute in auth-routes.ts). Ein fehlender
  // Handler endet daher nicht in 4xx/5xx, sondern silent in "200 + 0
  // mails". Genau das pinnt dieser Test gegen die Regression: ohne
  // resetEmails-Capture als Counter-Evidence wäre der Bug unsichtbar.

  let suite: Awaited<ReturnType<typeof bootStack>>;

  beforeAll(async () => {
    suite = await bootStack("without-auth-options");
  });

  afterAll(async () => {
    await suite.stack.cleanup();
  });

  afterEach(async () => {
    await deleteMany(suite.stack.db, userTable, {});
    await deleteMany(suite.stack.db, tenantMembershipsTable, {});
    suite.emailTransport.sent.length = 0;
  });

  test("authOptions fehlt → POST returnt enumeration-safe 200, ABER NULL Mails (der echte Bug-Beweis)", async () => {
    // User EXISTIERT — das pinst dass die fehlende Mail auf dem
    // composeFeatures-bug beruht, nicht auf "user not found"
    // (welcher legitim 0 mails produziert: enumeration-safety).
    await seedUser(suite.stack, { email: "noop@example.com", password: "any-pw-1234" });

    const res = await suite.stack.http.raw("POST", "/api/auth/request-password-reset", {
      email: "noop@example.com",
    });

    // 200 ist by-design (registerTokenRequestRoute swallowt handler-
    // Failures). Bug-Beweis ist die fehlende Mail — wenn der "with-both"-
    // Test 1 Mail bekommt und dieser Test 0 bekommt für denselben
    // existierenden User, ist die Differenz EXAKT der composeFeatures-
    // Bug. Diese Asymmetrie zwischen den beiden describe-Blöcken IST
    // der Test.
    expect(res.status).toBe(200);
    expect(suite.emailTransport.sent).toHaveLength(0);
  });
});
