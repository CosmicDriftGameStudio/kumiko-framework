import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { entityFieldLabels, localizedLabels } from "../labels.ts";
import type { RegistryManifestView } from "../types.ts";
import type { ApiDocsModel } from "./model.ts";
import type { ApiDocsProblem } from "./problems.ts";
import { fieldRows } from "./schema-fields.ts";

// "en" is skipped like for descriptions: the English page may fall back to the handler's own
// text, while a German page that shows English titles or empty field cells is a visible gap.
const FALLBACK_LOCALE = "en";

export function findTitleAndFieldLabelProblems(
  registry: Pick<RegistryManifestView, "getAllTranslations" | "getHandlerEntity">,
  model: Pick<ApiDocsModel, "handlers">,
  locales: readonly string[],
): readonly ApiDocsProblem[] {
  const translations = registry.getAllTranslations();
  const checkedLocales = locales.filter((locale) => locale !== FALLBACK_LOCALE);
  return model.handlers.flatMap((handler) => {
    const titleLabels = localizedLabels(translations, handlerTitleKey(handler.qn));
    const entity = registry.getHandlerEntity(handler.qn);
    const titleProblems = checkedLocales.flatMap((locale): ApiDocsProblem[] =>
      titleLabels[locale] === undefined
        ? [{ kind: "titleTranslationMissing", qn: handler.qn, locale }]
        : [],
    );
    const fieldProblems = fieldRows(handler.inputSchema).flatMap(({ name: field }) => {
      const own = localizedLabels(translations, handlerFieldLabelKey(handler.qn, field));
      const labels =
        Object.keys(own).length > 0 || entity === undefined
          ? own
          : entityFieldLabels(translations, entity, field, handler.qn.split(":")[0]);
      if (Object.keys(labels).length === 0) return [];
      return checkedLocales.flatMap((locale): ApiDocsProblem[] =>
        labels[locale] === undefined
          ? [{ kind: "fieldLabelMissing", qn: handler.qn, field, locale }]
          : [],
      );
    });
    return [...titleProblems, ...fieldProblems];
  });
}
