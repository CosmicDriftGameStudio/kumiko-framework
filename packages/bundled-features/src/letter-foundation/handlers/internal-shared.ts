import { access } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";

export type ApplyResult = WriteResult<{ readonly applied: boolean }>;

export const internalAccess = { roles: access.system } as const;
export const NOT_APPLIED: ApplyResult = { isSuccess: true, data: { applied: false } };
export const APPLIED: ApplyResult = { isSuccess: true, data: { applied: true } };
