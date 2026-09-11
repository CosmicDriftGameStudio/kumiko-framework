// PII on custom-event payloads (#799). Entity CRUD events get their PII
// encrypted by the executor; events written via ctx.appendEvent / MSP-apply /
// low-level append() (delivery attempt-log, jobs run-logger) had no encrypt
// path at all. `r.defineEvent(name, schema, { piiFields })` declares which
// payload fields are PII and which payload field names the owning user;
// createRegistry publishes the catalog and append() — the single write funnel
// into kumiko_events — encrypts every catalogued field.
//
// `piiFields` is a mandatory, explicit stance (fw#2558): a payload can only
// go uncatalogued through a declared `piiFields: "none"`, never by omission —
// defineEvent refuses to register an event without one. What used to be a
// silent no-op (forgetting the option) is now either an explicit "none" or a
// missing subject KMS at encrypt-time, both visible states, not a gap.

import type { EventPiiFields } from "@cosmicdrift/kumiko-types/handlers";
import { requestContext } from "../api/request-context";
import { configuredPiiSubjectKms, encryptPiiValueForSubject } from "./pii-field-encryption";
import { type EventSubjectEnvelope, resolveEventSubject } from "./subject-resolver";

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

// Encrypts catalogued payload fields under the declared subject's DEK
// (user/tenant/self — resolveEventSubject, fw#2801). No-op when the event
// type is uncatalogued or no subject KMS is configured (plaintext rollout
// mode — the hard boot gate governs whether that is acceptable). A
// user-subject field with no resolvable owner (system cron runs,
// recipient-less skip attempts) leaves the value plaintext: there is no
// user key to shred. This is the ONLY live-write encrypt path — the backfill
// catalog branch (`backfill-pii.ts`) resolves through the same
// resolveEventSubject so a field never ends up encrypted under different
// subjects depending on which path wrote it.
export async function encryptEventPayloadPii(
  eventType: string,
  payload: Record<string, unknown>,
  envelope: EventSubjectEnvelope,
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
    const subject = resolveEventSubject(field, spec, payload, envelope);
    if (subject === null) continue;
    const encrypted = await encryptPiiValueForSubject(
      kms,
      subject,
      value,
      { requestId: requestContext.get()?.requestId ?? "append-event" },
      field,
    );
    if (encrypted !== value) {
      out ??= { ...payload };
      out[field] = encrypted;
    }
  }
  return out ?? payload;
}
