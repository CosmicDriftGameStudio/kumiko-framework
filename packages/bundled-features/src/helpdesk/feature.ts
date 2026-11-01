import {
  access,
  createSystemConfig,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { HELPDESK_CLIENT_SOURCE } from "./client/helpdesk-client-source.ts";
import {
  createHelpdeskReplyEntity,
  createHelpdeskRequestEntity,
  helpdeskReplyEntity,
  helpdeskRequestEntity,
} from "./entity.ts";
import { createChallengeQuery } from "./handlers/challenge.query.ts";
import { createForwardRequestHandler } from "./handlers/forward-request.write.ts";
import { markDoneHandler } from "./handlers/mark-done.write.ts";
import { notifyReporterInAppHandler } from "./handlers/notify-reporter-in-app.write.ts";
import { openCountQuery } from "./handlers/open-count.query.ts";
import { repliesQuery } from "./handlers/replies.query.ts";
import { createReplyHandler } from "./handlers/reply.write.ts";
import { createReportHandler } from "./handlers/report.write.ts";
import { createRequestDeliveryQuery } from "./handlers/request-delivery.query.ts";
import { createRequestDetailQuery } from "./handlers/request-detail.query.ts";
import { createRequestListQuery } from "./handlers/request-list.query.ts";
import { createSendReplyMailHandler } from "./handlers/send-reply-mail.write.ts";
import { createSendTestHandler } from "./handlers/send-test.write.ts";
import { createSubmitHandler } from "./handlers/submit.write.ts";
import { createHelpdeskI18n } from "./i18n.ts";
import { TELEGRAM_FEATURE } from "./lib.ts";
import {
  HELPDESK_ACKNOWLEDGEMENT_VARIABLES,
  HELPDESK_CONFIRMATION_VARIABLES,
  HELPDESK_NEW_REQUEST_VARIABLES,
  HELPDESK_REPLY_VARIABLES,
  HELPDESK_TEST_VARIABLES,
  helpdeskAcknowledgementTemplate,
  helpdeskConfirmationTemplate,
  helpdeskNewRequestTemplate,
  helpdeskReplyTemplate,
  helpdeskTestTemplate,
  inAppTemplate,
  telegramTemplate,
} from "./mail.ts";
import {
  DEFAULT_RETENTION_KEEP_FOR,
  type HelpdeskOptions,
  resolveHelpdeskSettings,
} from "./options.ts";
import { createHelpdeskScreens } from "./screens.ts";
import { helpdeskDeleteHook, helpdeskExportHook } from "./user-data-hooks.ts";
import { HELPDESK_FEATURE } from "./web/constants.ts";

const REPLY_CONTEXT_FIELDS = ["name", "email", "replyTo"];

export function createHelpdeskFeature(opts: HelpdeskOptions): FeatureDefinition {
  const settings = resolveHelpdeskSettings(opts);
  const telegram = opts.telegram === true;
  const keepFor = opts.retentionKeepFor ?? DEFAULT_RETENTION_KEEP_FOR;
  const requestEntity =
    keepFor === DEFAULT_RETENTION_KEEP_FOR
      ? helpdeskRequestEntity
      : createHelpdeskRequestEntity(keepFor);
  const replyEntity =
    keepFor === DEFAULT_RETENTION_KEEP_FOR
      ? helpdeskReplyEntity
      : createHelpdeskReplyEntity(keepFor);

  return defineFeature(HELPDESK_FEATURE, (r) => {
    r.describe(
      "Helpdesk inbox: an anonymous browser client (GET /helpdesk/client.js) submits questions, contact requests, bug reports and wishes behind a honeypot, a minimum submit time and a single-use proof-of-work challenge; signed-in users file reports from the admin. Every request is stored platform-wide and every SystemAdmin is notified by mail, optionally also in a Telegram chat (option `telegram`, off by default); the notification names only the kind, the app and a link, never name, address, phone, subject or message, because mail and Telegram cannot be shredded. SystemAdmins reply by mail (Reply-To set, attachments, quoting the original) and mark requests done; a website sender gets a fixed acknowledgement, a signed-in reporter a copy and an in-app note. Personal data is crypto-shredding-ready and the EXT_USER_DATA hooks export and erase a user's requests.",
    );
    r.uiHints({ displayLabel: "Helpdesk", category: "communication", recommended: false });
    r.systemScope();
    r.requires({ features: ["config", "delivery", "user-data-rights", "files", "notes-history"] });
    // The feature manifest and reference are built from one mounted instance, so the off
    // default still names Telegram as an optional dependency.
    if (telegram) r.requires({ features: [TELEGRAM_FEATURE] });
    else r.optionalRequires(TELEGRAM_FEATURE);
    r.adoptsBundledLists();
    r.translations({ keys: createHelpdeskI18n() });

    r.config({
      keys: {
        replyTo: createSystemConfig("text", {
          default: "",
          write: access.systemAdmin,
          read: access.systemAdmin,
          pattern: { regex: "^$|^[^\\s@<>]{1,64}@[^\\s@<>]{1,200}\\.[^\\s@<>]{2,24}$" },
        }),
      },
    });
    if (telegram) {
      r.config({
        keys: {
          telegramChat: createSystemConfig("text", {
            default: "",
            write: access.systemAdmin,
            read: access.systemAdmin,
            pattern: { regex: "^$|^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$" },
          }),
        },
      });
    }

    r.notification("new-request", {
      variables: HELPDESK_NEW_REQUEST_VARIABLES,
      localizedTemplate: helpdeskNewRequestTemplate,
      ...(telegram && { templates: { telegram: telegramTemplate } }),
    });
    r.notification("confirmation", {
      variables: HELPDESK_CONFIRMATION_VARIABLES,
      localizedTemplate: helpdeskConfirmationTemplate,
    });
    r.notification("acknowledgement", {
      variables: HELPDESK_ACKNOWLEDGEMENT_VARIABLES,
      localizedTemplate: helpdeskAcknowledgementTemplate,
    });
    r.notification("reply", {
      variables: HELPDESK_REPLY_VARIABLES,
      localizedTemplate: helpdeskReplyTemplate,
    });
    r.notification("reply-in-app", {
      templates: { inApp: inAppTemplate },
    });
    if (telegram) {
      r.notification("test", {
        variables: HELPDESK_TEST_VARIABLES,
        localizedTemplate: helpdeskTestTemplate,
        templates: { telegram: telegramTemplate },
      });
    }

    r.entity({ name: "helpdesk-request", ...requestEntity });
    r.entity({ name: "helpdesk-reply", ...replyEntity });

    r.writeHandler(createSubmitHandler(opts, settings));
    r.writeHandler(createReportHandler(opts, settings));
    r.writeHandler(createForwardRequestHandler(opts));
    // The detail drawer prefills these for the form summary only; the form never sends them.
    r.writeHandler({ ...createReplyHandler(), excludedFields: REPLY_CONTEXT_FIELDS });
    r.writeHandler(createSendReplyMailHandler(opts));
    r.writeHandler(notifyReporterInAppHandler);
    r.writeHandler(markDoneHandler);
    if (telegram) r.writeHandler(createSendTestHandler(opts));

    r.queryHandler(createChallengeQuery(settings));
    r.queryHandler(openCountQuery);
    r.queryHandler(createRequestListQuery(requestEntity));
    r.queryHandler(createRequestDetailQuery(opts));
    r.queryHandler(repliesQuery);
    r.queryHandler(createRequestDeliveryQuery(opts));

    for (const screen of createHelpdeskScreens(opts, settings)) r.screen(screen);

    r.httpRoute({
      method: "GET",
      // A literal, not HELPDESK_CLIENT_PATH: the feature-AST extractor only reads string literals.
      path: "/helpdesk/client.js",
      anonymous: true,
      handler: async (c) =>
        c.body(HELPDESK_CLIENT_SOURCE, 200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
        }),
    });

    r.useExtension(EXT_USER_DATA, "helpdesk-request", {
      export: helpdeskExportHook,
      delete: helpdeskDeleteHook,
    });
    // Replies are exported nested under their request and erased with it (helpdeskDeleteHook).
    r.useExtension(EXT_USER_DATA, "helpdesk-reply", {
      export: async () => null,
      delete: async () => {},
    });
  });
}
