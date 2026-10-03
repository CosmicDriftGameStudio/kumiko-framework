import { acquireNamespacedAdvisoryLock } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineWriteHandler,
  type HandlerContext,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { WAITLIST_NOTIFICATION_TYPES, WAITLIST_STATUS } from "../constants.js";
import { normalizeEmail, platformActor, waitlistDb, waitlistExecutor } from "../lib.js";
import { renderWaitlistAdminNoticeEmail, renderWaitlistConfirmationEmail } from "../mail.js";
import { DEFAULT_SUBMIT_RATE_LIMIT, type WaitlistOptions } from "../options.js";
import { type WaitlistSubmitInput, WaitlistSubmitSchema } from "../payloads.js";

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

export type WaitlistSubmitData = { readonly kind: "submitted" };

// Identical for new, duplicate and honeypot submits: the response must not
// reveal whether the email is already on the list.
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
    { filter: { field: "email", op: "eq", value: email }, limit: 50 },
    platformActor(),
    waitlistDb(ctx),
  );
  return found.rows.some(
    (row) => row["status"] === WAITLIST_STATUS.Pending || row["status"] === WAITLIST_STATUS.Invited,
  );
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
  return defineWriteHandler<"submit", typeof WaitlistSubmitSchema, WaitlistSubmitData>({
    name: "submit",
    schema: WaitlistSubmitSchema,
    access: { roles: SUBMIT_ROLES, personalData: "public-intake" },
    rateLimit: opts.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT,
    description:
      "Public waitlist sign-up: registers an interest entry and sends the submitter a confirmation mail. Always reports success, whether the address is new or already on the list.",
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
          data: renderWaitlistConfirmationEmail({
            locale: payload.locale,
            appName: opts.appName,
          }),
          priority: "normal",
        }),
      );

      await sendBestEffort(ctx, "admin notice", async (notify) => {
        const adminRecipient = opts.notifyRecipient?.(ctx);
        // skip: no admin recipient configured
        if (!adminRecipient) return;
        await notify(WAITLIST_NOTIFICATION_TYPES.adminNotice, {
          route: { email: adminRecipient },
          data: renderWaitlistAdminNoticeEmail({
            name: payload.name,
            email,
            company: payload.company,
            message: payload.message,
            adminLocale: ctx.locale,
          }),
          priority: "normal",
        });
      });

      return SUBMITTED;
    },
  });
}
