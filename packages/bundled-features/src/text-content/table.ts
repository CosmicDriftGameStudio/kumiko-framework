import { buildDrizzleTable } from "@kumiko/framework/db";
import { createEntity, createTextField } from "@kumiko/framework/engine";

// TextBlock — generischer Container für statische Texte (legal pages,
// FAQ, About, ToS, Marketing-Snippets). Pro (tenantId, slug, lang) genau
// eine Row. SYSTEM_TENANT_ID für app-weite Texte (Impressum etc.), sonst
// Tenant-eigene Texte.
//
// Inhaltsformat ist Markdown (App-Renderer entscheidet Markdown→HTML).
// Body bleibt nullable damit ein leerer Block existieren kann (z.B.
// während Tenant-Onboarding bevor der Admin den finalen Text schreibt).
export const textBlockEntity = createEntity({
  table: "read_text_blocks",
  fields: {
    slug: createTextField({ required: true }),
    lang: createTextField({ required: true }),
    title: createTextField({ required: true }),
    body: createTextField({}),
  },
  indexes: [
    { unique: true, columns: ["tenantId", "slug", "lang"], name: "read_text_blocks_unique" },
  ],
});

export const textBlocksTable = buildDrizzleTable("text-block", textBlockEntity);

// Concrete Row-Type — single-source dafür dass die unknown-Werte die
// Drizzle aus `Record<string, unknown>` liefert genau einmal benannt
// werden (statt 6× `row["x"] as Y` Casts in Handlern + Seeding).
// Kommt aus `entity.fields` + Standard-Spalten (id, version, tenantId,
// createdAt, updatedAt, createdBy, updatedBy) die buildBaseColumns
// erzwingt.
export type TextBlockRow = {
  readonly id: string | number;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
  readonly updatedBy: string;
};
