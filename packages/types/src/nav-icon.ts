// Closed vocabulary of nav icon keys. NavDefinition.icon, ScreenNavSugar.icon
// and ConfigMask.icon are all typed against this union, so an unregistered
// key is a compile error at the r.nav()/r.screen()/config-mask call site
// instead of a silent missing-icon at runtime.
//
// The renderer-web NAV_ICONS map (packages/renderer-web/src/layout/
// nav-tree.tsx) is checked against this same union via `satisfies`, so the
// two can't drift — add a key here only together with its lucide-react entry
// there, and vice versa.
export type NavIconKey =
  | "dashboard"
  | "layout-grid"
  | "book-open"
  | "clipboard-list"
  | "package"
  | "gauge"
  | "list"
  | "table"
  | "layers"
  | "building"
  | "calculator"
  | "wallet"
  | "coins"
  | "credit-card"
  | "piggy-bank"
  | "receipt"
  | "chart"
  | "bar-chart"
  | "trending"
  | "sparkles"
  | "wand"
  | "calendar"
  | "file"
  | "folder"
  | "folder-open"
  | "home"
  | "bell"
  | "shield"
  | "settings"
  | "users"
  | "user"
  | "search"
  | "tag"
  | "key"
  | "link"
  | "palette"
  | "share"
  | "server"
  | "mail"
  | "lock"
  | "hash"
  | "download"
  | "upload"
  | "rocket"
  | "plus"
  | "languages";
