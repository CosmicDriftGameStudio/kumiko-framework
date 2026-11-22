import type {
  LetterAcceptance,
  LetterCancelResult,
  LetterMoney,
  LetterProvider,
  LetterProviderCapabilities,
  LetterProviderContext,
  LetterProviderOrder,
  LetterProviderPlugin,
  LetterProviderState,
  LetterShippingMode,
  LetterSpec,
  LetterSubmitResult,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { LetterXpressPrintJob } from "./api-schemas.ts";
import {
  createLetterXpressClient,
  type LetterXpressClient,
  type LetterXpressFailure,
  type LetterXpressResult,
  type LetterXpressSpecification,
} from "./client.ts";
import {
  LETTERXPRESS_C4_MAX_SHEETS,
  LETTERXPRESS_CANCEL_WINDOW_SECONDS,
  LETTERXPRESS_CURRENCY,
  LETTERXPRESS_ENV,
  LETTERXPRESS_FIND_MAX_PAGES,
  LETTERXPRESS_HOST,
  LETTERXPRESS_MAX_BYTES,
  LETTERXPRESS_MAX_SHEETS,
  LETTERXPRESS_NO_TRACKING_STATUS,
  LETTERXPRESS_VAT_PERCENT,
  type LetterXpressJobStatus,
  type LetterXpressListFilter,
  type LetterXpressMode,
  type LetterXpressRegistered,
} from "./constants.ts";
import { letterXpressEnvSchema } from "./env-schema.ts";

const LIST_FILTERS_OF_MODE: Readonly<Record<LetterXpressMode, readonly LetterXpressListFilter[]>> =
  {
    test: ["draft"],
    live: ["queue", "hold", "done"],
  };

const MOST_LISTS_PER_LOOKUP = Math.max(
  ...Object.values(LIST_FILTERS_OF_MODE).map((filters) => filters.length),
);

export const letterXpressCapabilities: LetterProviderCapabilities = {
  shippingModes: ["standard", "einwurf", "uebergabe"],
  envelopes: ["folded", "flat"],
  maxSheets: LETTERXPRESS_MAX_SHEETS,
  maxBytes: LETTERXPRESS_MAX_BYTES,
  maxFlatSheets: LETTERXPRESS_C4_MAX_SHEETS,
  cancelWindowSeconds: LETTERXPRESS_CANCEL_WINDOW_SECONDS,
  lookupRequestsPerLetter: MOST_LISTS_PER_LOOKUP * LETTERXPRESS_FIND_MAX_PAGES,
};

// Doc p. 7: r1 = "Einschreiben Einwurf", r2 = "Einschreiben". Mapping `uebergabe` to r2 is an assumption:
// the doc does not say that r2 is handed over against signature.
const REGISTERED_OF_SHIPPING_MODE: Readonly<
  Record<LetterShippingMode, LetterXpressRegistered | undefined>
> = {
  standard: undefined,
  einwurf: "r1",
  uebergabe: "r2",
  rueckschein: undefined,
};

// Test mode never processes orders (doc p. 4), so a draft stays queued for good.
const PROVIDER_STATE_OF_JOB_STATUS = {
  draft: "queued",
  queue: "queued",
  hold: "on-hold",
  done: "sent",
  canceled: "canceled",
} as const satisfies Record<LetterXpressJobStatus, LetterProviderState>;

// Doc p. 35 lists 400/401/403/405 as client errors: nothing was created. A 500 may have created the order.
const REJECTING_HTTP_STATUSES: readonly number[] = [400, 401, 403, 405];

type Rejected = Extract<LetterSubmitResult, { kind: "rejected" }>;

function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

function money(cents: number): LetterMoney {
  return { amount: cents, currency: LETTERXPRESS_CURRENCY };
}

function netOfGrossCents(grossCents: number): number {
  return Math.round((grossCents * 100) / (100 + LETTERXPRESS_VAT_PERCENT));
}

function specificationOf(spec: LetterSpec): LetterXpressSpecification {
  const asksForC4 = spec.envelope === "flat" && spec.sheetCount <= LETTERXPRESS_C4_MAX_SHEETS;
  return {
    color: spec.color ? "4" : "1",
    mode: spec.duplex ? "duplex" : "simplex",
    shipping: "national",
    ...(asksForC4 && { c4: 1 as const }),
  };
}

function describeFailure(failure: LetterXpressFailure): string {
  switch (failure.kind) {
    case "http-error":
      return `LetterXpress answered HTTP ${failure.status}${failure.message === "" ? "" : `: ${failure.message}`}`;
    case "unauthorized":
      return "LetterXpress refused the credentials (401)";
    case "not-found":
      return "LetterXpress answered 404";
    case "invalid-response":
      return "LetterXpress sent a response that does not match the documented shape";
    case "timeout":
      return "LetterXpress did not answer in time";
    case "unreachable":
      return "LetterXpress could not be reached";
  }
}

function unwrap<T>(result: LetterXpressResult<T>): T {
  if (result.kind === "ok") return result.data;
  throw new Error(describeFailure(result));
}

function refusalMessageOf(failure: LetterXpressFailure): string {
  const credentialsRefused =
    failure.kind === "unauthorized" || (failure.kind === "http-error" && failure.status === 403);
  if (credentialsRefused) return "LetterXpress rejected the credentials; nothing was created";
  return failure.kind === "http-error" ? failure.message : describeFailure(failure);
}

function isRefusedByProvider(failure: LetterXpressFailure): boolean {
  if (failure.kind === "unauthorized") return true;
  return failure.kind === "http-error" && REJECTING_HTTP_STATUSES.includes(failure.status);
}

function isThrottled(failure: LetterXpressFailure): boolean {
  return failure.kind === "http-error" && failure.status === 429;
}

function trackingNumberOf(job: LetterXpressPrintJob): string | undefined {
  const code = job.items[0]?.tracking_code;
  return code === undefined || code === null || code === "" ? undefined : code;
}

function trackingStatusOf(job: LetterXpressPrintJob): string | undefined {
  const text = job.items[0]?.tracking_status;
  if (text === undefined || text === null) return undefined;
  return text === "" || text === LETTERXPRESS_NO_TRACKING_STATUS ? undefined : text;
}

function acceptanceOf(
  job: LetterXpressPrintJob,
  cancelableUntil: Temporal.Instant | undefined,
): LetterAcceptance {
  const item = job.items[0];
  if (item === undefined) throw new Error("LetterXpress order without items");
  return {
    kind: "accepted",
    providerJobId: String(job.id),
    actualNet: money(eurosToCents(item.amount)),
    actualVat: money(eurosToCents(item.vat)),
    recognizedAddress: item.address,
    cancelableUntil,
    trackingNumber: trackingNumberOf(job),
  };
}

function readCredentials(source: LetterProviderContext["env"]): {
  username: string;
  apiKey: string;
} {
  const parsed = letterXpressEnvSchema.safeParse(source);
  const username = parsed.success ? parsed.data[LETTERXPRESS_ENV.username] : undefined;
  const apiKey = parsed.success ? parsed.data[LETTERXPRESS_ENV.apiKey] : undefined;
  if (username === undefined || apiKey === undefined) {
    throw new Error(
      `letterxpress provider needs ${LETTERXPRESS_ENV.username} and ${LETTERXPRESS_ENV.apiKey}`,
    );
  }
  return { username, apiKey };
}

export async function buildLetterXpressProvider(
  ctx: LetterProviderContext,
  options: {
    readonly now?: () => Temporal.Instant;
    readonly wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<LetterProvider> {
  const now = options.now ?? (() => Temporal.Now.instant());
  const mode: LetterXpressMode = ctx.live ? "live" : "test";
  const { username, apiKey } = readCredentials(ctx.env);
  const client: LetterXpressClient = createLetterXpressClient({
    egress: ctx.egress({ kind: "internal", allowOrigins: [`https://${LETTERXPRESS_HOST}`] }),
    username,
    apiKey,
    mode,
    ...(options.wait !== undefined && { wait: options.wait }),
  });

  // The doc names no signal for an empty balance, so `insufficient-balance` is never returned: open question for the test account.
  function rejectionOf(failure: LetterXpressFailure): Rejected {
    return {
      kind: "rejected",
      code: "refused-by-provider",
      message: refusalMessageOf(failure),
    };
  }

  return {
    async quote(spec) {
      const data = unwrap(
        await client.price({
          pages: spec.pageCount,
          specification: specificationOf(spec),
          registered: REGISTERED_OF_SHIPPING_MODE[spec.shippingMode],
        }),
      );
      return { net: money(netOfGrossCents(eurosToCents(data.price))), priceSource: "provider-api" };
    },

    async submit(submission) {
      const result = await client.createPrintJob({
        pdf: submission.pdf,
        specification: specificationOf(submission.spec),
        registered: REGISTERED_OF_SHIPPING_MODE[submission.spec.shippingMode],
        notice: submission.reference,
        filenameOriginal: `letter-${submission.reference}.pdf`,
      });
      if (result.kind === "ok") {
        return acceptanceOf(
          result.data,
          now().add({ seconds: LETTERXPRESS_CANCEL_WINDOW_SECONDS }),
        );
      }
      if (isThrottled(result)) {
        return {
          kind: "rejected",
          code: "refused-by-provider",
          message: "LetterXpress is throttling requests (429); nothing was created",
        };
      }
      if (isRefusedByProvider(result)) return rejectionOf(result);
      throw new Error(describeFailure(result));
    },

    async status(providerJobId) {
      const result = await client.getPrintJob(providerJobId);
      if (result.kind === "not-found") return { state: "not-found" };
      const job = unwrap(result);
      return {
        state: PROVIDER_STATE_OF_JOB_STATUS[job.status],
        trackingNumber: trackingNumberOf(job),
        trackingStatus: trackingStatusOf(job),
        recognizedAddress: job.items[0]?.address,
      };
    },

    async cancel(providerJobId): Promise<LetterCancelResult> {
      const result = await client.deletePrintJob(providerJobId);
      if (result.kind === "ok") return { kind: "canceled" };
      if (result.kind === "not-found") return { kind: "refused", reason: "unknown_job" };
      // Refused credentials say nothing about the order, so they must not read as a closed window.
      if (result.kind !== "unauthorized" && isRefusedByProvider(result)) {
        // The refusal body is undocumented, so the order status tells "done" from a closed window.
        const job = await client.getPrintJob(providerJobId);
        if (job.kind === "not-found") return { kind: "refused", reason: "unknown_job" };
        const reason = unwrap(job).status === "done" ? "already_processed" : "window_closed";
        return { kind: "refused", reason };
      }
      throw new Error(describeFailure(result));
    },

    // ponytail: scans at most LETTERXPRESS_FIND_MAX_PAGES pages (50 orders each, newest first) per list.
    // The API has no search on `notice`; if orders outgrow that window, the lookup needs a date filter or a stored job id.
    async findByReference(reference) {
      for (const filter of LIST_FILTERS_OF_MODE[mode]) {
        let page = 1;
        let lastPage = 1;
        while (page <= lastPage && page <= LETTERXPRESS_FIND_MAX_PAGES) {
          const list = unwrap(await client.listPrintJobs(filter, page));
          const hit = list.printjobs.find((job) => job.notice === reference);
          // `created_at` carries no zone, so the cancel deadline of a found order stays unknown.
          if (hit !== undefined) return acceptanceOf(hit, undefined);
          lastPage = list.pagination.last_page;
          page += 1;
        }
      }
      return null;
    },

    async findByJobId(providerJobId): Promise<LetterProviderOrder | null> {
      const result = await client.getPrintJob(providerJobId);
      if (result.kind === "not-found") return null;
      const job = unwrap(result);
      if (job.status === "canceled") return null;
      return { reference: job.notice ?? "", acceptance: acceptanceOf(job, undefined) };
    },
  };
}

// ponytail: no rate limiter; the provider allows 120 requests per minute and the foundation caps the poll run below that.
export const letterXpressPlugin: LetterProviderPlugin = {
  capabilities: letterXpressCapabilities,
  build: (ctx) => buildLetterXpressProvider(ctx),
};
