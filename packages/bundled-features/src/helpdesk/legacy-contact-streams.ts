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
import {
  systemTenantReadRunner,
  systemTenantWriteRunner,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { helpdeskReplyEntity, helpdeskRequestEntity } from "./entity.ts";

// Data stored before the contact -> helpdesk rename stays under the old aggregate names. The old
// read tables are dropped in the apps, so the streams are folded straight from the event log.
export const LEGACY_CONTACT_REQUEST_ENTITY = "contact-request";
export const LEGACY_CONTACT_REPLY_ENTITY = "contact-reply";

const PII_DECRYPT_REASON = "helpdesk:legacy-contact-streams";
const ARCHIVED_BY = "helpdesk:legacy-contact";
const ARCHIVE_WRITE_REASON =
  "archives the legacy contact streams of an erased subject in the system tenant";
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
  onlyFields?: readonly string[],
): Promise<LegacyAggregate["fields"]> {
  const piiFields = PII_FIELDS_BY_TYPE[aggregateType] ?? [];
  const kms = configuredPiiSubjectKms();
  if (kms === undefined) return fields;
  return decryptPiiFieldValues(
    fields,
    onlyFields ? piiFields.filter((name) => onlyFields.includes(name)) : piiFields,
    kms,
    { requestId: PII_DECRYPT_REASON },
  );
}

function hasUnreadablePersonalField(aggregateType: string, fields: LegacyAggregate["fields"]) {
  return (PII_FIELDS_BY_TYPE[aggregateType] ?? []).some((name) => {
    const value = fields[name];
    return value === PII_ERASED_SENTINEL || isPiiCiphertext(value);
  });
}

type RawFields = Record<string, unknown>;

// Folds created and updated events per aggregate; a deleted or forgotten stream is gone for good.
async function foldLegacyStreams(
  runner: ReturnType<typeof systemTenantReadRunner>,
  aggregateType: string,
): Promise<Map<string, RawFields>> {
  const folded = new Map<string, RawFields>();
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
  return folded;
}

export type LegacyReadOptions = {
  // Retention compares plaintext timestamps only, so it skips the KMS round trips.
  readonly decrypt?: boolean;
  // Narrows by plaintext fields before any archive lookup or decryption.
  readonly isCandidate?: (raw: Readonly<Record<string, unknown>>) => boolean;
};

// Archived streams are skipped, so an erased aggregate is never read again. The archive lookup
// is per aggregate (the framework has no bulk query for it), after the candidate filter.
export async function readLegacyAggregates(
  db: TenantDb,
  aggregateType: string,
  options: LegacyReadOptions = {},
): Promise<readonly LegacyAggregate[]> {
  const runner = systemTenantReadRunner(db);
  const aggregates: LegacyAggregate[] = [];
  for (const [id, raw] of await foldLegacyStreams(runner, aggregateType)) {
    if (options.isCandidate && !options.isCandidate(raw)) continue;
    if (await isStreamArchived(runner, SYSTEM_TENANT_ID, id)) continue;
    if (options.decrypt === false) {
      aggregates.push({ id, fields: raw, erased: false });
      continue;
    }
    const fields = await readableFields(aggregateType, raw);
    aggregates.push({ id, fields, erased: hasUnreadablePersonalField(aggregateType, fields) });
  }
  return aggregates;
}

// A signed-in request carries the plaintext user id; an anonymous one is matched by the email,
// which is the only field decrypted for the rest. Only the matches are fully decrypted.
export async function findLegacyRequestsOfSubject(
  db: TenantDb,
  subject: { readonly userId: string; readonly email: string | undefined },
): Promise<readonly LegacyAggregate[]> {
  const runner = systemTenantReadRunner(db);
  const matches: LegacyAggregate[] = [];
  for (const [id, raw] of await foldLegacyStreams(runner, LEGACY_CONTACT_REQUEST_ENTITY)) {
    if (!(await isSubjectRequest(raw, subject))) continue;
    if (await isStreamArchived(runner, SYSTEM_TENANT_ID, id)) continue;
    const fields = await readableFields(LEGACY_CONTACT_REQUEST_ENTITY, raw);
    matches.push({
      id,
      fields,
      erased: hasUnreadablePersonalField(LEGACY_CONTACT_REQUEST_ENTITY, fields),
    });
  }
  return matches;
}

async function isSubjectRequest(
  raw: RawFields,
  subject: { readonly userId: string; readonly email: string | undefined },
): Promise<boolean> {
  if (raw["reporterUserId"] === subject.userId) return true;
  if (subject.email === undefined) return false;
  const { email } = await readableFields(LEGACY_CONTACT_REQUEST_ENTITY, { email: raw["email"] }, [
    "email",
  ]);
  return typeof email === "string" && email.toLowerCase() === subject.email;
}

export async function archiveLegacyStream(
  db: TenantDb,
  aggregateType: string,
  aggregateId: string,
): Promise<void> {
  await archiveStream(systemTenantWriteRunner(db, ARCHIVE_WRITE_REASON), {
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
