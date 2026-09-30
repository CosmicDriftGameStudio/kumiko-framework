// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  MEMBER_ROLES_CELL_COMPONENT,
  MEMBER_STATUS_CELL_COMPONENT,
  TENANT_FEATURE,
} from "../constants.js";
import { MemberRolesCell } from "./member-roles-cell.js";
import { MemberStatusCell } from "./member-status-cell.js";

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
