import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  webhookEventDescriptionKey,
  webhookEventFieldKey,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { createAuthFoundationFeature } from "../../../auth-foundation/index.ts";
import { createConfigFeature } from "../../../config/index.ts";
import { createPersonalAccessTokensFeature } from "../../../personal-access-tokens/index.ts";
import { createTenantFeature } from "../../../tenant/index.ts";
import { createUserFeature } from "../../../user/feature.ts";
import type { ApiDocsInput } from "../generate.ts";
import type { ResolvedApiDocsConfig } from "../model.ts";

const OPEN_ACCESS = {
  openToAll: { reason: "fixture handler callable by any signed-in test user" },
} as const;

const ticketEntity = createEntity({
  webhookEvents: true,
  fields: {
    title: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

export const FIXTURE_RATE_LIMIT = { maxRequests: 30, windowMs: 10_000 } as const;

export function buildHelpdeskFeature(): FeatureDefinition {
  return defineFeature("helpdesk", (r) => {
    r.entity({ name: "ticket", ...ticketEntity });
    r.crud("ticket", ticketEntity, {
      write: { access: OPEN_ACCESS },
      read: { access: OPEN_ACCESS },
    });
    r.writeHandler({
      name: "ticket:close",
      schema: z.object({ id: z.uuid(), reason: z.enum(["solved", "duplicate"]) }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_ACCESS,
      description: "Closes a ticket.",
    });
    r.writeHandler({
      name: "ticket:escalate",
      schema: z.object({ id: z.uuid() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_ACCESS,
      description: "Escalates a ticket.",
    });
    r.writeHandler({
      name: "ticket:sync",
      schema: z.object({ id: z.uuid() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: { roles: ["system"] },
      description: "Syncs a ticket from the job runner.",
    });
    r.screen({
      id: "sync-ticket",
      type: "actionForm",
      handler: "helpdesk:write:ticket:sync",
      fields: {},
      layout: { sections: [] },
    });
    r.writeHandler({
      name: "internal:purge",
      schema: z.object({}),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: OPEN_ACCESS,
      description: "Purges everything.",
    });
    r.screen({
      id: "close-ticket",
      type: "actionForm",
      handler: "helpdesk:write:ticket:close",
      fields: { reason: createTextField({ personal: false, reason: "technical_reference" }) },
      layout: { sections: [{ title: "s", fields: ["reason"] }] },
    });
    r.screen({
      id: "escalate-ticket",
      type: "actionForm",
      handler: "helpdesk:write:ticket:escalate",
      fields: {},
      layout: { sections: [] },
    });
    r.nav({ id: "settings", label: "helpdesk:nav:settings" });
    r.nav({
      id: "api-tokens",
      label: "helpdesk:nav:api-tokens",
      parent: "helpdesk:nav:settings",
      screen: "personal-access-tokens:screen:api-tokens",
    });
    r.translations({
      keys: {
        "helpdesk:nav:settings": { en: "Settings", de: "Einstellungen" },
        "helpdesk:nav:api-tokens": { en: "API tokens", de: "API-Tokens" },
        "helpdesk:write:ticket:close:title": { en: "Close ticket", de: "Ticket schließen" },
        "helpdesk:write:ticket:close:description": {
          en: "Closes a ticket.",
          de: "Schließt ein Ticket.",
        },
        "helpdesk:write:ticket:close:field:reason": { en: "Reason", de: "Grund" },
      },
    });
  });
}

/** A locale package translates the token feature's own keys under the plain key, like `locale-de` does. */
export function buildLocalePackageFeature(): FeatureDefinition {
  return defineFeature("locale-de", (r) => {
    r.translations({ keys: { "pat.create.title": { de: "Neuen Token erstellen" } } });
  });
}

/** Two declared contracts, one of them named like the entity event `ticket.created` once
 *  punctuation is dropped, and one without a German description. */
export function buildWebhookFixtureFeatures(): FeatureDefinition[] {
  return [
    defineFeature("ticket", (r) => {
      r.defineWebhookEvent({
        name: "created",
        description: "A customer opened a ticket.",
        payload: z.object({ id: z.uuid(), subject: z.string().describe("Short summary") }),
        version: 2,
        wireName: "ticket.opened",
      });
      r.translations({
        keys: {
          [webhookEventDescriptionKey("ticket:created")]: {
            en: "A customer opened a ticket.",
            de: "Ein Kunde hat ein Ticket eröffnet.",
          },
          [webhookEventFieldKey("ticket:created", "subject")]: { de: "Kurze Zusammenfassung" },
        },
      });
    }),
    defineFeature("billing", (r) => {
      r.defineWebhookEvent({
        name: "invoice-paid",
        description: "An invoice was paid.",
        payload: z.object({ id: z.uuid() }),
        version: 1,
      });
    }),
  ];
}

export function buildFixtureFeatures(
  options: { readonly reverse?: boolean; readonly events?: readonly string[] } = {},
) {
  const features = [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthFoundationFeature(),
    buildHelpdeskFeature(),
    buildLocalePackageFeature(),
    ...(options.events === undefined ? [] : buildWebhookFixtureFeatures()),
    createPersonalAccessTokensFeature({
      scopes: {
        tickets: {
          label: "Tickets",
          ...(options.events !== undefined && { events: options.events }),
          read: ["helpdesk:query:*"],
          write: [
            "helpdesk:write:ticket:close",
            "helpdesk:write:ticket:sync",
            "helpdesk:write:ticket:create",
            "helpdesk:write:ticket:update",
          ],
        },
      },
      rateLimit: FIXTURE_RATE_LIMIT,
    }),
  ];
  return options.reverse === true ? features.reverse() : features;
}

export const fixtureConfig: ResolvedApiDocsConfig = {
  locales: ["en", "de"],
  baseUrl: "https://api.example.test",
  appName: "Helpdesk",
};

export function fixtureInput(
  overrides: Partial<ApiDocsInput> & { reverse?: boolean; events?: readonly string[] } = {},
): ApiDocsInput {
  const { reverse, events, ...rest } = overrides;
  return {
    registry: createRegistry(buildFixtureFeatures({ reverse: reverse === true, events })),
    config: fixtureConfig,
    source: { framework: "0.0.0-test", app: { name: "helpdesk", version: "1.2.3" } },
    examples: [],
    webhookExamples: [],
    ...rest,
  };
}
