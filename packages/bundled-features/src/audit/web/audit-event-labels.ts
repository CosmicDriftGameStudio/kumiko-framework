import type { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { AUDIT_EVENT_ACTIONS, type AuditEventAction } from "./constants.ts";

type Translate = ReturnType<typeof useTranslation>;

export function isAuditEventAction(value: unknown): value is AuditEventAction {
  return AUDIT_EVENT_ACTIONS.some((action) => action === value);
}

function humanizeEntityName(aggregateType: string): string {
  const spaced = aggregateType.replaceAll("-", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Singular entity noun: the entity's own `:noun` key, then the audit log's label for bundled entities, then the humanized aggregate type. */
export function auditEntityLabel(
  t: Translate,
  row: Readonly<Record<string, unknown>>,
): string | null {
  const aggregateType = row["aggregateType"];
  if (typeof aggregateType !== "string") return null;
  const nounKey = row["entityNounKey"];
  if (typeof nounKey === "string") {
    const noun = t(nounKey, { count: 1 });
    if (noun !== nounKey) return noun;
  }
  const bundledKey = `audit.log.entity.${aggregateType}`;
  const bundledLabel = t(bundledKey);
  return bundledLabel === bundledKey ? humanizeEntityName(aggregateType) : bundledLabel;
}
