import {
  access,
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTenantConfig,
  createTenantSeed,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

import {
  AI_STEPS,
  ANTHROPIC_CONNECTION_ID,
  MODELS_BY_PROVIDER,
  PROVIDER_LABELS,
  PROVIDERS,
  type Provider,
} from "./catalog";
import { AI_SETTINGS_I18N } from "./i18n";

export const connectionEntity = createEntity({
  table: "read_styleguide_ai_connections",
  fields: {
    name: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      sortable: true,
      searchable: true,
    }),
    provider: createSelectField({ options: PROVIDERS, default: "anthropic" }),
    apiKey: createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
  },
});

const openReason =
  "demo app: any signed-in user manages AI connections and settings; there is no per-user ownership in this sample";
const open = {
  access: { openToAll: { reason: openReason, personalData: "tenant-members" } },
} as const;
const openRead = { access: { openToAll: { reason: openReason } } } as const;

const noPayload = z.object({});
const connectionIdPayload = z.object({ connectionId: z.string().optional() });
const idPayload = z.object({ id: z.string() });

const { executor } = createEntityExecutor("connection", connectionEntity);

function isProvider(value: unknown): value is Provider {
  return PROVIDERS.some((provider) => provider === value);
}

export const aiSettingsFeature = defineFeature("ai-settings", (r) => {
  r.requires("config");
  r.translations({ keys: AI_SETTINGS_I18N });

  r.crud("connection", connectionEntity, { write: open, read: openRead });
  r.queryHandler(
    "connection-options",
    noPayload,
    async (query, ctx) => {
      const page = await executor.list({ limit: 100 }, query.user, ctx.db);
      return {
        rows: page.rows.map((row) => ({
          value: String(row["id"]),
          label: String(row["name"]),
        })),
      };
    },
    openRead,
  );

  r.queryHandler(
    "model-options",
    connectionIdPayload,
    async (query, ctx) => {
      const { connectionId } = query.payload;
      if (connectionId === undefined) return { rows: [] };
      const row = await executor.detail({ id: connectionId }, query.user, ctx.db);
      const provider = row?.["provider"];
      return { rows: isProvider(provider) ? MODELS_BY_PROVIDER[provider] : [] };
    },
    openRead,
  );

  r.queryHandler("step-options", noPayload, async () => ({ rows: AI_STEPS }), openRead);

  r.queryHandler(
    "all-model-options",
    noPayload,
    async () => ({
      rows: PROVIDERS.flatMap((provider) =>
        MODELS_BY_PROVIDER[provider].map((model) => ({
          ...model,
          group: `${PROVIDER_LABELS[provider]} · ${model.group}`,
        })),
      ),
    }),
    openRead,
  );

  r.queryHandler(
    "connection:summary",
    idPayload,
    async (query, ctx) => {
      const row = await executor.detail({ id: query.payload.id }, query.user, ctx.db);
      return {
        id: query.payload.id,
        name: String(row?.["name"] ?? ""),
        provider: String(row?.["provider"] ?? ""),
      };
    },
    openRead,
  );

  const acknowledged = async () => ({ isSuccess: true as const, data: null });
  r.writeHandler("step:assign", z.object({}).passthrough(), acknowledged, open);
  r.writeHandler("probe:run", z.object({}).passthrough(), acknowledged, open);

  r.config({
    keys: {
      textConnection: createTenantConfig("select", {
        optionsQuery: "ai-settings:query:connection-options",
        read: access.all,
        write: access.all,
        mask: { title: "ai-settings.text-connection", order: 1 },
      }),
      textModel: createTenantConfig("select", {
        optionsQuery: "ai-settings:query:model-options",
        optionsQueryPayload: { connectionId: { field: "textConnection" } },
        read: access.all,
        write: access.all,
        mask: { title: "ai-settings.text-model", order: 2 },
      }),
    },
    seeds: {
      textConnection: createTenantSeed({ value: ANTHROPIC_CONNECTION_ID }),
      textModel: createTenantSeed({ value: "claude-sonnet-5-5" }),
    },
  });

  r.screen({
    id: "connection-edit",
    type: "entityEdit",
    entity: "connection",
    layout: {
      sections: [
        {
          title: "ai-settings.section.connection",
          columns: 2,
          fields: [
            { field: "name", span: 2 },
            { field: "provider", span: 2 },
            { field: "apiKey", span: 2 },
          ],
        },
      ],
    },
  });

  r.screen({
    id: "connection-list",
    type: "entityList",
    entity: "connection",
    columns: ["name", "provider"],
    pagination: "pages",
    pageSize: 25,
    defaultSort: { field: "name", dir: "asc" },
    rowActions: [
      {
        kind: "navigate",
        id: "edit",
        label: "ai-settings.action.edit",
        screen: "connection-edit",
        rowClick: true,
      },
      {
        kind: "navigate",
        id: "probe",
        label: "ai-settings.action.probe",
        screen: "connection-detail",
      },
    ],
  });

  r.screen({
    id: "connection-detail",
    type: "projectionDetail",
    query: "ai-settings:query:connection:summary",
    header: { title: "name", subtitle: "provider" },
    fieldLabels: {
      name: "ai-settings:entity:connection:field:name",
      provider: "ai-settings:entity:connection:field:provider",
    },
    layout: {
      mode: "tabs",
      sections: [
        {
          id: "overview",
          kind: "fields",
          title: "ai-settings.tab.overview",
          fields: ["name", "provider"],
        },
        {
          id: "probe",
          kind: "writeForm",
          title: "ai-settings.tab.probe",
          columns: 2,
          fieldDefs: {
            model: createSelectField({
              options: [],
              optionsQuery: "ai-settings:query:all-model-options",
            }),
            prompt: createTextField({
              personal: false,
              reason: "is_business_data",
              multiline: { rows: 4 },
            }),
          },
          fields: [
            { field: "model", span: 2 },
            { field: "prompt", span: 2 },
          ],
          handler: "ai-settings:write:probe:run",
          submitLabel: "ai-settings.action.start-probe",
        },
      ],
    },
    access: open.access,
  });

  r.screen({
    id: "step-assign",
    type: "actionForm",
    handler: "ai-settings:write:step:assign",
    fields: {
      step: createSelectField({
        options: [],
        optionsQuery: "ai-settings:query:step-options",
        display: "radio",
        required: true,
      }),
      connection: createSelectField({
        options: [],
        optionsQuery: "ai-settings:query:connection-options",
      }),
      model: createSelectField({
        options: [],
        optionsQuery: "ai-settings:query:model-options",
        optionsQueryPayload: { connectionId: { field: "connection" } },
      }),
    },
    fieldLabels: {
      step: "ai-settings:entity:__action-form__:field:step",
      connection: "ai-settings:entity:__action-form__:field:connection",
      model: "ai-settings:entity:__action-form__:field:model",
    },
    layout: {
      sections: [
        { title: "ai-settings.section.step", fields: ["step"] },
        { title: "ai-settings.section.model", columns: 2, fields: ["connection", "model"] },
      ],
    },
    submitLabel: "ai-settings.action.assign",
    access: open.access,
  });

  r.nav({ id: "ai", label: "ai-settings:nav.ai", icon: "sparkles", order: 40 });
  r.nav({
    id: "connections",
    label: "ai-settings:nav.connections",
    parent: "ai-settings:nav:ai",
    screen: "ai-settings:screen:connection-list",
    icon: "list",
    order: 10,
  });
  r.nav({
    id: "connection-new",
    label: "ai-settings:nav.connectionNew",
    parent: "ai-settings:nav:ai",
    screen: "ai-settings:screen:connection-edit",
    icon: "file",
    order: 20,
  });
  r.nav({
    id: "step-assign",
    label: "ai-settings:nav.stepAssign",
    parent: "ai-settings:nav:ai",
    screen: "ai-settings:screen:step-assign",
    icon: "file",
    order: 30,
  });
});
