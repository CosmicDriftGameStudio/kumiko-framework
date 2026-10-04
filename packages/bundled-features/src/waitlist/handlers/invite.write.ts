import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
  parseTenantId,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  NotFoundError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/index.js";
import { TenantHandlers, tenantTable } from "../../tenant/index.js";
import { DEFAULT_OWN_TENANT_INVITE_ROLE, WAITLIST_STATUS, WaitlistErrors } from "../constants.js";
import { isOpenWaitlistStatus } from "../entity.js";
import { adminAccess, platformActor, waitlistDb, waitlistExecutor } from "../lib.js";
import type { WaitlistInviteOptions } from "../options.js";
import { WaitlistIdSchema } from "../payloads.js";

export type WaitlistInviteData = {
  readonly kind: "invited";
  readonly id: string;
  readonly tenantId: string;
};

type InviteTarget = { readonly tenantId: TenantId; readonly role: string };

const DEFAULT_INVITE: WaitlistInviteOptions = {
  mode: "own-tenant",
  role: DEFAULT_OWN_TENANT_INVITE_ROLE,
};

// Derived from the entry id so a retry finds the tenant a half-failed run created.
function tenantKeyForEntry(entryId: string): string {
  return `waitlist-${entryId}`;
}

type EntryRow = {
  readonly id: string;
  readonly version: number;
  readonly status: unknown;
  readonly email: string;
  readonly name: string;
  readonly company: string | null;
  readonly linkedTenantId: string | null;
};

function readEntryRow(row: Record<string, unknown>): EntryRow {
  const { id, version, email, name, company, linkedTenantId } = row;
  if (
    typeof id !== "string" ||
    typeof version !== "number" ||
    typeof email !== "string" ||
    typeof name !== "string"
  ) {
    throw new InternalError({ message: "waitlist:invite: malformed waitlist row" });
  }
  return {
    id,
    version,
    status: row["status"],
    email,
    name,
    company: typeof company === "string" && company !== "" ? company : null,
    linkedTenantId: typeof linkedTenantId === "string" ? linkedTenantId : null,
  };
}

function isInviteAlreadyAccepted(details: unknown): boolean {
  return (
    typeof details === "object" &&
    details !== null &&
    "reason" in details &&
    details.reason === AuthErrors.inviteAlreadyAccepted
  );
}

async function ensureOwnTenant(
  entry: EntryRow,
  ctx: HandlerContext,
): Promise<TenantId | WriteFailure> {
  const linked = entry.linkedTenantId === null ? null : parseTenantId(entry.linkedTenantId);
  if (linked) return linked;

  const key = tenantKeyForEntry(entry.id);
  const existing = await fetchOne<{ id: string }>(waitlistDb(ctx), tenantTable, { key });
  const existingId = existing ? parseTenantId(existing.id) : null;
  if (existingId) return existingId;

  const newTenantId = parseTenantId(crypto.randomUUID());
  if (!newTenantId) throw new InternalError({ message: "waitlist:invite: tenant id mint failed" });
  const created = await ctx.writeAs(createSystemUser(newTenantId), TenantHandlers.create, {
    id: newTenantId,
    key,
    name: entry.company ?? entry.name,
  });
  return created.isSuccess ? newTenantId : created;
}

async function resolveInviteTarget(
  invite: WaitlistInviteOptions,
  entry: EntryRow,
  ctx: HandlerContext,
): Promise<InviteTarget | WriteFailure> {
  if (invite.mode === "shared-tenant") return { tenantId: invite.tenantId, role: invite.role };
  const tenantId = await ensureOwnTenant(entry, ctx);
  if (typeof tenantId !== "string") return tenantId;
  return { tenantId, role: invite.role ?? DEFAULT_OWN_TENANT_INVITE_ROLE };
}

export function createInviteHandler(invite: WaitlistInviteOptions = DEFAULT_INVITE) {
  return defineWriteHandler<"invite", typeof WaitlistIdSchema, WaitlistInviteData>({
    name: "invite",
    schema: WaitlistIdSchema,
    access: adminAccess,
    description:
      "Invites a pending or already-invited waitlist entry: creates its tenant (or uses the configured shared tenant), mails the entrant a fresh accept link with the configured role and marks the entry invited; rejected entries cannot be invited. The invitee never receives a global role.",
    // Sends an invite link by email, which cannot be recalled.
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const db = waitlistDb(ctx);
      const row = await waitlistExecutor.detail({ id: event.payload.id }, platformActor(), db);
      if (!row) return writeFailure(new NotFoundError("waitlistEntry", event.payload.id));
      const entry = readEntryRow(row);
      if (!isOpenWaitlistStatus(entry.status)) {
        return writeFailure(new UnprocessableError(WaitlistErrors.notInvitable));
      }

      const target = await resolveInviteTarget(invite, entry, ctx);
      if ("isSuccess" in target) return target;

      // inviteCreate is admin-only (no system role); the system variant with an
      // empty globalRoles list is the only in-process path, and a waitlist
      // invite must never grant a global role.
      const invited = await ctx.writeAs(
        createSystemUser(target.tenantId),
        AuthHandlers.systemInviteCreate,
        { email: entry.email.toLowerCase(), role: target.role, globalRoles: [] },
      );
      if (!invited.isSuccess) {
        // Re-inviting a person who already accepted would reset their live invitation.
        if (isInviteAlreadyAccepted(invited.error.details)) {
          return writeFailure(new UnprocessableError(WaitlistErrors.notInvitable));
        }
        return invited;
      }

      const updated = await waitlistExecutor.update(
        {
          id: entry.id,
          version: entry.version,
          changes: {
            status: WAITLIST_STATUS.Invited,
            invitedAt: Temporal.Now.instant(),
            invitedBy: event.user.id,
            linkedTenantId: target.tenantId,
          },
        },
        platformActor(),
        db,
      );
      if (!updated.isSuccess) return updated;

      return {
        isSuccess: true,
        data: { kind: "invited", id: entry.id, tenantId: target.tenantId },
      };
    },
  });
}
