import { join } from "node:path";
import {
  formatWebhookPayloadIssues,
  parseWebhookPayload,
} from "@cosmicdrift/kumiko-framework/engine";
import type { WebhookEventContract } from "@cosmicdrift/kumiko-types/feature";
import { normalizeWebhookExample } from "./normalize.ts";
import { RECORD_API_EXAMPLES_ENV } from "./record.ts";

export const WEBHOOK_EXAMPLES_SUBDIR = "webhooks";

export type RecordWebhookExampleOptions = {
  /** File name without extension. */
  readonly name: string;
  /** The examples directory; the file lands in its `webhooks/` subdirectory. */
  readonly dir: string;
  readonly contract: WebhookEventContract;
  readonly payload: unknown;
};

/** Checks the payload against its contract and returns what delivery would send. A recording
 *  can therefore never contradict the contract; the file is only written when
 *  KUMIKO_RECORD_API_EXAMPLES=1. */
export async function recordWebhookExample(
  options: RecordWebhookExampleOptions,
): Promise<Record<string, unknown>> {
  const parsed = parseWebhookPayload(options.contract, options.payload);
  if (!parsed.ok) {
    throw new Error(
      `Webhook example "${options.name}" violates the contract of ${options.contract.qn}: ${formatWebhookPayloadIssues(parsed.issues)}`,
    );
  }
  if (process.env[RECORD_API_EXAMPLES_ENV] === "1") {
    const file = normalizeWebhookExample({
      event: options.contract.qn,
      version: options.contract.version,
      payload: parsed.payload,
    });
    await Bun.write(
      join(options.dir, WEBHOOK_EXAMPLES_SUBDIR, `${options.name}.json`),
      `${JSON.stringify(file, null, 2)}\n`,
    );
  }
  return parsed.payload;
}
