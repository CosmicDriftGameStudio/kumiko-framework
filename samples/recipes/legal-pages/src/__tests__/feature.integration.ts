import {
  createTextContentApi,
  textBlockEntity,
} from "@cosmicdrift/kumiko-bundled-features/text-content";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LEGAL_ROUTES, legalPagesFeature, textContentFeature } from "../feature";

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [textContentFeature, legalPagesFeature],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    extraContext: ({ db }) => ({
      textContent: createTextContentApi(db),
    }),
  });
  db = stack.db;
  await createEntityTable(db, textBlockEntity);
  await createEventsTable(db);

  // Seed Pflicht-Blocks für SYSTEM_TENANT (DE Impressum + DSE)
  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "imprint",
    lang: "de",
    title: "Impressum",
    body: [
      "## Angaben gemäß § 5 TMG",
      "",
      "**Marc Frost**",
      "Slevogtstr. 10",
      "04159 Leipzig",
      "Deutschland",
      "",
      "## Kontakt",
      "",
      "E-Mail: [hello@example.com](mailto:hello@example.com)",
    ].join("\n"),
  });

  await seedTextBlock(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "privacy",
    lang: "de",
    title: "Datenschutzerklärung",
    body: [
      "## 1. Verantwortlicher",
      "",
      "Marc Frost, Slevogtstr. 10, 04159 Leipzig.",
      "",
      "## 2. Erhobene Daten",
      "",
      "Diese App setzt **keine Tracking-Cookies** und kein Drittanbieter-Tracking ein.",
      "",
      "## 3. Deine Rechte (Art. 15-22 DSGVO)",
      "",
      "Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch.",
    ].join("\n"),
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("legal-pages sample", () => {
  test("alle LEGAL_ROUTES sind über stack.app erreichbar", async () => {
    // Smoke-Test: jede Route gibt entweder 200 (gerendert) oder 404
    // (Block fehlt). Nie 5xx — die Server-Pipeline läuft sauber durch.
    for (const route of LEGAL_ROUTES) {
      const res = await stack.app.request(route.path);
      expect([200, 404]).toContain(res.status);
    }
  });

  test("DE-Pflicht-Pages rendern HTML", async () => {
    const imprint = await stack.app.request("/legal/impressum");
    expect(imprint.status).toBe(200);
    const imprintBody = await imprint.text();
    expect(imprintBody).toContain("<!doctype html>");
    expect(imprintBody).toContain("Marc Frost");
    expect(imprintBody).toContain("Leipzig");

    const privacy = await stack.app.request("/legal/datenschutz");
    expect(privacy.status).toBe(200);
    const privacyBody = await privacy.text();
    expect(privacyBody).toContain("Tracking-Cookies");
    expect(privacyBody).toContain("Datenschutzerklärung");
  });

  test("EN-Variante 404 (nicht geseedet) zeigt hilfreiche Meldung", async () => {
    const res = await stack.app.request("/legal/imprint");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("Tenant-Admin");
  });

  test("Markdown-Headings werden zu HTML-h2-Tags", async () => {
    const res = await stack.app.request("/legal/impressum");
    const body = await res.text();
    expect(body).toContain("<h2>Angaben gemäß § 5 TMG</h2>");
    expect(body).toContain("<strong>Marc Frost</strong>");
  });

  test("Cache-Header zeigt 5min public-cache", async () => {
    const res = await stack.app.request("/legal/impressum");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
