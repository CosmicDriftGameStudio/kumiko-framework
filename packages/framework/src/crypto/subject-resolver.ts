import type { EntityDefinition } from "../engine/types/fields";
import type { TenantId } from "../engine/types/identifiers";
import type { SubjectId } from "./kms-adapter";

// Thrown when a field IS pii-annotated but the row can't name its subject —
// that must surface as an error, not fall back to plaintext.
export class SubjectResolutionError extends Error {
  constructor(
    public readonly fieldName: string,
    reason: string,
  ) {
    super(`Cannot resolve PII subject for field "${fieldName}": ${reason}`);
    this.name = "SubjectResolutionError";
  }
}

export interface ResolveSubjectOptions {
  // Write-time tenant scope — consulted for tenantOwned fields when the row
  // itself carries no tenantId column.
  readonly tenantId?: TenantId;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Maps a pii-annotated field to the subject whose key encrypts it.
 * Returns null for fields without any PII annotation (stored plaintext).
 *
 * Precedence for multi-annotated fields mirrors the erase triggers:
 * userOwned (user-forget) > tenantOwned (tenant-destroy) > pii (self).
 */
export function resolveSubjectForField(
  entity: EntityDefinition,
  fieldName: string,
  row: Record<string, unknown>,
  opts: ResolveSubjectOptions = {},
): SubjectId | null {
  const field = entity.fields[fieldName];
  if (!field) throw new SubjectResolutionError(fieldName, "field is not defined on the entity");

  if ("userOwned" in field && field.userOwned !== undefined) {
    const ownerField = field.userOwned.ownerField;
    const userId = nonEmptyString(row[ownerField]);
    if (userId === null) {
      throw new SubjectResolutionError(
        fieldName,
        `owner field "${ownerField}" is empty on the row`,
      );
    }
    return { kind: "user", userId };
  }

  if ("tenantOwned" in field && field.tenantOwned === true) {
    const tenantId = nonEmptyString(row["tenantId"]) ?? opts.tenantId;
    if (tenantId === undefined) {
      throw new SubjectResolutionError(
        fieldName,
        "row has no tenantId column and no write-time tenantId was provided",
      );
    }
    return { kind: "tenant", tenantId };
  }

  if ("pii" in field && field.pii === true) {
    // pii: true = the entity itself is the subject (user.email belongs to
    // that user row). Serial ids are stringified — subject keys are text.
    const id = row["id"];
    const userId = nonEmptyString(id) ?? (typeof id === "number" ? String(id) : null);
    if (userId === null) {
      throw new SubjectResolutionError(fieldName, "row has no id to use as the pii self-subject");
    }
    return { kind: "user", userId };
  }

  return null;
}

// The field names an encrypt engine must process for an entity — precomputed
// once at executor build time, like the sensitiveFields set.
export function collectPiiSubjectFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(
      ([, field]) =>
        ("userOwned" in field && field.userOwned !== undefined) ||
        ("tenantOwned" in field && field.tenantOwned === true) ||
        ("pii" in field && field.pii === true),
    )
    .map(([name]) => name);
}
