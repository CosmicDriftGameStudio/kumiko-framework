import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createJsonbField,
  createLongTextField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// (MVP) page shape — LiteParse fills this in.
// Kept minimal on purpose: downstream themes (provider, recipe) extend it.
// Stored as JSON.stringify(IngestPage[]) in the encrypted `pages` column —
// jsonb has no encryption support in the engine, and this column holds the
// full extracted text of ingested documents (invoices, IDs, contracts).
// Writers/readers MUST use writeIngestPages / readIngestPages — do not pass
// a raw IngestPage[] into executor.create (the encryption hook requires a
// string).
export type IngestPage = {
  readonly pageNumber: number;
  readonly text: string;
};

export type DocumentExtractMeta = {
  readonly provider: string;
  readonly ms: number;
  readonly needsOcr: boolean;
  readonly pagesParsed: number;
  readonly totalPages: number;
};

// documentExtract — implicit entity-projection (r.entity, NOT r.projection):
// an explicit r.projection would make `forget` non-rebuild-safe and require
// archiveStream instead of the regular forget path.
// fileRefId points at the source file_refs row; storageKey duplicates it for
// direct provider access without a join.
export const documentExtractEntity = createEntity({
  table: "read_document_extracts",
  fields: {
    fileRefId: createTextField({ required: true, personal: false, reason: "pseudonymous_fk" }),
    storageKey: createTextField({
      required: true,
      personal: false,
      reason: "technical_reference",
    }),
    // Holds the full extracted document text (PII). Record-owned (`personal: { of: "id" }`),
    // not tenant: the extract dies with its fileRef, and only a per-record key can make the old
    // events unreadable then; the forget paths erase that key. Whose subject a third party named
    // inside a document is stays open, same as inbound-mail-foundation. meta is provider
    // telemetry only and stays plaintext jsonb.
    pages: createLongTextField({
      personal: { of: "id" },
      find: "none",
    }),
    meta: createJsonbField(),
  },
  // Forget hooks and extract lookups select by the source fileRefId.
  indexes: [{ columns: ["tenantId", "fileRefId"] }],
});

export const documentExtractsTable = buildEntityTable("documentExtract", documentExtractEntity);
