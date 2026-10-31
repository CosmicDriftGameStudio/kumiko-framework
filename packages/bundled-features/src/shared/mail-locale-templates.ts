import type { NotificationLocalizedTemplate } from "@cosmicdrift/kumiko-framework/engine";
import {
  hasMailTranslationKey,
  listMailLocales,
  mailT,
  resolveMailLocale,
} from "@cosmicdrift/kumiko-framework/i18n";

type MailLocaleTemplateConfig<Kind extends string> = {
  readonly kinds: readonly Kind[];
  readonly notificationTypes: Readonly<Record<Kind, string>>;
  readonly subjectKey: (kind: Kind) => string;
  readonly bodyFor: (kind: Kind, locale: string) => string;
  // Subject placeholder -> template variable; defaults to the app name only.
  readonly subjectSlots?: (kind: Kind) => Readonly<Record<string, string>>;
};

export function createMailLocaleTemplates<Kind extends string>(
  config: MailLocaleTemplateConfig<Kind>,
): {
  templateLocale: (notificationType: string, requestedLocale: string) => string;
  localizedTemplate: (kind: Kind) => () => NotificationLocalizedTemplate;
} {
  const subjectKeyByType: ReadonlyMap<string, string> = new Map(
    config.kinds.map((kind) => [config.notificationTypes[kind], config.subjectKey(kind)]),
  );

  // A registered locale whose bundle lacks the subject key has no template (see
  // localizedTemplate); the renderer has no locale fallback, so the sender must
  // pick a locale that has one or the mail would not go out at all.
  const templateLocale = (notificationType: string, requestedLocale: string): string => {
    const locale = resolveMailLocale(requestedLocale);
    const key = subjectKeyByType.get(notificationType);
    return key !== undefined && hasMailTranslationKey(locale, key) ? locale : "en";
  };

  // Evaluated when the registry is built, after every locale feature has
  // registered its mail translations. English always ships; another locale only
  // gets a template when it has its own subject, so a missing translation never
  // silently becomes an English mail in that locale's slot.
  const localizedTemplate = (kind: Kind): (() => NotificationLocalizedTemplate) => {
    const kindSubjectKey = config.subjectKey(kind);
    return () => {
      const locales = [
        "en",
        ...listMailLocales().filter(
          (locale) => locale !== "en" && hasMailTranslationKey(locale, kindSubjectKey),
        ),
      ];
      return Object.fromEntries(
        locales.map((locale) => [
          locale,
          {
            body: config.bodyFor(kind, locale),
            meta: {
              subject: mailT(
                locale,
                kindSubjectKey,
                config.subjectSlots?.(kind) ?? { app: "{{appName}}" },
              ),
              category: "transactional" as const,
            },
          },
        ]),
      );
    };
  };

  return { templateLocale, localizedTemplate };
}
