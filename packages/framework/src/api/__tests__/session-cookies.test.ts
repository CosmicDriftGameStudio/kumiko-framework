import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers, testTenantId } from "../../stack/index.js";
import { deleteTenantCookie, setTenantCookie } from "../anonymous-cookie.js";
import { authMiddleware, CSRF_HEADER_NAME, getUser } from "../auth-middleware.js";
import { csrfMiddleware } from "../csrf-middleware.js";
import { createJwtHelper } from "../jwt.js";
import {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  HOST_COOKIE_PREFIX,
  resolveSecureCookies,
  resolveSessionCookies,
  sessionCookiesMiddleware,
  TENANT_COOKIE_BASE,
} from "../session-cookies.js";

const JWT_SECRET = "[REDACTED:API key param]";
const COOKIE_TENANT = testTenantId(7);
const PREFIXED_TENANT = `${HOST_COOKIE_PREFIX}${TENANT_COOKIE_BASE}`;

describe("resolveSessionCookies", () => {
  test("secure without domain: all three names are __Host- prefixed", () => {
    const { names, secure } = resolveSessionCookies({ secureCookies: true });
    expect(secure).toBe(true);
    expect(names).toEqual({
      auth: `${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`,
      csrf: `${HOST_COOKIE_PREFIX}${CSRF_COOKIE_BASE}`,
      tenant: PREFIXED_TENANT,
    });
  });

  test("insecure: plain names", () => {
    expect(resolveSessionCookies({ secureCookies: false }).names).toEqual({
      auth: AUTH_COOKIE_BASE,
      csrf: CSRF_COOKIE_BASE,
      tenant: TENANT_COOKIE_BASE,
    });
  });

  test("cookieDomain keeps auth and csrf plain; the always host-only tenant cookie stays prefixed", () => {
    const { names } = resolveSessionCookies({ secureCookies: true, cookieDomain: "example.eu" });
    expect(names.auth).toBe(AUTH_COOKIE_BASE);
    expect(names.csrf).toBe(CSRF_COOKIE_BASE);
    expect(names.tenant).toBe(PREFIXED_TENANT);
  });

  test("an explicit secureCookies wins over NODE_ENV", () => {
    expect(resolveSecureCookies(true)).toBe(true);
    expect(resolveSecureCookies(false)).toBe(false);
  });

  test("unset secureCookies is off outside production", () => {
    expect(process.env["NODE_ENV"]).not.toBe("production");
    expect(resolveSecureCookies()).toBe(false);
  });
});

describe("tenant cookie", () => {
  function buildTenantApp(secureCookies: boolean | undefined): Hono {
    const app = new Hono();
    app.use("*", sessionCookiesMiddleware(resolveSessionCookies({ secureCookies })));
    app.get("/set", (c) => {
      setTenantCookie(c, COOKIE_TENANT);
      return c.json({ ok: true });
    });
    app.get("/delete", (c) => {
      deleteTenantCookie(c);
      return c.json({ ok: true });
    });
    const jwt = createJwtHelper(JWT_SECRET);
    app.use("/api/*", authMiddleware(jwt, { anonymousAccess: { tenantExists: () => true } }));
    app.get("/api/who", (c) => c.json({ tenantId: getUser(c).tenantId }));
    return app;
  }

  async function whoAmI(
    app: Hono,
    cookie: string,
  ): Promise<{ status: number; tenantId?: string; errorCode?: string }> {
    const res = await app.request("/api/who", { headers: { Cookie: cookie } });
    const body = (await res.json()) as { tenantId?: string; error?: { code?: string } };
    return { status: res.status, tenantId: body.tenantId, errorCode: body.error?.code };
  }

  test("secure: set under __Host-kumiko_tenant with Secure, Path=/, no Domain", async () => {
    const res = await buildTenantApp(true).request("/set");
    const [header] = res.headers.getSetCookie();
    expect(header).toStartWith(`${PREFIXED_TENANT}=${COOKIE_TENANT}`);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*Path=\//i);
    expect(header).not.toMatch(/Domain=/i);
  });

  test("secure: the prefixed cookie is read back, the legacy name is ignored", async () => {
    const app = buildTenantApp(true);
    const prefixed = await whoAmI(app, `${PREFIXED_TENANT}=${COOKIE_TENANT}`);
    expect(prefixed).toMatchObject({ status: 200, tenantId: COOKIE_TENANT });
    const legacy = await whoAmI(app, `${TENANT_COOKIE_BASE}=${COOKIE_TENANT}`);
    expect(legacy).toMatchObject({ status: 400, errorCode: "tenant_required" });
  });

  test("insecure: plain name, read back", async () => {
    const app = buildTenantApp(false);
    const [header] = (await app.request("/set")).headers.getSetCookie();
    expect(header).toStartWith(`${TENANT_COOKIE_BASE}=${COOKIE_TENANT}`);
    expect(header).not.toMatch(/;\s*Secure/i);
    const plain = await whoAmI(app, `${TENANT_COOKIE_BASE}=${COOKIE_TENANT}`);
    expect(plain).toMatchObject({ status: 200, tenantId: COOKIE_TENANT });
  });

  test("secure: delete clears the prefixed (Secure, Path=/) and the legacy name", async () => {
    const headers = (await buildTenantApp(true).request("/delete")).headers.getSetCookie();
    const prefixed = headers.find((h) => h.startsWith(`${PREFIXED_TENANT}=`));
    const legacy = headers.find((h) => h.startsWith(`${TENANT_COOKIE_BASE}=`));
    expect(prefixed).toMatch(/Max-Age=0/i);
    expect(prefixed).toMatch(/;\s*Secure/i);
    expect(prefixed).toMatch(/;\s*Path=\//i);
    expect(legacy).toMatch(/Max-Age=0/i);
  });
});

describe("middlewares read only the resolved names", () => {
  const PREFIXED_AUTH = `${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`;
  const PREFIXED_CSRF = `${HOST_COOKIE_PREFIX}${CSRF_COOKIE_BASE}`;
  const CSRF = "csrf-token-fixed-for-test";

  async function buildApp(secureCookies: boolean): Promise<{ app: Hono; token: string }> {
    const jwt = createJwtHelper(JWT_SECRET);
    const token = await jwt.sign(TestUsers.user);
    const app = new Hono();
    app.use("*", sessionCookiesMiddleware(resolveSessionCookies({ secureCookies })));
    app.use("/api/*", authMiddleware(jwt));
    app.use("/api/*", csrfMiddleware());
    app.post("/api/ping", (c) => c.json({ ok: true }));
    return { app, token };
  }

  test("secure server: prefixed auth + prefixed csrf cookie with matching header passes", async () => {
    const { app, token } = await buildApp(true);
    const res = await app.request("/api/ping", {
      method: "POST",
      headers: {
        Cookie: `${PREFIXED_AUTH}=${token}; ${PREFIXED_CSRF}=${CSRF}`,
        [CSRF_HEADER_NAME]: CSRF,
      },
    });
    expect(res.status).toBe(200);
  });

  test("secure server: legacy auth cookie alone is not authenticated", async () => {
    const { app, token } = await buildApp(true);
    const res = await app.request("/api/ping", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_BASE}=${token}; ${CSRF_COOKIE_BASE}=${CSRF}`,
        [CSRF_HEADER_NAME]: CSRF,
      },
    });
    expect(res.status).toBe(401);
  });

  test("secure server: a legacy csrf cookie does not satisfy the double-submit check", async () => {
    const { app, token } = await buildApp(true);
    const res = await app.request("/api/ping", {
      method: "POST",
      headers: {
        Cookie: `${PREFIXED_AUTH}=${token}; ${CSRF_COOKIE_BASE}=${CSRF}`,
        [CSRF_HEADER_NAME]: CSRF,
      },
    });
    expect(res.status).toBe(403);
  });

  test("insecure server: the prefixed auth cookie is not read", async () => {
    const { app, token } = await buildApp(false);
    const res = await app.request("/api/ping", {
      method: "POST",
      headers: {
        Cookie: `${PREFIXED_AUTH}=${token}; ${PREFIXED_CSRF}=${CSRF}`,
        [CSRF_HEADER_NAME]: CSRF,
      },
    });
    expect(res.status).toBe(401);
  });
});
