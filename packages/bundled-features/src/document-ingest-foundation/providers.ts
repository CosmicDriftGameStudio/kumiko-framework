// document-ingest-foundation — provider extension-point. One shared
// documentIngest.requested QN fans out to every mounted provider's job,
// partitioned by documentIngestProviderTrigger's where-filter.

import type { FeatureDefinition, Registry } from "@cosmicdrift/kumiko-framework/engine";
import { normalizeMimeType } from "@cosmicdrift/kumiko-framework/files";
import * as z from "zod";
import { DOCUMENT_INGEST_REQUESTED_EVENT_QN } from "./events";

export const EXT_DOCUMENT_INGEST_PROVIDER = "documentIngestProvider" as const;

export const documentIngestProviderOptionsSchema = z.object({
  mimeTypes: z.array(z.string().min(1)).min(1),
  maxFileBytes: z.number().int().positive(),
});
export type DocumentIngestProviderOptions = z.infer<typeof documentIngestProviderOptionsSchema>;

// r.useExtension options-shape, co-located since the framework never imports upward.
declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [EXT_DOCUMENT_INGEST_PROVIDER]: DocumentIngestProviderOptions;
  }
}

export type ResolvedDocumentIngestProvider = {
  readonly name: string;
  readonly maxFileBytes: number;
};

type ExtensionUsages = FeatureDefinition["extensionUsages"];

// Throws on an invalid options shape or two providers claiming the same
// normalized mimeType — callers decide whether that's boot-fatal.
export function resolveDocumentIngestProviders(
  usages: ExtensionUsages,
): ReadonlyMap<string, ResolvedDocumentIngestProvider> {
  const byMime = new Map<string, ResolvedDocumentIngestProvider>();
  for (const usage of usages) {
    if (usage.extensionName !== EXT_DOCUMENT_INGEST_PROVIDER) continue;
    const parsed = documentIngestProviderOptionsSchema.safeParse(usage.options);
    if (!parsed.success) {
      throw new Error(
        `document-ingest-foundation: provider "${usage.entityName}" registered invalid options via ` +
          `r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, "${usage.entityName}", ...) — ${parsed.error.message}`,
      );
    }
    for (const mimeType of parsed.data.mimeTypes) {
      const normalized = normalizeMimeType(mimeType);
      const existing = byMime.get(normalized);
      if (existing && existing.name !== usage.entityName) {
        throw new Error(
          `document-ingest-foundation: providers "${existing.name}" and "${usage.entityName}" both claim mimeType ` +
            `"${normalized}" — each mimeType may have exactly one registered provider.`,
        );
      }
      byMime.set(normalized, { name: usage.entityName, maxFileBytes: parsed.data.maxFileBytes });
    }
  }
  return byMime;
}

export function listIngestibleMimeTypes(registry: Registry): readonly string[] {
  const usages = registry.getExtensionUsages(EXT_DOCUMENT_INGEST_PROVIDER);
  return [...resolveDocumentIngestProviders(usages).keys()].sort();
}

export type DocumentIngestProviderJobTrigger = {
  readonly on: typeof DOCUMENT_INGEST_REQUESTED_EVENT_QN;
  readonly where: { readonly provider: string };
};

// The trigger every provider's job must use — filters the shared
// documentIngest.requested QN down to just this provider's requests.
export function documentIngestProviderTrigger(
  providerName: string,
): DocumentIngestProviderJobTrigger {
  return { on: DOCUMENT_INGEST_REQUESTED_EVENT_QN, where: { provider: providerName } };
}
