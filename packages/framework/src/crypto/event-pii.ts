// PII on custom-event payloads (#799). Entity CRUD events get their PII
// encrypted by the executor; events written via ctx.appendEvent / MSP-apply /
// low-level append() (delivery attempt-log, jobs run-logger) had no encrypt
// path at all. `r.defineEvent(name, schema, { piiFields })` declares which
// payload fields are PII and which payload field names the owning user;
// createRegistry publishes the catalog and append() — the single write funnel
// into kumiko_events — encrypts every catalogued field. No caller can forget.

import { requestContext } from "../api/request-context";
import type { EventPiiFields } from "../engine/types/handlers";
import { configuredPiiSubjectKms, encryptPiiValueForSubject } from "./pii-field-encryption";

export type EventPiiCatalog = ReadonlyMap<string, EventPiiFields>;

// Boot-injected like configurePiiSubjectKms — createRegistry calls this with
// the catalog collected from all defineEvent registrations.
let catalog: EventPiiCatalog = new Map();

export function configureEventPiiCatalog(next: EventPiiCatalog): void {
  catalog = next;
}

export function configuredEventPiiCatalog(): EventPiiCatalog {
  return catalog;
}

/** @internal test-only */
export function resetEventPiiCatalogForTests(): void {
  catalog = new Map();
}

// Encrypts catalogued payload fields under the owning user's DEK. No-op when
// the event type is uncatalogued or no subject KMS is configured (plaintext
// rollout mode — the hard boot gate governs whether that is acceptable).
// A null/absent subject field (system cron runs, recipient-less skip
// attempts) leaves the value plaintext: there is no user key to shred.
export async function encryptEventPayloadPii(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const piiFields = catalog.get(eventType);
  if (!piiFields) return payload;
  const kms = configuredPiiSubjectKms();
  if (!kms) return payload;

  let out: Record<string, unknown> | undefined;
  for (const [field, spec] of Object.entries(piiFields)) {
    const value = payload[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") {
      throw new Error(
        `Event "${eventType}" piiFields."${field}" must be a string payload field, got ${typeof value}`,
      );
    }
    const subjectId = payload[spec.subjectField];
    if (typeof subjectId !== "string" || subjectId.length === 0) continue;
    const encrypted = await encryptPiiValueForSubject(
      kms,
      { kind: "user", userId: subjectId },
      value,
      { requestId: requestContext.get()?.requestId ?? "append-event" },
    );
    if (encrypted !== value) {
      out ??= { ...payload };
      out[field] = encrypted;
    }
  }
  return out ?? payload;
}
