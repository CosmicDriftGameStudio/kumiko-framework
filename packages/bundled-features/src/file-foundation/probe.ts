import {
  createSystemUser,
  type FeatureRegistrar,
  FILE_PROVIDER_CONFIG_KEY,
  FILE_STORAGE_PROVIDER_BOOT_SENTINEL,
} from "@cosmicdrift/kumiko-framework/engine";
import { createConfigAccessor } from "../config/index.ts";
import { FILE_PROBE_KEYS } from "./i18n.ts";
import { makeTenantStorageProviderResolver } from "./storage-provider-resolver.ts";

const PROBE_CONTENT = new TextEncoder().encode("kumiko-readiness-probe");

function isSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

// Bypasses the file-ref entity on purpose: a probe leaves neither a ref nor events behind.
export function registerStorageProbe(r: FeatureRegistrar<"file-foundation">): void {
  r.probe({
    name: "storage-roundtrip",
    scope: "tenant",
    cost: "free",
    area: FILE_PROBE_KEYS.area,
    label: FILE_PROBE_KEYS.label,
    run: async (ctx) => {
      const { configResolver, secrets } = ctx.services;
      const userId = createSystemUser(ctx.tenantId).id;
      const notConfigured = {
        status: "skipped",
        message: { key: FILE_PROBE_KEYS.notConfigured },
      } as const;
      if (!configResolver) return notConfigured;
      const selected = await createConfigAccessor(
        ctx.registry,
        configResolver,
        ctx.tenantId,
        userId,
        ctx.db,
      )(FILE_PROVIDER_CONFIG_KEY);
      if (
        selected === undefined ||
        selected === "" ||
        selected === FILE_STORAGE_PROVIDER_BOOT_SENTINEL
      ) {
        return notConfigured;
      }

      const provider = await makeTenantStorageProviderResolver({
        registry: ctx.registry,
        configResolver,
        secrets,
        db: ctx.db,
        userId,
        handlerName: "file-foundation:probe",
      })(ctx.tenantId);
      const key = `${ctx.tenantId}/__readiness-probe/${ctx.probeRunId}.txt`;
      try {
        await provider.write(key, PROBE_CONTENT, "text/plain");
        if (!isSameBytes(await provider.read(key), PROBE_CONTENT)) {
          throw new Error("storage returned different bytes than were written");
        }
      } finally {
        await provider.delete(key);
      }
      return { status: "ok", message: { key: FILE_PROBE_KEYS.reachable } };
    },
  });
}
