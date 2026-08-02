import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";

export function sessionTimezoneField(
  timezone: string | null | undefined,
): Pick<SessionUser, "timezone"> | Record<string, never> {
  return timezone !== null && timezone !== undefined ? { timezone } : {};
}
