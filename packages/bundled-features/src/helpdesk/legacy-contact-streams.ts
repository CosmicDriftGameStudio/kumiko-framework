import {
  collectPiiEncryptedFields,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  archiveStream,
  isStreamArchived,
  streamAllEventsByType,
} from "@cosmicdrift/kumiko-framework/event-store";
import { systemTenantStreamRunner } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { helpdeskReplyEntity, helpdeskRequestEntity } from "./entity.ts";

// Data stored before the contact -> helpdesk rename stays under the old aggregate names. The old
// read tables are dropped in the apps, so the streams are folded straight from the event log.
export const LEGACY_CONTACT_REQUEST_ENTITY = "contact-request";
export const LEGACY_CONTACT_REPLY_ENTITY = "contact-reply";

const PII_DECRYPT_REASON = "helpdesk:legacy-contact-streams";
const ARCHIVED_BY = "helpdesk:legacy-contact";
export const LEGACY_ARCHIVE_REASON = "legacy contact data erased";

export type LegacyAggregate = {
  readonly id: string;
  // Plaintext after decryption; a field whose subject key is shredded holds PII_ERASED_SENTINEL.
  readonly fields: Readonly<Record<string, unknown>>;
  // True when a personal field could not be read, so the content is gone for good.
  readonly erased: boolean;
};

const PII_FIELDS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  [LEGACY_CONTACT_REQUEST_ENTITY]: collectPiiEncryptedFields(helpdeskRequestEntity),
  [LEGACY_CONTACT_REPLY_ENTITY]: collectPiiEncryptedFields(helpdeskReplyEntity),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readableFields(
  aggregateType: string,
  fields: Record<string, unknown>,
): Promise<LegacyAggregate["fields"]> {
  const piiFields = PII_FIELDS_BY_TYPE[aggregateType] ?? [];
  const kms = configuredPiiSubjectKms();
  if (kms === undefined) return fields;
  return decryptPiiFieldValues(fields, piiFields, kms, { requestId: PII_DECRYPT_REASON });
}

function hasUnreadablePersonalField(aggregateType: string, fields: LegacyAggregate["fields"]) {
  return (PII_FIELDS_BY_TYPE[aggregateType] ?? []).some((name) => {
    const value = fields[name];
    return value === PII_ERASED_SENTINEL || isPiiCiphertext(value);
  });
}

// Folds created and updated events per aggregate; a deleted or forgotten stream is gone for good.
// Archived streams are skipped, so an erased aggregate is never read again.
export async function readLegacyAggregates(
  db: TenantDb,
  aggregateType: string,
): Promise<readonly LegacyAggregate[]> {
  const runner = systemTenantStreamRunner(db);
  const folded = new Map<string, Record<string, unknown>>();
  const gone = new Set<string>();
  for await (const event of streamAllEventsByType(runner, aggregateType)) {
    const id = event.aggregateId;
    if (gone.has(id)) continue;
    switch (event.type) {
      case `${aggregateType}.created`:
        folded.set(id, { ...event.payload });
        break;
      case `${aggregateType}.updated`: {
        const current = folded.get(id);
        const changes = event.payload["changes"];
        if (current && isRecord(changes)) Object.assign(current, changes);
        break;
      }
      case `${aggregateType}.deleted`:
      case `${aggregateType}.forgotten`:
        folded.delete(id);
        gone.add(id);
        break;
    }
  }
  const aggregates: LegacyAggregate[] = [];
  for (const [id, raw] of folded) {
    if (await isStreamArchived(runner, SYSTEM_TENANT_ID, id)) continue;
    const fields = await readableFields(aggregateType, raw);
    aggregates.push({ id, fields, erased: hasUnreadablePersonalField(aggregateType, fields) });
  }
  return aggregates;
}

export async function archiveLegacyStream(
  db: TenantDb,
  aggregateType: string,
  aggregateId: string,
): Promise<void> {
  await archiveStream(systemTenantStreamRunner(db), {
    tenantId: SYSTEM_TENANT_ID,
    aggregateId,
    aggregateType,
    archivedBy: ARCHIVED_BY,
    reason: LEGACY_ARCHIVE_REASON,
  });
}

export function repliesOf(
  replies: readonly LegacyAggregate[],
  requestId: string,
): readonly LegacyAggregate[] {
  return replies.filter((reply) => reply.fields["requestId"] === requestId);
}
