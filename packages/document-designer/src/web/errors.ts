// @runtime client
import { TemplateResolverErrors } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

function reasonOf(error: DispatcherError): string | undefined {
  const reason = propertyOf(error.details, "reason");
  return typeof reason === "string" ? reason : undefined;
}

export function isAlreadyActive(error: DispatcherError): boolean {
  return (
    error.code === TemplateResolverErrors.alreadyActive ||
    reasonOf(error) === TemplateResolverErrors.alreadyActive
  );
}

const REASON_KEYS: Readonly<Record<string, string>> = {
  [TemplateResolverErrors.resourceTooLarge]: "documentDesigner.error.resourceTooLarge",
  [TemplateResolverErrors.resourceUnsupportedImage]:
    "documentDesigner.error.resourceUnsupportedImage",
};

/** Plain-language text for a failed call; falls back to the server message when no translation exists. */
export function describeError(t: Translate, error: DispatcherError): string {
  const reason = reasonOf(error);
  const reasonKey = reason === undefined ? undefined : REASON_KEYS[reason];
  if (reasonKey !== undefined) return t(reasonKey);
  const translated = t(error.i18nKey, error.i18nParams);
  return translated === error.i18nKey ? error.message : translated;
}
