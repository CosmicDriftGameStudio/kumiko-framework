import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  helpdeskDb,
  loadTenantName,
  loadTenantPlan,
  loadUserLabel,
  normalizeEmail,
  phoneProblem,
  platformActor,
  requestExecutor,
  sendBestEffort,
} from "../lib.ts";
import { helpdeskConfirmationVariables, resolveHelpdeskMailLocale } from "../mail.ts";
import { type HelpdeskOptions, type HelpdeskSettings, REPORT_RATE_LIMIT } from "../options.ts";
import { HelpdeskReportSchema } from "../payloads.ts";
import { summarizeUserAgent } from "../user-agent.ts";
import {
  HELPDESK_NOTIFICATION_TYPES,
  HELPDESK_REQUEST_ENTITY,
  HELPDESK_SOURCE,
  HELPDESK_STATUS,
  HELPDESK_UPLOAD_FIELD,
  HelpdeskErrors,
  HelpdeskHandlers,
  HelpdeskScreens,
  helpdeskIdempotencyKeys,
} from "../web/constants.ts";
import { REPORT_ACCESS } from "./access.ts";
import { takeOverUploads } from "./take-over-uploads.ts";

export type HelpdeskReportData = { readonly kind: "reported"; readonly id: string };

export function createReportHandler(opts: HelpdeskOptions, settings: HelpdeskSettings) {
  return defineWriteHandler<"report", typeof HelpdeskReportSchema, HelpdeskReportData>({
    name: "report",
    schema: HelpdeskReportSchema,
    access: REPORT_ACCESS,
    rateLimit: REPORT_RATE_LIMIT,
    agent: { expose: false },
    description:
      "A signed-in user reports a problem, asks a question or voices a wish to the platform operators; name, email and tenant come from the session, never from the payload. Forwards the request to the SystemAdmins and mails the reporter a copy.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const phoneIssue = phoneProblem(settings.phone, payload.phone);
      if (phoneIssue !== null) return writeFailure(new UnprocessableError(phoneIssue));

      const db = helpdeskDb(ctx);
      const reporter = await loadUserLabel(db, event.user.id);
      if (!reporter?.email) {
        return writeFailure(new UnprocessableError(HelpdeskErrors.reporterEmailMissing));
      }
      const tenantName = await loadTenantName(db, event.user.tenantId);
      const email = normalizeEmail(reporter.email);
      const browser = summarizeUserAgent(requestContext.get()?.userAgent, ctx.locale);

      const tenantPlan = await loadTenantPlan(ctx, event.user.tenantId);

      const requestId = generateId();
      const uploaded = await takeOverUploads(ctx, {
        user: event.user,
        screen: HelpdeskScreens.report,
        entityType: HELPDESK_REQUEST_ENTITY,
        entityId: requestId,
        fileIds: payload.fileIds ?? [],
      });
      if (!uploaded.isSuccess) return uploaded;
      const fileIds = uploaded.data;
      const created = await requestExecutor.create(
        {
          id: requestId,
          kind: payload.kind,
          status: HELPDESK_STATUS.Open,
          source: HELPDESK_SOURCE.Admin,
          subject: payload.subject,
          message: payload.message,
          name: reporter.name,
          email,
          locale: ctx.locale,
          reporterUserId: event.user.id,
          reporterTenantId: event.user.tenantId,
          ...(tenantName !== null && { reporterTenantName: tenantName }),
          ...(tenantPlan !== null && { reporterTenantPlan: tenantPlan }),
          ...(payload.phone !== undefined && payload.phone !== "" && { phone: payload.phone }),
          ...(opts.appVersion !== undefined && { appVersion: opts.appVersion }),
          ...(browser !== null && { browser }),
          submittedAt: ctx.tz.now(),
          ...(fileIds.length > 0 && { [HELPDESK_UPLOAD_FIELD]: fileIds }),
          fileCount: fileIds.length,
          replyCount: 0,
        },
        platformActor(),
        db,
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
        notify(HELPDESK_NOTIFICATION_TYPES.confirmation, {
          route: { email },
          recipientId: requestId,
          data: helpdeskConfirmationVariables({
            appName: opts.appName,
            message: payload.message,
            locale: ctx.locale,
          }),
          idempotencyKey: helpdeskIdempotencyKeys.confirmation(requestId),
          priority: "normal",
          locale: resolveHelpdeskMailLocale(ctx.locale),
        }),
      );

      return { isSuccess: true, data: { kind: "reported", id: requestId } };
    },
  });
}
