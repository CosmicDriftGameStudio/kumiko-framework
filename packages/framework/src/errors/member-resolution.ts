import { AccessDeniedError } from "./classes";
import { FrameworkReasons } from "./reasons";

// Lives in errors/ (not pipeline/) so db/tenant-db.ts can throw it without importing pipeline.
export function memberResolutionReadOnlyDenied(cause?: unknown): AccessDeniedError {
  return new AccessDeniedError({
    message:
      "a resolved member principal (ctx.queryAsMember) cannot write or reach raw SQL — read-only",
    details: { reason: FrameworkReasons.memberResolutionReadOnly },
    ...(cause instanceof Error && { cause }),
  });
}
