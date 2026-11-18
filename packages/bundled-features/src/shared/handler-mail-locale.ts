import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { hasMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";

// X-Locale / Accept-Language on the request wins over the handler's static opts
// locale, then ctx.locale's resolved default (always set — boot default / "en").
// Reading requestContext is load-bearing: ctx.locale alone cannot tell whether
// THIS request carried a locale signal. The request locale is only checked for
// well-formedness, so a candidate without mail translations (e.g. "pl") is
// skipped; otherwise it would push the mail into the English fallback even
// though the app's configured locale has a table.
export function resolveHandlerMailLocale(
  ctx: { readonly locale?: string },
  optsLocale: string | undefined,
): string | undefined {
  const candidates = [requestContext.get()?.locale, optsLocale, ctx.locale].filter(
    (locale): locale is string => locale !== undefined,
  );
  return candidates.find((locale) => hasMailTranslations(locale)) ?? candidates[0];
}
