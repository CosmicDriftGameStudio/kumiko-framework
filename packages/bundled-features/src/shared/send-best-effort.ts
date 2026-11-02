import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

export async function sendBestEffort(
  ctx: Pick<HandlerContext, "notify" | "obs">,
  logMessage: string,
  send: (notify: NonNullable<HandlerContext["notify"]>) => Promise<unknown>,
): Promise<void> {
  try {
    if (!ctx.notify) {
      throw new InternalError({ message: "ctx.notify unavailable — mount the delivery feature" });
    }
    await send(ctx.notify);
  } catch (err) {
    ctx.obs.log?.warn(logMessage, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
