import type { AppApiDocsConfig } from "@cosmicdrift/kumiko-framework/config";
import type { ResolvedApiDocsConfig } from "./model.ts";

/** The one place that fills the config defaults and loads the lazy `translations`, so
 *  `kumiko api-docs` and the recipe golden test generate from the same settings. A missing
 *  `baseUrl` stays empty: the CLI refuses it before it gets here. */
export async function resolveApiDocsConfig(
  apiDocs: AppApiDocsConfig,
  options: { readonly appName: string; readonly locales?: readonly string[] },
): Promise<ResolvedApiDocsConfig> {
  const { translations, ...rest } = apiDocs;
  const docTranslations = translations === undefined ? undefined : await translations();
  return {
    ...rest,
    locales: options.locales ?? apiDocs.locales ?? ["en"],
    baseUrl: apiDocs.baseUrl ?? "",
    appName: apiDocs.appName ?? options.appName,
    ...(docTranslations !== undefined && { translations: docTranslations }),
  };
}
