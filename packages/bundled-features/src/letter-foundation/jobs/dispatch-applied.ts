import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

export async function dispatchApplied(
  ctx: JobContext,
  type: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const result = await ctx.dispatch.write(type, payload);
  if (!result.isSuccess) {
    throw new Error(`letter-foundation: ${type} was rejected: ${JSON.stringify(result.error)}`);
  }
  return propertyOf(result.data, "applied") === true;
}
