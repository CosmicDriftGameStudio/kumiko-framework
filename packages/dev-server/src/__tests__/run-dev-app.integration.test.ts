// The origin-guard config (allowedOrigins / unsafeSkipOriginCheck) is forwarded
// from runDevApp's auth options through to the server exactly like runProdApp
// (#399/1). The guard fires during server build — AFTER the ephemeral test DB is
// up — so this is an integration test (needs TEST_DATABASE_URL), mirroring the
// run-prod-app forwarding pair. Without it a typo or wrong spread-key on the dev
// path would silently drop the fail-closed guard and dev/prod would diverge.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  requireTemplateResolver,
  TEXT_BLOCK_KIND,
  type TemplateResolverApi,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineQueryHandler,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import * as jose from "jose";
import { z } from "zod";
import type { KumikoServerHandle } from "../create-kumiko-server";
import { runDevApp } from "../run-dev-app";

function validFeature() {
  return defineFeature("shop", (r) => {
    r.entity("product", createEntity({ fields: { name: createTextField() } }));
  });
}

const ADMIN = {
  email: "origin-guard@example.eu",
  password: "test-pw-strong-1234",
  displayName: "Admin",
  memberships: [],
};

let handle: KumikoServerHandle | undefined;
const savedJwtSecret = process.env["JWT_SECRET"];

beforeEach(() => {
  process.env["JWT_SECRET"] = "test-rundev-secret-32-chars-min!!!!";
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  if (savedJwtSecret === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = savedJwtSecret;
});

describe("runDevApp — auth.mail fail-fast on missing JWT_SECRET", () => {
  test("options.auth set but JWT_SECRET missing → throws, no dev-fallback", async () => {
    // beforeEach sets JWT_SECRET unconditionally for every OTHER test in this
    // file — none of them ever exercise the missing-secret path, so it's
    // unclear whether the fail-closed guard (requireEnv, not the old dev-
    // fallback) actually fires or was silently dropped. Pass a custom
    // envSource without JWT_SECRET instead of touching process.env.
    const { JWT_SECRET: _drop, ...envWithoutJwtSecret } = process.env;
    await expect(
      runDevApp({
        features: [validFeature()],
        auth: { admin: ADMIN, cookieDomain: "example.eu", allowedOrigins: ["https://example.eu"] },
        envSource: envWithoutJwtSecret,
      }),
    ).rejects.toThrow(/JWT_SECRET/);
  });
});

describe("runDevApp — auth allowedOrigins forwarding (#399/1)", () => {
  test("cookieDomain without allowedOrigins fails closed — guard is wired through runDevApp", async () => {
    await expect(
      runDevApp({
        features: [validFeature()],
        auth: { admin: ADMIN, cookieDomain: "example.eu" },
      }),
    ).rejects.toThrow(/allowedOrigins is empty/);
  });

  test("cookieDomain + allowedOrigins clears the guard — allowlist reaches the server", async () => {
    // Without the forwarding fix this would ALSO throw /allowedOrigins is empty/.
    handle = await runDevApp({
      features: [validFeature()],
      // Port 0 → OS-assigned ephemeral port, no fixed-port collision in CI.
      port: 0,
      auth: {
        admin: ADMIN,
        cookieDomain: "example.eu",
        allowedOrigins: ["https://app.example.eu"],
      },
    });
    // A booted handle that did not throw on the origin guard IS the forwarding
    // proof — the allowlist reached the server build.
    expect(handle).toBeDefined();
  });

  test("cookieDomain + unsafeSkipOriginCheck clears the guard without an allowlist", async () => {
    // The escape hatch must also forward: cookieDomain alone fails closed
    // (first test), but unsafeSkipOriginCheck=true bypasses it. A dropped/
    // mis-spread key would let the guard fire → /allowedOrigins is empty/.
    handle = await runDevApp({
      features: [validFeature()],
      port: 0,
      auth: {
        admin: ADMIN,
        cookieDomain: "example.eu",
        unsafeSkipOriginCheck: true,
      },
    });
    expect(handle).toBeDefined();
  });
});

describe("runDevApp — extraContext merge order: app values win over boot defaults (707/1)", () => {
  test("a caller-supplied extraContext.templateResolver wins over the auto-wired boot default", async () => {
    // runDevApp's extraContext factory does `{ ...boot, ...base }` — boot's
    // auto-wired templateResolver must lose to a caller-supplied override, exactly
    // the "app values win" parity claim this PR made against runProdApp. Every
    // OTHER test in this file only checks that runDevApp boots without
    // throwing; none dispatch a request that actually reads the merged value.
    const sentinel: TemplateResolverApi = {
      findExact: async () => ({
        id: "sentinel",
        version: 1,
        tenantId: TestUsers.systemAdmin.tenantId,
        slug: "sentinel",
        kind: TEXT_BLOCK_KIND,
        locale: "en",
        title: "from caller extraContext",
        folder: null,
        content: "",
        contentFormat: "markdown",
        variableSchema: {},
        linkedResources: {},
        scope: "system",
        parentTemplateId: null,
        status: "active",
        updatedAt: new Date(0),
      }),
      resolveTemplate: async () => {
        throw new Error("not used in this test");
      },
    };
    const readBlockQuery = defineQueryHandler({
      name: "read-block",
      schema: z.object({}),
      access: { openToAll: true },
      handler: async (_query, ctx) => {
        const api = requireTemplateResolver(ctx, "textcheck:query:read-block");
        return api.findExact({
          tenantId: TestUsers.systemAdmin.tenantId,
          slug: "x",
          kind: TEXT_BLOCK_KIND,
          locale: "en",
        });
      },
    });
    const textcheckFeature = defineFeature("textcheck", (r) => {
      r.queryHandler(readBlockQuery);
    });

    handle = await runDevApp({
      features: [validFeature(), textcheckFeature],
      port: 0,
      extraContext: { templateResolver: sentinel },
    });

    const res = await handle.stack.http.queryOk<{ title: string } | null>(
      "textcheck:query:read-block",
      {},
      TestUsers.systemAdmin,
    );

    expect(res?.title).toBe("from caller extraContext");
  });
});

// runDevApp had no equivalent of runProdApp's session boot gate (#1262/#1275):
// a forgotten sessions mount left session-list silently empty instead of
// saying anything (#2027). Unlike prod, dev warns rather than aborts —
// mirrors assertPiiBootInvariants' dev/prod split.
describe("runDevApp — session boot gate (#2027)", () => {
  const ADMIN = {
    email: "session-gate-dev@example.eu",
    password: "test-pw-strong-1234",
    displayName: "Admin",
    emailVerified: true,
    memberships: [
      {
        tenantId: "00000000-0000-4000-8000-000000000002" as TenantId,
        tenantKey: "session-gate-dev",
        tenantName: "Session Gate Dev",
        roles: ["Admin"],
      },
    ],
  };

  test("auth mounted, sessions feature missing → warns but still boots (dev doesn't abort)", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      handle = await runDevApp({
        features: [validFeature()],
        port: 0,
        auth: { admin: ADMIN },
      });
      expect(handle).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("sessionStore"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[runDevApp]"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("auth mounted, sessions feature mounted → login actually creates a session (sid on the JWT)", async () => {
    // The bug this issue reports: a mounted sessions feature whose sessionCreator
    // never reached the auth config, so login never got a `sid` and
    // store_user_sessions never got a row — session-list stayed empty with no
    // error anywhere. A boot that doesn't throw proves nothing about that; only
    // a real login + decoded JWT does.
    handle = await runDevApp({
      features: [
        authFoundationFeature,
        createPersonalAccessTokensFeature({ scopes: {} }),
        createSessionsFeature(),
      ],
      port: 0,
      auth: { admin: ADMIN },
    });

    const login = await handle.stack.http.raw("POST", "/api/auth/login", {
      email: ADMIN.email,
      password: ADMIN.password,
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { token?: string };
    expect(body.token).toBeTypeOf("string");
    expect(typeof jose.decodeJwt(body.token!).jti).toBe("string");
  });
});
