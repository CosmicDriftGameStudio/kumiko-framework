import type { EventDef, JobContext } from "@cosmicdrift/kumiko-types/handlers";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
} from "../crypto/index.ts";
import { InternalError } from "../errors/index.ts";

export type TriggeredEvent<TEvents extends readonly EventDef[]> = {
  [K in keyof TEvents]: TEvents[K] extends EventDef<infer TPayload, infer TName>
    ? { readonly type: TName; readonly payload: TPayload }
    : never;
}[number];

// A job payload arrives untyped from the queue; parsing it against the event that fired
// turns a reshaped or renamed event into a failed run instead of fields silently read as undefined.
export async function triggeredEventOf<const TEvents extends readonly EventDef[]>(
  events: TEvents,
  payload: Readonly<Record<string, unknown>>,
  ctx: Pick<JobContext, "triggerName">,
): Promise<TriggeredEvent<TEvents>>;
export async function triggeredEventOf(
  events: readonly EventDef[],
  payload: Readonly<Record<string, unknown>>,
  ctx: Pick<JobContext, "triggerName">,
): Promise<unknown> {
  const event = events.find((def) => def.name === ctx.triggerName);
  if (event === undefined) {
    throw new InternalError({
      message: `triggeredEventOf: trigger "${ctx.triggerName ?? "<none>"}" is none of ${events.map((def) => def.name).join(", ")}`,
    });
  }
  // Catalogued personal fields stay ciphertext in the queue, so Redis never holds plaintext; they are decrypted at run time.
  const plainPayload =
    event.piiFields === "none"
      ? payload
      : await decryptTriggeredPayload(event.name, payload, Object.keys(event.piiFields));
  const parsed = event.schema.safeParse(plainPayload);
  if (!parsed.success) {
    throw new InternalError({
      message: `triggeredEventOf: payload of "${event.name}" does not match its schema`,
      cause: parsed.error,
    });
  }
  return { type: event.name, payload: parsed.data };
}

async function decryptTriggeredPayload(
  eventName: string,
  payload: Readonly<Record<string, unknown>>,
  piiFieldNames: readonly string[],
): Promise<Record<string, unknown>> {
  const kms = configuredPiiSubjectKms();
  if (kms === undefined) {
    const encryptedField = piiFieldNames.find((name) => isPiiCiphertext(payload[name]));
    if (encryptedField !== undefined) {
      throw new InternalError({
        message: `triggeredEventOf: field "${encryptedField}" of "${eventName}" is encrypted but no subject KMS is configured`,
      });
    }
    return { ...payload };
  }
  return decryptPiiFieldValues({ ...payload }, piiFieldNames, kms, {
    requestId: `triggered-event:${eventName}`,
  });
}
