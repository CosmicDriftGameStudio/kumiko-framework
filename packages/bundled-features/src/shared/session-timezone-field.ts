import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";

export function sessionTimezoneField(
  timezone: string | null | undefined,
): Pick<SessionUser, "timezone"> | Record<string, never> {
  if (timezone === null || timezone === undefined) return {};
  return { timezone };
}
