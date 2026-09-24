// Closed vocabulary of nav and button icon keys. NavDefinition.icon,
// ScreenNavSugar.icon, ConfigMask.icon and ButtonProps.icon/iconEnd are all
// typed against this union, so an unregistered key is a compile error at the
// r.nav()/r.screen()/config-mask/button call site instead of a silent
// missing-icon at runtime.
//
// The renderer-web NAV_ICONS map (packages/renderer-web/src/icons.tsx) is
// checked against this same union via `satisfies`, so the two can't drift —
// add a key here only together with its lucide-react entry there, and vice
// versa.
//
// Declared as a runtime tuple (not just a type) so callers that sit outside
// this repo's `tsc --build` project graph (e.g. samples, external consumers
// resolving from a stale published type) still get a runtime-checkable
// vocabulary — the boot-validator's validateActionHasIcon checks a declared
// icon against NAV_ICON_KEYS instead of trusting "not undefined".
export const NAV_ICON_KEYS = [
  "dashboard",
  "layout-grid",
  "book-open",
  "clipboard-list",
  "package",
  "gauge",
  "list",
  "table",
  "layers",
  "building",
  "calculator",
  "wallet",
  "coins",
  "credit-card",
  "piggy-bank",
  "receipt",
  "chart",
  "bar-chart",
  "trending",
  "sparkles",
  "wand",
  "calendar",
  "file",
  "folder",
  "folder-open",
  "home",
  "bell",
  "shield",
  "shield-check",
  "send",
  "settings",
  "users",
  "user",
  "search",
  "tag",
  "key",
  "link",
  "palette",
  "share",
  "server",
  "mail",
  "lock",
  "hash",
  "download",
  "upload",
  "rocket",
  "plus",
  "languages",
  "trash",
  "x",
  "check",
  "arrow-left",
  "arrow-right",
  "copy",
  "pencil",
  "eye",
  "eye-off",
  "filter",
  "refresh",
  "more-horizontal",
  "more-vertical",
  "external-link",
  "chevron-down",
  "chevron-right",
  "save",
  "undo",
  "archive",
  "star",
  "flag",
  "clock",
  "map-pin",
  "phone",
  "printer",
  "alert-triangle",
  "info",
  "check-circle",
  "x-circle",
  "loader",
  "mic",
  "circle-stop",
  "image",
] as const;

export type NavIconKey = (typeof NAV_ICON_KEYS)[number];

// Alias kept because the union stopped being nav-only — actions and fields
// (added on this branch) also key their icons against it.
export type IconKey = NavIconKey;
