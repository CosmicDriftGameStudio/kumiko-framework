import {
  access,
  createSystemConfig,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { CONTACT_CLIENT_SOURCE } from "./client/contact-client-source.ts";
import {
  contactReplyEntity,
  contactRequestEntity,
  createContactReplyEntity,
  createContactRequestEntity,
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
import { createContactI18n } from "./i18n.ts";
import { TELEGRAM_FEATURE } from "./lib.ts";
import {
  CONTACT_ACKNOWLEDGEMENT_VARIABLES,
  CONTACT_CONFIRMATION_VARIABLES,
  CONTACT_NEW_REQUEST_VARIABLES,
  CONTACT_REPLY_VARIABLES,
  CONTACT_TEST_VARIABLES,
  contactAcknowledgementTemplate,
  contactConfirmationTemplate,
  contactNewRequestTemplate,
  contactReplyTemplate,
  contactTestTemplate,
  inAppTemplate,
  telegramTemplate,
} from "./mail.ts";
import {
  type ContactOptions,
  DEFAULT_RETENTION_KEEP_FOR,
  resolveContactSettings,
} from "./options.ts";
import { createContactScreens } from "./screens.ts";
import { contactDeleteHook, contactExportHook } from "./user-data-hooks.ts";
import { CONTACT_FEATURE } from "./web/constants.ts";

const REPLY_CONTEXT_FIELDS = ["name", "email", "replyTo"];

export function createContactFeature(opts: ContactOptions): FeatureDefinition {
  const settings = resolveContactSettings(opts);
  const telegram = opts.telegram === true;
  const keepFor = opts.retentionKeepFor ?? DEFAULT_RETENTION_KEEP_FOR;
  const requestEntity =
    keepFor === DEFAULT_RETENTION_KEEP_FOR
      ? contactRequestEntity
      : createContactRequestEntity(keepFor);
  const replyEntity =
    keepFor === DEFAULT_RETENTION_KEEP_FOR ? contactReplyEntity : createContactReplyEntity(keepFor);

  return defineFeature(CONTACT_FEATURE, (r) => {
    r.describe(
      "Contact inbox: an anonymous browser client (GET /contact/client.js) submits questions, contact requests, bug reports and wishes behind a honeypot, a minimum submit time and a single-use proof-of-work challenge; signed-in users file reports from the admin. Every request is stored platform-wide and every SystemAdmin is notified by mail, optionally also in a Telegram chat (option `telegram`, off by default); the notification names only the kind, the app and a link, never name, address, phone, subject or message, because mail and Telegram cannot be shredded. SystemAdmins reply by mail (Reply-To set, attachments, quoting the original) and mark requests done; a website sender gets a fixed acknowledgement, a signed-in reporter a copy and an in-app note. Personal data is crypto-shredding-ready and the EXT_USER_DATA hooks export and erase a user's requests.",
    );
    r.uiHints({ displayLabel: "Contact", category: "communication", recommended: false });
    r.systemScope();
    r.requires({ features: ["config", "delivery", "user-data-rights", "files"] });
    if (telegram) r.requires({ features: [TELEGRAM_FEATURE] });
    r.adoptsBundledLists();
    r.translations({ keys: createContactI18n() });

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
      variables: CONTACT_NEW_REQUEST_VARIABLES,
      localizedTemplate: contactNewRequestTemplate,
      ...(telegram && { templates: { telegram: telegramTemplate } }),
    });
    r.notification("confirmation", {
      variables: CONTACT_CONFIRMATION_VARIABLES,
      localizedTemplate: contactConfirmationTemplate,
    });
    r.notification("acknowledgement", {
      variables: CONTACT_ACKNOWLEDGEMENT_VARIABLES,
      localizedTemplate: contactAcknowledgementTemplate,
    });
    r.notification("reply", {
      variables: CONTACT_REPLY_VARIABLES,
      localizedTemplate: contactReplyTemplate,
    });
    r.notification("reply-in-app", { templates: { inApp: inAppTemplate } });
    if (telegram) {
      r.notification("test", {
        variables: CONTACT_TEST_VARIABLES,
        localizedTemplate: contactTestTemplate,
        templates: { telegram: telegramTemplate },
      });
    }

    r.entity({ name: "contact-request", ...requestEntity });
    r.entity({ name: "contact-reply", ...replyEntity });

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

    for (const screen of createContactScreens(opts, settings)) r.screen(screen);

    r.httpRoute({
      method: "GET",
      // A literal, not CONTACT_CLIENT_PATH: the feature-AST extractor only reads string literals.
      path: "/contact/client.js",
      anonymous: true,
      handler: async (c) =>
        c.body(CONTACT_CLIENT_SOURCE, 200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
        }),
    });

    r.useExtension(EXT_USER_DATA, "contact-request", {
      export: contactExportHook,
      delete: contactDeleteHook,
    });
    // Replies are exported nested under their request and erased with it (contactDeleteHook).
    r.useExtension(EXT_USER_DATA, "contact-reply", {
      export: async () => null,
      delete: async () => {},
    });
  });
}
