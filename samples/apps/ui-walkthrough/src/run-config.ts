// Single source of truth for ui-walkthrough feature composition.
//
// src/app/server.ts (dev boot) and kumiko/schema.ts (schema CLI) import
// from here — migration and runtime cannot drift.

import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createDocumentDesignerFeature } from "@cosmicdrift/kumiko-document-designer";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { localeEs } from "@cosmicdrift/kumiko-locale-es";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { createRendererPuppeteerClientFeature } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import { TENANT_ADMIN_EMAIL } from "./app/auth-constants";
import { billingFeature } from "./features/billing";
import { rentalFeature } from "./features/rental";
import { taskFeature } from "./features/tasks";
import { vehiclesFeature } from "./features/vehicles";

export const APP_FEATURES = [
  localeDe(),
  // Spanish mail copy: subscribers whose mails go out in Spanish land on Spanish unsubscribe pages.
  localeEs(),
  taskFeature,
  rentalFeature,
  vehiclesFeature,
  billingFeature,
  createTemplateResolverFeature(),
  // Only the branding rail of the layout editor needs managed-pages; the sample
  // serves no public pages, so no host resolves to a tenant.
  createManagedPagesFeature({ resolveApexTenant: () => null }),
  createDocumentDesignerFeature(),
  // Mounted individually: composeRendererStack() would add a second template-resolver.
  createRendererFoundationFeature(),
  createRendererMailHtmlFeature({
    footer: ({ locale }) =>
      locale.startsWith("de")
        ? {
            text: "Gesendet über das Nordlicht Mieterportal",
            imprint: { label: "Impressum", url: "https://nordlicht-immobilien.de/impressum" },
            privacy: { label: "Datenschutz", url: "https://nordlicht-immobilien.de/datenschutz" },
          }
        : locale.startsWith("es")
          ? {
              text: "Enviado a través del portal de inquilinos Nordlicht",
              imprint: { label: "Aviso legal", url: "https://nordlicht-immobilien.de/imprint" },
              privacy: { label: "Privacidad", url: "https://nordlicht-immobilien.de/privacy" },
            }
          : {
              text: "Sent via the Nordlicht tenant portal",
              imprint: { label: "Imprint", url: "https://nordlicht-immobilien.de/imprint" },
              privacy: { label: "Privacy", url: "https://nordlicht-immobilien.de/privacy" },
            },
  }),
  // The PDF preview of the template editor prints through the puppeteer-service
  // (PUPPETEER_SERVICE_URL / PUPPETEER_AUTH_TOKEN); the e2e config starts one.
  createRendererPuppeteerClientFeature(),
  createDeliveryFeature(),
  // In-memory transport: the test mail of the mail editor is rendered and
  // "sent" for real, nothing leaves the process. Every user resolves to the
  // tenant admin's address because the sample has no per-user mail lookup.
  createChannelEmailFeature({
    transport: createInMemoryTransport(),
    resolveEmail: async () => TENANT_ADMIN_EMAIL,
  }),
  createAuditFeature(),
] as const;

// runDevApp auto-mounts config/user/tenant/auth-email-password when
// `auth: { … }` is set in server.ts (composeFeatures includeBundled).
export const HAS_AUTH = true;
