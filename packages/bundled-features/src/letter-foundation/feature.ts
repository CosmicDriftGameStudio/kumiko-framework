import {
  access,
  createSystemConfig,
  createTenantConfig,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
  EXT_TENANT_DATA,
  EXT_USER_DATA,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  LETTER_APPROVED_STALE_MS,
  LETTER_CONFIG_KEYS,
  LETTER_CREATED_EVENT,
  LETTER_ENTITY,
  LETTER_FEATURE,
  LETTER_HANDOVER_GIVE_UP_MS,
  LETTER_HANDOVER_HOLD_MS,
  LETTER_HANDOVER_RESTART_EVENT,
  LETTER_POLL_LIMIT_PER_RUN,
  LETTER_PROVIDER_EXTENSION,
  LETTER_ROLES,
  LetterEvents,
  LetterI18n,
} from "./constants.ts";
import { letterEntity, letterSubmissionTable } from "./entity.ts";
import { announceCreatedHandler } from "./handlers/announce-created.write.ts";
import { applyProviderStatusHandler } from "./handlers/apply-provider-status.write.ts";
import { createApproveHandler } from "./handlers/approve.write.ts";
import { createApproveManyHandler } from "./handlers/approve-many.write.ts";
import { createBudgetQuery } from "./handlers/budget.query.ts";
import { cancelHandler } from "./handlers/cancel.write.ts";
import { cancelBeforeHandoverHandler } from "./handlers/cancel-before-handover.write.ts";
import { markSubmissionUnknownHandler } from "./handlers/mark-submission-unknown.write.ts";
import { createPrepareHandler } from "./handlers/prepare.write.ts";
import { createPreviewQuery } from "./handlers/preview.query.ts";
import { recordAcceptanceHandler } from "./handlers/record-acceptance.write.ts";
import { recordRejectionHandler } from "./handlers/record-rejection.write.ts";
import { requestHandoverRestartHandler } from "./handlers/request-handover-restart.write.ts";
import { resolveUnknownHandler } from "./handlers/resolve-unknown.write.ts";
import { startSubmissionHandler } from "./handlers/start-submission.write.ts";
import { LETTER_FOUNDATION_I18N } from "./i18n.ts";
import { pollLetters } from "./jobs/poll-letters.job.ts";
import { prepareLetter } from "./jobs/prepare-letter.job.ts";
import { createSubmitLetterRun } from "./jobs/submit-letter.job.ts";
import { LetterTransitionEventSchema } from "./payloads.ts";
import {
  LETTER_TENANT_DESTROY_ARCHIVE_REASON,
  letterSubmissionTenantDestroyHook,
  letterTenantDestroyHook,
} from "./tenant-destroy-hook.ts";
import type { LetterProviderPlugin } from "./types.ts";
import { letterDeleteHook, letterExportHook } from "./user-data-hooks.ts";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [LETTER_PROVIDER_EXTENSION]: LetterProviderPlugin;
  }
}

const readAccess = { roles: [LETTER_ROLES.approver, ...access.admin] };

export type LetterFoundationOptions = {
  /** How long after approval the handover waits, so a letter can still be canceled without touching the provider. */
  readonly handoverHoldMs?: number;
  /** Letters asked at the provider per tenant and run; the provider allows 120 requests per minute for the whole account. */
  readonly pollLimitPerRun?: number;
};

export function createLetterFoundationFeature(options: LetterFoundationOptions = {}) {
  const handoverHoldMs = options.handoverHoldMs ?? LETTER_HANDOVER_HOLD_MS;
  const pollLimitPerRun = options.pollLimitPerRun ?? LETTER_POLL_LIMIT_PER_RUN;
  const feature = defineFeature(
    LETTER_FEATURE,
    (r) => {
      r.describe(
        "Sends PDFs as postal letters through a print provider. Defines the `letterProvider` extension point, the `letter` entity with its status flow (awaiting approval, approved, submitting, submission unknown, accepted, on hold, sent, failed, canceled, returned) and `sendLetter`, which always creates a letter that waits for approval, then a job prepares it (merged PDF, page and sheet count, price; a document problem is stored as `preparationIssue`). With the option `approval: auto` of `sendLetter` (an app decision, not part of the input schema), a prepared letter that fits the monthly limit is approved without a person; `approve-many` approves a selection all or none, `budget` shows limit and use, `quoteLetter` prices a document before it is sent. A printed letter never meets the written form (`schriftform`): `sendLetter` refuses it unless `formRiskAcknowledged` is true, set by the app after the user accepted the risk; the preview returns `formRequirement` and `formRiskAcknowledged` so the app can warn before approval. `envelope` is `folded` (default) or `flat` (unfolded A4 in a C4 envelope), if the provider offers it. A user with the LetterApprover role approves it after seeing the price; the letter is then handed to the provider. Real sending is switched on by the system config key `live` (SystemAdmin mask, default off) and only happens with NODE_ENV=production; everywhere else the inmemory provider runs, whatever the switch says. In production with the switch off letters are refused (`letter_provider_not_configured`), never simulated. With the switch on, the one mounted letter-provider-* feature sends. A handover without an answer is never repeated on its own: the poll job looks the letter up at the provider, and it asks the submit job to retry a letter that stayed approved. An approved letter that cannot be handed over for two hours fails with `handover-stalled`. A letter stays with the provider it was approved with. A monthly cost limit per tenant is set with the `monthlyCostLimitCents` config key, 0 until a value is set. The recipient address is personal data of the letter.",
      );
      r.uiHints({ displayLabel: "Letters", category: "notifications", recommended: false });
      r.requires({ features: ["config", "files", "cap-counter", "tenant-lifecycle"] });
      r.extendsRegistrar(LETTER_PROVIDER_EXTENSION, {});

      r.config({
        keys: {
          [LETTER_CONFIG_KEYS.live]: createSystemConfig("boolean", {
            default: false,
            write: access.systemAdmin,
            read: access.systemAdmin,
            mask: { title: LetterI18n.liveTitle, icon: "rocket" },
          }),
        },
      });

      const monthlyCostLimitCents = r.config({
        keys: {
          [LETTER_CONFIG_KEYS.monthlyCostLimitCents]: createTenantConfig("number", {
            default: 0,
            bounds: { min: 0 },
            write: access.privileged,
            read: access.admin,
            mask: {
              title: LetterI18n.monthlyLimitTitle,
              description: LetterI18n.monthlyLimitHelp,
              icon: "coins",
            },
          }),
        },
      }).monthlyCostLimitCents;

      r.translations({ keys: LETTER_FOUNDATION_I18N });
      r.entity(letterEntity);
      r.storeTable(letterSubmissionTable, { reason: "read_side.letter_submissions_direct_write" });

      r.defineEvent(LETTER_CREATED_EVENT, LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("approved", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("submitting", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("submission-unknown", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("accepted", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("on-hold", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("sent", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent(LETTER_HANDOVER_RESTART_EVENT, LetterTransitionEventSchema, {
        piiFields: "none",
      });
      r.defineEvent("failed", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("canceled", LetterTransitionEventSchema, { piiFields: "none" });
      r.defineEvent("returned", LetterTransitionEventSchema, { piiFields: "none" });

      r.writeHandler(createApproveHandler(monthlyCostLimitCents));
      r.writeHandler(createApproveManyHandler(monthlyCostLimitCents));
      r.writeHandler(createPrepareHandler(monthlyCostLimitCents));
      r.writeHandler(announceCreatedHandler);
      r.writeHandler(cancelHandler);
      r.writeHandler(resolveUnknownHandler);
      r.writeHandler(startSubmissionHandler);
      r.writeHandler(recordAcceptanceHandler);
      r.writeHandler(recordRejectionHandler);
      r.writeHandler(markSubmissionUnknownHandler);
      r.writeHandler(requestHandoverRestartHandler);
      r.writeHandler(cancelBeforeHandoverHandler);
      r.writeHandler(applyProviderStatusHandler);
      r.job({
        name: "prepare",
        trigger: { on: [LetterEvents.created] },
        // Safe to repeat: a letter that is prepared or no longer waiting is left alone.
        retries: 5,
        backoff: { type: "exponential", delayMs: 2_000 },
        handler: (payload, ctx) => prepareLetter(payload, ctx),
      });
      const submitLetterRun = createSubmitLetterRun(monthlyCostLimitCents, handoverHoldMs);
      r.job({
        name: "submit",
        trigger: { on: [LetterEvents.approved, LetterEvents.handoverRestartRequested] },
        concurrency: "sequential",
        // Safe to repeat: a run in `approved` finds its claim and takes a fresh reservation, a letter in any other state is left alone.
        retries: 5,
        backoff: { type: "exponential", delayMs: 2_000 },
        handler: (payload, ctx) => submitLetterRun(payload, ctx),
      });
      r.job({
        name: "poll",
        trigger: { cron: "*/5 * * * *" },
        perTenant: true,
        concurrency: "skip",
        handler: (_payload, ctx) =>
          pollLetters(ctx, {
            limitPerRun: pollLimitPerRun,
            approvedStaleMs: handoverHoldMs + LETTER_APPROVED_STALE_MS,
            giveUpMs: handoverHoldMs + LETTER_HANDOVER_GIVE_UP_MS,
          }),
      });
      r.applyExtension({
        name: EXT_TENANT_DATA,
        entity: LETTER_ENTITY,
        destroy: letterTenantDestroyHook,
        escapeHatch: { reason: LETTER_TENANT_DESTROY_ARCHIVE_REASON },
      });
      r.applyExtension({
        name: EXT_TENANT_DATA,
        entity: "letter-submission",
        destroy: letterSubmissionTenantDestroyHook,
      });
      r.applyExtension({
        name: EXT_USER_DATA,
        entity: LETTER_ENTITY,
        export: letterExportHook,
        delete: letterDeleteHook,
      });
      r.queryHandler(createPreviewQuery(monthlyCostLimitCents));
      r.queryHandler(createBudgetQuery(monthlyCostLimitCents));
      r.queryHandler(
        defineEntityListHandler(LETTER_ENTITY, letterEntity, {
          access: readAccess,
          description:
            "Lists letters with status, shipping mode, price and the object they belong to; paging, filtering and sorting.",
        }),
      );
      r.queryHandler(
        defineEntityDetailHandler(LETTER_ENTITY, letterEntity, {
          access: readAccess,
          description: "Returns one letter with its status, price, tracking and recipient address.",
        }),
      );

      return { monthlyCostLimitCents };
    },
    Object.keys(options).length === 0 ? { dedupeOptions: {} } : undefined,
  );
  return feature;
}
