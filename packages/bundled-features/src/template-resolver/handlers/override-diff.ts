import type { TemplateResourceRow } from "../table.js";
import { diffTemplateBlocks, splitTemplateBlocks } from "../template-diff.js";

function parseStoredMeta(raw: string | null): Readonly<Record<string, unknown>> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

function diffMeta(
  system: Readonly<Record<string, unknown>>,
  tenant: Readonly<Record<string, unknown>>,
) {
  const keys = [...new Set([...Object.keys(system), ...Object.keys(tenant)])].sort();
  return keys
    .filter((key) => JSON.stringify(system[key]) !== JSON.stringify(tenant[key]))
    .map((key) => ({ key, tenant: tenant[key], system: system[key] }));
}

// Shared by the tenant's own diff and the SystemAdmin's per-tenant diff in the overrides drawer.
export function buildOverrideDiff(tenantRow: TemplateResourceRow, systemRow: TemplateResourceRow) {
  const blocks = diffTemplateBlocks(
    splitTemplateBlocks(systemRow.content ?? "", systemRow.contentFormat),
    splitTemplateBlocks(tenantRow.content ?? "", tenantRow.contentFormat),
  );
  const meta = diffMeta(parseStoredMeta(systemRow.meta), parseStoredMeta(tenantRow.meta));
  return {
    tenant: {
      templateId: String(tenantRow.id),
      templateVersion: tenantRow.version,
      contentFormat: tenantRow.contentFormat,
    },
    system: {
      templateId: String(systemRow.id),
      templateVersion: systemRow.version,
      contentFormat: systemRow.contentFormat,
    },
    identical: meta.length === 0 && blocks.every((block) => block.change === "same"),
    blocks,
    meta,
  };
}
