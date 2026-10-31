import {
  createEventStoreExecutor,
  fetchOne,
  selectMany,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type AppContext,
  access,
  createSystemUser,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { decryptStoredPii } from "../shared/index.ts";
import { tenantTable } from "../tenant/index.ts";
import { TierEngineQueries } from "../tier-engine/index.ts";
import { USER_STATUS, userTable } from "../user/index.ts";
import {
  contactReplyEntity,
  contactReplyTable,
  contactRequestEntity,
  contactRequestTable,
} from "./entity.ts";
import {
  CONTACT_REPLY_CHANNELS,
  CONTACT_REPLY_ENTITY,
  CONTACT_REQUEST_ENTITY,
  ContactErrors,
  type ContactPhoneMode,
  type ContactReplyChannels,
} from "./web/constants.ts";

export const IN_APP_FEATURE = "channel-in-app";
export const TELEGRAM_FEATURE = "channel-telegram";

export const CONTACT_CROSS_TENANT_REASON = "contact is platform-wide (systemScope)";

export const SYSTEM_ADMIN_ROLE = "SystemAdmin";
const PII_DECRYPT_REASON = "contact:user-lookup";

export const adminAccess = { roles: access.systemAdmin } as const;
export const internalAccess = { roles: access.system } as const;

export const requestExecutor = createEventStoreExecutor(contactRequestTable, contactRequestEntity, {
  entityName: CONTACT_REQUEST_ENTITY,
});

export const replyExecutor = createEventStoreExecutor(contactReplyTable, contactReplyEntity, {
  entityName: CONTACT_REPLY_ENTITY,
});

const MAX_REPLIES_PER_REQUEST = 200;

export async function listRepliesOf(db: TenantDb, requestId: string) {
  const found = await replyExecutor.list(
    {
      filter: { field: "requestId", op: "eq", value: requestId },
      sort: "sentAt",
      sortDirection: "asc",
      limit: MAX_REPLIES_PER_REQUEST,
    },
    platformActor(),
    db,
  );
  return found.rows;
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

export function contactDb(ctx: Pick<AppContext, "systemDb">): TenantDb {
  if (!ctx.systemDb) {
    throw new InternalError({
      message: "contact requires ctx.systemDb — is r.systemScope() set on the feature?",
    });
  }
  return ctx.systemDb.acknowledgeCrossTenant(CONTACT_CROSS_TENANT_REASON);
}

// Requests and replies are systemStream rows, so every write targets the system tenant's stream.
export function platformActor(): SessionUser {
  return createSystemUser(SYSTEM_TENANT_ID);
}

export async function listSystemAdminIds(db: TenantDb): Promise<readonly string[]> {
  const rows = await selectMany<{ readonly id: string }>(
    db,
    userTable,
    { isDeleted: false, status: USER_STATUS.Active, roles: SYSTEM_ADMIN_ROLE },
    { fields: ["id"], orderBy: { col: "id" } },
  );
  return rows.map((r) => r.id);
}

export type UserLabel = { readonly name: string; readonly email: string | null };

type UserLabelRow = { readonly displayName: string; readonly email: string };

export async function loadUserLabel(db: TenantDb, userId: string): Promise<UserLabel | null> {
  const row = await fetchOne<UserLabelRow>(db, userTable, { id: userId, isDeleted: false });
  if (!row) return null;
  const email = await decryptStoredPii(row.email, "email", PII_DECRYPT_REASON);
  const name = await decryptStoredPii(row.displayName, "displayName", PII_DECRYPT_REASON);
  return { name, email };
}

export async function sendBestEffort(
  ctx: Pick<HandlerContext, "notify" | "obs">,
  label: string,
  send: (notify: NonNullable<HandlerContext["notify"]>) => Promise<unknown>,
): Promise<void> {
  try {
    if (!ctx.notify) {
      throw new InternalError({ message: "ctx.notify unavailable — mount the delivery feature" });
    }
    await send(ctx.notify);
  } catch (err) {
    ctx.obs.log?.warn(`[contact] ${label} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function pickReplyChannels(
  ctx: Pick<HandlerContext, "hasFeature">,
  reporterUserId: string | null | undefined,
): Promise<ContactReplyChannels> {
  const hasInApp = reporterUserId && (await ctx.hasFeature(IN_APP_FEATURE));
  return hasInApp ? CONTACT_REPLY_CHANNELS.EmailAndInApp : CONTACT_REPLY_CHANNELS.Email;
}

export function phoneProblem(
  mode: ContactPhoneMode,
  phone: string | undefined,
): (typeof ContactErrors)[keyof typeof ContactErrors] | null {
  const present = phone !== undefined && phone !== "";
  if (mode === "off") return present ? ContactErrors.phoneNotAllowed : null;
  if (mode === "required") return present ? null : ContactErrors.phoneRequired;
  return null;
}

export async function loadTenantName(db: TenantDb, tenantId: string): Promise<string | null> {
  const row = await fetchOne<{ name: string }>(db, tenantTable, { id: tenantId });
  return row ? decryptStoredPii(row.name, "name", PII_DECRYPT_REASON) : null;
}

// The tier engine only knows tier ids, so the operators' label is the id with a capital.
function planDisplayName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// The plan is context for the operators, so a missing tier-engine or a failed lookup leaves it empty.
export async function loadTenantPlan(
  ctx: Pick<HandlerContext, "dispatch" | "registry" | "obs">,
  tenantId: string,
): Promise<string | null> {
  if (ctx.registry.getQueryHandler(TierEngineQueries.getTenantTier) === undefined) return null;
  try {
    const assignment = await ctx.dispatch.queryAs(
      createSystemUser(SYSTEM_TENANT_ID, [SYSTEM_ADMIN_ROLE]),
      TierEngineQueries.getTenantTier,
      { tenantId },
    );
    const tier = propertyOf(assignment, "tier");
    return typeof tier === "string" && tier !== "" ? planDisplayName(tier) : null;
  } catch (err) {
    ctx.obs.log?.warn("[contact] tenant plan lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
