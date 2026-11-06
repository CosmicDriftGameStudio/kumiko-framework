import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

export async function runBestEffort(
  ctx: Pick<HandlerContext, "obs">,
  logMessage: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    ctx.obs.log?.warn(logMessage, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendBestEffort(
  ctx: Pick<HandlerContext, "notify" | "obs">,
  logMessage: string,
  send: (notify: NonNullable<HandlerContext["notify"]>) => Promise<unknown>,
): Promise<void> {
  await runBestEffort(ctx, logMessage, async () => {
    if (!ctx.notify) {
      throw new InternalError({ message: "ctx.notify unavailable — mount the delivery feature" });
    }
    await send(ctx.notify);
  });
}
