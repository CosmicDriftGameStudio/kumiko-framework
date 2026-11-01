import { join } from "node:path";
import type { ApiExampleEndpoint, ApiExampleFile } from "@cosmicdrift/kumiko-types/api-example";
import type { RequestHelper } from "../stack/request-helper.ts";
import { normalizeApiExample } from "./normalize.ts";

export const RECORD_API_EXAMPLES_ENV = "KUMIKO_RECORD_API_EXAMPLES";

export type RecordApiExampleOptions = {
  /** File name without extension. */
  readonly name: string;
  readonly dir: string;
  readonly endpoint: ApiExampleEndpoint;
  readonly body: ApiExampleFile["request"]["body"];
  /** Raw personal access token; sent as bearer token and never written to the file. */
  readonly token: string;
};

/** Sends the request as an API client would and returns the result. The recording is only
 *  written when KUMIKO_RECORD_API_EXAMPLES=1, so ordinary test runs leave the files alone. */
export async function recordApiExample(
  http: Pick<RequestHelper, "raw">,
  options: RecordApiExampleOptions,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await http.raw("POST", options.endpoint, options.body, {
    Authorization: `Bearer ${options.token}`,
  });
  const body: unknown = await response.json();
  const result = { status: response.status, body };
  if (process.env[RECORD_API_EXAMPLES_ENV] === "1") {
    const file = normalizeApiExample({
      request: { endpoint: options.endpoint, body: options.body },
      response: result,
    });
    await Bun.write(
      join(options.dir, `${options.name}.json`),
      `${JSON.stringify(file, null, 2)}\n`,
    );
  }
  return result;
}
