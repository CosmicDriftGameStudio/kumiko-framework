// @runtime client
// Column-renderer for the /members screen's roles column — `roles` is a
// `readonly string[]` on TeamRow (see team-list.query.ts), and DataTable has
// no default array-to-cell formatting, so this joins it into one string.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { translateOrRaw } from "./translate-or-raw";

export function MemberRolesCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const roles = row["roles"];
  if (!Array.isArray(roles)) return "";
  return roles
    .map((role) =>
      typeof role === "string"
        ? translateOrRaw(t, `tenant:entity:__action-form__:field:roles:option:${role}`, role)
        : "",
    )
    .join(", ");
}
