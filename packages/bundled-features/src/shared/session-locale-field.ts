import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { canonicalizeLocaleTag, isValidLocaleTag } from "@cosmicdrift/kumiko-framework/i18n";
import { sessionField } from "./session-field";

export function sessionLocaleField(
  locale: string | null | undefined,
): Pick<SessionUser, "locale"> | Record<string, never> {
  if (locale === null || locale === undefined || !isValidLocaleTag(locale)) return {};
  return sessionField("locale", canonicalizeLocaleTag(locale));
}
