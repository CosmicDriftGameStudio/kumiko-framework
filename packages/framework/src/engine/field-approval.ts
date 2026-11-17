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

function isEmptyCreateValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
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
        ? isEmptyCreateValue(data[key])
        : isUnchangedValue(data[key], previous[key]);
    if (!skip) gated.push(key);
  }
  return gated;
}
