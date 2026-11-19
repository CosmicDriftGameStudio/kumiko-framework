import { userHasWriteRole } from "./field-access.ts";
import { normalizeAccessEntry } from "./ownership.ts";
import { isUnchangedValue } from "./screen-helpers.ts";
import type { EntityDefinition, FieldDefinition } from "./types/fields.ts";
import type { SessionUser } from "./types/index.ts";

export const FIELD_CHANGE_REQUEST_ENTITY_NAME = "field-change-request";

export const FIELD_APPROVAL_FIELD_TYPES: ReadonlySet<FieldDefinition["type"]> = new Set([
  "text",
  "longText",
  "number",
  "bigInt",
  "decimal",
  "select",
  "boolean",
  "date",
  "reference",
]);

export function fieldApproveRoles(field: FieldDefinition): readonly string[] {
  return field.access?.approve ?? [];
}

export function userCanApproveField(
  user: Pick<SessionUser, "roles">,
  field: FieldDefinition,
): boolean {
  const approvers = fieldApproveRoles(field);
  return user.roles.some((role) => approvers.includes(role));
}

// A form shows these fields read-only and offers a change request instead of a direct edit.
export function fieldsRequiringApprovalRequest(
  entity: EntityDefinition,
  user: Pick<SessionUser, "roles">,
): readonly string[] {
  return Object.entries(entity.fields)
    .filter(
      ([, field]) =>
        fieldApproveRoles(field).length > 0 &&
        !userCanApproveField(user, field) &&
        userHasWriteRole(user, normalizeAccessEntry(field.access?.write) ?? {}),
    )
    .map(([name]) => name);
}

export function scalarFieldDefault(field: FieldDefinition): unknown {
  switch (field.type) {
    case "text":
    case "longText":
    case "number":
    case "boolean":
    case "select":
      return field.default;
    default:
      return undefined;
  }
}

// The executor fills declared defaults before this check, so a create that leaves the field
// alone arrives with the default and must pass like an empty one.
function isUnsetCreateValue(field: FieldDefinition, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  const fieldDefault = scalarFieldDefault(field);
  return fieldDefault !== undefined && isUnchangedValue(value, fieldDefault);
}

export function fieldsAwaitingApproval(
  entity: EntityDefinition,
  user: Pick<SessionUser, "roles">,
  data: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const gated: string[] = [];
  for (const key of Object.keys(data)) {
    const field = entity.fields[key];
    if (field === undefined || fieldApproveRoles(field).length === 0) continue;
    if (userCanApproveField(user, field)) continue;
    const skip =
      previous === undefined
        ? isUnsetCreateValue(field, data[key])
        : isUnchangedValue(data[key], previous[key]);
    if (!skip) gated.push(key);
  }
  return gated;
}
