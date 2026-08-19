// @runtime client
// Column-renderer for the /members screen's roles column — `roles` is a
// `readonly string[]` on TeamRow (see team-list.query.ts), and DataTable has
// no default array-to-cell formatting, so this joins it into one string.

import type { ColumnRendererProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export function MemberRolesCell({ row }: ColumnRendererProps): ReactNode {
  const roles = row["roles"];
  return Array.isArray(roles) ? roles.join(", ") : "";
}
