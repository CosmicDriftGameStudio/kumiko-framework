// Public share token — generic recipe (no domain payload).
//
// Pattern: authenticated create → plain token show-once → anonymous
// read-by-token with SHA-256 lookup. Revoke sets revokedAt via executor.
//
// See money-horse for credit/folder snapshots, layouts, tier gates.

import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createEntityExecutor,
  createJsonbField,
  createTextField,
  createTimestampField,
  defineFeature,
  defineQueryHandler,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";

const TOKEN_PREFIX = "sh_";

export const shareLinkEntity = createEntity({
  table: "read_public_share_links",
  idType: "uuid",
  fields: {
    tokenHash: createTextField({ required: true, maxLength: 64 }),
    label: createTextField({ required: true, maxLength: 200 }),
    payload: createJsonbField(),
    expiresAt: createTimestampField({ required: true }),
    revokedAt: createTimestampField({}),
  },
  indexes: [
    {
      unique: true,
      columns: ["tokenHash"],
      name: "read_public_share_links_hash_unique",
    },
  ],
});

const { executor, table } = createEntityExecutor("share-link", shareLinkEntity);

async function hashToken(plain: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function mintToken(): Promise<{ plain: string; hash: string }> {
  const plain = `${TOKEN_PREFIX}${generateToken()}`;
  return { plain, hash: await hashToken(plain) };
}

const createSchema = z.object({
  label: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

export const shareLinkCreateWrite = defineWriteHandler({
  name: "share-link:create",
  schema: createSchema,
  access: { openToAll: true },
  rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
  handler: async (event, ctx) => {
    const { plain, hash } = await mintToken();
    const now = getTemporal().Now.instant();
    const expiresAt = now.add({ hours: 24 * event.payload.expiresInDays });

    const result = await executor.create(
      {
        tokenHash: hash,
        label: event.payload.label,
        payload: event.payload.payload ?? {},
        expiresAt,
        revokedAt: null,
        tenantId: event.user.tenantId,
      },
      event.user,
      ctx.db,
    );
    if (!result.isSuccess) return result;

    const id = String((result.data as { id: unknown }).id);
    return {
      isSuccess: true as const,
      data: { id, plainToken: plain, expiresAt: expiresAt.toString() },
    };
  },
});

export const shareLinkRevokeWrite = defineWriteHandler({
  name: "share-link:revoke",
  schema: z.object({ id: z.uuid() }),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const rows = await ctx.db.selectMany(
      table,
      { id: event.payload.id, tenantId: event.user.tenantId },
      { limit: 1 },
    );
    const row = rows[0];
    const ownerId = String(row?.["insertedById"] ?? row?.["inserted_by_id"] ?? "");
    if (!row || ownerId !== event.user.id) {
      throw new NotFoundError("share-link");
    }

    return executor.update(
      {
        id: event.payload.id,
        version: Number(row["version"]),
        changes: { revokedAt: getTemporal().Now.instant() },
      },
      event.user,
      ctx.db,
    );
  },
});

interface ShareLinkRow {
  readonly id: string;
  readonly label: string;
  readonly payload: unknown;
  readonly expiresAt: Temporal.Instant;
  readonly revokedAt: Temporal.Instant | null;
}

export const shareByTokenQuery = defineQueryHandler({
  name: "share-by-token",
  schema: z.object({ token: z.string().min(1) }),
  access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
  rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
  handler: async (query, ctx) => {
    const hash = await hashToken(query.payload.token);
    const row = await fetchOne<ShareLinkRow>(ctx.db.raw, table, { tokenHash: hash });

    if (!row) {
      throw new NotFoundError("share-link");
    }

    const now = getTemporal().Now.instant();
    if (row.revokedAt != null || row.expiresAt.epochMilliseconds <= now.epochMilliseconds) {
      throw new NotFoundError("share-link");
    }

    return {
      label: row.label,
      payload: row.payload,
    };
  },
});

export const publicShareTokenFeature = defineFeature("public-share", (r) => {
  r.entity("share-link", shareLinkEntity);
  r.writeHandler(shareLinkCreateWrite);
  r.writeHandler(shareLinkRevokeWrite);
  r.queryHandler(shareByTokenQuery);
});
