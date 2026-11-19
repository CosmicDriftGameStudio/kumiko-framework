// Inbound-Mail Triage Sample
//
// Shows the consumer pattern for `inbound-mail-foundation`: the
// foundation owns transport, dedup and PII handling — the app attaches
// its business process to the ingest write-handler via a worker-lane
// job. Every inbound mail becomes a triage item; a real app would
// create a ticket, run an AI classification, extract an invoice or
// draft a reply here.
//
// Feature composition (see the test):
//   inbound-mail-foundation   — streams, projections, ingest handler
//   inbound-provider-inmemory — scriptable provider (tests/demos)
//   mail-triage (this file)   — the app-side consumer
//
// The job triggers on the stored inbound-message-received event, which the
// foundation appends exactly once per message (deterministic aggregate id),
// so an idempotent replay of the ingest creates no second event. The triage
// store is keyed by the message id (the event's aggregate id) all the same:
// the trigger is at-least-once, so key your side-effects the same way.

import {
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  inboundMessageEventPayloadSchema,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export type TriageItem = {
  readonly messageId: string;
  readonly accountId: string;
  readonly scope: string;
  readonly threadHint: string;
};

// In-memory store so the integration-test can assert the job ran with
// the right payload. A real app would do domain writes / AI calls /
// notifications — the side-effect is opaque to the framework.
export const triageInbox = new Map<string, TriageItem>();

export function createMailTriageFeature(): FeatureDefinition {
  return defineFeature("mail-triage", (r) => {
    r.describe(
      "Sample consumer for inbound-mail-foundation: a worker-lane job triggered by the inbound-message-received event turns every inbound mail into a triage item.",
    );
    r.requires({ features: ["inbound-mail-foundation"] });

    // from and subject are PII ciphertext in the event payload. Plaintext is read through
    // InboundMailFoundationQueries.listMessages / messageContent, so the triage item keeps ids only.
    r.job({
      name: "triage-inbound",
      trigger: { on: INBOUND_MESSAGE_RECEIVED_EVENT_QN },
      runIn: "worker",
      handler: async (rawPayload, context) => {
        const messageId = context.triggerEvent?.aggregateId;
        if (messageId === undefined) {
          throw new Error("triage-inbound: job context has no triggerEvent.aggregateId");
        }
        const payload = inboundMessageEventPayloadSchema.parse(rawPayload);
        triageInbox.set(messageId, {
          messageId,
          accountId: payload.accountId,
          scope: payload.scope,
          threadHint: payload.messageIdHeader,
        });
      },
    });
  });
}
