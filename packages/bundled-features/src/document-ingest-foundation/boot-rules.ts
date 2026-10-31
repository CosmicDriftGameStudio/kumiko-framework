import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const DOCUMENT_INGEST_BOOT_RULES = {
  jobWithoutProviderFilter: {
    id: "document-ingest-foundation/job-without-provider-filter",
    summary:
      "A job triggered by documentIngest.requested filters to one provider, so it does not fire for every provider's uploads.",
    fix: 'Use trigger: documentIngestProviderTrigger("<name>").',
  },
  jobUnknownProvider: {
    id: "document-ingest-foundation/job-unknown-provider",
    summary:
      "A documentIngest.requested job filters to a provider that some feature registers via EXT_DOCUMENT_INGEST_PROVIDER.",
    fix: 'Register the provider via r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, "<name>", ...) or fix the provider name.',
  },
  providerWithoutJob: {
    id: "document-ingest-foundation/provider-without-job",
    summary:
      "A registered document-ingest provider has a job triggered by documentIngestProviderTrigger, otherwise requested files are never processed.",
    fix: "Add an r.job with that trigger, or unmount the provider.",
  },
} as const satisfies BootRuleTable;
