import type { AppApiDocsConfig } from "@cosmicdrift/kumiko-framework/config";
import type { ResolvedApiDocsConfig } from "./model.ts";

/** The one place that fills the config defaults, so `kumiko api-docs` and the recipe golden
 *  test generate from the same settings. A missing `baseUrl` stays empty: the CLI refuses it
 *  before it gets here. */
export function resolveApiDocsConfig(
  apiDocs: AppApiDocsConfig,
  options: { readonly appName: string; readonly locales?: readonly string[] },
): ResolvedApiDocsConfig {
  return {
    ...apiDocs,
    locales: options.locales ?? apiDocs.locales ?? ["en"],
    baseUrl: apiDocs.baseUrl ?? "",
    appName: apiDocs.appName ?? options.appName,
  };
}
