import {
  createEntity,
  createJsonbField,
  createLongTextField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// Phase-1 (MVP) page shape — LiteParse fills this in (kumiko-enterprise#273).
// Kept minimal on purpose: downstream themes (provider, recipe) extend it.
// Stored as JSON.stringify(IngestPage[]) in the encrypted `pages` column —
// jsonb has no encryption support in the engine, and this column holds the
// full extracted text of ingested documents (invoices, IDs, contracts).
// Writers/readers MUST use writeIngestPages / readIngestPages — do not pass
// a raw IngestPage[] into executor.create (encrypted longText requires string).
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
// archiveStream instead of the regular forget path (kumiko-framework#1495).
// fileRefId points at the source file_refs row; storageKey duplicates it for
// direct provider access without a join.
export const documentExtractEntity = createEntity({
  table: "read_document_extracts",
  fields: {
    fileRefId: createTextField({ required: true }),
    storageKey: createTextField({ required: true }),
    // Encrypted — holds the full extracted document text (PII). meta is
    // provider telemetry only and stays plaintext jsonb.
    pages: createLongTextField({ encrypted: true }),
    meta: createJsonbField(),
  },
});
