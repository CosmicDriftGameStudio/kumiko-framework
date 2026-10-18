// step-dispatcher — bundled-feature that drains deferred Tier-2 step
// requests (webhook.send, mail.send, ...) after their TX commits.
//
// The `kumiko:system:step.dispatch-requested` system event (registry-bypassed,
// see SYSTEM_EVENT_PREFIX) is picked up by an MSP that only enqueues a
// per-dispatch job. The job performs the side-effect and emits
// `kumiko:system:step.dispatched` or `kumiko:system:step.dispatch-failed` back
// onto the same stream so the audit trail lives in the event log only — no
// separate status table. The job's Redis data carries only the stream id and
// tenant, never the (encrypted) request payload.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type FeatureDefinition,
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { createMultiStreamApplyContext } from "@cosmicdrift/kumiko-framework/pipeline";
import * as z from "zod";
import {
  DELIVER_MAX_PER_TENANT,
  DELIVER_RETRIES,
  deliverJobId,
  STEP_DISPATCHER_FEATURE,
  StepDispatcherJobs,
} from "./constants.ts";
import {
  deliverDispatchRequest,
  eraseDispatchKey,
  isDispatchOutcome,
} from "./deliver-dispatch-request.ts";
import {
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  WEBHOOK_AUTH_SECRET_NAMESPACE_OPTIONS,
} from "./webhook-runner.ts";

export const stepDispatcherEnvSchema = z.object({
  [WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR]: z
    .string()
    .optional()
    .describe(
      "Comma-separated operator allowlist of private/internal hosts (e.g. a local webhook-receiver for dev/test) that bypass the public-address check for webhook.send targets. Never a tenant-config value.",
    ),
});

export { STEP_DISPATCH_AGGREGATE_TYPE };

const NEEDS_JOB_RUNNER_ERROR = "step-dispatcher needs a job runner (Redis) to deliver";
const DELIVER_ESCAPE_HATCH_REASON =
  "reads the dispatch stream and appends its outcome event, which needs a raw connection";

const deliverJobPayloadSchema = z.object({ aggregateId: z.string() });

export function createStepDispatcherFeature(): FeatureDefinition {
  return defineFeature("step-dispatcher", (r) => {
    r.describe(
      "Internal system feature that drains deferred Tier-2 side-effects (currently `webhook.send` and `mail.send`) after their originating transaction commits. An `r.multiStreamProjection` on the `kumiko:system:step.dispatch-requested` system event enqueues one `step-dispatcher:job:deliver` BullMQ job per dispatch (Redis carries only the stream id and tenant, never the request payload). The job performs the actual HTTP or mail delivery and appends `kumiko:system:step.dispatched` or `kumiko:system:step.dispatch-failed` back onto the same stream, so the outcome is recorded in the event log without a separate status table. Transient failures (network error, timeout, 5xx, 408, 429, any mail adapter failure) are retried 3 times with exponential backoff; the outcome is recorded after the final attempt and the payload key is erased only then. Permanent failures (invalid url, blocked host, other 4xx, unavailable auth secret) are recorded immediately. At most 2 deliveries per tenant run at once (`maxPerTenant` with `onLimit: \"defer\"`), so a slow receiver of one tenant does not delay other tenants. Requires a job runner (Redis) and a worker consuming the job's default `worker` lane; without a job runner the projection fails loudly. Mount this feature explicitly via `createStepDispatcherFeature()` in your app's feature list alongside any features that use `r.step.webhook.send` or `r.step.mail.send`. Requires the `secrets` feature (`createSecretsFeature()`) to be mounted — `webhook.send` auth resolves per-tenant through it, under `step-dispatcher:webhook-auth.<name>`. Every `webhook.send` request carries `Idempotency-Key: <dispatch stream id>`, stable across retries and redeliveries of the same dispatch request; an explicit `Idempotency-Key` in `headers` takes precedence.",
    );
    r.secretNamespace("webhook-auth", WEBHOOK_AUTH_SECRET_NAMESPACE_OPTIONS);
    r.uiHints({
      displayLabel: "Step Dispatcher · Deferred Side-Effects",
      category: "infrastructure",
      recommended: false,
    });
    r.envSchema(stepDispatcherEnvSchema);
    r.requires({ features: ["secrets"] });

    // Literal name: the few-shot corpus parser only reads string-literal job names.
    // StepDispatcherJobNames.deliver mirrors it; feature.boot.test.ts pins the two together.
    r.job(
      "deliver",
      {
        trigger: { manual: true },
        retries: DELIVER_RETRIES,
        backoff: "exponential",
        maxPerTenant: { limit: DELIVER_MAX_PER_TENANT, onLimit: "defer" },
        escapeHatch: { reason: DELIVER_ESCAPE_HATCH_REASON },
      },
      async (payload, ctx) => {
        const { aggregateId } = deliverJobPayloadSchema.parse(payload);
        const db = ctx.db.unsafeRaw() as DbConnection; // @cast-boundary db-operator — jobs never run inside a DbTx
        const tenantId = ctx.systemUser.tenantId;
        await deliverDispatchRequest({
          aggregateId,
          tenantId,
          attempt: ctx.attempt,
          finalAttempt: ctx.finalAttempt,
          applyContextFor: (userId) =>
            createMultiStreamApplyContext({
              registry: ctx.registry,
              db,
              tenantId,
              userId,
              callerFeature: STEP_DISPATCHER_FEATURE,
              ...(ctx.secrets && { secrets: ctx.secrets }),
            }),
        });
      },
    );

    r.multiStreamProjection({
      name: "step-dispatcher",
      apply: {
        [STEP_DISPATCH_REQUESTED_TYPE]: async (event, _tx, ctx) => {
          const stream = await ctx.loadAggregate(event.aggregateId);
          if (stream.some(isDispatchOutcome)) {
            await eraseDispatchKey(event.aggregateId);
            // skip: redelivery after an outcome was recorded — only the erase is repeated
            return;
          }
          if (!ctx.jobs) throw new Error(NEEDS_JOB_RUNNER_ERROR);
          await ctx.jobs.dispatch(
            StepDispatcherJobs.deliver,
            { aggregateId: event.aggregateId, _tenantId: event.tenantId },
            { jobId: deliverJobId(event.aggregateId) },
          );
        },
      },
    });
  });
}
