import {
  createEntity,
  createJsonbField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// Phase-1 (MVP) page shape — LiteParse fills this in (kumiko-enterprise#273).
// Kept minimal on purpose: downstream themes (provider, recipe) extend it,
// this skeleton only needs a stable name for the jsonb `pages` column.
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
    pages: createJsonbField(),
    meta: createJsonbField(),
  },
});
