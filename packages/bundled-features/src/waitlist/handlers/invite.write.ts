import { acquireNamespacedAdvisoryLock, fetchOne } from "@cosmicdrift/kumiko-framework/db";
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
import { AuthErrors, AuthHandlers } from "../../auth-email-password/index.ts";
import { TenantHandlers, tenantTable } from "../../tenant/index.ts";
import { isOpenWaitlistStatus } from "../entity.ts";
import {
  adminAccess,
  isTenantMember,
  platformActor,
  waitlistDb,
  waitlistExecutor,
} from "../lib.ts";
import type { WaitlistInviteOptions } from "../options.ts";
import { WaitlistIdSchema } from "../payloads.ts";
import {
  DEFAULT_OWN_TENANT_INVITE_ROLE,
  WAITLIST_STATUS,
  WaitlistErrors,
} from "../web/constants.ts";

export type WaitlistInviteData = {
  readonly kind: "invited";
  readonly id: string;
  readonly tenantId: string;
};

type InviteTarget = { readonly tenantId: TenantId; readonly role: string };

// pg_advisory_xact_lock namespace (int4): 'wlin' as ASCII, disjoint from the submit lock.
const INVITE_LOCK_NAMESPACE = 0x776c696e;
const INVITE_LOCK_REASON =
  "takes the per-entry advisory lock so parallel invites cannot both create a tenant and invitation; TenantDb has no lock API";

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
  readonly locale: string | undefined;
};

function readEntryRow(row: Record<string, unknown>): EntryRow {
  const { id, version, email, name, company, linkedTenantId, locale } = row;
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
    locale: typeof locale === "string" && locale !== "" ? locale : undefined,
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
  const created = await ctx.dispatch.writeAs(createSystemUser(newTenantId), TenantHandlers.create, {
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
    escapeHatch: { grants: ["unsafeRaw"], reason: INVITE_LOCK_REASON },
    handler: async (event, ctx) => {
      const db = waitlistDb(ctx);
      if (!ctx.systemDb) {
        throw new InternalError({ message: "waitlist:invite requires ctx.systemDb" });
      }
      await acquireNamespacedAdvisoryLock(
        ctx.systemDb.unsafeRaw(INVITE_LOCK_REASON),
        INVITE_LOCK_NAMESPACE,
        event.payload.id,
      );
      const row = await waitlistExecutor.detail({ id: event.payload.id }, platformActor(), db);
      if (!row) return writeFailure(new NotFoundError("waitlistEntry", event.payload.id));
      const entry = readEntryRow(row);
      if (!isOpenWaitlistStatus(entry.status)) {
        return writeFailure(new UnprocessableError(WaitlistErrors.notInvitable));
      }

      const target = await resolveInviteTarget(invite, entry, ctx);
      if ("isSuccess" in target) return target;

      if (await isTenantMember(db, entry.email, target.tenantId)) {
        return writeFailure(new UnprocessableError(WaitlistErrors.notInvitable));
      }

      // inviteCreate is admin-only (no system role); the system variant with an
      // empty globalRoles list is the only in-process path, and a waitlist
      // invite must never grant a global role.
      const invited = await ctx.dispatch.writeAs(
        createSystemUser(target.tenantId),
        AuthHandlers.systemInviteCreate,
        {
          email: entry.email.toLowerCase(),
          role: target.role,
          globalRoles: [],
          ...(entry.locale !== undefined && { locale: entry.locale }),
        },
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
