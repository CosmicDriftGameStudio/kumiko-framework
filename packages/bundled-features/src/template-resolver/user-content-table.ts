import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { CONTENT_FORMATS, TEMPLATE_KINDS } from "./constants";

// UserContentEntry — the per-user half of the content store: mail signatures
// and personal reply snippets, one row per (tenantId, ownerId, slug, kind,
// locale).
//
// Why a separate table instead of a nullable ownerId on read_template_resources:
// `content` here carries the owner's name, phone and address, so it needs
// `userOwned` for crypto-shredding. That annotation is resolved per entity, not
// per row — `resolveSubjectForField` throws when the owner column is empty
// (crypto/subject-resolver.ts). On a mixed table every tenant-wide mail template
// would fail its write. `ownerId` NOT NULL keeps the invariant in the schema and
// makes the unique index a plain one instead of two partial indexes.
//
// Not part of `resolveTemplate`'s 4-level fallback: these entries are listed and
// edited by their owner, never resolved as a tenant/system template override.
export const userContentEntryEntity = createEntity({
  table: "read_user_content_entries",
  fields: {
    ownerId: createTextField({ required: true, subjectRef: true }),
    slug: createTextField({ required: true }),
    kind: createSelectField({ required: true, options: [...TEMPLATE_KINDS] }),
    locale: createTextField({ required: true }),
    title: createTextField({}),
    folder: createTextField({}),
    content: createLongTextField({ userOwned: { ownerField: "ownerId" } }),
    contentFormat: createSelectField({ required: true, options: [...CONTENT_FORMATS] }),
  },
  indexes: [
    {
      unique: true,
      columns: ["tenantId", "ownerId", "slug", "kind", "locale"],
      name: "read_user_content_entries_unique",
    },
  ],
});

export const userContentEntriesTable = buildEntityTable(
  "user-content-entry",
  userContentEntryEntity,
);

export type UserContentEntryRow = {
  readonly id: string | number;
  readonly version: number;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly title: string | null;
  readonly folder: string | null;
  readonly content: string | null;
  readonly contentFormat: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
  readonly updatedBy: string;
};
