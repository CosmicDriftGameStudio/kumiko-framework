import type { EventDef, JobContext } from "@cosmicdrift/kumiko-types/handlers";
import { InternalError } from "../errors/index.ts";

export type TriggeredEvent<TEvents extends readonly EventDef[]> = {
  [K in keyof TEvents]: TEvents[K] extends EventDef<infer TPayload, infer TName>
    ? { readonly type: TName; readonly payload: TPayload }
    : never;
}[number];

// A job payload arrives untyped from the queue; parsing it against the event that fired
// turns a reshaped or renamed event into a failed run instead of fields silently read as undefined.
export function triggeredEventOf<const TEvents extends readonly EventDef[]>(
  events: TEvents,
  payload: Readonly<Record<string, unknown>>,
  ctx: Pick<JobContext, "triggerName">,
): TriggeredEvent<TEvents>;
export function triggeredEventOf(
  events: readonly EventDef[],
  payload: Readonly<Record<string, unknown>>,
  ctx: Pick<JobContext, "triggerName">,
): unknown {
  const event = events.find((def) => def.name === ctx.triggerName);
  if (event === undefined) {
    throw new InternalError({
      message: `triggeredEventOf: trigger "${ctx.triggerName ?? "<none>"}" is none of ${events.map((def) => def.name).join(", ")}`,
    });
  }
  // Personal fields reach the job as ciphertext, which the write-side schema rejects.
  if (event.piiFields !== "none") {
    throw new InternalError({
      message: `triggeredEventOf: event "${event.name}" has personal fields, which reach the job encrypted; load the aggregate with ctx.events.load instead`,
    });
  }
  const parsed = event.schema.safeParse(payload);
  if (!parsed.success) {
    throw new InternalError({
      message: `triggeredEventOf: payload of "${event.name}" does not match its schema`,
      cause: parsed.error,
    });
  }
  return { type: event.name, payload: parsed.data };
}
