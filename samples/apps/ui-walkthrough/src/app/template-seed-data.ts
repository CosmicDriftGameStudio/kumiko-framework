// Template content for the Nordlicht document-designer walkthrough. Pure data,
// no framework import: seed-templates.ts feeds it through the template write
// handlers, so every body here goes through the real sanitizer and placeholder
// validation.

export type SeedTemplate = {
  readonly slug: string;
  readonly kind: "mail" | "mail-layout" | "document-pdf" | "pdf-layout";
  readonly locale: string;
  readonly title?: string;
  readonly content: string;
  readonly meta?: Record<string, unknown>;
  readonly variableSchema?: Record<string, unknown>;
};

// Document HTML marks a variable as an empty span; only link targets take {{name}}.
const v = (name: string): string => `<span data-variable="${name}"></span>`;

const AUTH_VARIABLE_SCHEMA = {
  appName: { type: "text", required: true },
  actionUrl: { type: "link", required: true },
  validFor: { type: "text", required: true },
  validUntil: { type: "text", required: true },
} as const;

const INVOICE_VARIABLE_SCHEMA = {
  customerName: { type: "text", required: true },
  invoiceNumber: { type: "text", required: true },
  amount: { type: "money", required: true },
  dueDate: { type: "date", required: true },
  invoiceUrl: { type: "link", required: true },
} as const;

const DOCUMENT_LINES_SCHEMA = {
  tenantName: { type: "text" },
  customerName: { type: "text", required: true },
  invoiceNumber: { type: "text", required: true },
  invoiceDate: { type: "date", required: true },
  total: { type: "money", required: true },
  lines: {
    type: "list",
    required: true,
    item: { description: { type: "text" }, amount: { type: "money" } },
  },
} as const;

export const SYSTEM_PDF_LAYOUT: SeedTemplate = {
  slug: "default",
  kind: "pdf-layout",
  locale: "en",
  title: "Briefpapier",
  content: [
    `<div data-header><p><strong>${v("tenantName")}</strong></p></div>`,
    "<div data-content></div>",
    "<div data-signature></div>",
    `<div data-footer><p>${v("tenantName")} · Seite ${v("page")} von ${v("pages")}</p></div>`,
  ].join(""),
};

export const TENANT_MAIL_LAYOUT_VERSIONS: readonly string[] = [
  [
    `<div data-header><p><strong>${v("tenantName")}</strong></p></div>`,
    "<div data-content></div>",
    "<div data-signature><p>Mit freundlichen Grüßen</p></div>",
    `<div data-footer><p>${v("tenantName")}</p></div>`,
  ].join(""),
  [
    `<div data-header><p><strong>${v("tenantName")}</strong></p><p>Ihre Hausverwaltung in Kiel</p></div>`,
    "<div data-content></div>",
    `<div data-signature><p>Mit freundlichen Grüßen</p><p>${v("signature")}</p><p>${v("tenantName")}</p></div>`,
    `<div data-footer><p>${v("imprint")}</p><p><a href="https://nordlicht-immobilien.de/datenschutz">Datenschutz</a> · <a href="{{unsubscribeUrl}}">Abmelden</a></p></div>`,
  ].join(""),
];

const INVOICE_ISSUED_META = (subject: string) => ({
  subject,
  previewText: "Ihre Rechnung steht zum Abruf bereit.",
});

function invoiceIssuedBody(intro: string): string {
  return [
    `<p>Guten Tag ${v("customerName")},</p>`,
    `<p>${intro} <strong>${v("invoiceNumber")}</strong> über <strong>${v("amount")}</strong>. Bitte überweisen Sie den Betrag bis zum ${v("dueDate")}.</p>`,
    `<p>Sie können die Rechnung hier abrufen: <a href="{{invoiceUrl}}">Rechnung öffnen</a></p>`,
    "<p>Bei Rückfragen melden Sie sich gerne bei uns.</p>",
  ].join("");
}

// Saved in order: each entry becomes the next version of the same draft.
export const INVOICE_ISSUED_DRAFT_VERSIONS: readonly SeedTemplate[] = [
  {
    slug: "billing:notify:invoice-issued",
    kind: "mail",
    locale: "de",
    title: "Rechnung versendet",
    content: invoiceIssuedBody("anbei senden wir Ihnen die Rechnung"),
    meta: INVOICE_ISSUED_META("Ihre Rechnung {{invoiceNumber}}"),
    variableSchema: INVOICE_VARIABLE_SCHEMA,
  },
  {
    slug: "billing:notify:invoice-issued",
    kind: "mail",
    locale: "de",
    title: "Rechnung versendet",
    content: invoiceIssuedBody("anbei erhalten Sie die Rechnung"),
    meta: INVOICE_ISSUED_META("Ihre Rechnung {{invoiceNumber}} von {{tenantName}}"),
    variableSchema: INVOICE_VARIABLE_SCHEMA,
  },
  {
    slug: "billing:notify:invoice-issued",
    kind: "mail",
    locale: "de",
    title: "Rechnung versendet",
    content: invoiceIssuedBody("anbei erhalten Sie die aktuelle Rechnung"),
    meta: INVOICE_ISSUED_META("Rechnung {{invoiceNumber}}: {{amount}} fällig am {{dueDate}}"),
    variableSchema: INVOICE_VARIABLE_SCHEMA,
  },
];

export const PAYMENT_REMINDER_TEMPLATES: readonly SeedTemplate[] = [
  {
    slug: "billing:notify:payment-reminder",
    kind: "mail",
    locale: "de",
    title: "Zahlungserinnerung",
    content: [
      `<p>Guten Tag ${v("customerName")},</p>`,
      `<p>zu unserer Rechnung <strong>${v("invoiceNumber")}</strong> über <strong>${v("amount")}</strong> konnten wir bis heute keinen Zahlungseingang feststellen. Fällig war der Betrag am ${v("dueDate")}.</p>`,
      `<p>Bitte überweisen Sie den offenen Betrag in den nächsten Tagen. Die Rechnung finden Sie hier: <a href="{{invoiceUrl}}">Rechnung öffnen</a></p>`,
      "<p>Sollten Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.</p>",
    ].join(""),
    meta: { subject: "Zahlungserinnerung zu Rechnung {{invoiceNumber}}" },
    variableSchema: INVOICE_VARIABLE_SCHEMA,
  },
  {
    slug: "billing:notify:payment-reminder",
    kind: "mail",
    locale: "en",
    title: "Payment reminder",
    content: [
      `<p>Hello ${v("customerName")},</p>`,
      `<p>we have not received a payment for invoice <strong>${v("invoiceNumber")}</strong> of <strong>${v("amount")}</strong>, which was due on ${v("dueDate")}.</p>`,
      `<p>Please transfer the open amount in the next few days. You can find the invoice here: <a href="{{invoiceUrl}}">Open invoice</a></p>`,
      "<p>If you have already paid, please disregard this message.</p>",
    ].join(""),
    meta: { subject: "Payment reminder for invoice {{invoiceNumber}}" },
    variableSchema: INVOICE_VARIABLE_SCHEMA,
  },
];

function authMail(
  notification: string,
  locale: "de" | "en",
  title: string,
  subject: string,
  paragraphs: readonly string[],
  extraSchema: Record<string, unknown> = {},
): SeedTemplate {
  return {
    slug: `auth-email-password:notify:${notification}`,
    kind: "mail",
    locale,
    title,
    content: paragraphs.join(""),
    meta: { subject },
    variableSchema: { ...AUTH_VARIABLE_SCHEMA, ...extraSchema },
  };
}

export const SYSTEM_AUTH_MAILS: readonly SeedTemplate[] = [
  authMail(
    "password-reset",
    "de",
    "Passwort zurücksetzen",
    "Passwort für {{appName}} zurücksetzen",
    [
      "<p>Hallo,</p>",
      `<p>für Ihr Konto bei ${v("appName")} wurde ein neues Passwort angefordert. Über den folgenden Link können Sie es festlegen: <a href="{{actionUrl}}">Passwort zurücksetzen</a></p>`,
      `<p>Der Link ist ${v("validFor")} gültig, bis ${v("validUntil")}. Haben Sie das nicht angefordert, können Sie diese Nachricht ignorieren.</p>`,
    ],
  ),
  authMail("password-reset", "en", "Reset password", "Reset your {{appName}} password", [
    "<p>Hello,</p>",
    `<p>a new password was requested for your ${v("appName")} account. You can set it with this link: <a href="{{actionUrl}}">Reset password</a></p>`,
    `<p>The link is valid for ${v("validFor")}, until ${v("validUntil")}. If you did not ask for this, you can ignore this message.</p>`,
  ]),
  authMail(
    "invite",
    "de",
    "Einladung ins Team",
    "Einladung zu {{appName}}",
    [
      "<p>Hallo,</p>",
      `<p>Sie wurden zu ${v("appName")} eingeladen, mit der Rolle <strong>${v("role")}</strong>. Mit dem folgenden Link nehmen Sie die Einladung an: <a href="{{actionUrl}}">Einladung annehmen</a></p>`,
      `<p>Die Einladung ist ${v("validFor")} gültig, bis ${v("validUntil")}.</p>`,
    ],
    { role: { type: "text", required: true } },
  ),
  authMail(
    "invite",
    "en",
    "Team invitation",
    "You are invited to {{appName}}",
    [
      "<p>Hello,</p>",
      `<p>You have been invited to ${v("appName")} with the role <strong>${v("role")}</strong>. Accept the invitation with this link: <a href="{{actionUrl}}">Accept invitation</a></p>`,
      `<p>The invitation is valid for ${v("validFor")}, until ${v("validUntil")}.</p>`,
    ],
    { role: { type: "text", required: true } },
  ),
  authMail(
    "signup-activation",
    "de",
    "Registrierung bestätigen",
    "Registrierung bei {{appName}} bestätigen",
    [
      "<p>Willkommen,</p>",
      `<p>vielen Dank für Ihre Registrierung bei ${v("appName")}. Bitte bestätigen Sie Ihre E-Mail-Adresse: <a href="{{actionUrl}}">Registrierung bestätigen</a></p>`,
      `<p>Der Link ist ${v("validFor")} gültig, bis ${v("validUntil")}.</p>`,
    ],
  ),
];

const INVOICE_DOCUMENT_ROWS = `<table><tbody><tr><th><p>Leistung</p></th><th><p>Betrag</p></th></tr><tr data-each="lines" data-repeat-header=""><td><p>${v("description")}</p></td><td><p>${v("amount")}</p></td></tr></tbody></table>`;

export const SYSTEM_INVOICE_DOCUMENTS: readonly SeedTemplate[] = [
  {
    slug: "billing:invoice",
    kind: "document-pdf",
    locale: "de",
    title: "Rechnung",
    content: [
      `<h1>Rechnung ${v("invoiceNumber")}</h1>`,
      `<p>Rechnungsdatum: ${v("invoiceDate")}</p>`,
      `<p>Guten Tag ${v("customerName")},</p>`,
      "<p>für unsere Leistungen stellen wir Ihnen folgenden Betrag in Rechnung.</p>",
      INVOICE_DOCUMENT_ROWS,
      `<p><strong>Gesamtbetrag: ${v("total")}</strong></p>`,
      "<p>Bitte überweisen Sie den Betrag innerhalb von 14 Tagen auf unser Konto.</p>",
    ].join(""),
    meta: { layoutSlug: "default", pageFormat: "A4", fileName: "Rechnung.pdf" },
    variableSchema: DOCUMENT_LINES_SCHEMA,
  },
  {
    slug: "billing:invoice",
    kind: "document-pdf",
    locale: "en",
    title: "Invoice",
    content: [
      `<h1>Invoice ${v("invoiceNumber")}</h1>`,
      `<p>Invoice date: ${v("invoiceDate")}</p>`,
      `<p>Dear ${v("customerName")},</p>`,
      "<p>we charge you the following amount for our services.</p>",
      INVOICE_DOCUMENT_ROWS.replace("Leistung", "Service").replace("Betrag", "Amount"),
      `<p><strong>Total: ${v("total")}</strong></p>`,
      "<p>Please transfer the amount to our account within 14 days.</p>",
    ].join(""),
    meta: { layoutSlug: "default", pageFormat: "A4", fileName: "Invoice.pdf" },
    variableSchema: DOCUMENT_LINES_SCHEMA,
  },
];

export const TENANT_UTILITY_STATEMENT: SeedTemplate = {
  slug: "rental:utility-statement",
  kind: "document-pdf",
  locale: "de",
  title: "Nebenkostenabrechnung",
  content: [
    `<h1>Nebenkostenabrechnung ${v("invoiceNumber")}</h1>`,
    `<p>Abrechnungsdatum: ${v("invoiceDate")}</p>`,
    `<p>Guten Tag ${v("customerName")},</p>`,
    "<p>nachfolgend erhalten Sie die Abrechnung der Betriebskosten für den Abrechnungszeitraum.</p>",
    INVOICE_DOCUMENT_ROWS,
    `<p><strong>Ergebnis: ${v("total")}</strong></p>`,
    "<p>Ein Guthaben überweisen wir Ihnen innerhalb von 30 Tagen, eine Nachzahlung ist zum Monatsende fällig.</p>",
  ].join(""),
  meta: { layoutSlug: "default", pageFormat: "A4", fileName: "Nebenkostenabrechnung.pdf" },
  variableSchema: DOCUMENT_LINES_SCHEMA,
};

export const SYSTEM_TENANCY_CERTIFICATE: SeedTemplate = {
  slug: "rental:tenancy-certificate",
  kind: "document-pdf",
  locale: "de",
  title: "Mietbescheinigung",
  content: [
    "<h1>Mietbescheinigung</h1>",
    `<p>Hiermit bestätigen wir, dass ${v("customerName")} bei uns Mieter ist und die Miete ordnungsgemäß zahlt.</p>`,
    `<p>Ausgestellt am ${v("invoiceDate")}.</p>`,
  ].join(""),
  meta: { layoutSlug: "default", pageFormat: "A4", fileName: "Mietbescheinigung.pdf" },
  variableSchema: {
    customerName: { type: "text", required: true },
    invoiceDate: { type: "date", required: true },
  },
};
