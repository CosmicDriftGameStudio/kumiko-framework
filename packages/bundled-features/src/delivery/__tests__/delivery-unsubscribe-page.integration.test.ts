// The pages behind a mailed unsubscribe link wear the tenant's mail look: brand
// row, accent, footer, in the mail's language, under a CSP that admits only them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { localeEs } from "@cosmicdrift/kumiko-locale-es";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as jose from "jose";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { BRANDING_QN, createManagedPagesFeature } from "../../managed-pages/index.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { DELIVERY_RESUBSCRIBE_PATH, DELIVERY_UNSUBSCRIBE_PATH } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import { createDeliveryTestContext } from "../testing.js";
import { createUnsubscribeRoutes, signUnsubscribeToken } from "../unsubscribe.js";

const UNSUBSCRIBE_SECRET = "unsubscribe-page-test-secret-at-least-32-chars";
const NOTIFICATION_TYPE = "page-probe:notify:status";
const LOGO_URL = "https://cdn.muster.example/logo.png";

const brandedAdmin = createTestUser({
  id: 61,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(61),
});
const plainTenant: TenantId = testTenantId(62);

let stack: TestStack;

function userToken(tenantId: TenantId, locale: string | undefined): Promise<string> {
  return signUnsubscribeToken(
    {
      userId: "subscriber-1",
      tenantId,
      notificationType: NOTIFICATION_TYPE,
      channel: "email",
      ...(locale !== undefined && { locale }),
    },
    UNSUBSCRIBE_SECRET,
  );
}

function postForm(path: string, token: string, headers: Record<string, string> = {}) {
  return stack.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: `token=${encodeURIComponent(token)}`,
  });
}

function hiddenToken(html: string): string {
  const token = /<input type="hidden" name="token" value="([^"]+)">/.exec(html)?.[1];
  if (token === undefined) throw new Error("page carries no token form");
  return token;
}

function styleHash(html: string): string {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  if (style === undefined) throw new Error("page carries no style block");
  return createHash("sha256").update(style).digest("base64");
}

beforeAll(async () => {
  localeDe();
  localeEs();
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createManagedPagesFeature({ resolveApexTenant: () => null }),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature({
        footer: ({ locale }) => ({
          text: locale === "de" ? "Versendet über Statusdienst" : "Sent via Statusdienst",
          imprint: { url: "https://statusdienst.example/imprint" },
          privacy: { url: "https://statusdienst.example/privacy" },
        }),
        brandSuffix: () => "Status",
      }),
      createDeliveryFeature(),
    ],
    extraContext: (deps) => {
      const accessorFactory = createConfigAccessorFactory(deps.registry, resolver);
      return {
        ...createDeliveryTestContext(deps, {
          tenantConfigFor: (tenantId) =>
            accessorFactory({
              user: { id: createSystemUser(tenantId).id, tenantId },
              db: createTenantDb({ db: deps.db, tenantId }),
            }),
        }),
        configResolver: resolver,
        _configAccessorFactory: accessorFactory,
      };
    },
    extraRoutes: [...createUnsubscribeRoutes({ secret: UNSUBSCRIBE_SECRET })],
  });
  await unsafePushTables(stack.db, { configValuesTable });
  for (const [key, value] of [
    [BRANDING_QN.title, "Muster AG"],
    [BRANDING_QN.accentColor, "#7a3e9d"],
    [BRANDING_QN.logoUrl, LOGO_URL],
    [BRANDING_QN.siteUrl, "https://muster.example"],
  ] as const) {
    await stack.http.writeOk("config:write:set", { key, value, scope: "tenant" }, brandedAdmin);
  }
});

afterAll(async () => {
  await stack.cleanup();
});

describe("unsubscribe pages in the tenant's mail look", () => {
  test("the confirmation page carries brand row, accent, site link and footer in the mail's language", async () => {
    const token = await userToken(brandedAdmin.tenantId, "de");
    const res = await stack.app.request(
      `${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("<title>Abmelden</title>");
    expect(html).toContain(`<img src="${LOGO_URL}" alt="">`);
    expect(html).toContain('<span class="name">Muster AG</span>');
    expect(html).toContain('<span class="suffix">Status</span>');
    expect(html).toContain("--accent:#7a3e9d");
    expect(html).toContain('<a href="https://muster.example">muster.example</a>');
    expect(html).toContain("Versendet über Statusdienst");
    expect(html).toContain('<a href="https://statusdienst.example/imprint">Impressum</a>');
    expect(html).toContain('<a href="https://statusdienst.example/privacy">Datenschutz</a>');
    expect(html).toContain("/assets/kumiko/fonts/ibm-plex-sans-latin-400.woff2");
    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain(" style=");
    expect(hiddenToken(html)).toBe(token);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("the CSP admits exactly the page's style block, the same-origin font and the logo origin", async () => {
    const token = await userToken(brandedAdmin.tenantId, "de");
    const res = await stack.app.request(
      `${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`,
    );
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`style-src 'sha256-${styleHash(await res.text())}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data: https://cdn.muster.example");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("unsafe-inline");
  });

  test("unsubscribe and undo stay in the tenant's look through both result pages", async () => {
    const token = await userToken(brandedAdmin.tenantId, "es");
    const done = await postForm(DELIVERY_UNSUBSCRIBE_PATH, token);
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    expect(doneHtml).toContain("<title>Baja confirmada</title>");
    expect(doneHtml).toContain("Muster AG");
    expect(doneHtml).toContain(`action="${DELIVERY_RESUBSCRIBE_PATH}"`);
    expect(doneHtml).toContain("Deshacer");

    const undone = await postForm(DELIVERY_RESUBSCRIBE_PATH, hiddenToken(doneHtml));
    expect(undone.status).toBe(200);
    const undoneHtml = await undone.text();
    expect(undoneHtml).toContain("<title>Suscripción restablecida</title>");
    expect(undoneHtml).toContain("Muster AG");
    expect(undoneHtml).not.toContain("<form");
  });

  test("an expired link shows the link-invalid page in the tenant's look and language", async () => {
    const expired = await new jose.SignJWT({
      tenantId: brandedAdmin.tenantId,
      notificationType: NOTIFICATION_TYPE,
      channel: "email",
      locale: "de",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("subscriber-1")
      .setIssuer("kumiko:unsubscribe")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(UNSUBSCRIBE_SECRET));

    const res = await stack.app.request(
      `${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(expired)}`,
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("<title>Link nicht mehr gültig</title>");
    expect(html).toContain("Muster AG");
    expect(html).not.toContain("<form");
  });

  test("a forged link gets the plain page in the browser's language, without any tenant's look", async () => {
    const forged = await new jose.SignJWT({
      tenantId: brandedAdmin.tenantId,
      notificationType: NOTIFICATION_TYPE,
      channel: "email",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("subscriber-1")
      .setIssuer("kumiko:unsubscribe")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-different-secret-that-is-also-32-chars-long"));

    const res = await postForm(DELIVERY_UNSUBSCRIBE_PATH, forged, {
      "accept-language": "es-ES,es;q=0.9",
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("<title>Enlace no válido</title>");
    expect(html).not.toContain("Muster AG");
    expect(html).not.toContain('class="brand"');
    expect(res.headers.get("content-security-policy")).toContain("img-src 'self' data:;");
  });

  test("a tenant without branding gets the plain card and no foreign look", async () => {
    const token = await userToken(plainTenant, undefined);
    const res = await stack.app.request(
      `${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Unsubscribe</title>");
    expect(html).not.toContain("Muster AG");
    expect(html).not.toContain(LOGO_URL);
    expect(html).toContain("--accent:#1f5468");
    expect(html).toContain("Sent via Statusdienst");
  });
});
