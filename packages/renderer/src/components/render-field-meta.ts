import type { FieldIconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import { toKebab } from "../app/qn.ts";
import type { EditFieldViewModel } from "../headless/index.ts";

export function inputId(field: EditFieldViewModel): string {
  return `kumiko-edit-${field.field}`;
}

// Field types whose read display already isn't a boxed "disabled input" look
// (embedded/jsonb render as an info Banner) — `readOnlyDisplayText` doesn't
// cover these, they keep going through `renderInput`'s existing Banner branch
// in text-display mode too.
export function isComplexFieldType(type: string): boolean {
  return type === "embedded" || type === "jsonb";
}

// Read-only file fields keep their (disabled) widget: it shows a thumbnail or
// the file name, where plain text could only show the FileRef UUID.
export function isFileFieldType(type: string): boolean {
  return type === "file" || type === "image" || type === "files" || type === "images";
}

// Mirrors ACTION_ICON_BY_ID (kumiko-screen.tsx) for fields: only names with
// an unambiguous matching FieldIconKey are listed here, everything else
// stays iconless rather than guessing.
const FIELD_ICON_BY_NAME: Readonly<Partial<Record<string, FieldIconKey>>> = {
  email: "mail",
  phone: "phone",
  tel: "phone",
  mobile: "phone",
  url: "link",
  website: "link",
  link: "link",
  password: "lock",
  search: "search",
  city: "map-pin",
  address: "map-pin",
  street: "map-pin",
  user: "user",
  owner: "user",
  assignee: "user",
};

function kebabLastSegment(value: string): string {
  const kebab = toKebab(value);
  const lastDash = kebab.lastIndexOf("-");
  return lastDash === -1 ? kebab : kebab.slice(lastDash + 1);
}

// Derives a prefix icon when the field declares none: field.icon wins, then
// the field name. Deliberately no type-based fallback — a hash in front of a
// number field restates what the field already shows and reads as noise.
export function resolveFieldIcon(field: EditFieldViewModel): FieldIconKey | undefined {
  if (field.icon !== undefined) return field.icon;
  const byName =
    FIELD_ICON_BY_NAME[field.field.toLowerCase()] ??
    FIELD_ICON_BY_NAME[kebabLastSegment(field.field)];
  return byName;
}
