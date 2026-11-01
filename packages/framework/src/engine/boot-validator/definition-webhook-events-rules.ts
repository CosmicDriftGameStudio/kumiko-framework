import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_WEBHOOK_EVENT_RULES = {
  nameNotKebab: {
    id: "webhook-event/name-not-kebab",
    summary: "Webhook event names are kebab-case.",
    fix: "Rename the event to lowercase letters, digits and dashes.",
  },
  descriptionEmpty: {
    id: "webhook-event/description-empty",
    summary: "Webhook events carry a non-empty description sentence.",
    fix: "Add a description.",
  },
  payloadNotZodObject: {
    id: "webhook-event/payload-not-zod-object",
    summary: "Webhook event payloads are Zod object schemas.",
    fix: "Pass z.object({ ... }) as payload.",
  },
  versionInvalid: {
    id: "webhook-event/version-invalid",
    summary: "Webhook event version is a positive integer.",
    fix: "Set version to an integer of 1 or higher.",
  },
  wireNameEmpty: {
    id: "webhook-event/wire-name-empty",
    summary: "Webhook event wireName is a non-empty string when set.",
    fix: "Set a wireName or omit it.",
  },
  duplicate: {
    id: "webhook-event/duplicate",
    summary: "Webhook event names are unique per feature.",
    fix: "Rename one of the events.",
  },
} as const satisfies BootRuleTable;
