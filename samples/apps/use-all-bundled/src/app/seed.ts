// Seed-Daten für die Feature-Reference-Screenshots: damit die entity-Listen
// nicht leer rendern und die öffentlichen Legal-Routes Inhalt haben. Läuft
// nach dem Admin (runDevApp seeds-Hook), idempotent über die seed-Helper.

import { seedPage } from "@cosmicdrift/kumiko-bundled-features/managed-pages/seeding";
import { seedTextBlock } from "@cosmicdrift/kumiko-bundled-features/text-content/seeding";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { DEV_TENANT_ID } from "./auth-constants";

const PRIVACY_BODY = [
  "## 1. Controller",
  "",
  "Acme Inc., 123 Example Street, 90001 Sample City.",
  "",
  "## 2. Data we collect",
  "",
  "This app sets **no tracking cookies** and uses no third-party analytics.",
  "",
  "## 3. Your rights (GDPR Art. 15–22)",
  "",
  "Access, rectification, erasure, restriction, portability, objection.",
].join("\n");

export const seedScreenshotData: SeedFn = async (stack) => {
  const devTenant = DEV_TENANT_ID as TenantId;

  // managed-pages — zwei Seiten im Dev-Tenant für den page-list Screen.
  await seedPage(stack.db, {
    tenantId: devTenant,
    slug: "about",
    lang: "en",
    title: "About Acme",
    body: "# About Acme\n\nWe build calm software.",
    published: true,
  });
  await seedPage(stack.db, {
    tenantId: devTenant,
    slug: "pricing",
    lang: "en",
    title: "Pricing",
    body: "# Pricing\n\nSimple, per-seat pricing.",
    published: false,
  });

  // legal-pages — Public-Route /legal/privacy liest den text-block aus dem
  // SYSTEM_TENANT (anonymousAccess.defaultTenantId).
  await seedTextBlock(stack.db, {
    tenantId: SYSTEM_TENANT_ID,
    slug: "privacy",
    lang: "en",
    title: "Privacy Policy",
    body: PRIVACY_BODY,
  });
};
