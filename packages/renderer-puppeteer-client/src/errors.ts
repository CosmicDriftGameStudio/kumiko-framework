import { KumikoError } from "@cosmicdrift/kumiko-framework/errors";

// The puppeteer-service did not answer (network, timeout, 5xx after retries) or the
// client is not configured, so no PDF can be created. 503 tells the client to retry later.
export const PUPPETEER_UNAVAILABLE_MESSAGE =
  "The PDF service is not reachable right now, so no PDF can be created. Please try again later.";

// The cause (URL, network error, status) is logged by the caller: a non-internal
// KumikoError serializes message and details to the client.
export class PuppeteerUnavailableError extends KumikoError {
  readonly code = "puppeteer_unavailable";
  readonly httpStatus = 503;

  constructor() {
    super({
      message: PUPPETEER_UNAVAILABLE_MESSAGE,
      i18nKey: "errors.puppeteer_unavailable",
    });
  }
}
