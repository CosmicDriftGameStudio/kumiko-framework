// Every job triggered on documentIngest.requested must filter to exactly one
// registered provider, and every registered provider must have a job wired
// to it — otherwise requested ingests for that provider never get picked up.

import type { FeatureDefinition, JobDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { DOCUMENT_INGEST_REQUESTED_EVENT_QN } from "./events";
import { resolveDocumentIngestProviders } from "./providers";

// undefined = job isn't triggered on documentIngest.requested at all (not our
// concern here). "" = triggered without a usable where.provider filter.
function providerFilterOf(trigger: JobDefinition["trigger"]): string | undefined {
  if (!("on" in trigger)) return undefined;
  const on = Array.isArray(trigger.on) ? trigger.on : [trigger.on];
  if (!on.includes(DOCUMENT_INGEST_REQUESTED_EVENT_QN)) return undefined;
  const provider = trigger.where?.["provider"];
  return typeof provider === "string" && provider.length > 0 ? provider : "";
}

export function validateDocumentIngestProviderWiring(features: readonly FeatureDefinition[]): void {
  const allUsages = features.flatMap((f) => f.extensionUsages);
  // Throws on invalid options / mimeType collisions.
  const byMime = resolveDocumentIngestProviders(allUsages);
  const registeredProviderNames = new Set([...byMime.values()].map((p) => p.name));

  const wiredProviderNames = new Set<string>();
  for (const feature of features) {
    for (const jobDef of Object.values(feature.jobs)) {
      const provider = providerFilterOf(jobDef.trigger);
      if (provider === undefined) continue;
      if (provider === "") {
        throw new Error(
          `[kumiko:boot] Job "${jobDef.name}" (feature "${feature.name}") triggers on ` +
            `document-ingest-foundation's documentIngest.requested without a provider filter — every job on ` +
            `this event must route through documentIngestProviderTrigger("<name>"), or it fires for every ` +
            `provider's uploads. Use: trigger: documentIngestProviderTrigger("<name>").`,
        );
      }
      if (!registeredProviderNames.has(provider)) {
        throw new Error(
          `[kumiko:boot] Job "${jobDef.name}" (feature "${feature.name}") filters documentIngest.requested to ` +
            `provider "${provider}", but no feature registers that provider via ` +
            `r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, "${provider}", ...). Known: ` +
            `${[...registeredProviderNames].join(", ") || "<none>"}.`,
        );
      }
      wiredProviderNames.add(provider);
    }
  }

  for (const name of registeredProviderNames) {
    if (wiredProviderNames.has(name)) continue;
    throw new Error(
      `[kumiko:boot] Provider "${name}" is registered via EXT_DOCUMENT_INGEST_PROVIDER but no job triggers on ` +
        `documentIngestProviderTrigger("${name}") — files matching its mimeTypes would be requested for ingest ` +
        `and never processed. Add an r.job with that trigger, or unmount the provider.`,
    );
  }
}
