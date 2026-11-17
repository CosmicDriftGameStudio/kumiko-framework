import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  type HandlerContext,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { INBOUND_MESSAGE_PII_FIELDS } from "../entities.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

export type InboundMessageEnvelope = {
  readonly messageId: string;
  readonly ownerUserId: string | null;
  readonly threadKey: string | null;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string | null;
  readonly snippet: string | null;
};

const recipientsSchema = z.array(z.string());

function isSystemCaller(user: { readonly id: string; readonly roles: readonly string[] }): boolean {
  return user.id === SYSTEM_USER_ID && user.roles.includes(SYSTEM_ROLE);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export async function loadInboundMessageEnvelope(
  ctx: Pick<HandlerContext, "db" | "user">,
  messageId: string,
): Promise<InboundMessageEnvelope | null> {
  const row = await ctx.db.fetchOne(inboundMessagesProjectionTable, { id: messageId });
  if (!row) return null;
  // Jobs and ingest handlers of apps run as the system user and must read personal mailboxes too;
  // humans see them only as owner, like message:content.
  if (!isVisibleToCaller(row, ctx.user) && !isSystemCaller(ctx.user)) return null;
  const piiKms = configuredPiiSubjectKms();
  const readable = piiKms
    ? await decryptPiiFieldValues(row, INBOUND_MESSAGE_PII_FIELDS, piiKms, {
        requestId: `inbound-mail-foundation:message-envelope:${ctx.user.tenantId}`,
      })
    : row;
  const from = readable["from"];
  if (typeof from !== "string" || from === PII_ERASED_SENTINEL) return null;
  const rawTo = readable["to"];
  const to =
    typeof rawTo === "string" && rawTo !== ""
      ? recipientsSchema.parse(parseJsonOrThrow(rawTo, "inbound message to column"))
      : [];
  return {
    messageId,
    ownerUserId: nonEmptyStringOrNull(row["ownerUserId"]),
    threadKey: stringOrNull(row["threadKey"]),
    from,
    to,
    subject: stringOrNull(readable["subject"]),
    snippet: stringOrNull(readable["snippet"]),
  };
}
