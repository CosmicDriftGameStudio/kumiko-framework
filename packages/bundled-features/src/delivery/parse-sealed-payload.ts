import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type * as z from "zod";

export function parseSealedPayload<S extends z.ZodType<{ readonly tenantId: string }>>(
  schema: S,
  plaintext: string,
  tenantId: TenantId,
  failureMessage: string,
): z.output<S> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    decoded = undefined;
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success || parsed.data.tenantId !== tenantId) {
    throw new InternalError({ message: failureMessage });
  }
  return parsed.data;
}
