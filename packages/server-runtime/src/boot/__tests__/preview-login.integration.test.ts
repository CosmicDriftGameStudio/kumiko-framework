// The Studio preview-login link signs the bootstrap owner in over the real auth cookies.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { BOOTSTRAP_ADMIN_EMAIL_ENV } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTenantFeature,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  USER_STATUS,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { resetTestTables, updateRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { buildPreviewLoginConfig } from "../../boot-options/preview-login-option.ts";
import { resolveSeedShortcuts } from "../../boot-options/seed-shortcuts.ts";
import { applyStandardBootSeeds } from "../shared-boot-steps.ts";

const TENANT_ID = "00000000-0000-4000-8000-0000000000c1" as TenantId;
const OWNER_EMAIL = "owner@example.com";
const LOGIN_KEY = "k".repeat(64);
const LINK_PATH = "/__kumiko/preview-login";

function featuresList() {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createTemplateResolverFeature(),
    createRendererFoundationFeature(),
    createRendererMailHtmlFeature(),
    createDeliveryFeature(),
    createChannelEmailFeature({
      transport: createInMemoryTransport(),
      resolveEmail: async () => "unused@test.local",
    }),
    createAuthEmailPasswordFeature({
      passwordReset: {
        hmacSecret: randomBytes(32).toString("base64"),
        tokenTtlMinutes: 15,
        appUrl: "https://app.example.com/reset-password",
      },
    }),
  ];
}

function authConfig(loginKey: string | undefined) {
  const previewLogin = buildPreviewLoginConfig(
    loginKey === undefined ? undefined : { loginKey },
    OWNER_EMAIL,
  );
  return {
    membershipQuery: "tenant:query:memberships",
    loginHandler: AuthHandlers.login,
    ...(previewLogin && { previewLogin }),
  };
}

let withLink: TestStack;
let withoutLink: TestStack;

beforeAll(async () => {
  withLink = await setupTestStack({
    features: featuresList(),
    extraContext: (deps) => createDeliveryTestContext(deps),
    authConfig: authConfig(LOGIN_KEY),
  });
  withoutLink = await setupTestStack({
    features: featuresList(),
    authConfig: authConfig(undefined),
  });
});

afterAll(async () => {
  await withLink.cleanup();
  await withoutLink.cleanup();
});

function seedOwner(stack: TestStack) {
  return applyStandardBootSeeds({
    db: stack.db,
    registry: stack.registry,
    admin: undefined,
    shortcutSeeds: resolveSeedShortcuts(
      { bootstrapAdminFromEnv: { tenant: { id: TENANT_ID, key: "app", name: "App" } } },
      {
        envSource: { [BOOTSTRAP_ADMIN_EMAIL_ENV]: OWNER_EMAIL },
        hasAuth: true,
        hasAuthAdmin: false,
      },
    ),
    cipher: undefined,
    processName: "test",
  });
}

beforeEach(async () => {
  for (const stack of [withLink, withoutLink]) {
    await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
  }
});

function link(exp: number, key = LOGIN_KEY): string {
  const sig = createHmac("sha256", key).update(`kumiko-preview-login:${exp}`).digest("hex");
  return `${LINK_PATH}?exp=${exp}&sig=${sig}`;
}

const inSeconds = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;
let expOffset = 0;
// A link is single-use per sig, so each test needs its own exp.
const freshExp = () => inSeconds(10 + expOffset++);

function cookieHeader(res: Response): { cookie: string; csrf: string } {
  const setCookies = res.headers.getSetCookie();
  const pair = (name: string) =>
    setCookies.map((c) => c.split(";")[0] ?? "").find((c) => c.startsWith(`${name}=`)) ?? "";
  const auth = pair("kumiko_auth");
  const csrf = pair("kumiko_csrf");
  return { cookie: `${auth}; ${csrf}`, csrf: csrf.split("=")[1] ?? "" };
}

describe("preview login", () => {
  test("a valid link redirects to / and the cookies authenticate the owner", async () => {
    await seedOwner(withLink);

    const res = await withLink.http.raw("GET", link(freshExp()));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const { cookie, csrf } = cookieHeader(res);
    expect(cookie).toContain("kumiko_auth=");
    const me = await withLink.http.raw(
      "POST",
      "/api/query",
      { type: "tenant:query:me", payload: {} },
      { cookie, "x-csrf-token": csrf },
    );
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.data.id).toBe(TENANT_ID);
  });

  test("a wrong signature, an expired link and a far-future link answer 403", async () => {
    await seedOwner(withLink);

    expect((await withLink.http.raw("GET", link(inSeconds(60), "other-key"))).status).toBe(403);
    expect((await withLink.http.raw("GET", link(inSeconds(-5)))).status).toBe(403);
    expect((await withLink.http.raw("GET", link(inSeconds(3600)))).status).toBe(403);
    expect((await withLink.http.raw("GET", LINK_PATH)).status).toBe(403);
  });

  test("a valid link before the owner exists answers 503", async () => {
    const res = await withLink.http.raw("GET", link(freshExp()));

    expect(res.status).toBe(503);
  });

  test("without the option the route does not exist", async () => {
    await seedOwner(withoutLink);

    const res = await withoutLink.http.raw("GET", link(freshExp()));

    expect(res.status).toBe(404);
  });

  test("a link works once, the second use answers 403", async () => {
    await seedOwner(withLink);
    const url = link(freshExp());

    expect((await withLink.http.raw("GET", url)).status).toBe(302);
    expect((await withLink.http.raw("GET", url)).status).toBe(403);
  });

  test("a restricted owner gets no session", async () => {
    await seedOwner(withLink);
    await updateRowViaEventStore(
      withLink.db,
      { table: userTable, entity: userEntity, entityName: "user" },
      { email: OWNER_EMAIL },
      { status: USER_STATUS.Restricted },
    );

    const res = await withLink.http.raw("GET", link(freshExp()));

    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  test("a loginKey shorter than 32 characters is a boot error, an empty one means off", () => {
    expect(() => buildPreviewLoginConfig({ loginKey: "too-short" }, OWNER_EMAIL)).toThrow(
      KumikoBootError,
    );
    expect(buildPreviewLoginConfig({ loginKey: "" }, OWNER_EMAIL)).toBeUndefined();
  });
});
