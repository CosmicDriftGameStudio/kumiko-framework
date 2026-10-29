import { sql } from "@cosmicdrift/kumiko-framework/db";
import {
  createDateField,
  createEntity,
  createFileField,
  createSelectField,
  createTextField,
  type EntityDefinition,
  SYSTEM_ROLE,
} from "@cosmicdrift/kumiko-framework/engine";
import { DOCUMENT_LINK_ENTITY } from "./constants.ts";

export type DocumentLinkReadMode = "anyLink" | "allLinks";

export type DocumentEntityOptions = {
  readonly categories: readonly [string, ...string[]];
  readonly adminRoles: readonly string[];
  readonly readAccess?: NonNullable<EntityDefinition["access"]>["read"];
  readonly linkReadMode?: DocumentLinkReadMode;
  readonly retention?: EntityDefinition["retention"];
};

// Readable only through a link to a host the viewer can read, and only when the file's owner is
// readable too (see EntityDefinition.readGate); readAccess narrows further.
export function createDocumentEntity(options: DocumentEntityOptions) {
  return createEntity({
    table: "read_filed_documents",
    softDelete: true,
    description:
      "A filed document: title, category, issue and expiry dates and one file. It is visible only through its links to other records and the owner of its file; the file may stay owned by the record it came from.",
    // The system user passes the gate; the capture and import checks run as it and would
    // otherwise miss a document that readAccess hides.
    ...(options.readAccess !== undefined && {
      access: { read: { ...options.readAccess, [SYSTEM_ROLE]: "all" } },
    }),
    ...(options.retention !== undefined && { retention: options.retention }),
    readGate: {
      [options.linkReadMode ?? "anyLink"]: { entity: DOCUMENT_LINK_ENTITY, field: "documentId" },
      fileOwner: { field: "file" },
      linkExemptRoles: options.adminRoles,
    },
    fields: {
      title: createTextField({
        required: true,
        maxLength: 200,
        sortable: true,
        searchable: true,
        personal: false,
        reason: "document_title",
      }),
      category: createSelectField({
        options: options.categories,
        required: true,
        filterable: true,
        sortable: true,
      }),
      issuedAt: createDateField({ sortable: true }),
      validUntil: createDateField({ sortable: true, filterable: true }),
      // Filed business documents belong to the tenant, not to one person.
      file: createFileField({ required: true, personal: false, reason: "is_business_data" }),
    },
    // One live document per file; a deleted one releases the file.
    indexes: [
      {
        columns: ["tenantId", "file"],
        unique: true,
        name: "read_filed_documents_file_unique",
        where: sql`"is_deleted" = false`,
      },
    ],
  });
}

export function createDocumentLinkEntity(linkTargets: readonly string[]) {
  return createEntity({
    table: "read_filed_document_links",
    softDelete: true,
    description:
      "The join row recording that one document belongs to one record, addressed by documentId, entityType and entityId, with exactly one row per triple. A document is visible to whoever can read at least one of its linked records.",
    parentRef: {
      entityTypeField: "entityType",
      entityIdField: "entityId",
      allowedTypes: linkTargets,
    },
    fields: {
      documentId: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      entityType: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      entityId: createTextField({
        required: true,
        maxLength: 128,
        personal: false,
        reason: "technical_reference",
      }),
    },
  });
}
