import { deleteFileRefBytes } from "@cosmicdrift/kumiko-framework/derivatives";
import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { computeCutoff } from "../data-retention/index.ts";
import { eraseLegacyAggregate, eraseLegacyRequest } from "./legacy-contact-erasure.ts";
import {
  LEGACY_CONTACT_REPLY_ENTITY,
  LEGACY_CONTACT_REQUEST_ENTITY,
  type LegacyAggregate,
  readLegacyAggregates,
  repliesOf,
} from "./legacy-contact-streams.ts";
import { purgeAttachmentsWith } from "./user-data-hooks.ts";

const RETENTION_CONTEXT = "helpdesk:legacy-contact-retention";

function isOlderThan(
  aggregate: LegacyAggregate,
  referenceField: string,
  cutoff: ReturnType<typeof computeCutoff>,
): boolean {
  const reference = aggregate.fields[referenceField];
  if (typeof reference !== "string") return false;
  return getTemporal().Instant.compare(getTemporal().Instant.from(reference), cutoff) < 0;
}

// The helpdesk entities' retention cron only sees the live tables; the pre-rename streams have none,
// so the same keepFor is enforced on the event log.
export async function runLegacyContactRetention(keepFor: string, ctx: JobContext): Promise<void> {
  const cutoff = computeCutoff(keepFor, ctx.tz.now());
  const eraser = {
    db: ctx.db,
    erasedBy: ctx.systemUser.id,
    purgeAttachments: (entity: string, id: string) =>
      purgeAttachmentsWith(ctx, entity, id, async () => {
        const files = ctx.services.files;
        if (!files) {
          throw new InternalError({
            message: `[${RETENTION_CONTEXT}] no file storage resolvable, attachments of ${entity} ${id} cannot be erased`,
          });
        }
        return (storageKey) => deleteFileRefBytes(files, { storageKey }, RETENTION_CONTEXT);
      }),
  };
  const requests = await readLegacyAggregates(ctx.db, LEGACY_CONTACT_REQUEST_ENTITY, {
    decrypt: false,
  });
  const replies = await readLegacyAggregates(ctx.db, LEGACY_CONTACT_REPLY_ENTITY, {
    decrypt: false,
  });
  const erasedRequestIds = new Set<string>();
  for (const request of requests) {
    if (!isOlderThan(request, "submittedAt", cutoff)) continue;
    await eraseLegacyRequest(eraser, request, repliesOf(replies, request.id));
    erasedRequestIds.add(request.id);
  }
  for (const reply of replies) {
    const requestId = reply.fields["requestId"];
    if (typeof requestId === "string" && erasedRequestIds.has(requestId)) continue;
    if (isOlderThan(reply, "sentAt", cutoff)) {
      await eraseLegacyAggregate(eraser, LEGACY_CONTACT_REPLY_ENTITY, reply.id);
    }
  }
}
