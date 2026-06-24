// Reine Daten für den Marketing-Seed — Templates + Personen-Listen.
// Logik und Random-Erzeugung leben in seed.ts. Trennung weil sich
// Daten häufiger ändern als Logik (mehr Items, andere Namen) und der
// Diff-Lärm den Seed-Algorithmus nicht überlagern soll.
//
// Type-Felder leiten direkt aus den Schema-Konstanten ab (AssetType,
// AssetDepartment, etc.) — Schema-Änderung an den `options` macht hier
// sofort einen Compile-Error, kein silent drift.

import type { AssetDepartment, AssetType } from "../features/assets/schema";
import type { TicketCategory, TicketDepartment } from "../features/helpdesk/schema";

export interface AssetTemplate {
  readonly name: string;
  readonly type: AssetType;
  readonly vendor: string;
  readonly department: AssetDepartment;
  readonly priceMin: number;
  readonly priceMax: number;
}

export const ASSET_TEMPLATES: ReadonlyArray<AssetTemplate> = [
  {
    name: "MacBook Pro 14",
    type: "laptop",
    vendor: "Apple",
    department: "engineering",
    priceMin: 2400,
    priceMax: 2900,
  },
  {
    name: "MacBook Pro 16",
    type: "laptop",
    vendor: "Apple",
    department: "engineering",
    priceMin: 3100,
    priceMax: 3800,
  },
  {
    name: "MacBook Air M2",
    type: "laptop",
    vendor: "Apple",
    department: "marketing",
    priceMin: 1400,
    priceMax: 1700,
  },
  {
    name: "ThinkPad X1 Carbon",
    type: "laptop",
    vendor: "Lenovo",
    department: "sales",
    priceMin: 2100,
    priceMax: 2500,
  },
  {
    name: "ThinkPad T14",
    type: "laptop",
    vendor: "Lenovo",
    department: "it",
    priceMin: 1500,
    priceMax: 1900,
  },
  {
    name: "Dell XPS 13",
    type: "laptop",
    vendor: "Dell",
    department: "finance",
    priceMin: 1700,
    priceMax: 2100,
  },
  {
    name: "Dell Latitude 7440",
    type: "laptop",
    vendor: "Dell",
    department: "hr",
    priceMin: 1600,
    priceMax: 1950,
  },
  {
    name: "Surface Laptop 5",
    type: "laptop",
    vendor: "Microsoft",
    department: "marketing",
    priceMin: 1500,
    priceMax: 1900,
  },
  {
    name: 'LG UltraFine 27"',
    type: "monitor",
    vendor: "LG",
    department: "engineering",
    priceMin: 600,
    priceMax: 850,
  },
  {
    name: 'LG UltraFine 32"',
    type: "monitor",
    vendor: "LG",
    department: "engineering",
    priceMin: 1100,
    priceMax: 1500,
  },
  {
    name: "Dell U2723QE",
    type: "monitor",
    vendor: "Dell",
    department: "shared",
    priceMin: 700,
    priceMax: 950,
  },
  {
    name: "BenQ PD2705U",
    type: "monitor",
    vendor: "BenQ",
    department: "marketing",
    priceMin: 550,
    priceMax: 750,
  },
  {
    name: 'Eizo FlexScan 27"',
    type: "monitor",
    vendor: "Eizo",
    department: "engineering",
    priceMin: 650,
    priceMax: 900,
  },
  {
    name: "iPhone 15 Pro",
    type: "phone",
    vendor: "Apple",
    department: "sales",
    priceMin: 1200,
    priceMax: 1400,
  },
  {
    name: "iPhone 14",
    type: "phone",
    vendor: "Apple",
    department: "sales",
    priceMin: 800,
    priceMax: 1000,
  },
  {
    name: "Pixel 8",
    type: "phone",
    vendor: "Google",
    department: "engineering",
    priceMin: 700,
    priceMax: 900,
  },
  {
    name: "Samsung Galaxy S24",
    type: "phone",
    vendor: "Samsung",
    department: "sales",
    priceMin: 900,
    priceMax: 1100,
  },
  {
    name: "Bosch GSR 18V Akkuschrauber",
    type: "tool",
    vendor: "Bosch",
    department: "shared",
    priceMin: 250,
    priceMax: 380,
  },
  {
    name: "DeWalt DCH273 Bohrhammer",
    type: "tool",
    vendor: "DeWalt",
    department: "shared",
    priceMin: 320,
    priceMax: 480,
  },
  {
    name: "Makita BO5041 Schleifgerät",
    type: "tool",
    vendor: "Makita",
    department: "shared",
    priceMin: 180,
    priceMax: 260,
  },
  {
    name: "Hilti TE 6-A22 Bohrer",
    type: "tool",
    vendor: "Hilti",
    department: "shared",
    priceMin: 700,
    priceMax: 950,
  },
  {
    name: 'Drehmomentschlüssel 1/2"',
    type: "tool",
    vendor: "Hazet",
    department: "shared",
    priceMin: 220,
    priceMax: 320,
  },
  {
    name: "Multimeter Fluke 87V",
    type: "tool",
    vendor: "Fluke",
    department: "engineering",
    priceMin: 480,
    priceMax: 620,
  },
  {
    name: "Schweißgerät Lorch",
    type: "tool",
    vendor: "Lorch",
    department: "shared",
    priceMin: 1900,
    priceMax: 2400,
  },
  {
    name: "Adobe Creative Cloud",
    type: "license",
    vendor: "Adobe",
    department: "marketing",
    priceMin: 720,
    priceMax: 720,
  },
  {
    name: "Adobe Acrobat Pro",
    type: "license",
    vendor: "Adobe",
    department: "finance",
    priceMin: 180,
    priceMax: 220,
  },
  {
    name: "JetBrains All Products",
    type: "license",
    vendor: "JetBrains",
    department: "engineering",
    priceMin: 650,
    priceMax: 780,
  },
  {
    name: "Microsoft 365 Business",
    type: "license",
    vendor: "Microsoft",
    department: "shared",
    priceMin: 130,
    priceMax: 160,
  },
  {
    name: "Microsoft Visio",
    type: "license",
    vendor: "Microsoft",
    department: "engineering",
    priceMin: 280,
    priceMax: 380,
  },
  {
    name: "Figma Professional",
    type: "license",
    vendor: "Figma",
    department: "marketing",
    priceMin: 144,
    priceMax: 180,
  },
  {
    name: "GitHub Enterprise",
    type: "license",
    vendor: "GitHub",
    department: "engineering",
    priceMin: 252,
    priceMax: 252,
  },
  {
    name: "Notion Team",
    type: "license",
    vendor: "Notion",
    department: "shared",
    priceMin: 96,
    priceMax: 120,
  },
  {
    name: "Linear Standard",
    type: "license",
    vendor: "Linear",
    department: "engineering",
    priceMin: 100,
    priceMax: 144,
  },
  {
    name: "Werkstatt-Schraubstock",
    type: "other",
    vendor: "Heuer",
    department: "shared",
    priceMin: 320,
    priceMax: 480,
  },
  {
    name: "Konferenz-Webcam Logitech Brio",
    type: "other",
    vendor: "Logitech",
    department: "shared",
    priceMin: 220,
    priceMax: 280,
  },
];

// Erste Position leer → Math.floor(r() * length) kann „nicht ausgeliehen"
// treffen ohne Sonderfall. Wird nur für status==="lent" konsultiert.
export const OWNERS: ReadonlyArray<string> = [
  "",
  "Marc Frost",
  "Anna Weber",
  "Lars Bergmann",
  "Sina Klein",
  "Tom Meier",
  "Jana Schmidt",
];

export const LOCATIONS: ReadonlyArray<string> = [
  "Berlin office 3F",
  "Berlin office 2F",
  "Munich office",
  "Hanover workshop",
  "Cologne warehouse",
  "Remote / home office",
  "Mid conference room",
  "Server room",
  "Reception",
];

export interface TicketTemplate {
  readonly title: string;
  readonly category: TicketCategory;
  readonly department: TicketDepartment;
}

export const TICKET_TEMPLATES: ReadonlyArray<TicketTemplate> = [
  { title: "Printer on 2nd floor not working", category: "hardware", department: "it" },
  {
    title: "VPN disconnects after 30 minutes",
    category: "network",
    department: "engineering",
  },
  { title: "MacBook no longer boots", category: "hardware", department: "engineering" },
  {
    title: "Office license for marketing team expired",
    category: "license",
    department: "marketing",
  },
  { title: "Slack notifications not arriving", category: "software", department: "sales" },
  { title: "Weak Wi‑Fi in conference room", category: "network", department: "it" },
  {
    title: "Mail client hangs on large attachments",
    category: "software",
    department: "finance",
  },
  {
    title: "Nightly database backup failed",
    category: "software",
    department: "engineering",
  },
  { title: "SSL certificate expires in 7 days", category: "software", department: "it" },
  { title: "Inventory spreadsheet corrupted", category: "software", department: "finance" },
  { title: "Outlook no longer syncs", category: "software", department: "sales" },
  { title: "Zoom meeting won't connect", category: "software", department: "marketing" },
  {
    title: "Excel crashes opening large files",
    category: "software",
    department: "finance",
  },
  { title: "USB-C hub at desk defective", category: "hardware", department: "engineering" },
  { title: "Webcam not detected", category: "hardware", department: "marketing" },
  {
    title: "Set up GitHub access for new hire",
    category: "account",
    department: "engineering",
  },
  { title: "Projector in conference room 3 shows red pixels", category: "hardware", department: "it" },
  { title: "File server disk almost full", category: "hardware", department: "it" },
  { title: "AD login suddenly takes 30 seconds", category: "account", department: "it" },
  {
    title: "External monitor flickers sporadically",
    category: "hardware",
    department: "engineering",
  },
  {
    title: "Reassign Adobe license for intern",
    category: "license",
    department: "marketing",
  },
  { title: "Phone headset crackling", category: "hardware", department: "sales" },
  {
    title: "Keycloak token expires mid workday",
    category: "account",
    department: "engineering",
  },
  { title: "Mac onboarding script failed", category: "software", department: "it" },
  { title: "Lost two-factor token", category: "account", department: "hr" },
  { title: "Printer toner request — accounting", category: "hardware", department: "finance" },
  { title: "Server room temperature too high", category: "hardware", department: "it" },
  { title: "MFA reset for marketing team lead", category: "account", department: "marketing" },
  { title: "Expand mailbox quota for sales team", category: "account", department: "sales" },
  { title: "Backup tape robot making noise", category: "hardware", department: "it" },
  {
    title: "Firewall rule for new service endpoint",
    category: "network",
    department: "engineering",
  },
  {
    title: "Print queue stuck since this morning",
    category: "hardware",
    department: "it",
  },
  { title: "Update VPN profile to new IP", category: "network", department: "it" },
  { title: "Asset tag missing after laptop return", category: "other", department: "hr" },
  { title: "BitLocker recovery key for stolen laptop", category: "account", department: "hr" },
];

export const REPORTERS: ReadonlyArray<string> = [
  "Anna Weber",
  "Lars Bergmann",
  "Sina Klein",
  "Tom Meier",
  "Jana Schmidt",
  "Felix Hofmann",
  "Marie Wagner",
  "Daniel Becker",
  "Lisa Krüger",
  "Sebastian Roth",
];

// Erste Position leer → genauso wie OWNERS, einige Tickets bleiben
// unzugewiesen damit die Liste nicht zu uniform aussieht.
export const ASSIGNEES: ReadonlyArray<string> = [
  "",
  "Marc Frost",
  "IT-Team",
  "Sysadmin",
  "Helpdesk-L1",
  "Helpdesk-L2",
];
