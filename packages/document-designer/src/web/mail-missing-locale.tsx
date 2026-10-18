// @runtime client
import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  useMutation,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { languageName } from "./mail-origin-bar.tsx";

export function languageAdjective(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  locale: string,
): string {
  const key = `documentDesigner.mail.languageAdjective.${locale}`;
  const translated = t(key);
  return translated === key ? locale : translated;
}

// Shown in place of the editor while a language has no version yet: nothing to edit, so no
// subject line, toolbar or properties; the two ways to get a version sit right here.
export function MissingLocaleCanvas({
  slug,
  locale,
  fallbackLocale,
  copyScope,
  onCreateBlank,
  onCopied,
}: {
  readonly slug: string;
  readonly locale: string;
  readonly fallbackLocale: string | null;
  readonly copyScope: "tenant" | "system";
  readonly onCreateBlank: () => void;
  readonly onCopied: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Button } = usePrimitives();
  const copyLocale = useMutation(TemplateResolverHandlers.copyLocale);
  const [error, setError] = useState<string | null>(null);

  const copy = async (from: string): Promise<void> => {
    setError(null);
    const result = await copyLocale.mutate({
      slug,
      kind: "mail",
      fromLocale: from,
      toLocale: locale,
      overwrite: false,
      scope: copyScope,
    });
    if (result.isSuccess) onCopied();
    else setError(dispatcherErrorText(result.error, t));
  };

  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-8"
      data-testid="mail-missing-locale"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <p className="m-0 text-base">
          {fallbackLocale === null
            ? t("documentDesigner.mail.missing.textNoFallback", {
                language: languageName(t, locale),
              })
            : t("documentDesigner.mail.missing.text", {
                language: languageName(t, locale),
                locale,
                fallbackAdjective: languageAdjective(t, fallbackLocale),
              })}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {fallbackLocale !== null && (
            <Button
              variant="primary"
              disabled={copyLocale.pending}
              onClick={() => copy(fallbackLocale)}
              testId="mail-copy-locale"
            >
              {t("documentDesigner.mail.missing.copy", {
                language: languageName(t, fallbackLocale),
              })}
            </Button>
          )}
          <Button variant="secondary" onClick={onCreateBlank} testId="mail-create-blank">
            {t("documentDesigner.mail.origin.createBlank")}
          </Button>
        </div>
        {fallbackLocale !== null && (
          <p className="m-0 text-xs text-muted-foreground">
            {t("documentDesigner.mail.origin.copyNote")}
          </p>
        )}
        {error !== null && (
          <Banner variant="error" testId="mail-copy-error">
            {error}
          </Banner>
        )}
      </div>
    </div>
  );
}
