import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  archiveLegacyStream,
  LEGACY_CONTACT_REPLY_ENTITY,
  LEGACY_CONTACT_REQUEST_ENTITY,
  type LegacyAggregate,
} from "./legacy-contact-streams.ts";
import { eraseNotesOnRequest } from "./user-data-hooks.ts";

const ERASE_REASON = "helpdesk:legacy-contact-forget";

export type LegacyEraser = {
  readonly db: TenantDb;
  readonly erasedBy: string;
  readonly purgeAttachments: (entity: string, id: string) => Promise<void>;
};

// Attachments first, then the record key, then the archive mark: until the stream is archived a
// retry still finds it.
export async function eraseLegacyAggregate(
  eraser: LegacyEraser,
  entity: string,
  id: string,
): Promise<void> {
  await eraser.purgeAttachments(entity, id);
  await configuredPiiSubjectKms()?.eraseKey(
    { kind: "record", entity, id },
    { requestId: ERASE_REASON, userId: eraser.erasedBy, eraseReason: ERASE_REASON },
  );
  await archiveLegacyStream(eraser.db, entity, id);
}

// Replies go with their request; notes hang on the request as host and go first, so a retry still
// finds the request.
export async function eraseLegacyRequest(
  eraser: LegacyEraser,
  request: LegacyAggregate,
  replies: readonly LegacyAggregate[],
): Promise<void> {
  await eraseNotesOnRequest(eraser, LEGACY_CONTACT_REQUEST_ENTITY, request.id, eraser.erasedBy);
  for (const reply of replies)
    await eraseLegacyAggregate(eraser, LEGACY_CONTACT_REPLY_ENTITY, reply.id);
  await eraseLegacyAggregate(eraser, LEGACY_CONTACT_REQUEST_ENTITY, request.id);
}
