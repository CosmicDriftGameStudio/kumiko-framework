import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";

export function sessionLocaleField(
  locale: string | null | undefined,
): Pick<SessionUser, "locale"> | Record<string, never> {
  return locale !== null && locale !== undefined ? { locale } : {};
}
