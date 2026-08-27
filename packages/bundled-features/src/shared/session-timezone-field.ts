import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { sessionField } from "./session-field";

export function sessionTimezoneField(
  timezone: string | null | undefined,
): Pick<SessionUser, "timezone"> | Record<string, never> {
  return sessionField("timezone", timezone);
}
