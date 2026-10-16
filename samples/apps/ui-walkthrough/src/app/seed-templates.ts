// Nordlicht Immobilien GmbH for the document-designer walkthrough: a tenant
// admin, a platform admin, branding and a realistic set of mail and PDF
// templates. Everything goes through the template write handlers (or the
// system-template seed), never straight into the tables.

import { seedAdmin } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import { BRANDING_QN } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_MAIL_LAYOUT_MJML } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  NORDLICHT_TENANT_ID,
  NORDLICHT_TENANT_NAME,
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
  TENANT_ADMIN_EMAIL,
  TENANT_ADMIN_PASSWORD,
} from "./auth-constants";
import {
  INVOICE_CORRECTED_DRAFT,
  INVOICE_ISSUED_DRAFT_VERSIONS,
  PAYMENT_REMINDER_TEMPLATES,
  type SeedTemplate,
  SYSTEM_AUTH_MAILS,
  SYSTEM_INVOICE_DOCUMENTS,
  SYSTEM_INVOICE_ISSUED,
  SYSTEM_PDF_LAYOUT,
  SYSTEM_TENANCY_CERTIFICATE,
  TENANT_MAIL_LAYOUT_VERSIONS,
  TENANT_UTILITY_STATEMENT,
} from "./template-seed-data";

const NORDLICHT = NORDLICHT_TENANT_ID as TenantId;

const BRANDING = [
  [BRANDING_QN.title, "Nordlicht Mieterportal"],
  [BRANDING_QN.accentColor, "#205265"],
  [BRANDING_QN.siteUrl, "https://nordlicht-immobilien.de"],
  [BRANDING_QN.logoUrl, "https://nordlicht-immobilien.de/logo-nordlicht.png"],
] as const;

export const seedTemplates: SeedFn = async (stack) => {
  const membership = (roles: readonly string[]) => [
    {
      tenantId: NORDLICHT,
      tenantKey: "nordlicht",
      tenantName: NORDLICHT_TENANT_NAME,
      roles,
    },
  ];
  const tenantAdminAccount = await seedAdmin(stack.db, {
    email: TENANT_ADMIN_EMAIL,
    password: TENANT_ADMIN_PASSWORD,
    displayName: "A. Berger",
    emailVerified: true,
    memberships: membership(["TenantAdmin"]),
  });
  const platformAdminAccount = await seedAdmin(stack.db, {
    email: PLATFORM_ADMIN_EMAIL,
    password: PLATFORM_ADMIN_PASSWORD,
    displayName: "Plattform-Admin",
    emailVerified: true,
    globalRoles: ["SystemAdmin"],
    memberships: membership(["TenantAdmin"]),
  });
  // The session re-derives roles from the membership row on every request, so
  // the roles here only have to match what the account really has.
  const tenantAdmin: SessionUser = {
    id: tenantAdminAccount.id as SessionUser["id"],
    tenantId: NORDLICHT,
    roles: ["TenantAdmin"],
  };
  const platformAdmin: SessionUser = {
    id: platformAdminAccount.id as SessionUser["id"],
    tenantId: NORDLICHT,
    roles: ["TenantAdmin", "SystemAdmin"],
  };

  const overview = await stack.http.queryOk<{ rows: { origin: string }[] }>(
    TemplateResolverQueries.overview,
    {},
    tenantAdmin,
  );
  if (overview.rows.some((row) => row.origin === "tenant")) return;

  const upsert = (
    handler: string,
    template: SeedTemplate,
    user: SessionUser,
    extra: Record<string, unknown> = {},
  ) =>
    stack.http.writeOk<{ id: string }>(
      handler,
      {
        slug: template.slug,
        kind: template.kind,
        locale: template.locale,
        contentFormat: "html",
        content: template.content,
        ...(template.title !== undefined && { title: template.title }),
        ...(template.meta !== undefined && { meta: template.meta }),
        ...(template.variableSchema !== undefined && { variableSchema: template.variableSchema }),
        ...extra,
      },
      user,
    );
  const upsertSystem = (template: SeedTemplate) =>
    upsert(TemplateResolverHandlers.upsertSystem, template, platformAdmin);
  const upsertTenant = (template: SeedTemplate, status: "draft" | "active") =>
    upsert(TemplateResolverHandlers.upsertTenant, template, tenantAdmin, { status });

  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: "default",
      kind: "mail-layout",
      locale: "en",
      contentFormat: "mjml",
      content: DEFAULT_MAIL_LAYOUT_MJML,
      title: "Mail-Layout",
    },
    platformAdmin,
  );
  await upsertSystem(SYSTEM_PDF_LAYOUT);
  for (const mail of SYSTEM_AUTH_MAILS) await upsertSystem(mail);
  await upsertSystem(SYSTEM_INVOICE_ISSUED);
  for (const document of SYSTEM_INVOICE_DOCUMENTS) await upsertSystem(document);
  const certificate = await upsertSystem(SYSTEM_TENANCY_CERTIFICATE);
  await stack.http.writeOk(
    TemplateResolverHandlers.archiveSystem,
    { id: certificate.id },
    platformAdmin,
  );

  for (const [key, value] of BRANDING) {
    await stack.http.writeOk("config:write:set", { key, value }, tenantAdmin);
  }
  // Each save is a new version of the same row; the second one makes the
  // layout "customised" for the overview and the first leaves history to diff.
  for (const content of TENANT_MAIL_LAYOUT_VERSIONS) {
    await upsertTenant(
      { slug: "default", kind: "mail-layout", locale: "en", title: "Mail-Layout", content },
      "active",
    );
  }
  for (const draft of INVOICE_ISSUED_DRAFT_VERSIONS) await upsertTenant(draft, "draft");
  await upsertTenant(INVOICE_CORRECTED_DRAFT, "draft");
  for (const reminder of PAYMENT_REMINDER_TEMPLATES) await upsertTenant(reminder, "active");
  await upsertTenant(TENANT_UTILITY_STATEMENT, "active");
};
