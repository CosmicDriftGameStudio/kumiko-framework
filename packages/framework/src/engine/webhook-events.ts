import type { WebhookEventContract, WebhookEventHandle } from "@cosmicdrift/kumiko-types/feature";
import { ZodObject } from "zod";
import { bootRuleError } from "./boot-validator/boot-rule.ts";
import { DEFINITION_WEBHOOK_EVENT_RULES } from "./boot-validator/definition-webhook-events-rules.ts";
import type { FeatureBuilderState } from "./feature-builder-state.ts";
import { isObjectArgument, throwObjectArgumentRequired } from "./object-form.ts";
import { isKebabSegment, toKebab } from "./qualified-name.ts";

export type WebhookPayloadIssue = {
  readonly path: string;
  readonly message: string;
};

export type WebhookPayloadResult =
  | { readonly ok: true; readonly payload: Record<string, unknown> }
  | { readonly ok: false; readonly issues: readonly WebhookPayloadIssue[] };

/** Delivery sends the returned payload, never the input: zod strips keys the contract does not
 *  declare, so a field added to the source row cannot leak into a webhook by accident. */
export function parseWebhookPayload(
  contract: Pick<WebhookEventContract, "payload">,
  payload: unknown,
): WebhookPayloadResult {
  const parsed = contract.payload.safeParse(payload);
  if (parsed.success) return { ok: true, payload: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}

/** Maps a stored entity lifecycle event to the contract's payload: the aggregate id joins the
 *  event payload, and the contract parse drops every field it does not release, personal ones
 *  included, even when the event payload carries them. */
export function toEntityWebhookPayload(
  contract: Pick<WebhookEventContract, "payload" | "verb">,
  event: { readonly aggregateId: string; readonly payload: Readonly<Record<string, unknown>> },
): WebhookPayloadResult {
  const { aggregateId, payload } = event;
  const shaped =
    contract.verb === "created"
      ? { ...payload, id: aggregateId }
      : { id: aggregateId, changes: payload["changes"], previous: payload["previous"] };
  return parseWebhookPayload(contract, shaped);
}

export function formatWebhookPayloadIssues(issues: readonly WebhookPayloadIssue[]): string {
  return issues
    .map((issue) => `${issue.path === "" ? "(root)" : issue.path}: ${issue.message}`)
    .join("; ");
}

export function buildWebhookEventMethods(state: FeatureBuilderState, featureName: string) {
  return {
    defineWebhookEvent(definition: {
      readonly name: string;
      readonly description: string;
      readonly payload: ZodObject;
      readonly version: number;
      readonly wireName?: string;
    }): WebhookEventHandle {
      if (!isObjectArgument(definition))
        throwObjectArgumentRequired(featureName, "defineWebhookEvent");
      const { name, description, payload, version } = definition;
      const where = `[Feature ${featureName}] defineWebhookEvent`;
      if (typeof name !== "string" || !isKebabSegment(name)) {
        throw bootRuleError(DEFINITION_WEBHOOK_EVENT_RULES.nameNotKebab, {
          message: `${where}: name must be kebab-case, got ${JSON.stringify(name)}`,
        });
      }
      if (typeof description !== "string" || description.trim() === "") {
        throw bootRuleError(DEFINITION_WEBHOOK_EVENT_RULES.descriptionEmpty, {
          message: `${where}("${name}"): description must be a non-empty sentence`,
        });
      }
      if (!(payload instanceof ZodObject)) {
        throw bootRuleError(DEFINITION_WEBHOOK_EVENT_RULES.payloadNotZodObject, {
          message: `${where}("${name}"): payload must be a zod object schema`,
        });
      }
      if (!Number.isInteger(version) || version < 1) {
        throw bootRuleError(DEFINITION_WEBHOOK_EVENT_RULES.versionInvalid, {
          message: `${where}("${name}"): version must be a positive integer`,
        });
      }
      if (
        definition.wireName !== undefined &&
        (typeof definition.wireName !== "string" || definition.wireName.trim() === "")
      ) {
        throw bootRuleError(DEFINITION_WEBHOOK_EVENT_RULES.wireNameEmpty, {
          message: `${where}("${name}"): wireName must be a non-empty string`,
        });
      }
      const wireName = definition.wireName?.trim() ?? name;
      const qn = `${toKebab(featureName)}:${name}`;
      if (state.webhookEvents[qn] !== undefined) {
        throw bootRuleError(DEFINITION_WEBHOOK_EVENT_RULES.duplicate, {
          message: `${where}("${name}"): already registered in this feature`,
        });
      }
      state.webhookEvents[qn] = {
        qn,
        wireName,
        description: description.trim(),
        payload,
        version,
      };
      return { name: qn, payload, version };
    },
  };
}
