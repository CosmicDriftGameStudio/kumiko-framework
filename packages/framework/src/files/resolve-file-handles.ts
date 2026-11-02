import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { parseFileHandle } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "../db/tenant-db.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { type WriteFailure, writeFailure } from "../errors/index.ts";
import { fileClaimMatches } from "./file-claim.ts";
import { holdsFileRefs, mapFileRefSlots } from "./file-field-slots.ts";
import { invalidFileRefError } from "./invalid-file-ref-error.ts";

type NamedHandle = { readonly fieldName: string; readonly id: string; readonly claim: string };

export type ResolvedFileHandles =
  | {
      readonly values: Readonly<Record<string, unknown>>;
      readonly claimedFileRefIds: readonly string[];
    }
  | { readonly failure: WriteFailure };

function handlesNamedBy(
  fields: Readonly<Record<string, FieldDefinition>>,
  values: Readonly<Record<string, unknown>>,
): NamedHandle[] {
  const found: NamedHandle[] = [];
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    if (!holdsFileRefs(fieldDef) || !(fieldName in values)) continue;
    mapFileRefSlots(fieldDef, values[fieldName], (entry) => {
      const handle = parseFileHandle(entry);
      if (handle !== null) found.push({ fieldName, ...handle });
      return entry;
    });
  }
  return found;
}

// Swaps every file handle a write names for the bare fileRef id after checking its claim, so
// neither the claim nor the handle reaches a hook, the event or the table. A handle only proves
// ownership of a pending upload; a pending row with a wrong claim, a missing row or one of
// another tenant, or an upload made for another field fails like an unknown id. A bound row passes through as its bare id.
export async function resolveFileHandles(
  { fields }: { readonly fields: Readonly<Record<string, FieldDefinition>> },
  entityName: string,
  values: Readonly<Record<string, unknown>>,
  db: TenantDb,
  user: Pick<SessionUser, "tenantId">,
): Promise<ResolvedFileHandles> {
  const handles = handlesNamedBy(fields, values);
  // skip: without handles there is nothing to resolve and no row to read
  if (handles.length === 0) return { values, claimedFileRefIds: [] };

  // Loaded on demand: file_refs is built from an entity definition that needs the engine, which
  // imports the executor this module is part of.
  const { loadFileRefRows } = await import("./load-save-file-refs.ts");
  const rows = await loadFileRefRows(db, [...new Set(handles.map((h) => h.id))], user.tenantId);
  const claimedFileRefIds = new Set<string>();
  for (const handle of handles) {
    const row = rows.get(handle.id);
    if (row === undefined) return { failure: writeFailure(invalidFileRefError(handle.fieldName)) };
    // A bound row needs no claim: the handle is just resubmitted next to its record, and
    // assertFileRefsBelongToTenant judges it like a bare id (same record passes, another fails).
    if (row["entityId"] !== null && row["entityId"] !== undefined) continue;
    // The claim is bound to the field the upload came in through: a handle issued for one field
    // must not carry the file into another entity or field.
    const isIssuedForThisField =
      row["entityType"] === entityName && row["fieldName"] === handle.fieldName;
    if (!isIssuedForThisField || !fileClaimMatches(row["claimHash"], handle.claim)) {
      return { failure: writeFailure(invalidFileRefError(handle.fieldName)) };
    }
    claimedFileRefIds.add(handle.id);
  }

  const resolved: Record<string, unknown> = { ...values };
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    if (!holdsFileRefs(fieldDef) || !(fieldName in values)) continue;
    resolved[fieldName] = mapFileRefSlots(
      fieldDef,
      values[fieldName],
      (entry) => parseFileHandle(entry)?.id ?? entry,
    );
  }
  return { values: resolved, claimedFileRefIds: [...claimedFileRefIds] };
}
