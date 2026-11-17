import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import * as z from "zod";

export type SearchBootOption = { readonly provider: "meili-env"; readonly indexPrefix?: string };

export const meiliEnvSchema = z.object({
  MEILI_URL: z.string().url().describe('Meilisearch URL; required with search "meili-env".'),
  MEILI_MASTER_KEY: z
    .string()
    .min(1)
    .describe('Meilisearch API key; required with search "meili-env".')
    .meta({ kumiko: { pulumi: { secret: true } } }),
});

export async function resolveSearchOption(
  option: SearchBootOption,
  envSource: Readonly<Record<string, string | undefined>>,
): Promise<SearchAdapter> {
  const url = envSource["MEILI_URL"]?.trim();
  const apiKey = envSource["MEILI_MASTER_KEY"]?.trim();
  if (!url || !apiKey) {
    const missing: string[] = [];
    if (!url) missing.push("MEILI_URL");
    if (!apiKey) missing.push("MEILI_MASTER_KEY");
    throw new Error(`[runProdApp] search "meili-env" is missing: ${missing.join(", ")}.`);
  }
  // meilisearch is an optional peer of the framework; a static import would break every app without it.
  let meilisearchModule: typeof import("@cosmicdrift/kumiko-framework/search/meilisearch");
  try {
    meilisearchModule = await import("@cosmicdrift/kumiko-framework/search/meilisearch");
  } catch (error) {
    throw new Error(
      '[runProdApp] search "meili-env" needs the optional peer dependency "meilisearch"; add it to the app\'s dependencies.',
      { cause: error },
    );
  }
  return meilisearchModule.createMeilisearchAdapter({
    url,
    apiKey,
    ...(option.indexPrefix !== undefined && { indexPrefix: option.indexPrefix }),
  });
}

export function searchAdapterContext(
  searchAdapter: SearchAdapter | undefined,
  appExtraContext: Readonly<Record<string, unknown>>,
  processName: string,
): { readonly searchAdapter?: SearchAdapter } {
  if (searchAdapter === undefined) return {};
  if (Object.hasOwn(appExtraContext, "searchAdapter")) {
    throw new Error(
      `[${processName}] the search option and extraContext.searchAdapter are both set; drop extraContext.searchAdapter.`,
    );
  }
  return { searchAdapter };
}
