import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
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
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  acknowledgedSystemDb,
  decryptStoredPii,
  sendBestEffort as sendSharedBestEffort,
} from "../shared/index.ts";
import { tenantTable } from "../tenant/index.ts";
import { TierEngineQueries } from "../tier-engine/index.ts";
import { USER_STATUS, userTable } from "../user/index.ts";
import {
  helpdeskReplyEntity,
  helpdeskReplyTable,
  helpdeskRequestEntity,
  helpdeskRequestTable,
} from "./entity.ts";
import {
  HELPDESK_REPLY_CHANNELS,
  HELPDESK_REPLY_ENTITY,
  HELPDESK_REQUEST_ENTITY,
  HelpdeskErrors,
  HelpdeskHandlers,
  type HelpdeskPhoneMode,
  type HelpdeskReplyChannels,
} from "./web/constants.ts";

export const IN_APP_FEATURE = "channel-in-app";
export const TELEGRAM_FEATURE = "channel-telegram";

export const HELPDESK_CROSS_TENANT_REASON = "helpdesk is platform-wide (systemScope)";

const PII_DECRYPT_REASON = "helpdesk:user-lookup";

export const adminAccess = { roles: access.systemAdmin } as const;
export const internalAccess = { roles: access.system } as const;

export const requestExecutor = createEventStoreExecutor(
  helpdeskRequestTable,
  helpdeskRequestEntity,
  {
    entityName: HELPDESK_REQUEST_ENTITY,
  },
);

export const replyExecutor = createEventStoreExecutor(helpdeskReplyTable, helpdeskReplyEntity, {
  entityName: HELPDESK_REPLY_ENTITY,
});

// Equals the executor's MAX_LIST_LIMIT, so every page is filled until the last one.
const LIST_PAGE_SIZE = 200;

export async function listAllPages<Row>(
  fetchPage: (page: { limit: number; offset: number }) => Promise<{ rows: readonly Row[] }>,
): Promise<Row[]> {
  const all: Row[] = [];
  for (;;) {
    const { rows } = await fetchPage({ limit: LIST_PAGE_SIZE, offset: all.length });
    all.push(...rows);
    if (rows.length < LIST_PAGE_SIZE) return all;
  }
}

export function listRepliesOf(db: TenantDb, requestId: string) {
  return listAllPages((page) =>
    replyExecutor.list(
      {
        filter: { field: "requestId", op: "eq", value: requestId },
        sort: "sentAt",
        sortDirection: "asc",
        ...page,
      },
      platformActor(),
      db,
    ),
  );
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

export function helpdeskDb(ctx: Pick<AppContext, "systemDb">): TenantDb {
  return acknowledgedSystemDb(ctx, "helpdesk", HELPDESK_CROSS_TENANT_REASON);
}

// Requests and replies are systemStream rows, so every write targets the system tenant's stream.
export function platformActor(): SessionUser {
  return createSystemUser(SYSTEM_TENANT_ID);
}

export async function listSystemAdminIds(db: TenantDb): Promise<readonly string[]> {
  const rows = await selectMany<{ readonly id: string }>(
    db,
    userTable,
    { isDeleted: false, status: USER_STATUS.Active, roles: ROLES.SystemAdmin },
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
  return sendSharedBestEffort(ctx, `[helpdesk] ${label} failed`, send);
}

export async function forwardHelpdeskRequest(
  ctx: Pick<HandlerContext, "dispatch">,
  requestId: string,
): Promise<void> {
  const forwarded = await ctx.dispatch.writeAs(platformActor(), HelpdeskHandlers.forwardRequest, {
    requestId,
  });
  if (!forwarded.isSuccess) throw new Error(forwarded.error.message);
}

export async function pickReplyChannels(
  ctx: Pick<HandlerContext, "hasFeature">,
  reporterUserId: string | null | undefined,
): Promise<HelpdeskReplyChannels> {
  const hasInApp = reporterUserId && (await ctx.hasFeature(IN_APP_FEATURE));
  return hasInApp ? HELPDESK_REPLY_CHANNELS.EmailAndInApp : HELPDESK_REPLY_CHANNELS.Email;
}

export function phoneProblem(
  mode: HelpdeskPhoneMode,
  phone: string | undefined,
): (typeof HelpdeskErrors)[keyof typeof HelpdeskErrors] | null {
  const present = phone !== undefined && phone !== "";
  if (mode === "off") return present ? HelpdeskErrors.phoneNotAllowed : null;
  if (mode === "required") return present ? null : HelpdeskErrors.phoneRequired;
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
      createSystemUser(SYSTEM_TENANT_ID, [ROLES.SystemAdmin]),
      TierEngineQueries.getTenantTier,
      { tenantId },
    );
    const tier = propertyOf(assignment, "tier");
    return typeof tier === "string" && tier !== "" ? planDisplayName(tier) : null;
  } catch (err) {
    ctx.obs.log?.warn("[helpdesk] tenant plan lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
