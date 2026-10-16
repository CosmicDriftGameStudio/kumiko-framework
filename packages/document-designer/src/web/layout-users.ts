// @runtime client
import { DEFAULT_LAYOUT_SLUG } from "../constants.js";
import type { LayoutKind } from "./layout-types.js";
import type { OverviewRowView } from "./overview-row.js";

// Templates whose content is wrapped by this layout. A template without an explicit
// layoutSlug uses the default layout.
export function layoutUsers(
  rows: readonly OverviewRowView[],
  kind: LayoutKind,
  layoutSlug: string,
): readonly OverviewRowView[] {
  const documentKind = kind === "mail-layout" ? "mail" : "document-pdf";
  return rows.filter(
    (row) => row.kind === documentKind && (row.layoutSlug ?? DEFAULT_LAYOUT_SLUG) === layoutSlug,
  );
}
