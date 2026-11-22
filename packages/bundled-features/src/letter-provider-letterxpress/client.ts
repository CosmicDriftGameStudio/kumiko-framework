import { createHash } from "node:crypto";
import * as z from "zod";
import {
  envelopeOf,
  errorBodySchema,
  type LetterXpressPrice,
  type LetterXpressPrintJob,
  type LetterXpressPrintJobList,
  priceDataSchema,
  printJobListSchema,
  printJobSchema,
} from "./api-schemas.ts";
import {
  LETTERXPRESS_BASE_URL,
  LETTERXPRESS_SUBMIT_TIMEOUT_MS,
  LETTERXPRESS_TIMEOUT_MS,
  type LetterXpressListFilter,
  type LetterXpressMode,
  type LetterXpressRegistered,
} from "./constants.ts";

export type LetterXpressFailure =
  | { readonly kind: "not-found" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "http-error"; readonly status: number; readonly message: string }
  | { readonly kind: "invalid-response" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unreachable" };

export type LetterXpressResult<T> = { readonly kind: "ok"; readonly data: T } | LetterXpressFailure;

export type LetterXpressSpecification = {
  readonly color: "1" | "4";
  readonly mode: "simplex" | "duplex";
  readonly shipping: "national";
  readonly c4?: 1 | undefined;
};

export type PriceRequest = {
  readonly pages: number;
  readonly specification: LetterXpressSpecification;
  readonly registered?: LetterXpressRegistered | undefined;
};

export type CreatePrintJobRequest = {
  readonly pdf: Uint8Array;
  readonly specification: LetterXpressSpecification;
  readonly registered?: LetterXpressRegistered | undefined;
  readonly notice: string;
  readonly filenameOriginal: string;
};

export type LetterXpressClientOptions = {
  readonly egress: (raw: string, init?: RequestInit) => Promise<Response>;
  readonly username: string;
  readonly apiKey: string;
  readonly mode: LetterXpressMode;
};

export type LetterXpressClient = {
  price(request: PriceRequest): Promise<LetterXpressResult<LetterXpressPrice>>;
  createPrintJob(request: CreatePrintJobRequest): Promise<LetterXpressResult<LetterXpressPrintJob>>;
  getPrintJob(id: string): Promise<LetterXpressResult<LetterXpressPrintJob>>;
  listPrintJobs(
    filter: LetterXpressListFilter,
    page: number,
  ): Promise<LetterXpressResult<LetterXpressPrintJobList>>;
  deletePrintJob(id: string): Promise<LetterXpressResult<null>>;
};

const MAX_PROVIDER_MESSAGE_CHARS = 300;
const JOB_ID_PATTERN = /^\d{1,18}$/;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function providerMessageOf(text: string): string {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text));
    const message = parsed.success ? parsed.data.message : undefined;
    return (message ?? "").slice(0, MAX_PROVIDER_MESSAGE_CHARS);
  } catch {
    return "";
  }
}

export function createLetterXpressClient(options: LetterXpressClientOptions): LetterXpressClient {
  const auth = { username: options.username, apikey: options.apiKey, mode: options.mode };

  // The API reads a JSON body on GET, which fetch refuses to send. A POST with the method-override
  // header reaches the GET route; checked against the provider test mode for every read and the delete.
  async function call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    timeoutMs: number = LETTERXPRESS_TIMEOUT_MS,
  ): Promise<LetterXpressResult<T>> {
    let response: Response;
    let text: string;
    try {
      response = await options.egress(`${LETTERXPRESS_BASE_URL}${path}`, {
        method: method === "GET" ? "POST" : method,
        headers: {
          "Content-Type": "application/json",
          ...(method === "GET" && { "X-HTTP-Method-Override": "GET" }),
        },
        body: JSON.stringify({ auth, ...body }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (err) {
      return { kind: isTimeout(err) ? "timeout" : "unreachable" };
    }

    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status !== 200) {
      return { kind: "http-error", status: response.status, message: providerMessageOf(text) };
    }
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "invalid-response" };
    } catch {
      return { kind: "invalid-response" };
    }
  }

  function withValidId<T>(
    id: string,
    run: () => Promise<LetterXpressResult<T>>,
  ): Promise<LetterXpressResult<T>> {
    return JOB_ID_PATTERN.test(id) ? run() : Promise.resolve({ kind: "not-found" });
  }

  async function unwrapData<T>(
    pending: Promise<LetterXpressResult<{ readonly data: T }>>,
  ): Promise<LetterXpressResult<T>> {
    const result = await pending;
    return result.kind === "ok" ? { kind: "ok", data: result.data.data } : result;
  }

  return {
    price: (request) =>
      unwrapData(
        call(
          "GET",
          "/price",
          {
            letter: {
              specification: { pages: request.pages, ...request.specification },
              ...(request.registered !== undefined && { registered: request.registered }),
            },
          },
          envelopeOf(priceDataSchema),
        ),
      ),
    createPrintJob: (request) => {
      const base64File = Buffer.from(request.pdf).toString("base64");
      return unwrapData(
        call(
          "POST",
          "/printjobs",
          {
            letter: {
              base64_file: base64File,
              base64_file_checksum: createHash("md5").update(base64File).digest("hex"),
              specification: request.specification,
              notice: request.notice,
              filename_original: request.filenameOriginal,
              ...(request.registered !== undefined && { registered: request.registered }),
            },
          },
          envelopeOf(printJobSchema),
          LETTERXPRESS_SUBMIT_TIMEOUT_MS,
        ),
      );
    },
    getPrintJob: (id) =>
      withValidId(id, () =>
        unwrapData(call("GET", `/printjobs/${id}`, {}, envelopeOf(printJobSchema))),
      ),
    listPrintJobs: (filter, page) =>
      unwrapData(
        call("GET", `/printjobs?filter=${filter}&page=${page}`, {}, envelopeOf(printJobListSchema)),
      ),
    deletePrintJob: async (id) => {
      const result = await withValidId(id, () =>
        call("DELETE", `/printjobs/${id}`, {}, z.object({})),
      );
      return result.kind === "ok" ? { kind: "ok", data: null } : result;
    },
  };
}
