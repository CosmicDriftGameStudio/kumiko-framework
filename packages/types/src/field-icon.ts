// Closed vocabulary of edit-field prefix icon keys. EditFieldSpec.icon,
// InputProps.icon and EditFieldViewModel.icon are typed against this union,
// so a typo (`"mial"`) is a compile error at the screen-def / view-model
// call site instead of a silent missing-icon at runtime.
//
// The renderer-web FIELD_ICONS map (packages/renderer-web/src/primitives/
// index.tsx) is checked against this same union via `satisfies`, so the
// two can't drift — add a key here only together with its lucide-react
// entry there, and vice versa.
export type FieldIconKey =
  | "mail"
  | "lock"
  | "hash"
  | "search"
  | "user"
  | "phone"
  | "calendar"
  | "link"
  | "tag"
  | "building"
  | "globe"
  | "key"
  | "map-pin";
