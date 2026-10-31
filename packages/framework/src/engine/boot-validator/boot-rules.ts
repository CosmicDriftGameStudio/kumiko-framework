import { API_EXT_RULES } from "./api-ext-rules.ts";
import { BOOT_CHECK_RULES } from "./boot-check-rules.ts";
import type { BootRule } from "./boot-rule.ts";
import { CARD_META_OVERFLOW_RULES } from "./card-meta-overflow-rules.ts";
import { ENTITY_LIST_RULES } from "./entity-list-screens-rules.ts";
import { I18N_RULES } from "./i18n-keys-rules.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";
import { PII_RULES } from "./pii-retention-rules.ts";
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
] as const;

export const FRAMEWORK_BOOT_RULES: readonly BootRule[] = FRAMEWORK_BOOT_RULE_TABLES.flatMap(
  (table) => Object.values<BootRule>(table),
);
