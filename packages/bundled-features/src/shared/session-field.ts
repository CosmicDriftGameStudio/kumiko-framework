import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";

/** Omit null/undefined session keys so callers can spread without wiping defaults. */
export function sessionField<K extends "locale" | "timezone">(
  key: K,
  value: string | null | undefined,
): Partial<Pick<SessionUser, K>> {
  if (value === null || value === undefined) return {};
  return { [key]: value } as Pick<SessionUser, K>;
}
