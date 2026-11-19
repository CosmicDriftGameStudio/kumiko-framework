import {
  type FeatureRegistrar,
  ProbeFailure,
  type ProbeVerdict,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { probePuppeteerService } from "./status.query.ts";

export const PDF_PROBE_KEYS = {
  area: "renderer-puppeteer-client.probe.area",
  label: "renderer-puppeteer-client.probe.pdf-service.label",
  available: "renderer-puppeteer-client.probe.pdf-service.available",
  unavailable: "renderer-puppeteer-client.probe.pdf-service.unavailable",
} as const;

export const PDF_PROBE_I18N = {
  [PDF_PROBE_KEYS.area]: { en: "PDF" },
  [PDF_PROBE_KEYS.label]: { en: "PDF service" },
  [PDF_PROBE_KEYS.available]: { en: "PDF service answers" },
  [PDF_PROBE_KEYS.unavailable]: { en: "The PDF service does not answer" },
} as const;

export function registerPdfServiceProbe(r: FeatureRegistrar<"renderer-puppeteer-client">): void {
  r.probe({
    name: "pdf-service",
    scope: "system",
    cost: "free",
    area: PDF_PROBE_KEYS.area,
    label: PDF_PROBE_KEYS.label,
    run: async (ctx): Promise<ProbeVerdict> => {
      const status = await probePuppeteerService(
        createFallbackLogger("renderer-puppeteer-client", ctx.obs.log),
      );
      if (!status.available) throw new ProbeFailure({ key: PDF_PROBE_KEYS.unavailable });
      return { status: "ok", message: { key: PDF_PROBE_KEYS.available } };
    },
  });
}
