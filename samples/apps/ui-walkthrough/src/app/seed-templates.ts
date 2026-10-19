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
import { readBundledAsset } from "@cosmicdrift/kumiko-server-runtime";
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
  LOGO_RESOURCE_KEY,
  PAYMENT_REMINDER_TEMPLATES,
  type SeedTemplate,
  SYSTEM_AUTH_MAILS,
  SYSTEM_INVOICE_DOCUMENTS,
  SYSTEM_INVOICE_ISSUED,
  SYSTEM_PDF_LAYOUT,
  SYSTEM_PROPERTY_EXPOSE,
  SYSTEM_TENANCY_CERTIFICATE,
  SYSTEM_TERMS_CHANGED,
  TENANT_INVOICE_OVERRIDES,
  TENANT_MAIL_LAYOUT_VERSIONS,
  TENANT_UTILITY_STATEMENT,
} from "./template-seed-data";

const NORDLICHT = NORDLICHT_TENANT_ID as TenantId;

// Declared under `kumiko.assets` in this sample's package.json; looked up from the
// package dir so the seed does not depend on the cwd the dev server was started in.
const LOGO_ASSET_NAME = "logo-nordlicht.png";
const SAMPLE_APP_DIR = new URL("../../", import.meta.url).pathname;

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
  // Real multipart upload; every resource link and the branding logo consume their own file.
  const uploadLogo = async (user: SessionUser): Promise<string> => {
    const logoPng = await readBundledAsset(LOGO_ASSET_NAME, { cwd: SAMPLE_APP_DIR });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(logoPng)], LOGO_RESOURCE_KEY, { type: "image/png" }),
    );
    const response = await stack.app.request("/api/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await stack.jwt.sign(user)}`,
      },
      body: form,
    });
    if (response.status !== 201) throw new Error(`logo upload failed: HTTP ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  };
  const linkInvoicePdf = (templateId: string): Promise<unknown> =>
    stack.http.writeOk(
      TemplateResolverHandlers.resourceLinkPdf,
      {
        templateId,
        key: "rechnung",
        templateSlug: "billing:invoice",
        fileName: "rechnung-{{invoiceNumber}}.pdf",
      },
      tenantAdmin,
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
  await upsertSystem(SYSTEM_TERMS_CHANGED);
  for (const document of SYSTEM_INVOICE_DOCUMENTS) await upsertSystem(document);
  await upsertSystem(SYSTEM_PROPERTY_EXPOSE);
  const certificate = await upsertSystem(SYSTEM_TENANCY_CERTIFICATE);
  await stack.http.writeOk(
    TemplateResolverHandlers.archiveSystem,
    { id: certificate.id },
    platformAdmin,
  );

  for (const [key, value] of BRANDING) {
    await stack.http.writeOk("config:write:set", { key, value }, tenantAdmin);
  }
  // The built-in "logo" placeholder of the layouts resolves to this file.
  await stack.http.writeOk(
    "config:write:set",
    { key: BRANDING_QN.logoFile, value: await uploadLogo(tenantAdmin) },
    tenantAdmin,
  );
  // Each save is a new version of the same row; the second one makes the
  // layout "customised" for the overview and the first leaves history to diff.
  for (const content of TENANT_MAIL_LAYOUT_VERSIONS) {
    await upsertTenant(
      {
        slug: "default",
        kind: "mail-layout",
        locale: "en",
        title: "Mail-Layout",
        content,
        meta: { accentLine: "branding" },
      },
      "active",
    );
  }
  let invoiceDraftId: string | null = null;
  for (const draft of INVOICE_ISSUED_DRAFT_VERSIONS) {
    const saved = await upsertTenant(draft, "draft");
    if (invoiceDraftId === null) {
      invoiceDraftId = saved.id;
      await linkInvoicePdf(saved.id);
    }
  }
  await upsertTenant(INVOICE_CORRECTED_DRAFT, "draft");
  for (const reminder of PAYMENT_REMINDER_TEMPLATES) await upsertTenant(reminder, "active");
  await upsertTenant(TENANT_UTILITY_STATEMENT, "active");

  // Other tenants with their own invoice copy: what the SystemAdmin sees in the overrides drawer.
  for (const override of TENANT_INVOICE_OVERRIDES) {
    const account = await seedAdmin(stack.db, {
      email: override.adminEmail,
      password: TENANT_ADMIN_PASSWORD,
      displayName: override.adminName,
      emailVerified: true,
      memberships: [
        {
          tenantId: override.tenantId as TenantId,
          tenantKey: override.tenantKey,
          tenantName: override.tenantName,
          roles: ["TenantAdmin"],
        },
      ],
    });
    const admin: SessionUser = {
      id: account.id as SessionUser["id"],
      tenantId: override.tenantId as TenantId,
      roles: ["TenantAdmin"],
    };
    for (const version of override.versions) {
      await upsert(TemplateResolverHandlers.upsertTenant, version, admin, {
        status: override.status,
      });
    }
  }
};
