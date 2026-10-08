import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { canonicalizeLocaleTag, isValidLocaleTag } from "@cosmicdrift/kumiko-framework/i18n";

export function sessionLocaleField(
  locale: string | null | undefined,
): Pick<SessionUser, "locale"> | Record<string, never> {
  if (locale === null || locale === undefined || !isValidLocaleTag(locale)) return {};
  return { locale: canonicalizeLocaleTag(locale) };
}

// Only an explicit request signal (X-Locale) counts: the boot default is not a
// choice the new user made.
export function registrationLocaleFromRequest(): ReturnType<typeof sessionLocaleField> {
  return sessionLocaleField(requestContext.get()?.locale);
}
