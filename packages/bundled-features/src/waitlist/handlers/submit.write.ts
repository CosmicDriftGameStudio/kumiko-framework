import { acquireNamespacedAdvisoryLock } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineWriteHandler,
  type HandlerContext,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { WAITLIST_NOTIFICATION_TYPES, WAITLIST_STATUS } from "../constants.ts";
import { normalizeEmail, platformActor, waitlistDb, waitlistExecutor } from "../lib.ts";
import {
  resolveWaitlistAdminMailLocale,
  resolveWaitlistMailLocale,
  waitlistAdminNoticeVariables,
  waitlistConfirmationVariables,
} from "../mail.ts";
import {
  DEFAULT_SUBMIT_EMAIL_RATE_LIMITS,
  DEFAULT_SUBMIT_RATE_LIMIT,
  type WaitlistOptions,
} from "../options.ts";
import { type WaitlistSubmitInput, WaitlistSubmitSchema } from "../payloads.ts";

// pg_advisory_xact_lock namespace (int4): 'wlst' as ASCII, disjoint from the
// framework's other fixed advisory-lock keys.
const SUBMIT_LOCK_NAMESPACE = 0x776c7374;
const SUBMIT_LOCK_REASON =
  "takes the per-email advisory lock so parallel submits cannot both pass the duplicate check; TenantDb has no lock API";

// Logged-in callers carry no anonymous role, so every signed-in role must be listed.
const SUBMIT_ROLES = access.roles(
  ...access.anonymous,
  ...access.authenticated,
  "Member",
  "TenantAdmin",
);

const OPEN_STATUSES = [WAITLIST_STATUS.Pending, WAITLIST_STATUS.Invited];

export type WaitlistSubmitData = { readonly kind: "submitted" };

// Identical body for new, duplicate and honeypot submits so the response does not
// state whether the email is already on the list. Timing still differs: only the
// new-entry path writes and sends mail.
const SUBMITTED: WriteResult<WaitlistSubmitData> = {
  isSuccess: true,
  data: { kind: "submitted" },
};

// An explicitly bound `undefined` is an error for the postgres driver; a missing key is not.
function presentOptionalFields(payload: WaitlistSubmitInput) {
  return {
    ...(payload.company !== undefined && { company: payload.company }),
    ...(payload.portfolio !== undefined && { portfolio: payload.portfolio }),
    ...(payload.message !== undefined && { message: payload.message }),
  };
}

function isHoneypotFilled(payload: WaitlistSubmitInput): boolean {
  return payload.website !== undefined && payload.website.trim() !== "";
}

async function hasOpenEntryForEmail(email: string, ctx: HandlerContext): Promise<boolean> {
  const found = await waitlistExecutor.list(
    {
      filter: { field: "email", op: "eq", value: email },
      filters: [{ field: "status", op: "in", value: OPEN_STATUSES }],
      limit: 1,
    },
    platformActor(),
    waitlistDb(ctx),
  );
  return found.rows.length > 0;
}

// The resolver usually reads config; run it outside the handler transaction's
// critical section so a failing statement cannot abort the transaction that holds
// the entry, and a slow resolver does not extend the per-email advisory lock.
async function resolveAdminRecipient(
  opts: WaitlistOptions,
  ctx: HandlerContext,
): Promise<string | null> {
  try {
    return (await opts.notifyRecipient?.(ctx)) || null;
  } catch (err) {
    ctx.log?.warn("[waitlist:submit] admin notice recipient resolution failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function sendBestEffort(
  ctx: HandlerContext,
  label: string,
  send: (notify: NonNullable<HandlerContext["notify"]>) => Promise<unknown>,
): Promise<void> {
  try {
    if (!ctx.notify) {
      throw new InternalError({ message: "ctx.notify unavailable — mount the delivery feature" });
    }
    await send(ctx.notify);
  } catch (err) {
    ctx.log?.warn(`[waitlist:submit] ${label} mail failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createSubmitHandler(opts: WaitlistOptions) {
  const emailRateLimits = opts.emailRateLimits ?? DEFAULT_SUBMIT_EMAIL_RATE_LIMITS;
  return defineWriteHandler<"submit", typeof WaitlistSubmitSchema, WaitlistSubmitData>({
    name: "submit",
    schema: WaitlistSubmitSchema,
    access: { roles: SUBMIT_ROLES, personalData: "public-intake" },
    rateLimit: opts.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT,
    // An empty array means "disabled"; boot validation rejects an empty additionalRateLimits.
    ...(emailRateLimits.length > 0 && { additionalRateLimits: emailRateLimits }),
    description:
      "Public waitlist sign-up: registers an interest entry and sends the submitter a confirmation mail. Reports success whether the address is new or already on the list; the response body is identical, response timing can still differ.",
    escapeHatch: { grants: ["unsafeRaw"], reason: SUBMIT_LOCK_REASON },
    handler: async (event, ctx) => {
      const payload = event.payload;
      if (isHoneypotFilled(payload)) return SUBMITTED;

      const email = normalizeEmail(payload.email);
      if (!ctx.systemDb) {
        throw new InternalError({
          message: "waitlist:submit requires ctx.systemDb — is r.systemScope() set?",
        });
      }
      const adminRecipient = await resolveAdminRecipient(opts, ctx);
      await acquireNamespacedAdvisoryLock(
        ctx.systemDb.unsafeRaw(SUBMIT_LOCK_REASON),
        SUBMIT_LOCK_NAMESPACE,
        email,
      );
      if (await hasOpenEntryForEmail(email, ctx)) return SUBMITTED;

      const created = await waitlistExecutor.create(
        {
          name: payload.name,
          email,
          locale: payload.locale,
          ...presentOptionalFields(payload),
          status: WAITLIST_STATUS.Pending,
          submittedAt: Temporal.Now.instant(),
        },
        platformActor(),
        waitlistDb(ctx),
      );
      if (!created.isSuccess) return created;

      await sendBestEffort(ctx, "confirmation", (notify) =>
        notify(WAITLIST_NOTIFICATION_TYPES.confirmation, {
          route: { email },
          data: waitlistConfirmationVariables({
            locale: payload.locale,
            appName: opts.appName,
          }),
          priority: "normal",
          locale: resolveWaitlistMailLocale(payload.locale),
        }),
      );

      await sendBestEffort(ctx, "admin notice", async (notify) => {
        // skip: no admin recipient configured
        if (!adminRecipient) return;
        await notify(WAITLIST_NOTIFICATION_TYPES.adminNotice, {
          route: { email: adminRecipient },
          data: waitlistAdminNoticeVariables({
            name: payload.name,
            email,
            company: payload.company,
            message: payload.message,
          }),
          priority: "normal",
          locale: resolveWaitlistAdminMailLocale(ctx.locale),
        });
      });

      return SUBMITTED;
    },
  });
}
