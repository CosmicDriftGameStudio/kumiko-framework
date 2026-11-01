import { access, createFilesField, createTextField } from "@cosmicdrift/kumiko-framework/engine";
import type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  EntityListScreenDefinition,
  ProjectionDetailScreenDefinition,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { DELIVERY_LOG_SCREEN_ID } from "../delivery/index.ts";
import { REPORT_ACCESS } from "./handlers/access.ts";
import type { HelpdeskOptions, HelpdeskSettings } from "./options.ts";
import {
  HELPDESK_ADMIN_KINDS,
  HELPDESK_DELIVERY_STATUS,
  HELPDESK_FEATURE,
  HELPDESK_MAX_FILES,
  HELPDESK_ORIGIN,
  HELPDESK_REPLY_CHANNELS,
  HELPDESK_STATUS,
  HELPDESK_UPLOAD_FIELD,
  HelpdeskConfigKeys,
  HelpdeskHandlers,
  HelpdeskQueries,
} from "./web/constants.ts";

const MAX_FILE_SIZE = "10MB";
const REQUEST_FIELD = `${HELPDESK_FEATURE}:entity:helpdesk-request:field`;
const DELIVERY_FIELD = `${HELPDESK_FEATURE}:entity:helpdesk-delivery:field`;
const TELEGRAM_BOT_TOKEN_SECRET = "channel-telegram:secret:bot-token";

export const REPORT_FIELD_LABEL = `${HELPDESK_FEATURE}:report.field`;
export const REPLY_FIELD_LABEL = `${HELPDESK_FEATURE}:reply.field`;

function attachmentsField() {
  return createFilesField({
    personal: false,
    reason: "is_business_data",
    maxCount: HELPDESK_MAX_FILES,
    maxSize: MAX_FILE_SIZE,
    display: "dropzone",
  });
}

// The files the form uploads stay pending under this screen's QN until the handler takes them
// over (copyPendingFileRefsToTenant).
function createReportScreen(
  opts: HelpdeskOptions,
  settings: HelpdeskSettings,
): ActionFormScreenDefinition {
  const withPhone = settings.phone !== "off";
  return {
    id: "report",
    type: "actionForm",
    dormant: true,
    handler: HelpdeskHandlers.report,
    summary: {
      title: `${HELPDESK_FEATURE}:report.hint`,
      subtitle: `${HELPDESK_FEATURE}:report.summary`,
      params: { appName: opts.appName },
    },
    fields: {
      kind: { type: "select", options: HELPDESK_ADMIN_KINDS, required: true, display: "radio" },
      ...(withPhone && {
        phone: { type: "text", format: "phone", required: settings.phone === "required" },
      }),
      subject: { type: "text", required: true },
      message: { type: "longText", required: true },
      [HELPDESK_UPLOAD_FIELD]: attachmentsField(),
    },
    layout: {
      sections: [
        {
          title: `${HELPDESK_FEATURE}:report.section`,
          description: `${HELPDESK_FEATURE}:report.section.description`,
          fields: [
            "kind",
            ...(withPhone ? ["phone"] : []),
            { field: "subject", span: 2 },
            "message",
            HELPDESK_UPLOAD_FIELD,
          ],
        },
      ],
    },
    fieldLabels: {
      kind: `${REPORT_FIELD_LABEL}.kind`,
      phone: `${REPORT_FIELD_LABEL}.phone`,
      subject: `${REPORT_FIELD_LABEL}.subject`,
      message: `${REPORT_FIELD_LABEL}.message`,
      [HELPDESK_UPLOAD_FIELD]: `${REPORT_FIELD_LABEL}.files`,
    },
    submitLabel: `${HELPDESK_FEATURE}:report.submit`,
    ...(opts.reportCancelTarget !== undefined && { cancelTarget: opts.reportCancelTarget }),
    successMessage: `${HELPDESK_FEATURE}:report.success`,
    access: REPORT_ACCESS,
  };
}

// The two reply screens differ only in the summary text: the screen QN is also the entityType the
// pending uploads hang under, so reply.write picks the variant by the reporter's reply channels.
function createReplyScreen(id: string, summarySubtitle: string): ActionFormScreenDefinition {
  return {
    id,
    type: "actionForm",
    dormant: true,
    handler: HelpdeskHandlers.reply,
    summary: { title: `${HELPDESK_FEATURE}:reply.title`, subtitle: summarySubtitle },
    fields: {
      requestId: { type: "text", required: true },
      message: { type: "longText", required: true },
      [HELPDESK_UPLOAD_FIELD]: attachmentsField(),
      markDone: { type: "boolean" },
      name: { type: "text" },
      email: { type: "text" },
      replyTo: { type: "text" },
    },
    layout: {
      sections: [
        {
          title: `${HELPDESK_FEATURE}:reply.section`,
          description: `${HELPDESK_FEATURE}:reply.section.description`,
          fields: [
            { field: "requestId", visible: false },
            { field: "name", visible: false },
            { field: "email", visible: false },
            { field: "replyTo", visible: false },
            "message",
            HELPDESK_UPLOAD_FIELD,
            "markDone",
          ],
        },
      ],
    },
    fieldLabels: {
      message: `${REPLY_FIELD_LABEL}.message`,
      [HELPDESK_UPLOAD_FIELD]: `${REPLY_FIELD_LABEL}.files`,
      markDone: `${REPLY_FIELD_LABEL}.mark-done`,
    },
    submitLabel: `${HELPDESK_FEATURE}:reply.submit`,
    access: { roles: access.systemAdmin },
  };
}

const requestListScreen: EntityListScreenDefinition = {
  id: "request-list",
  type: "entityList",
  entity: "helpdesk-request",
  dormant: true,
  allowCreate: false,
  searchable: true,
  columns: [
    { field: "submittedAt", display: "datetime" },
    "kind",
    { field: "name", label: `${HELPDESK_FEATURE}:list.from` },
    { field: "reporterTenantName", label: `${REQUEST_FIELD}:reporterTenantName` },
    { field: "subject", hideOnNarrow: true },
    {
      field: "source",
      hideOnNarrow: true,
      renderer: { format: "enumOption", keyPrefix: `${REQUEST_FIELD}:source:option:` },
    },
    { field: "fileCount", label: `${REQUEST_FIELD}:fileCount`, hideOnNarrow: true },
    "status",
  ],
  facets: {
    status: {
      display: "chips",
      showCounts: true,
      extraOptions: [
        { id: "all", label: `${HELPDESK_FEATURE}:filter.all`, values: [], position: "start" },
      ],
    },
    kind: { display: "select" },
    source: { display: "select" },
  },
  defaultFilters: { status: [HELPDESK_STATUS.Open] },
  defaultSort: { field: "submittedAt", dir: "desc" },
  rowActions: [
    {
      kind: "navigate",
      id: "open",
      label: `${HELPDESK_FEATURE}:action.open`,
      screen: "request-detail",
      entityId: "id",
      rowClick: true,
    },
    {
      kind: "writeHandler",
      id: "mark-done",
      label: `${HELPDESK_FEATURE}:action.mark-done`,
      handler: HelpdeskHandlers.markDone,
      payload: { pick: ["id"] },
      visible: { field: "status", ne: HELPDESK_STATUS.Done },
    },
  ],
  bulkActions: [{ id: "mark-done", rowAction: "mark-done" }],
  access: { roles: access.systemAdmin },
};

const deliveryStatusTones = {
  [HELPDESK_DELIVERY_STATUS.Pending]: "warn",
  [HELPDESK_DELIVERY_STATUS.Delivered]: "ok",
  [HELPDESK_DELIVERY_STATUS.Failed]: "bad",
  [HELPDESK_DELIVERY_STATUS.Skipped]: "neutral",
  [HELPDESK_DELIVERY_STATUS.Read]: "accent",
} as const;

function detailLinkTarget(
  link: string | false | undefined,
  defaultScreen: string,
): string | undefined {
  if (link === false) return undefined;
  return link ?? defaultScreen;
}

function createRequestDetailScreen(
  opts: HelpdeskOptions,
  settings: HelpdeskSettings,
): ProjectionDetailScreenDefinition {
  const userScreen = detailLinkTarget(opts.detailLinks?.user, "user-edit");
  const tenantScreen = detailLinkTarget(opts.detailLinks?.tenant, "tenant-edit");
  return {
    id: "request-detail",
    type: "projectionDetail",
    dormant: true,
    query: HelpdeskQueries.requestDetail,
    listScreenId: "request-list",
    header: {
      title: "subject",
      subtitle: [
        {
          field: "kind",
          format: { format: "enumOption", keyPrefix: `${REQUEST_FIELD}:kind:option:` },
        },
        {
          field: "name",
          ...(userScreen !== undefined && {
            navigate: { screen: userScreen, entityId: "reporterUserId" },
          }),
        },
        {
          field: "reporterTenantName",
          ...(tenantScreen !== undefined && {
            navigate: { screen: tenantScreen, entityId: "reporterTenantId" },
          }),
        },
        {
          field: "submittedAt",
          format: { format: "timestamp", dateStyle: "medium", timeStyle: "short" },
        },
      ],
      status: "status",
      statusFormat: { format: "enumOption", keyPrefix: `${REQUEST_FIELD}:status:option:` },
      statusTones: {
        [HELPDESK_STATUS.Open]: "warn",
        [HELPDESK_STATUS.Answered]: "accent",
        [HELPDESK_STATUS.Done]: "ok",
      },
    },
    actions: [
      {
        kind: "writeHandler",
        id: "mark-done",
        label: `${HELPDESK_FEATURE}:action.mark-done`,
        handler: HelpdeskHandlers.markDone,
        icon: "check-circle",
        style: "secondary",
        payload: { pick: ["id"] },
        visible: { field: "status", ne: HELPDESK_STATUS.Done },
      },
      {
        kind: "drawer",
        id: "reply",
        icon: "mail",
        style: "primary",
        label: `${HELPDESK_FEATURE}:action.reply`,
        screen: "reply",
        params: { map: { requestId: "id", name: "name", email: "email", replyTo: "replyTo" } },
        title: "screen:reply.title",
        visible: { field: "replyChannels", eq: HELPDESK_REPLY_CHANNELS.EmailAndInApp },
      },
      {
        kind: "drawer",
        id: "reply-mail",
        icon: "mail",
        style: "primary",
        label: `${HELPDESK_FEATURE}:action.reply`,
        screen: "reply-mail",
        params: { map: { requestId: "id", name: "name", email: "email", replyTo: "replyTo" } },
        title: "screen:reply-mail.title",
        visible: { field: "replyChannels", eq: HELPDESK_REPLY_CHANNELS.Email },
      },
    ],
    primaryAction: "reply",
    inlineActions: ["mark-done"],
    fieldLabels: {
      message: `${REQUEST_FIELD}:message`,
      fileIds: `${HELPDESK_FEATURE}:detail.attachments`,
      name: `${REQUEST_FIELD}:name`,
      email: `${REQUEST_FIELD}:email`,
      phone: `${REQUEST_FIELD}:phone`,
      reporterTenantPlan: `${REQUEST_FIELD}:reporterTenantPlan`,
      origin: `${REQUEST_FIELD}:origin`,
      page: `${REQUEST_FIELD}:page`,
      versionLabel: `${REQUEST_FIELD}:versionLabel`,
      browser: `${REQUEST_FIELD}:browser`,
    },
    layout: {
      sections: [
        { title: `${HELPDESK_FEATURE}:detail.section.message`, fields: ["message"] },
        {
          kind: "relatedList",
          readOnly: true,
          title: `${HELPDESK_FEATURE}:detail.section.replies`,
          query: HelpdeskQueries.replies,
          columns: [
            {
              field: "sentAt",
              renderer: { format: "timestamp", dateStyle: "medium", timeStyle: "short" },
              label: `${HELPDESK_FEATURE}:entity:helpdesk-reply:field:sentAt`,
            },
            {
              field: "authorName",
              label: `${HELPDESK_FEATURE}:entity:helpdesk-reply:field:authorName`,
            },
            { field: "message", label: `${HELPDESK_FEATURE}:entity:helpdesk-reply:field:message` },
          ],
        },
        {
          title: `${HELPDESK_FEATURE}:detail.section.files`,
          fields: [
            {
              field: HELPDESK_UPLOAD_FIELD,
              renderer: { format: "file" },
              visible: { field: "fileCount", ne: 0 },
            },
          ],
        },
        {
          title: `${HELPDESK_FEATURE}:detail.section.sender`,
          fields: [
            "name",
            { field: "email", format: "email" },
            ...(settings.phone !== "off"
              ? [
                  {
                    field: "phone",
                    format: "phone" as const,
                    visible: { field: "phone", notIn: [null, ""] },
                  },
                ]
              : []),
            "reporterTenantPlan",
          ],
        },
        {
          title: `${HELPDESK_FEATURE}:detail.section.origin`,
          fields: [
            {
              field: "origin",
              renderer: { format: "enumOption", keyPrefix: `${REQUEST_FIELD}:origin:option:` },
            },
            { field: "page", visible: { field: "origin", eq: HELPDESK_ORIGIN.Website } },
            "versionLabel",
            "browser",
          ],
        },
        {
          kind: "relatedList",
          readOnly: true,
          title: `${HELPDESK_FEATURE}:detail.section.delivery`,
          query: HelpdeskQueries.requestDelivery,
          toolbarActions: [
            {
              kind: "navigate",
              id: "delivery-log",
              label: `${HELPDESK_FEATURE}:detail.delivery-log`,
              screen: DELIVERY_LOG_SCREEN_ID,
            },
          ],
          columns: [
            {
              field: "channel",
              label: `${DELIVERY_FIELD}:channel`,
              renderer: { format: "enumOption", keyPrefix: `${DELIVERY_FIELD}:channel:option:` },
            },
            { field: "recipient", label: `${DELIVERY_FIELD}:recipient` },
            {
              field: "at",
              renderer: { format: "timestamp", dateStyle: "medium", timeStyle: "short" },
              label: `${DELIVERY_FIELD}:at`,
            },
            {
              field: "status",
              label: `${DELIVERY_FIELD}:status`,
              renderer: {
                format: "enumOption",
                keyPrefix: `${DELIVERY_FIELD}:status:option:`,
                tones: deliveryStatusTones,
              },
            },
          ],
        },
        {
          kind: "extension",
          title: `${HELPDESK_FEATURE}:detail.section.notes`,
          component: { react: { __component: "NotesSection" } },
          entityName: "helpdesk-request",
        },
      ],
    },
    access: { roles: access.systemAdmin },
  };
}

function createForwardingScreen(telegram: boolean): ConfigEditScreenDefinition {
  return {
    id: "forwarding",
    type: "configEdit",
    dormant: true,
    scope: "system",
    configKeys: {
      replyTo: HelpdeskConfigKeys.replyTo,
      ...(telegram && { telegramChat: HelpdeskConfigKeys.telegramChat }),
    },
    ...(telegram && { secretKeys: { botToken: TELEGRAM_BOT_TOKEN_SECRET } }),
    fields: {
      replyTo: createTextField({
        format: "email",
        maxLength: 254,
        personal: false,
        reason: "is_business_data",
      }),
      ...(telegram && {
        telegramChat: createTextField({
          maxLength: 64,
          personal: false,
          reason: "is_business_data",
        }),
        botToken: createTextField({
          writeOnly: true,
          maxLength: 200,
          personal: false,
          reason: "is_business_data",
        }),
      }),
    },
    layout: {
      variant: "settings-list",
      sections: [
        {
          title: `${HELPDESK_FEATURE}:forwarding.email`,
          description: `${HELPDESK_FEATURE}:forwarding.email.description`,
          fields: ["replyTo"],
        },
        ...(telegram
          ? [
              {
                title: `${HELPDESK_FEATURE}:forwarding.telegram`,
                description: `${HELPDESK_FEATURE}:forwarding.telegram.description`,
                fields: ["telegramChat", "botToken"],
              },
            ]
          : []),
      ],
    },
    fieldLabels: {
      replyTo: `${HELPDESK_FEATURE}:config.reply-to.label`,
      telegramChat: `${HELPDESK_FEATURE}:config.telegram-chat.label`,
      botToken: `${HELPDESK_FEATURE}:config.bot-token.label`,
    },
    fieldDescriptions: {
      replyTo: `${HELPDESK_FEATURE}:config.reply-to.description`,
      telegramChat: `${HELPDESK_FEATURE}:config.telegram-chat.description`,
      botToken: `${HELPDESK_FEATURE}:config.bot-token.description`,
    },
    submitLabel: `${HELPDESK_FEATURE}:forwarding.submit`,
    ...(telegram && {
      actions: [
        {
          id: "send-test",
          handler: HelpdeskHandlers.sendTest,
          label: `${HELPDESK_FEATURE}:config.send-test.label`,
          description: `${HELPDESK_FEATURE}:config.send-test.description`,
          buttonLabel: `${HELPDESK_FEATURE}:config.send-test.button`,
          afterField: "botToken",
          successMessage: `${HELPDESK_FEATURE}:config.send-test.success`,
        },
      ],
    }),
    access: { roles: access.systemAdmin },
  };
}

export function createHelpdeskScreens(
  opts: HelpdeskOptions,
  settings: HelpdeskSettings,
): readonly ScreenDefinition[] {
  return [
    createReportScreen(opts, settings),
    requestListScreen,
    createRequestDetailScreen(opts, settings),
    createReplyScreen("reply", `${HELPDESK_FEATURE}:reply.summary.in-app`),
    createReplyScreen("reply-mail", `${HELPDESK_FEATURE}:reply.summary.mail`),
    createForwardingScreen(opts.telegram === true),
  ];
}
