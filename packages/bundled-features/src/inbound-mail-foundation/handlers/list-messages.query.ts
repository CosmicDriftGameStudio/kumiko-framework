// list-messages — tenant-scoped message list for the inbox cockpit.
// Optional filters: accountId (one mailbox), threadKey (one conversation),
// scope (folder hint). PII (from/to/cc/subject/snippet) is decrypted on read;
// to/cc remain JSON-stringified strings, which the client parses as documented
// in the event payload.
//
// Pages newest first (receivedAt, then id, both descending) with a keyset cursor, so a page reads and decrypts at most `limit` visible rows instead of the whole tenant.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { isUuid, MAX_LIST_LIMIT, type QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { INBOUND_MESSAGE_PII_FIELDS, inboundMessageEntity } from "../entities.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

// The full text and HTML are delivered only by message:content; selecting them here would decrypt
// every body of the list, the HTML at up to its event cap per row.
const LIST_EXCLUDED_BODY_FIELDS: ReadonlySet<string> = new Set(["bodyText", "bodyHtml"]);
const LIST_MESSAGE_COLUMNS = [
  "id",
  "tenantId",
  "version",
  "insertedAt",
  "modifiedAt",
  "insertedById",
  "modifiedById",
  ...Object.keys(inboundMessageEntity.fields).filter(
    (name) => !LIST_EXCLUDED_BODY_FIELDS.has(name),
  ),
];

const listMessagesSchema = z
  .object({
    accountId: z.uuid().optional(),
    threadKey: z.string().min(1).max(500).optional(),
    scope: z.string().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
  })
  .strict();
type ListMessagesPayload = z.infer<typeof listMessagesSchema>;

type MessagePosition = { readonly receivedAt: Temporal.Instant; readonly id: string };

const LIST_ORDER = [
  { col: "receivedAt", direction: "desc" },
  { col: "id", direction: "desc" },
] as const;

function invalidCursorError(): ValidationError {
  return new ValidationError({
    fields: [
      { path: "cursor", code: "invalid_cursor", i18nKey: "inboundMail.errors.invalidCursor" },
    ],
  });
}

function parseMessageCursor(cursor: string): MessagePosition {
  let decoded: ReturnType<typeof decodeKeysetCursor>;
  try {
    decoded = decodeKeysetCursor(cursor);
  } catch {
    throw invalidCursorError();
  }
  const { sortValue, id } = decoded;
  if (typeof sortValue !== "string" || !isUuid(id)) throw invalidCursorError();
  try {
    return { receivedAt: Temporal.Instant.from(sortValue), id };
  } catch {
    throw invalidCursorError();
  }
}

function positionOf(row: Readonly<Record<string, unknown>>): MessagePosition {
  return { receivedAt: Temporal.Instant.from(String(row["receivedAt"])), id: String(row["id"]) };
}

function encodeMessageCursor(row: Readonly<Record<string, unknown>>): string {
  return encodeKeysetCursor(String(row["receivedAt"]), String(row["id"]));
}

// Rows tied on the cursor's receivedAt (id below the cursor's id) come first, then rows strictly older; both halves follow LIST_ORDER, so concatenation keeps the order.
async function fetchAfter(
  db: TenantDb,
  filter: Record<string, unknown>,
  after: MessagePosition | undefined,
  count: number,
): Promise<readonly Record<string, unknown>[]> {
  const tied = after
    ? await db.selectMany(
        inboundMessagesProjectionTable,
        { ...filter, receivedAt: after.receivedAt, id: { lt: after.id } },
        { fields: LIST_MESSAGE_COLUMNS, orderBy: LIST_ORDER, limit: count },
      )
    : [];
  if (tied.length >= count) return tied;
  const beyond = await db.selectMany(
    inboundMessagesProjectionTable,
    after ? { ...filter, receivedAt: { lt: after.receivedAt } } : filter,
    { fields: LIST_MESSAGE_COLUMNS, orderBy: LIST_ORDER, limit: count - tied.length },
  );
  return [...tied, ...beyond];
}

export function createListMessagesQuery({ memberRoles }: InboundMailRoles): QueryHandlerDef {
  return {
    name: "message:list",
    schema: listMessagesSchema,
    access: { roles: [...memberRoles] },
    description:
      "Lists received mail of the caller's tenant newest first with sender, recipients, subject and snippet decrypted, optionally narrowed to one account, thread or folder scope and hiding messages of personal mailboxes the caller does not own; pages with `limit` (default 50, at most 200) and the returned `nextCursor` until it is null. Use it to read an inbox or a conversation.",
    handler: async (query, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = query.payload as ListMessagesPayload;
      const filter: Record<string, unknown> = { tenantId: ctx.user.tenantId };
      if (payload.accountId) filter["accountId"] = payload.accountId;
      if (payload.threadKey) filter["threadKey"] = payload.threadKey;
      if (payload.scope) filter["scope"] = payload.scope;

      const visible: Record<string, unknown>[] = [];
      let after = payload.cursor ? parseMessageCursor(payload.cursor) : undefined;
      let nextCursor: string | null = null;
      // ponytail: visibility ("shared or mine") is filtered in memory because WhereObject has no OR, so a page scans past other users' personal mail; push it into SQL once the where builder supports OR.
      for (;;) {
        const batch = await fetchAfter(ctx.db, filter, after, payload.limit);
        for (const row of batch) {
          if (!isVisibleToCaller(row, ctx.user)) continue;
          visible.push(row);
          if (visible.length === payload.limit) {
            nextCursor = encodeMessageCursor(row);
            break;
          }
        }
        const lastScanned = batch[batch.length - 1];
        if (nextCursor !== null || batch.length < payload.limit || lastScanned === undefined) break;
        after = positionOf(lastScanned);
      }
      const piiKms = configuredPiiSubjectKms();
      if (!piiKms) return { rows: visible, nextCursor };
      const decryptedRows = await Promise.all(
        visible.map((row) =>
          decryptPiiFieldValues(row, INBOUND_MESSAGE_PII_FIELDS, piiKms, {
            requestId: `inbound-mail-foundation:list-messages:${ctx.user.tenantId}`,
          }),
        ),
      );
      return { rows: decryptedRows, nextCursor };
    },
  };
}
