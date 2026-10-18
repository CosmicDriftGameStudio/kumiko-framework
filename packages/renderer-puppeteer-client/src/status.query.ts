import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import * as z from "zod";
import { loadClientConfig } from "./config.ts";
import { PUPPETEER_UNAVAILABLE_MESSAGE } from "./errors.ts";
import { serviceEgress } from "./http-client.ts";

const STATUS_TIMEOUT_MS = 3000;

type PuppeteerStatus =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly error: "puppeteer_unavailable";
      readonly message: string;
    };

type StatusLogger = ReturnType<typeof createFallbackLogger>;

// The status goes to the client: the technical cause (URL, network error, status)
// is only logged.
function unavailable(cause: string, log: StatusLogger): PuppeteerStatus {
  log.warn("PDF service status check failed", { cause });
  return {
    available: false,
    error: "puppeteer_unavailable",
    message: PUPPETEER_UNAVAILABLE_MESSAGE,
  };
}

// One probe without retries: the admin screen asks before offering PDF actions,
// so a slow answer must not hang it. /healthz is unauthenticated, so no token is sent.
async function probeService(log: StatusLogger): Promise<PuppeteerStatus> {
  let serviceUrl: string;
  try {
    serviceUrl = loadClientConfig().serviceUrl;
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e), log);
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await serviceEgress(serviceUrl)(`${serviceUrl}/healthz`, {
      signal: controller.signal,
    });
    return response.status === 200
      ? { available: true }
      : unavailable(`puppeteer-service answered ${response.status}`, log);
  } catch (e) {
    return unavailable(
      e instanceof Error && e.name === "AbortError"
        ? `no answer within ${STATUS_TIMEOUT_MS}ms`
        : e instanceof Error
          ? e.message
          : String(e),
      log,
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const puppeteerStatusQuery = defineQueryHandler({
  name: "puppeteer-status",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Reports whether the PDF service (puppeteer-service) answers its health check; use it to show an admin whether PDFs can be created right now.",
  handler: async (_event, ctx) =>
    probeService(createFallbackLogger("renderer-puppeteer-client", ctx.log)),
});
