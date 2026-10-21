import { buildEntityTable } from "../db/table-builder.ts";
import { FILE_REF_ENTITY_NAME, fileRefEntity } from "./file-ref-entity.ts";

// `file_refs` is the read table for the `fileRef` entity. It is built from the entity
// definition rather than a manually maintained `pgTable`, so the implicit entity
// projection (rebuild) and live executor writes use the same columns and table—one
// source of truth, with no drift between duplicate definitions.
//
// `id` is a UUID and also serves as the aggregate ID for the `fileRef` event stream:
// each upload appends `fileRef.created`, and each deletion appends `fileRef.deleted`
// (standard entity auto-verbs). UUIDs prevent enumeration attacks against /files/:id.
export const fileRefsTable = buildEntityTable(FILE_REF_ENTITY_NAME, fileRefEntity);
