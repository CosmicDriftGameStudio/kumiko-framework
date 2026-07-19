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
// The trigger fires AFTER every successful ingest-message write — that
// includes idempotent replays (duplicate ingest returns success). The
// triage store is therefore keyed by providerMessageId: replays
// overwrite instead of duplicating. Key your side-effects the same way.

import {
  InboundMailFoundationHandlers,
  type RawInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export type TriageItem = {
  readonly from: string;
  readonly subject: string;
  readonly scope: string;
  readonly threadHint: string | null;
};

// In-memory store so the integration-test can assert the job ran with
// the right payload. A real app would do domain writes / AI calls /
// notifications — the side-effect is opaque to the framework.
export const triageInbox = new Map<string, TriageItem>();

export function createMailTriageFeature(): FeatureDefinition {
  return defineFeature("mail-triage", (r) => {
    r.describe(
      "Sample consumer for inbound-mail-foundation: a worker-lane job triggered by the ingest-message write-handler turns every inbound mail into a triage item.",
    );
    r.requires("inbound-mail-foundation");

    // The job receives the dispatcher-validated ingest payload — i.e.
    // the PLAINTEXT normalized mail (PII encryption happens inside the
    // handler right before the event append, so consumers on the
    // handler-trigger path never deal with ciphertext).
    r.job(
      "triage-inbound",
      {
        trigger: { on: InboundMailFoundationHandlers.ingestMessage },
        runIn: "worker",
      },
      async (rawPayload) => {
        // Dispatcher-validated ingest payload — one cast at the job boundary
        // to the foundation's own message shape instead of per-field casts.
        const payload = rawPayload as unknown as RawInboundMessage;
        triageInbox.set(payload.providerMessageId, {
          from: payload.from,
          subject: payload.subject,
          scope: payload.scope,
          threadHint: payload.messageIdHeader,
        });
      },
    );
  });
}
