import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { JobContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { hasMailTranslations, mailT } from "@cosmicdrift/kumiko-framework/i18n";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  decryptTenantNames,
  type TenantLifecycleStatus,
  tenantMembershipsTable,
  tenantTable,
} from "../tenant/index.ts";
import { requestTenantDestruction } from "../tenant-lifecycle/index.ts";
import { userTable } from "../user/index.ts";
import { TENANT_OWNER_ROLE } from "./constants.ts";
import { formatInactivityMailDate } from "./email-templates.ts";
import {
  activityBase,
  decideInactivityAction,
  foldActivity,
  type InactivityRule,
  resetWarnings,
} from "./inactivity-plan.ts";
import { signKeepAccountToken } from "./keep-token.ts";
import {
  InactivityWarningNotificationType,
  inactivityMailTemplateLocale,
} from "./mail-notifications.ts";
import { resolveInactivityRule, type TenantInactivityOptions } from "./options.ts";
import {
  loadInactivityState,
  loadNewestSessionActivity,
  type StoredInactivityState,
  saveInactivityState,
} from "./state-store.ts";

// Links outlive the deadline a little so a late click still counts as a reaction.
const KEEP_LINK_GRACE_MINUTES = 14 * 24 * 60;
const MS_PER_MINUTE = 60_000;

function emptyState(now: Temporal.Instant): StoredInactivityState {
  return {
    cycleId: crypto.randomUUID(),
    firstSeenAt: now,
    lastActivityAt: null,
    lastExemptAt: null,
    lastWarnedAt: null,
    postponedDueAt: null,
    warningsSent: 0,
  };
}

function startNewCycle(state: StoredInactivityState): StoredInactivityState {
  return { ...resetWarnings(state), cycleId: crypto.randomUUID() };
}

function latestOf(instants: readonly (Temporal.Instant | null)[]): Temporal.Instant | null {
  let latest: Temporal.Instant | null = null;
  for (const instant of instants) {
    if (instant !== null && (latest === null || Temporal.Instant.compare(instant, latest) > 0)) {
      latest = instant;
    }
  }
  return latest;
}

async function newestExternalActivity(
  options: TenantInactivityOptions,
  tenantId: TenantId,
  now: Temporal.Instant,
): Promise<Temporal.Instant | null> {
  const found = await Promise.all(
    (options.activitySources ?? []).map((source) => source({ tenantId, now })),
  );
  return latestOf(found);
}

function isNewerThanBase(
  activity: Temporal.Instant | null,
  state: StoredInactivityState,
): activity is Temporal.Instant {
  return activity !== null && Temporal.Instant.compare(activity, activityBase(state)) > 0;
}

type OwnerRecipient = { readonly userId: string; readonly locale: string | null };

async function loadOwners(ctx: JobContext): Promise<readonly OwnerRecipient[]> {
  const memberships = await ctx.db.selectMany<{ userId: string; roles: unknown }>(
    tenantMembershipsTable,
    {},
  );
  const owners: OwnerRecipient[] = [];
  for (const membership of memberships) {
    if (!parseRoles(membership.roles).includes(TENANT_OWNER_ROLE)) continue;
    const user = await ctx.db
      .global(userTable)
      .fetchOne<{ locale: string | null }>({ id: membership.userId });
    owners.push({ userId: membership.userId, locale: user?.locale ?? null });
  }
  return owners;
}

function mailLocaleFor(userLocale: string | null): string {
  const root = userLocale?.toLowerCase().split("-")[0];
  const preferred = root !== undefined && hasMailTranslations(root) ? root : "en";
  return inactivityMailTemplateLocale(InactivityWarningNotificationType, preferred);
}

async function readTenantName(ctx: JobContext, tenantId: TenantId): Promise<string> {
  const row = await fetchOne<{ name?: unknown }>(ctx.db.unsafeRaw(), tenantTable, {
    id: tenantId,
  });
  const [named] = await decryptTenantNames(row ? [row] : [], tenantId);
  return typeof named?.name === "string" ? named.name : tenantId;
}

function keepLinkFor(args: {
  readonly options: TenantInactivityOptions;
  readonly tenantId: TenantId;
  readonly state: StoredInactivityState;
  readonly deadline: Temporal.Instant;
  readonly now: Temporal.Instant;
}): string {
  const { options, tenantId, state, deadline, now } = args;
  if (options.keepAccountTokenSecret === undefined) return options.keepAccountUrl;
  const untilDeadline = Math.ceil(
    (deadline.epochMilliseconds - now.epochMilliseconds) / MS_PER_MINUTE,
  );
  const token = signKeepAccountToken({
    tenantId,
    cycleId: state.cycleId,
    ttlMinutes: Math.max(0, untilDeadline) + KEEP_LINK_GRACE_MINUTES,
    secret: options.keepAccountTokenSecret,
    now,
  });
  return `${options.keepAccountUrl}#token=${token}`;
}

// True when at least one owner got the mail. A failed delivery must not count as a sent warning,
// or the deletion request would follow without the owner ever having been told.
async function sendWarningMails(args: {
  readonly ctx: JobContext;
  readonly options: TenantInactivityOptions;
  readonly tenantId: TenantId;
  readonly state: StoredInactivityState;
  readonly deadline: Temporal.Instant;
  readonly now: Temporal.Instant;
}): Promise<boolean> {
  const { ctx, options, tenantId, deadline } = args;
  if (!ctx.notify) throw new Error("tenant-inactivity: ctx.notify missing, mount delivery");
  const tenantName = await readTenantName(ctx, tenantId);
  const keepUrl = keepLinkFor(args);

  let delivered = false;
  for (const owner of await loadOwners(ctx)) {
    const locale = mailLocaleFor(owner.locale);
    // immediate: the keep-account token must not land in a delivery job payload.
    const result = await ctx.notify(InactivityWarningNotificationType, {
      to: owner.userId,
      locale,
      immediate: true,
      data: {
        app: options.appName ?? mailT(locale, "gdpr.mail.appNameDefault"),
        tenant: tenantName,
        when: formatInactivityMailDate(deadline),
        keepUrl,
      },
    });
    if (result.deliveries.some((delivery) => delivery.status !== "failed")) delivered = true;
  }
  return delivered;
}

async function evaluate(
  ctx: JobContext,
  options: TenantInactivityOptions,
  tenantId: TenantId,
  rule: InactivityRule,
  stored: StoredInactivityState | null,
  now: Temporal.Instant,
): Promise<StoredInactivityState> {
  const initial = stored ?? emptyState(now);
  const folded = foldActivity(initial, await loadNewestSessionActivity(ctx.db));
  const merged: StoredInactivityState = { ...initial, ...folded.state };
  const state = folded.newCycle ? startNewCycle(merged) : merged;

  const decision = decideInactivityAction(state, rule, now);
  if (decision.kind === "none") return state;

  // Steps with consequences ask other apps first: activity there counts too.
  const external = await newestExternalActivity(options, tenantId, now);
  if (isNewerThanBase(external, state)) {
    return startNewCycle({ ...state, lastActivityAt: external });
  }

  if (decision.kind === "warn") {
    const delivered = await sendWarningMails({
      ctx,
      options,
      tenantId,
      state,
      deadline: decision.deadline,
      now,
    });
    if (!delivered) return state;
    return {
      ...state,
      warningsSent: decision.warningsSentAfter,
      lastWarnedAt: now,
      postponedDueAt: decision.postponedDueAt ?? state.postponedDueAt,
    };
  }

  if (!ctx.registry) throw new Error("tenant-inactivity: ctx.registry required");
  const result = await requestTenantDestruction({
    tenantId,
    actor: ctx.systemUser,
    now,
    db: ctx.db,
    runner: ctx.db.unsafeRaw(),
    registry: ctx.registry,
    revokeSessions: true,
  });
  if (!result.isSuccess) {
    throw new Error(`tenant-inactivity: destruction request for ${tenantId} failed`);
  }
  // If the owner cancels the request, a fresh cycle starts instead of an instant second request.
  return startNewCycle({ ...state, lastActivityAt: now });
}

export async function checkTenantInactivity(
  ctx: JobContext,
  options: TenantInactivityOptions,
): Promise<void> {
  const tenantId = ctx.systemUser.tenantId ?? ctx._tenantId;
  // skip: a job without a tenant scope has nothing to evaluate
  if (tenantId === undefined) return;
  const now = ctx.tz.now();
  const tenant = await fetchOne<{ status: TenantLifecycleStatus }>(
    ctx.db.unsafeRaw(),
    tenantTable,
    { id: tenantId },
  );
  // skip: only active tenants are evaluated; others are already in a lifecycle step
  if (tenant?.status !== "active") return;

  const rule = await resolveInactivityRule(options, ctx.db);
  const stored = await loadInactivityState(ctx.db);
  if (rule === null) {
    const state = stored ?? emptyState(now);
    // A tier change back to a rule starts its period at the last exempt run.
    const exempt = state.warningsSent > 0 ? startNewCycle(state) : state;
    await saveInactivityState(ctx.db, stored, { ...exempt, lastExemptAt: now });
  } else {
    await saveInactivityState(
      ctx.db,
      stored,
      await evaluate(ctx, options, tenantId, rule, stored, now),
    );
  }
}
