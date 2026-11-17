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

import { open, openRead } from "./access";
import {
  AI_STEPS,
  ANTHROPIC_CONNECTION_ID,
  MODELS_BY_PROVIDER,
  PROVIDER_LABELS,
  PROVIDERS,
  type Provider,
} from "./catalog";
import { AI_SETTINGS_I18N } from "./i18n";
import {
  connectionDetailScreen,
  connectionEditScreen,
  connectionListScreen,
  stepAssignScreen,
} from "./screens";

export const connectionEntity = createEntity({
  name: "connection",
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

const noPayload = z.object({});
const connectionIdPayload = z.object({ connectionId: z.string().optional() });
const idPayload = z.object({ id: z.string() });

const { executor } = createEntityExecutor(connectionEntity);

function isProvider(value: unknown): value is Provider {
  return PROVIDERS.some((provider) => provider === value);
}

export const aiSettingsFeature = defineFeature("ai-settings", (r) => {
  r.requires({ features: ["config"] });
  r.translations({ keys: AI_SETTINGS_I18N });

  r.crud(connectionEntity, { write: open, read: openRead });
  r.queryHandler({
    name: "connection-options",
    unfilteredResult: { reason: "returns select options, never connection rows" },
    schema: noPayload,
    handler: async (query, ctx) => {
      const page = await executor.list({ limit: 100 }, query.user, ctx.db);
      return {
        rows: page.rows.map((row) => ({
          value: String(row["id"]),
          label: String(row["name"]),
        })),
      };
    },
    ...openRead,
  });

  r.queryHandler({
    name: "model-options",
    unfilteredResult: { reason: "returns select options, never connection rows" },
    schema: connectionIdPayload,
    handler: async (query, ctx) => {
      const { connectionId } = query.payload;
      if (connectionId === undefined) return { rows: [] };
      const row = await executor.detail({ id: connectionId }, query.user, ctx.db);
      const provider = row?.["provider"];
      return { rows: isProvider(provider) ? MODELS_BY_PROVIDER[provider] : [] };
    },
    ...openRead,
  });

  r.queryHandler({
    name: "step-options",
    unfilteredResult: { reason: "returns select options, never connection rows" },
    schema: noPayload,
    handler: async () => ({ rows: AI_STEPS }),
    ...openRead,
  });

  r.queryHandler({
    name: "all-model-options",
    unfilteredResult: { reason: "returns select options, never connection rows" },
    schema: noPayload,
    handler: async () => ({
      rows: PROVIDERS.flatMap((provider) =>
        MODELS_BY_PROVIDER[provider].map((model) => ({
          ...model,
          group: `${PROVIDER_LABELS[provider]} · ${model.group}`,
        })),
      ),
    }),
    ...openRead,
  });

  r.queryHandler({
    name: "connection:summary",
    schema: idPayload,
    handler: async (query, ctx) => {
      const row = await executor.detail({ id: query.payload.id }, query.user, ctx.db);
      return {
        id: query.payload.id,
        name: String(row?.["name"] ?? ""),
        provider: String(row?.["provider"] ?? ""),
      };
    },
    ...openRead,
  });

  const acknowledged = async () => ({ isSuccess: true as const, data: null });
  r.writeHandler({
    name: "step:assign",
    schema: z.object({}).passthrough(),
    handler: acknowledged,
    ...open,
  });
  r.writeHandler({
    name: "probe:run",
    schema: z.object({}).passthrough(),
    handler: acknowledged,
    ...open,
  });

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

  r.screen(connectionEditScreen);

  r.screen(connectionListScreen);

  r.screen(connectionDetailScreen);

  r.screen(stepAssignScreen);

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
