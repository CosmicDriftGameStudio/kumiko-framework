// @runtime dev
// Seed data for the PDF template editor: the system invoice of a small property
// manager with its letterhead layout, plus one tenant customisation that is live
// and one that is still a draft, so the editor's "tenant customisations" drawer
// has both counts to show. System rows go through the template-resolver seed
// helper, tenant rows through the real upsert-tenant write.

import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedSystemTemplate } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { BETA_TENANT_ID, DEV_TENANT_ID, INVOICE_TEMPLATE_SLUG } from "./auth-constants";

type Stack = Parameters<SeedFn>[0];

const LETTERHEAD_SLUG = "briefpapier";
const LOCALE = "de";

const LETTERHEAD_BODY = [
  "<div data-header><p>Nordlicht Immobilien GmbH</p><p>Hafenstraße 12 · 24103 Kiel</p></div>",
  "<div data-content></div>",
  '<div data-footer><p>Seite <span data-variable="page"></span> von <span data-variable="pages"></span></p></div>',
].join("");

// The page break puts the payment terms on page 2 whatever the length of the
// positions list: the print preview shows only two rows of any list.
const invoiceBody = (paymentNote: string): string =>
  [
    '<h1>Rechnung <span data-variable="number"></span></h1>',
    '<p>Rechnungsdatum: <span data-variable="invoiceDate"></span></p>',
    '<p><span data-variable="recipientName"></span></p>',
    '<p><span data-variable="recipientAddress"></span></p>',
    "<p>für die folgenden Leistungen im Abrechnungszeitraum stellen wir Ihnen in Rechnung:</p>",
    '<table><tbody><tr data-repeat-header=""><th><p>Position</p></th><th><p>Betrag</p></th></tr>',
    '<tr data-each="items"><td><p><span data-variable="description"></span></p></td><td><p><span data-variable="amount"></span></p></td></tr></tbody></table>',
    '<p>Gesamtbetrag: <span data-variable="total"></span></p>',
    '<div data-page-break=""></div>',
    "<h2>Zahlungsbedingungen</h2>",
    `<p>${paymentNote}</p>`,
    "<p>Bankverbindung: Förde Sparkasse, IBAN DE89 3704 0044 0532 0130 00.</p>",
  ].join("");

const INVOICE_VARIABLES = {
  number: { type: "text", label: "Rechnungsnummer", required: true, example: "2026-0142" },
  invoiceDate: { type: "date", label: "Rechnungsdatum", example: "2026-10-01" },
  recipientName: { type: "text", label: "Empfänger", example: "Mareike Jansen" },
  recipientAddress: { type: "text", label: "Anschrift", example: "Kehdenstraße 14, 24103 Kiel" },
  items: {
    type: "list",
    label: "Positionen",
    item: {
      description: { type: "text", label: "Beschreibung" },
      amount: { type: "money", label: "Betrag" },
    },
    // Money examples are minor units (cents), like stored amounts.
    example: [
      { description: "Kaltmiete Oktober 2026, Wohnung 3. OG links", amount: 78000 },
      { description: "Nebenkostenvorauszahlung Oktober 2026", amount: 18500 },
    ],
  },
  total: { type: "money", label: "Gesamtbetrag", example: 96500 },
} as const;

const INVOICE_META = {
  layoutSlug: LETTERHEAD_SLUG,
  pageFormat: "A4",
  margins: { top: 35, bottom: 25 },
  fileName: "Rechnung-{{number}}.pdf",
  metadata: { title: "Rechnung {{number}}" },
} as const;

export async function seedPdfDocuments(stack: Stack, adminUserId: string): Promise<void> {
  await seedSystemTemplate(stack.db, {
    slug: LETTERHEAD_SLUG,
    kind: "pdf-layout",
    locale: LOCALE,
    content: LETTERHEAD_BODY,
    contentFormat: "html",
    meta: {},
  });
  const system = await seedSystemTemplate(stack.db, {
    slug: INVOICE_TEMPLATE_SLUG,
    kind: "document-pdf",
    locale: LOCALE,
    content: invoiceBody("Bitte überweisen Sie den Betrag innerhalb von 14 Tagen."),
    contentFormat: "html",
    meta: INVOICE_META,
    variableSchema: INVOICE_VARIABLES,
  });

  const admin: SessionUser = {
    ...TestUsers.systemAdmin,
    tenantId: DEV_TENANT_ID as TenantId,
    id: adminUserId,
  };
  const overrides = [
    {
      tenantId: DEV_TENANT_ID,
      status: "active",
      paymentNote:
        "Bitte überweisen Sie den Betrag innerhalb von 7 Tagen unter Angabe der Rechnungsnummer.",
    },
    {
      tenantId: BETA_TENANT_ID,
      status: "draft",
      paymentNote: "Der Betrag wird zum Monatsersten von Ihrem Konto eingezogen.",
    },
  ] as const;
  for (const override of overrides) {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: INVOICE_TEMPLATE_SLUG,
        kind: "document-pdf",
        locale: LOCALE,
        content: invoiceBody(override.paymentNote),
        contentFormat: "html",
        meta: INVOICE_META,
        variableSchema: INVOICE_VARIABLES,
        parentTemplateId: system.id,
        tenantIdOverride: override.tenantId,
        status: override.status,
      },
      admin,
    );
  }
}
