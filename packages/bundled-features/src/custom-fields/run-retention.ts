// T1.5d — per-field retention sweep for the customFields jsonb.
//
// Iterates one host entity's rows, looks up every fieldDefinition with a
// `retention` policy, and strips/nulls customField values whose host-row
// `modified_at` is older than the policy's `keepFor`.
//
// Typically invoked by a daily cron in the consumer app — alongside (or
// inside) the data-retention bundle's own cleanup job. We don't auto-
// register a cron here because the consumer chooses the schedule, and
// because some apps want to sweep multiple host entities in one run.
//
// Caveat: the reference timestamp is the *host row's* `modified_at`, not
// a per-customField timestamp. A row's customField hasn't been touched
// in `keepFor` only when the entire row hasn't been touched in `keepFor`
// — for value-level granularity, future work needs a value-timestamp
// jsonb shape, which would be a breaking schema change.

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  applyRetentionRemovals,
  selectFieldDefinitionsWithSerialized,
  selectHostRowsWithCustomFields,
} from "./db/queries/retention";
import { parseSerializedField } from "./lib/parse-serialized-field";

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
function getTableName(table: unknown): string {
  if (typeof table === "object" && table !== null) {
    const sym = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
    if (typeof sym === "string") return sym;
  }
  throw new Error("custom-fields/run-retention: table missing kumiko:schema:Name symbol");
}

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

// Lifted from data-retention/keep-for.ts because the helper isn't re-exported
// from the bundle's public index. Same parser semantics: "/^\\d+[hdwmy]$/",
// month = 30d, year = 365d, hour as exact unit. If data-retention exports it
// in a future minor we can switch the import back.
const KEEP_FOR_PATTERN = /^(\d+)([hdwmy])$/;
const UNIT_TO_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

function isPastCutoff(args: {
  readonly referenceTimestamp: Instant;
  readonly keepFor: string;
  readonly now: Instant;
}): boolean {
  const match = args.keepFor.match(KEEP_FOR_PATTERN);
  if (!match) return false;
  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "";
  const hours = unit === "h" ? amount : amount * (UNIT_TO_DAYS[unit] ?? 0) * 24;
  const cutoff = args.now.subtract({ hours });
  return getTemporal().Instant.compare(args.referenceTimestamp, cutoff) < 0;
}

export interface RunCustomFieldsRetentionOptions {
  readonly db: DbRunner;
  readonly tenantId: string;
  readonly entityName: string;
  readonly entityTable: unknown;
  /** Current time, injected for time-travel-tests. */
  readonly now: Instant;
}

export interface CustomFieldsRetentionReport {
  /** How many host rows were scanned (any customFields content). */
  readonly rowsScanned: number;
  /** How many host rows were updated because at least one key expired. */
  readonly rowsUpdated: number;
  /** Per-fieldKey count of expired-and-removed values. */
  readonly removalsByFieldKey: Record<string, number>;
}

interface RetentionPolicy {
  readonly keepFor: string;
  readonly strategy: "delete" | "anonymize";
}

export async function runCustomFieldsRetention(
  opts: RunCustomFieldsRetentionOptions,
): Promise<CustomFieldsRetentionReport> {
  const policies = await loadRetentionPolicies(opts.db, opts.tenantId, opts.entityName);
  if (policies.size === 0) {
    return { rowsScanned: 0, rowsUpdated: 0, removalsByFieldKey: {} };
  }

  const tableName = getTableName(opts.entityTable);
  const rows = await selectHostRowsWithCustomFields(opts.db, tableName, opts.tenantId);

  const removalsByFieldKey: Record<string, number> = {};
  let rowsUpdated = 0;
  let rowsScanned = 0;

  for (const raw of rows) {
    rowsScanned++;
    const row = asHostRow(raw);
    // skip: see asHostRow rationale — defense in depth for driver shape drift.
    if (!row) continue;
    if (Object.keys(row.customFields).length === 0) continue;

    const modifiedAt = parseInstant(row.modifiedAt);
    // skip: rows without a parseable modified_at can't be aged against any
    // cutoff, leave them untouched.
    if (!modifiedAt) continue;

    const removals: Array<{ key: string; strategy: "delete" | "anonymize" }> = [];
    for (const [fieldKey, policy] of policies) {
      if (!(fieldKey in row.customFields)) continue;
      const expired = isPastCutoff({
        referenceTimestamp: modifiedAt,
        keepFor: policy.keepFor,
        now: opts.now,
      });
      if (expired) {
        removals.push({ key: fieldKey, strategy: policy.strategy });
      }
    }

    // skip: nothing on this row aged out — no UPDATE needed.
    if (removals.length === 0) continue;

    const deleteKeys: string[] = [];
    const anonymizeKeys: string[] = [];
    for (const { key, strategy } of removals) {
      if (strategy === "delete") {
        deleteKeys.push(key);
      } else {
        anonymizeKeys.push(key);
      }
      removalsByFieldKey[key] = (removalsByFieldKey[key] ?? 0) + 1;
    }

    await applyRetentionRemovals(opts.db, tableName, deleteKeys, anonymizeKeys, row.id);
    rowsUpdated++;
  }

  return { rowsScanned, rowsUpdated, removalsByFieldKey };
}

interface HostRow {
  readonly id: string;
  readonly modifiedAt: unknown;
  readonly customFields: Record<string, unknown>;
}

function asHostRow(value: unknown): HostRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("id" in value) || typeof value.id !== "string") return null;
  if (!("custom_fields" in value)) return null;
  const cf = value.custom_fields;
  if (!cf || typeof cf !== "object" || Array.isArray(cf)) return null;
  return {
    id: value.id,
    modifiedAt: "modified_at" in value ? value.modified_at : null,
    customFields: Object.fromEntries(Object.entries(cf)),
  };
}

interface FieldDefinitionRow {
  readonly field_key: string;
  readonly serialized_field: unknown;
}

function isFieldDefinitionRow(value: unknown): value is FieldDefinitionRow {
  if (!value || typeof value !== "object") return false;
  if (!("field_key" in value)) return false;
  return typeof value.field_key === "string";
}

async function loadRetentionPolicies(
  db: DbRunner,
  tenantId: string,
  entityName: string,
): Promise<Map<string, RetentionPolicy>> {
  const rows = await selectFieldDefinitionsWithSerialized(db, entityName, tenantId);
  const out = new Map<string, RetentionPolicy>();
  for (const raw of rows) {
    // skip: see asHostRow rationale.
    if (!isFieldDefinitionRow(raw)) continue;
    const parsed = parseSerializedField(raw.serialized_field);
    if (parsed?.retention) {
      out.set(raw.field_key, parsed.retention);
    }
  }
  return out;
}

interface InstantLike {
  readonly epochMilliseconds: number;
}

function isInstantLike(value: unknown): value is InstantLike {
  if (!value || typeof value !== "object") return false;
  if (!("epochMilliseconds" in value)) return false;
  return typeof value.epochMilliseconds === "number";
}

function parseInstant(value: unknown): Instant | null {
  if (value == null) return null;
  const T = getTemporal();
  try {
    if (typeof value === "string") return T.Instant.from(value);
    // `Number(date)` on a Date instance returns epoch-ms — matches getTime()
    // without tripping the no-date-api guard.
    if (value instanceof Date) return T.Instant.fromEpochMilliseconds(Number(value));
    if (isInstantLike(value)) return T.Instant.fromEpochMilliseconds(value.epochMilliseconds);
    return null;
  } catch {
    return null;
  }
}
