import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createTenantDb,
  selectMany,
  table,
  text as textColumn,
  timestamp,
  transaction,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { DbConnection } from "@cosmicdrift/kumiko-types/db-connection";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { WAITLIST_STATUS, type WaitlistStatus } from "./constants.ts";
import { importWaitlistEntry, type WaitlistImportEntry } from "./import.ts";

export const LEGACY_WAITLIST_SOURCES = ["offlot", "publicstatus"] as const;
export type LegacyWaitlistSource = (typeof LEGACY_WAITLIST_SOURCES)[number];

export function isLegacyWaitlistSource(value: string | undefined): value is LegacyWaitlistSource {
  return LEGACY_WAITLIST_SOURCES.some((known) => known === value);
}

export const DEFAULT_LEGACY_SOURCE_TABLE: Readonly<Record<LegacyWaitlistSource, string>> = {
  offlot: "read_waitlist_entries",
  publicstatus: "marketing_waitlist",
};

export const DEFAULT_IMPORT_LOCALE = "en";

export type LegacyWaitlistMigrateOptions = {
  readonly from: LegacyWaitlistSource;
  readonly dryRun: boolean;
  readonly sourceTable: string;
  /** publicstatus rows carry no language; every imported entry gets this one. */
  readonly defaultLocale: string;
};

export type LegacyWaitlistMigrateReport = {
  readonly read: number;
  readonly created: number;
  readonly skipped: number;
  readonly unreadable: number;
};

type LegacyRow = Readonly<Record<string, unknown>>;

function toInstant(value: unknown): Temporal.Instant | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Temporal.Instant) return value;
  if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(Number(value));
  if (typeof value !== "string") return undefined;
  try {
    return Temporal.Instant.from(value);
  } catch {
    // Temporal.Instant.from throws RangeError for a non-ISO string.
    return undefined;
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isWaitlistStatus(value: string | undefined): value is WaitlistStatus {
  return Object.values(WAITLIST_STATUS).some((known) => known === value);
}

// Legacy offlot rows may hold subject ciphertext; decryption is self-describing and
// needs the same KMS the app ran with. Without it the value cannot be read, so the
// caller counts the row as unreadable instead of importing ciphertext as the name.
async function readPii(value: unknown, field: string): Promise<string | undefined> {
  const raw = nonEmpty(value);
  if (raw === undefined || !isPiiCiphertext(raw)) return raw;
  const kms = configuredPiiSubjectKms();
  if (!kms) return undefined;
  const decrypted = await decryptPiiFieldValues({ [field]: raw }, [field], kms, {
    requestId: "waitlist-migrate",
  });
  const plain = decrypted[field];
  return typeof plain === "string" && plain !== PII_ERASED_SENTINEL ? plain : undefined;
}

// Source columns without a FW counterpart (city, stock, country, notes) are kept
// as labelled lines in `message`, so no information is lost.
function offlotMessage(row: LegacyRow): string | undefined {
  const lines = [
    ["City", nonEmpty(row["city"])],
    ["Stock", nonEmpty(row["stock"])],
    ["Country", nonEmpty(row["country"])],
    ["Notes", nonEmpty(row["notes"])],
  ].flatMap(([label, value]) => (value === undefined ? [] : [`${label}: ${value}`]));
  return lines.length === 0 ? undefined : lines.join("\n");
}

export async function mapOfflotRow(row: LegacyRow): Promise<WaitlistImportEntry | undefined> {
  const id = nonEmpty(row["id"]);
  const name = await readPii(row["name"], "name");
  const email = await readPii(row["email"], "email");
  const submittedAt = toInstant(row["submittedAt"]);
  const status = nonEmpty(row["status"]);
  if (!id || !name || !email || !submittedAt || !isWaitlistStatus(status)) return undefined;
  const company = nonEmpty(row["dealership"]);
  const message = offlotMessage(row);
  const invitedAt = toInstant(row["invitedAt"]);
  const provisionedAt = toInstant(row["provisionedAt"]);
  const invitedBy = nonEmpty(row["invitedBy"]);
  const linkedTenantId = nonEmpty(row["linkedTenantId"]);
  return {
    sourceKey: `offlot:${id}`,
    name,
    email,
    locale: nonEmpty(row["locale"]) ?? DEFAULT_IMPORT_LOCALE,
    status,
    submittedAt,
    ...(company !== undefined && { company }),
    ...(message !== undefined && { message }),
    ...(invitedAt !== undefined && { invitedAt }),
    ...(invitedBy !== undefined && { invitedBy }),
    ...(provisionedAt !== undefined && { provisionedAt }),
    ...(linkedTenantId !== undefined && { linkedTenantId }),
  };
}

export function mapPublicstatusRow(
  row: LegacyRow,
  defaultLocale: string,
): WaitlistImportEntry | undefined {
  const id = nonEmpty(row["id"]);
  const email = nonEmpty(row["email"]);
  const submittedAt = toInstant(row["createdAt"]);
  if (!id || !email || !submittedAt) return undefined;
  return {
    sourceKey: `publicstatus:${id}`,
    // The apex form only asked for an address; the FW entry requires a name.
    name: email.split("@")[0] ?? email,
    email,
    locale: defaultLocale,
    status: WAITLIST_STATUS.Pending,
    submittedAt,
  };
}

export function publicstatusLegacyTable(sourceTable: string) {
  return table(sourceTable, {
    id: uuid("id").primaryKey(),
    email: textColumn("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  });
}

export function offlotLegacyTable(sourceTable: string) {
  return table(sourceTable, {
    id: uuid("id").primaryKey(),
    name: textColumn("name").notNull(),
    email: textColumn("email").notNull(),
    dealership: textColumn("dealership"),
    city: textColumn("city"),
    stock: textColumn("stock"),
    country: textColumn("country"),
    locale: textColumn("locale").notNull(),
    status: textColumn("status").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    invitedBy: textColumn("invited_by"),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    linkedTenantId: textColumn("linked_tenant_id"),
    notes: textColumn("notes"),
  });
}

async function readLegacyRows(
  db: DbConnection,
  from: LegacyWaitlistSource,
  sourceTable: string,
): Promise<readonly LegacyRow[]> {
  if (from === "publicstatus") {
    return await selectMany<LegacyRow>(db, publicstatusLegacyTable(sourceTable), undefined, {
      orderBy: { col: "createdAt", direction: "asc" },
    });
  }
  return await selectMany<LegacyRow>(db, offlotLegacyTable(sourceTable), undefined, {
    orderBy: { col: "submittedAt", direction: "asc" },
  });
}

// Idempotent: the new entry id derives from the source row id, so a re-run finds
// what an earlier run wrote and skips it. Writes go through the waitlist entity
// executor (events, projection, subject encryption), never into tables directly.
export async function migrateLegacyWaitlist(
  db: DbConnection,
  options: LegacyWaitlistMigrateOptions,
): Promise<LegacyWaitlistMigrateReport> {
  const rows = await readLegacyRows(db, options.from, options.sourceTable);
  let created = 0;
  let skipped = 0;
  let unreadable = 0;
  for (const row of rows) {
    const entry =
      options.from === "offlot"
        ? await mapOfflotRow(row)
        : mapPublicstatusRow(row, options.defaultLocale);
    if (!entry) {
      unreadable += 1;
      continue;
    }
    await transaction(db, async (tx) => {
      const tenantDb = createTenantDb({ db: tx, tenantId: SYSTEM_TENANT_ID, mode: "system" });
      const outcome = await importWaitlistEntry(tenantDb, entry, { dryRun: options.dryRun });
      if (outcome === "created") created += 1;
      else skipped += 1;
    });
  }
  return { read: rows.length, created, skipped, unreadable };
}
