// The pieces an app ships for a letterhead: a system layout with its own look, a letter that places
// the recipient in the DIN address window, and the list of templates tenants may edit.

import {
  TENANT_LAYOUT_SLUG_PREFIX,
  type TenantEditableTemplate,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";

export const LETTERHEAD_LAYOUT_SLUG = "letterhead";
export const LETTER_SLUG = "letter";
export const LETTER_LOCALE = "de";

// Company placeholders read the tenant's own settings (tenant:config:company-*); a tenant that
// left one empty is told so by the validate query instead of getting an empty line in the PDF.
export const LETTERHEAD_LAYOUT_HTML = [
  '<div data-header><p data-align="center"><strong>Hausverwaltung am Sund</strong></p></div>',
  "<div data-content></div>",
  "<div data-signature></div>",
  [
    '<div data-footer><table data-borders="none"><tbody><tr>',
    '<td><p data-size="small"><span data-variable="companyAddress"></span></p></td>',
    '<td><p data-size="small"><span data-variable="companyIban"></span></p></td>',
    '<td><p data-size="small"><span data-variable="companyBic"></span></p></td>',
    "</tr></tbody></table></div>",
  ].join(""),
].join("");

export const LETTERHEAD_LAYOUT_META = {
  fontFamily: "times",
  fontSizePt: 11,
  tableStyle: "lines",
  margins: { top: 36, right: 24, bottom: 28, left: 30 },
} as const;

// DIN 5008 form B: the frame sits at the window position, 85 x 45 mm at 20 / 45 mm.
export const LETTER_HTML = [
  '<div data-frame data-x="20" data-y="45" data-width="85" data-height="45" data-frame-preset="address"><p><span data-variable="recipientName"></span></p></div>',
  '<p><span data-text-style data-size-pt="14" data-font="times">Guten Tag,</span></p>',
  "<p>anbei erhalten Sie die Unterlagen.</p>",
].join("");

// What an AI assistant sends through create-layout and patch-draft to rebuild an uploaded letter:
// structured blocks only, never HTML. Names and addresses are made up.
export const REBUILT_LAYOUT_NAME = "rebuilt-letterhead";
export const REBUILT_LAYOUT_SLUG = `${TENANT_LAYOUT_SLUG_PREFIX}${REBUILT_LAYOUT_NAME}`;
export const REBUILT_LETTER_SLUG = "rebuilt-letter";

export const REBUILT_HEADER_BLOCKS = [
  {
    type: "paragraph",
    align: "right",
    runs: [{ text: "Musterfirma GmbH", bold: true, sizePt: 14, color: "#1f5468" }],
  },
  { type: "paragraph", align: "right", text: "Musterstraße 1, 12345 Musterstadt" },
] as const;

export const REBUILT_LETTER_BLOCKS = [
  {
    type: "frame",
    xMm: 20,
    yMm: 45,
    widthMm: 85,
    heightMm: 45,
    preset: "address",
    blocks: [
      { type: "paragraph", text: "Max Mustermann" },
      { type: "paragraph", text: "Beispielweg 2" },
    ],
  },
  { type: "heading", level: 2, text: "Rechnung {{invoiceNumber}}" },
  {
    type: "table",
    columnWidthsPx: [320, 120],
    header: {
      cells: [
        { text: "Leistung", background: "#eeeeee" },
        { text: "Betrag", align: "right" },
      ],
    },
    rows: [],
    repeat: {
      each: "positions",
      row: { cells: [{ text: "{{label}}" }, { text: "{{amount}}", align: "right" }] },
    },
  },
] as const;

export const TENANT_EDITABLE: readonly TenantEditableTemplate[] = [
  { kind: "pdf-layout", slug: LETTERHEAD_LAYOUT_SLUG, access: { roles: ["TenantAdmin"] } },
  { kind: "document-pdf", slug: LETTER_SLUG, access: { roles: ["TenantAdmin"] } },
  { kind: "document-pdf", slug: REBUILT_LETTER_SLUG, access: { roles: ["TenantAdmin"] } },
];
