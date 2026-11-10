// One tenant per print-editor e2e spec (see PRINT_EDITOR_TENANTS). Everything goes through the
// template and config write handlers, never straight into the tables.

import { seedAdmin } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  PRINT_EDITOR_PASSWORD,
  PRINT_EDITOR_TENANTS,
  type PrintEditorTenant,
} from "./auth-constants";
import {
  type SeedTemplate,
  SYSTEM_PDF_LAYOUT,
  TENANT_UTILITY_STATEMENT,
} from "./template-seed-data";

const COMPANY_DATA = {
  "company-address": "Kaistraße 18\n20457 Hamburg",
  "company-phone": "+49 40 5550 1100",
  "company-email": "verwaltung@hafenkontor-beispiel.de",
  "company-register": "HRB 120045 Amtsgericht Hamburg",
  "company-iban": "DE89 3704 0044 0532 0130 00",
} as const;

const LETTER_MARGINS_MM = { top: 32, right: 22, bottom: 27, left: 26 } as const;

// Follows the tenant default layout, since it names none of its own.
const UTILITY_STATEMENT_WITHOUT_LAYOUT: SeedTemplate = {
  ...TENANT_UTILITY_STATEMENT,
  meta: { pageFormat: "A4", fileName: "Nebenkostenabrechnung.pdf" },
};

async function seedTenant(
  stack: Parameters<SeedFn>[0],
  tenant: PrintEditorTenant,
  setup: (user: SessionUser, write: WriteTemplate) => Promise<void>,
): Promise<void> {
  const tenantId = tenant.tenantId as TenantId;
  const account = await seedAdmin(stack.db, {
    email: tenant.adminEmail,
    password: PRINT_EDITOR_PASSWORD,
    displayName: tenant.adminName,
    emailVerified: true,
    memberships: [
      {
        tenantId,
        tenantKey: tenant.tenantKey,
        tenantName: tenant.tenantName,
        roles: ["TenantAdmin"],
      },
    ],
  });
  const admin: SessionUser = {
    id: account.id as SessionUser["id"],
    tenantId,
    roles: ["TenantAdmin"],
  };
  const overview = await stack.http.queryOk<{ rows: { origin: string }[] }>(
    TemplateResolverQueries.overview,
    {},
    admin,
  );
  if (overview.rows.some((row) => row.origin === "tenant")) return;
  const write: WriteTemplate = (template) =>
    stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: template.slug,
        kind: template.kind,
        locale: template.locale,
        contentFormat: "html",
        content: template.content,
        status: "active",
        ...(template.title !== undefined && { title: template.title }),
        ...(template.meta !== undefined && { meta: template.meta }),
        ...(template.variableSchema !== undefined && { variableSchema: template.variableSchema }),
      },
      admin,
    );
  await setup(admin, write);
}

type WriteTemplate = (template: SeedTemplate) => Promise<unknown>;

export const seedPrintEditorTenants: SeedFn = async (stack) => {
  const { editor, drafts, appearance, applySelected, applyAll } = PRINT_EDITOR_TENANTS;
  const setCompanyData = async (user: SessionUser): Promise<void> => {
    for (const [name, value] of Object.entries(COMPANY_DATA)) {
      await stack.http.writeOk("config:write:set", { key: `tenant:config:${name}`, value }, user);
    }
  };
  const setUpEditorTenant = async (user: SessionUser, write: WriteTemplate): Promise<void> => {
    await setCompanyData(user);
    await write(TENANT_UTILITY_STATEMENT);
    // The ruler's margin marks read the layout's own margins.
    await write({
      ...SYSTEM_PDF_LAYOUT,
      meta: { margins: LETTER_MARGINS_MM },
    });
  };

  await seedTenant(stack, editor, setUpEditorTenant);
  await seedTenant(stack, drafts, setUpEditorTenant);
  await seedTenant(stack, appearance, async (user) => {
    await setCompanyData(user);
  });
  await seedTenant(stack, applySelected, async (_user, write) => {
    await write(TENANT_UTILITY_STATEMENT);
  });
  await seedTenant(stack, applyAll, async (_user, write) => {
    await write(UTILITY_STATEMENT_WITHOUT_LAYOUT);
  });
};
