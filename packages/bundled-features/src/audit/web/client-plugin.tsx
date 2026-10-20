import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { AuditEventCell, AuditObjectCell } from "./audit-event-cell.tsx";
import {
  AUDIT_EVENT_CELL_COMPONENT,
  AUDIT_FEATURE,
  AUDIT_OBJECT_CELL_COMPONENT,
} from "./constants.ts";
import { defaultTranslations } from "./default-translations.ts";

export type AuditClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function auditClient(options?: AuditClientOptions): ClientFeatureDefinition {
  return {
    name: AUDIT_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    columnRenderers: {
      [AUDIT_EVENT_CELL_COMPONENT]: AuditEventCell,
      [AUDIT_OBJECT_CELL_COMPONENT]: AuditObjectCell,
    },
  };
}
