import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  defineWriteHandler,
  type HandlerContext,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  isKumikoError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { normalizePayloadBucketValue } from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { PayloadRateLimitOption } from "@cosmicdrift/kumiko-types/handlers";
import { consumeChallenge } from "../challenge.ts";
import {
  helpdeskDb,
  normalizeEmail,
  phoneProblem,
  platformActor,
  requestExecutor,
  sendBestEffort,
} from "../lib.ts";
import { helpdeskAcknowledgementVariables, resolveHelpdeskMailLocale } from "../mail.ts";
import {
  DEFAULT_SUBMIT_EMAIL_RATE_LIMITS,
  DEFAULT_SUBMIT_RATE_LIMIT,
  type HelpdeskOptions,
  type HelpdeskSettings,
} from "../options.ts";
import { type HelpdeskSubmitInput, HelpdeskSubmitSchema } from "../payloads.ts";
import { verifyProofOfWork } from "../pow.ts";
import { deriveSubjectFromMessage } from "../subject.ts";
import { summarizeUserAgent } from "../user-agent.ts";
import {
  HELPDESK_NOTIFICATION_TYPES,
  HELPDESK_SOURCE,
  HELPDESK_STATUS,
  HelpdeskHandlers,
  helpdeskIdempotencyKeys,
} from "../web/constants.ts";
import { SUBMIT_ROLES } from "./access.ts";

export type HelpdeskSubmitData = { readonly kind: "submitted" };

// Identical body for stored and silently dropped submits, so a bot learns nothing from it.
const SUBMITTED: WriteResult<HelpdeskSubmitData> = {
  isSuccess: true,
  data: { kind: "submitted" },
};

type DropReason = "honeypot" | "challenge" | "too_fast" | "proof_of_work";

// An explicitly bound `undefined` is an error for the postgres driver; a missing key is not.
function presentOptionalFields(payload: HelpdeskSubmitInput) {
  return {
    ...(payload.phone !== undefined && payload.phone !== "" && { phone: payload.phone }),
    ...(payload.page !== undefined && payload.page !== "" && { page: payload.page }),
  };
}

async function findDropReason(
  payload: HelpdeskSubmitInput,
  ctx: HandlerContext,
  settings: HelpdeskSettings,
): Promise<DropReason | null> {
  if (payload.website !== undefined && payload.website.trim() !== "") return "honeypot";
  const redis = ctx.services.redis;
  if (!redis) {
    throw new InternalError({
      message: "helpdesk:submit requires ctx.services.redis for the challenge store",
    });
  }
  const issued = await consumeChallenge(redis, payload.challenge);
  if (!issued) return "challenge";
  if (ctx.tz.now().epochMilliseconds - issued.issuedAtMs < settings.minSubmitMs) return "too_fast";
  if (
    !verifyProofOfWork({ challenge: payload.challenge, nonce: payload.nonce, bits: issued.bits })
  ) {
    return "proof_of_work";
  }
  return null;
}

// Counted here instead of as a payload bucket in front of the handler: a bot that posts a victim's
// address without solving the challenge would otherwise exhaust that address's quota and lock the
// real owner out. Only submits that passed the spam checks count. An empty list disables the limit.
async function enforceEmailLimits(
  ctx: HandlerContext,
  payload: HelpdeskSubmitInput,
  limits: readonly PayloadRateLimitOption[],
): Promise<WriteFailure | null> {
  if (limits.length === 0) return null;
  const { rateLimit } = ctx.services;
  if (!rateLimit || !ctx.rateLimitDigest) {
    throw new InternalError({
      message:
        "helpdesk:submit declares an email rate limit but no rate limiter or digest is wired",
    });
  }
  const requests = limits.map(({ per, limit, windowSeconds, cost, normalize }) => ({
    bucket: `helpdesk-submit:${per.payloadField}:${ctx.rateLimitDigest?.(
      normalizePayloadBucketValue(payload.email, normalize),
    )}`,
    config: { limit, windowSeconds, ...(cost !== undefined && { cost }) },
  }));
  try {
    await rateLimit.enforceAll(requests);
  } catch (error) {
    if (isKumikoError(error)) return writeFailure(error);
    throw error;
  }
  return null;
}

export function createSubmitHandler(opts: HelpdeskOptions, settings: HelpdeskSettings) {
  const emailRateLimits = opts.emailRateLimits ?? DEFAULT_SUBMIT_EMAIL_RATE_LIMITS;
  return defineWriteHandler<"submit", typeof HelpdeskSubmitSchema, HelpdeskSubmitData>({
    name: "submit",
    schema: HelpdeskSubmitSchema,
    access: { roles: SUBMIT_ROLES, personalData: "public-intake", anySignedIn: true },
    rateLimit: opts.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT,
    agent: { expose: false },
    description:
      "Public contact form: stores a question, contact request or problem report from a website visitor after a single-use proof-of-work challenge, forwards it to the SystemAdmins (mail, optional Telegram) and mails the sender a copy. Spam (honeypot, unknown or reused challenge, too fast, wrong proof of work) gets the same success body but nothing is stored or sent.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const dropReason = await findDropReason(payload, ctx, settings);
      if (dropReason !== null) {
        ctx.obs.log?.info("[helpdesk:submit] dropped", { reason: dropReason });
        return SUBMITTED;
      }

      // Before the email limit, so a mistyped phone number does not use up the sender's quota.
      const phoneIssue = phoneProblem(settings.phone, payload.phone);
      if (phoneIssue !== null) return writeFailure(new UnprocessableError(phoneIssue));

      const limited = await enforceEmailLimits(ctx, payload, emailRateLimits);
      if (limited !== null) return limited;

      const email = normalizeEmail(payload.email);
      const browser = summarizeUserAgent(requestContext.get()?.userAgent, payload.locale);
      const requestId = generateId();
      const created = await requestExecutor.create(
        {
          id: requestId,
          kind: payload.kind,
          status: HELPDESK_STATUS.Open,
          source: HELPDESK_SOURCE.Website,
          subject: deriveSubjectFromMessage(payload.message),
          message: payload.message,
          name: payload.name,
          email,
          locale: payload.locale,
          ...presentOptionalFields(payload),
          ...(opts.appVersion !== undefined && { appVersion: opts.appVersion }),
          ...(browser !== null && { browser }),
          submittedAt: ctx.tz.now(),
          fileCount: 0,
          replyCount: 0,
        },
        platformActor(),
        helpdeskDb(ctx),
      );
      if (!created.isSuccess) return created;

      await sendBestEffort(ctx, "forward request", async () => {
        const forwarded = await ctx.dispatch.writeAs(
          platformActor(),
          HelpdeskHandlers.forwardRequest,
          { requestId },
        );
        if (!forwarded.isSuccess) throw new Error(forwarded.error.message);
      });

      await sendBestEffort(ctx, "confirmation mail", (notify) =>
        notify(HELPDESK_NOTIFICATION_TYPES.acknowledgement, {
          route: { email },
          recipientId: requestId,
          data: helpdeskAcknowledgementVariables({
            appName: opts.appName,
            locale: payload.locale,
          }),
          idempotencyKey: helpdeskIdempotencyKeys.confirmation(requestId),
          priority: "normal",
          locale: resolveHelpdeskMailLocale(payload.locale),
        }),
      );

      return SUBMITTED;
    },
  });
}
