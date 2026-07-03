// One-time backfill for pre-KMS plaintext PII in kumiko_events (#799).
//
// Crypto-shredding (#724/#818) only covers NEW writes — events appended
// before a KMS was configured still carry plaintext (user.created email,
// delivery attempt recipientAddress, job payloads). This tool re-encrypts
// them in place, per field, under the owning subject's DEK:
//
//   - entity lifecycle events (<entity>.created/updated/deleted/forgotten/
//     restored) for every entity with PII subject annotations
//   - custom events from the event-PII catalog (r.defineEvent piiFields)
//
// Already-forgotten subjects must NOT get a fresh key minted for their old
// plaintext — three erased-detection layers write [[erased]] instead:
//   1. KeyErasedError from the KMS (subject forgotten in the KMS era)
//   2. the event's own aggregate has a *.forgotten event (pre-KMS forget)
//   3. the resolved user subject's id has a *.forgotten event (custom
//      events referencing a pre-KMS-forgotten user)
//
// Idempotent: ciphertext and sentinel values pass through untouched — a
// second run reports 0 updates. One failing event does not abort the run;
// failures are collected and reported (fail-loud at the caller).
//
// Snapshots of touched aggregates are dropped (they may cache plaintext);
// the next snapshotting load recreates them. AFTER a run, rebuild the
// affected projections — applyEntityEvent materializes ciphertext AND the
// blind-index columns, which keeps equality lookups (login by email) alive.

import { asRawClient } from "../bun-db";
import { configuredEventPiiCatalog } from "../crypto/event-pii";
import type { KmsContext, LocalKeyKmsAdapter, SubjectId } from "../crypto/kms-adapter";
import { KeyErasedError } from "../crypto/kms-adapter";
import {
  configuredPiiSubjectKms,
  encryptPiiValueForSubject,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "../crypto/pii-field-encryption";
import { collectPiiSubjectFields, resolveSubjectForField } from "../crypto/subject-resolver";
import type { DbRunner } from "../db/connection";
import type { EntityDefinition, Registry, TenantId } from "../engine/types";

const LIFECYCLE_VERBS = ["created", "updated", "deleted", "restored", "forgotten"] as const;

export type PiiBackfillFailure = {
  readonly eventId: string;
  readonly reason: string;
};

export type PiiBackfillResult = {
  readonly scannedEvents: number;
  readonly updatedEvents: number;
  readonly encryptedFields: number;
  readonly erasedFields: number;
  readonly deletedSnapshots: number;
  readonly failures: readonly PiiBackfillFailure[];
};

export type PiiBackfillOptions = {
  readonly batchSize?: number;
  // Scan + count only, write nothing.
  readonly dryRun?: boolean;
};

type EventRow = {
  readonly id: bigint | string;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

type FieldOutcome = "unchanged" | "encrypted" | "erased";

export async function backfillEventPiiEncryption(
  db: DbRunner,
  registry: Registry,
  options: PiiBackfillOptions = {},
): Promise<PiiBackfillResult> {
  const kms = configuredPiiSubjectKms();
  if (!kms) {
    throw new Error(
      "backfillEventPiiEncryption requires a configured subject KMS — boot with " +
        "runProdApp({ kms }) / configurePiiSubjectKms(adapter) before running the backfill.",
    );
  }
  const batchSize = options.batchSize ?? 500;
  const raw = asRawClient(db);
  const kmsCtx: KmsContext = { requestId: "pii-backfill" };

  const entityTargets = new Map<
    string,
    { readonly entity: EntityDefinition; readonly piiFields: readonly string[] }
  >();
  for (const [name, entity] of registry.getAllEntities()) {
    const piiFields = collectPiiSubjectFields(entity);
    if (piiFields.length > 0) entityTargets.set(name, { entity, piiFields });
  }
  const eventCatalog = configuredEventPiiCatalog();

  const aggregateTypes = [...entityTargets.keys()];
  const catalogTypes = [...eventCatalog.keys()];
  const result = {
    scannedEvents: 0,
    updatedEvents: 0,
    encryptedFields: 0,
    erasedFields: 0,
    deletedSnapshots: 0,
    failures: [] as PiiBackfillFailure[],
  };
  if (aggregateTypes.length === 0 && catalogTypes.length === 0) return result;

  // Pre-KMS forgets left no key tombstone — the *.forgotten event on the
  // stream is the only durable marker. Collect once; aggregate_id doubles
  // as the user id for user-subject lookups.
  const forgottenRows = (await raw.unsafe(
    `SELECT DISTINCT "aggregate_id" FROM "kumiko_events" WHERE "type" LIKE '%.forgotten'`,
  )) as ReadonlyArray<{ aggregate_id: string }>;
  const forgottenAggregates = new Set(forgottenRows.map((r) => r.aggregate_id));

  const touchedAggregates = new Set<string>();
  let cursor = "0";

  for (;;) {
    const rows = (await raw.unsafe(
      `SELECT "id", "aggregate_id", "aggregate_type", "tenant_id", "type", "payload"
         FROM "kumiko_events"
        WHERE ("aggregate_type" = ANY($1::text[]) OR "type" = ANY($2::text[])) AND "id" > $3::bigint
        ORDER BY "id" ASC
        LIMIT $4`,
      [aggregateTypes, catalogTypes, cursor, batchSize],
    )) as ReadonlyArray<EventRow>;
    if (rows.length === 0) break;

    for (const row of rows) {
      result.scannedEvents++;
      try {
        const outcome = await transformEvent(row);
        if (outcome === null) continue;
        result.encryptedFields += outcome.encrypted;
        result.erasedFields += outcome.erased;
        if (!options.dryRun) {
          await raw.unsafe(`UPDATE "kumiko_events" SET "payload" = $1::jsonb WHERE "id" = $2`, [
            JSON.stringify(outcome.payload),
            row.id,
          ]);
        }
        result.updatedEvents++;
        touchedAggregates.add(row.aggregate_id);
      } catch (e) {
        result.failures.push({
          eventId: String(row.id),
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const last = rows[rows.length - 1];
    if (last === undefined) break;
    cursor = String(last.id);
  }

  // Snapshots may cache the plaintext state of touched aggregates.
  if (!options.dryRun && touchedAggregates.size > 0) {
    const deleted = (await raw.unsafe(
      `DELETE FROM "kumiko_snapshots" WHERE "aggregate_id" = ANY($1::uuid[]) RETURNING "aggregate_id"`,
      [[...touchedAggregates]],
    )) as ReadonlyArray<unknown>;
    result.deletedSnapshots = deleted.length;
  }

  return result;

  async function transformEvent(
    row: EventRow,
  ): Promise<{ payload: Record<string, unknown>; encrypted: number; erased: number } | null> {
    const counters = { encrypted: 0, erased: 0 };
    const payload = structuredClone(row.payload);

    const catalogFields = eventCatalog.get(row.type);
    if (catalogFields) {
      for (const [field, spec] of Object.entries(catalogFields)) {
        const subjectId = payload[spec.subjectField];
        if (typeof subjectId !== "string" || subjectId.length === 0) continue;
        const outcome = await encryptField(payload, field, { kind: "user", userId: subjectId });
        bump(outcome);
      }
    } else {
      const target = entityTargets.get(row.aggregate_type);
      if (!target || !isLifecycleEventOf(row.type, row.aggregate_type)) return null;
      const sections = lifecycleSections(payload);
      for (const section of sections) {
        // Update-changes may carry a pii field without its owner field —
        // resolve subjects from the merged view; aggregate_id backs the
        // self-subject when a section lacks the id column.
        const subjectSource: Record<string, unknown> = {
          id: row.aggregate_id,
          ...Object.assign({}, ...sections),
          ...section,
        };
        for (const field of target.piiFields) {
          const subject = resolveSubjectForField(target.entity, field, subjectSource, {
            // @cast-boundary db-read — tenant_id column is the branded TenantId
            tenantId: row.tenant_id as TenantId,
          });
          if (subject === null) continue;
          const outcome = await encryptField(section, field, subject);
          bump(outcome);
        }
      }
    }

    if (counters.encrypted === 0 && counters.erased === 0) return null;
    return { payload, ...counters };

    function bump(outcome: FieldOutcome): void {
      if (outcome === "encrypted") counters.encrypted++;
      if (outcome === "erased") counters.erased++;
    }

    async function encryptField(
      section: Record<string, unknown>,
      field: string,
      subject: SubjectId,
    ): Promise<FieldOutcome> {
      const value = section[field];
      if (value === null || value === undefined) return "unchanged";
      if (typeof value !== "string") return "unchanged";
      if (isPiiCiphertext(value) || value === PII_ERASED_SENTINEL) return "unchanged";
      if (isForgottenSubject(subject, row.aggregate_id)) {
        section[field] = PII_ERASED_SENTINEL;
        return "erased";
      }
      try {
        section[field] = await encryptPiiValueForSubject(
          kms as LocalKeyKmsAdapter,
          subject,
          value,
          kmsCtx,
        );
        return "encrypted";
      } catch (e) {
        if (e instanceof KeyErasedError) {
          section[field] = PII_ERASED_SENTINEL;
          return "erased";
        }
        throw e;
      }
    }
  }

  function isForgottenSubject(subject: SubjectId, aggregateId: string): boolean {
    if (forgottenAggregates.has(aggregateId)) return true;
    return subject.kind === "user" && forgottenAggregates.has(subject.userId);
  }
}

function isLifecycleEventOf(eventType: string, aggregateType: string): boolean {
  if (!eventType.startsWith(`${aggregateType}.`)) return false;
  const verb = eventType.slice(aggregateType.length + 1);
  return (LIFECYCLE_VERBS as readonly string[]).includes(verb);
}

// created events carry the fields flat; updated carries { changes, previous };
// deleted/forgotten/restored carry { previous }. Returned sections are the
// mutable objects INSIDE the payload clone — encryptField writes in place.
function lifecycleSections(payload: Record<string, unknown>): Record<string, unknown>[] {
  const sections: Record<string, unknown>[] = [];
  if (isRecord(payload["changes"])) sections.push(payload["changes"]);
  if (isRecord(payload["previous"])) sections.push(payload["previous"]);
  if (sections.length === 0) sections.push(payload);
  return sections;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
