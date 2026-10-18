// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  MEMBER_ROLES_CELL_COMPONENT,
  MEMBER_STATUS_CELL_COMPONENT,
  TENANT_FEATURE,
} from "../constants.ts";
import { MemberRolesCell } from "./member-roles-cell.tsx";
import { MemberStatusCell } from "./member-status-cell.tsx";

export type TenantClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function tenantClient(options?: TenantClientOptions): ClientFeatureDefinition {
  return {
    name: TENANT_FEATURE,
    translations: mergeTranslations({}, options?.translations ?? {}),
    columnRenderers: {
      [MEMBER_STATUS_CELL_COMPONENT]: MemberStatusCell,
      [MEMBER_ROLES_CELL_COMPONENT]: MemberRolesCell,
    },
  };
}
