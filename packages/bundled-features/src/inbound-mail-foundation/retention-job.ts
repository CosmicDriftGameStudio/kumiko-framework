import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileProviderForTenant,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { runInboundMailRetention } from "./retention-sweep.ts";

export function registerInboundMailRetentionJob(r: FeatureRegistrar<"inbound-mail-foundation">) {
  // Data-Retention — perTenant fan-out (one run per tenant, like
  // data-retention:retention-cleanup): runInboundMailRetention's raw query
  // helpers need the unfiltered runner, so the handler declares escapeHatch
  // and reaches for ctx.db.unsafeRaw(). Without this cron, read_inbound_messages
  // + the bodies grow unbounded (GDPR Art. 5).
  const INBOUND_MAIL_RETENTION_REASON =
    "inbound-mail retention runs raw deletes; every statement filters by this run's tenantId";
  r.job({
    name: "inbound-mail-retention",
    trigger: { cron: "0 3 * * *" },
    perTenant: true,
    concurrency: "skip",
    escapeHatch: { reason: INBOUND_MAIL_RETENTION_REASON },
    handler: async (_payload, ctx) => {
      if (!ctx.registry) {
        throw new Error("inbound-mail-retention: ctx.registry required (JobContext incomplete)");
      }
      const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
      if (tenantId === undefined) {
        // skip: cron fired without a perTenant fan-out tenant — nothing scoped
        return;
      }
      const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
      const retentionDb = ctx.db.unsafeRaw() as DbConnection; // @cast-boundary db-operator — jobs never run inside a DbTx

      // Original (.eml/.html) objects live in file-foundation; the provider is lazy and
      // memoized so a tenant without purgeable mails never builds it. Attachment files are
      // deliberately kept: they are ordinary file records the tenant may still use.
      let providerPromise: Promise<FileStorageProvider> | null = null;
      const deleteBodyObject = async (bodyRef: string): Promise<void> => {
        if (!providerPromise) {
          providerPromise = createFileProviderForTenant(
            { config: ctx.config, registry: ctx.registry, secrets: ctx.services.secrets },
            tenantId,
          );
        }
        const provider = await providerPromise;
        await provider.delete(bodyRef);
      };

      const report = await runInboundMailRetention({
        db: retentionDb,
        tenantId,
        now: T.Now.instant(),
        deleteBodyObject,
      });
      if (report.bodyObjectErrors > 0) {
        // biome-ignore lint/suspicious/noConsole: operator-visibility for failed body deletes
        console.warn(
          `[inbound-mail-foundation:inbound-mail-retention] tenant=${tenantId} bodyObjectErrors=${report.bodyObjectErrors}`,
        );
      }
    },
  });
}
