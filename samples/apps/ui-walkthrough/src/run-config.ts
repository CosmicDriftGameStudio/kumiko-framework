// Single source of truth for ui-walkthrough feature composition.
//
// src/app/server.ts (dev boot) and kumiko/schema.ts (schema CLI) import
// from here — migration and runtime cannot drift.

import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { AuthMailNotificationTypes } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  type TenantEditableTemplate,
  templateEditAccess,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createDocumentDesignerFeature } from "@cosmicdrift/kumiko-document-designer";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { localeEs } from "@cosmicdrift/kumiko-locale-es";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { createRendererPuppeteerClientFeature } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import { TENANT_ADMIN_EMAIL } from "./app/auth-constants";
import { billingFeature } from "./features/billing";
import { rentalFeature } from "./features/rental";
import {
  createPortalBillingFeature,
  subscriptionPlansFeature,
} from "./features/subscription-plans";
import { taskFeature } from "./features/tasks";
import { vehiclesFeature } from "./features/vehicles";

// The walkthrough shows the tenant admin editing these templates; every other template stays with the platform.
const TENANT_EDITABLE_TEMPLATES: readonly TenantEditableTemplate[] = [
  ...[
    "billing:notify:invoice-issued",
    "billing:notify:invoice-corrected",
    "billing:notify:payment-reminder",
    "billing:notify:terms-changed",
    AuthMailNotificationTypes.passwordReset,
  ].map((slug) => ({ kind: "mail" as const, slug, access: { roles: ["TenantAdmin"] } })),
  ...["billing:invoice", "rental:utility-statement"].map((slug) => ({
    kind: "document-pdf" as const,
    slug,
    access: { roles: ["TenantAdmin"] },
  })),
  ...(["mail-layout", "pdf-layout"] as const).map((kind) => ({
    kind,
    slug: "default",
    access: { roles: ["TenantAdmin"] },
  })),
];

export const APP_FEATURES = [
  localeDe(),
  // Spanish mail copy: subscribers whose mails go out in Spanish land on Spanish unsubscribe pages.
  localeEs(),
  taskFeature,
  rentalFeature,
  vehiclesFeature,
  billingFeature,
  createPortalBillingFeature(`http://localhost:${process.env["PORT"] ?? "4173"}`),
  subscriptionPlansFeature,
  // billing-foundation stores the subscription as tenant data and keeps the compliance profile.
  createComplianceProfilesFeature(),
  createTenantLifecycleFeature(),
  createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE_TEMPLATES }),
  // Only the branding rail of the layout editor needs managed-pages; the sample
  // serves no public pages, so no host resolves to a tenant.
  createManagedPagesFeature({ resolveApexTenant: () => null }),
  // The mail editor offers uploads only when the files feature is mounted.
  createFilesFeature(),
  createDocumentDesignerFeature({ access: templateEditAccess(TENANT_EDITABLE_TEMPLATES) }),
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
