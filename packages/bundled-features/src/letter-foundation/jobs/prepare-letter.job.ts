import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { LetterInternalHandlers } from "../constants.ts";
import { LetterTransitionEventSchema } from "../payloads.ts";
import { dispatchApplied } from "./dispatch-applied.ts";

/** Prepares a letter right after it was created. Safe to repeat: a letter that is prepared or no longer waiting is left alone. */
export async function prepareLetter(payload: unknown, ctx: JobContext): Promise<undefined> {
  const event = LetterTransitionEventSchema.safeParse(payload);
  // skip: trigger payload without a letter id
  if (!event.success) return undefined;
  await dispatchApplied(ctx, LetterInternalHandlers.prepare, { letterId: event.data.letterId });
  return undefined;
}
