import { AGENT_EFFECT_RULES } from "./agent-effect-rules.ts";
import { API_EXT_RULES } from "./api-ext-rules.ts";
import { BOOT_CHECK_RULES } from "./boot-check-rules.ts";
import { BOOT_ENVIRONMENT_RULES } from "./boot-environment-rules.ts";
import type { BootRule } from "./boot-rule.ts";
import { CARD_META_OVERFLOW_RULES } from "./card-meta-overflow-rules.ts";
import { CONFIG_KEY_RULES } from "./config-key-rules.ts";
import { DERIVED_SQL_FIELD_RULES } from "./derived-sql-fields-rules.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";
import { HANDLER_ACCESS_RULES } from "./entity-handler-access-rules.ts";
import { ENTITY_LIST_RULES } from "./entity-list-screens-rules.ts";
import { ENTITY_REFERENCE_EMBEDDED_RULES } from "./entity-reference-embedded-rules.ts";
import { ENTITY_SELECT_IMAGE_RULES } from "./entity-select-image-rules.ts";
import { ENTITY_STRUCTURE_RULES } from "./entity-structure-rules.ts";
import { FIELD_CONDITION_RULES } from "./field-conditions-rules.ts";
import { FORM_DERIVATION_RULES } from "./form-derivations-rules.ts";
import { HANDLER_DECLARATION_RULES } from "./handler-declaration-rules.ts";
import { HANDLER_FIELD_REFERENCE_RULES } from "./handler-field-references-rules.ts";
import { I18N_RULES } from "./i18n-keys-rules.ts";
import { LIST_BULK_ACTION_RULES } from "./list-bulk-actions-rules.ts";
import { LIST_QUERY_RULES } from "./list-query-rules.ts";
import { LIST_TABLE_AGGREGATE_RULES } from "./list-table-aggregate-rules.ts";
import { LIST_TABLE_RULES } from "./list-table-rules.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";
import { NAV_RULES } from "./nav-rules.ts";
import { OWNERSHIP_RULES } from "./ownership-rules.ts";
import { PII_RULES } from "./pii-retention-rules.ts";
import { QUERY_RULES } from "./query-rules.ts";
import { SCREEN_ACTION_RULES } from "./screens-actions-rules.ts";
import { DASHBOARD_CHART_RULES } from "./screens-dashboard-chart-rules.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";
import { FORM_LAYOUT_RULES } from "./screens-forms-layout-rules.ts";
import { FORM_FIELD_RULES } from "./screens-forms-rules.ts";
import { PROJECTION_DETAIL_RULES } from "./screens-kind-projection-detail-rules.ts";
import { SCREEN_KIND_RULES } from "./screens-kind-rules.ts";
import { LIST_SCREEN_RULES } from "./screens-lists-rules.ts";
import { SCREEN_RULES } from "./screens-rules.ts";

export const FRAMEWORK_BOOT_RULE_TABLES = [
  PII_RULES,
  ENTITY_LIST_RULES,
  NAMED_FILTER_RULES,
  I18N_RULES,
  CARD_META_OVERFLOW_RULES,
  SCREEN_ACTION_RULES,
  API_EXT_RULES,
  BOOT_CHECK_RULES,
  DASHBOARD_RULES,
  DASHBOARD_CHART_RULES,
  FORM_FIELD_RULES,
  FORM_LAYOUT_RULES,
  LIST_SCREEN_RULES,
  SCREEN_KIND_RULES,
  PROJECTION_DETAIL_RULES,
  SCREEN_RULES,
  DERIVED_SQL_FIELD_RULES,
  HANDLER_ACCESS_RULES,
  ENTITY_REFERENCE_EMBEDDED_RULES,
  ENTITY_SELECT_IMAGE_RULES,
  ENTITY_STRUCTURE_RULES,
  FIELD_CONDITION_RULES,
  FORM_DERIVATION_RULES,
  HANDLER_FIELD_REFERENCE_RULES,
  LIST_TABLE_RULES,
  LIST_TABLE_AGGREGATE_RULES,
  LIST_QUERY_RULES,
  LIST_BULK_ACTION_RULES,
  QUERY_RULES,
  BOOT_ENVIRONMENT_RULES,
  CONFIG_KEY_RULES,
  ENTITY_DECLARATION_RULES,
  HANDLER_DECLARATION_RULES,
  NAV_RULES,
  OWNERSHIP_RULES,
  AGENT_EFFECT_RULES,
] as const;

export const FRAMEWORK_BOOT_RULES: readonly BootRule[] = FRAMEWORK_BOOT_RULE_TABLES.flatMap(
  (table) => Object.values<BootRule>(table),
);
