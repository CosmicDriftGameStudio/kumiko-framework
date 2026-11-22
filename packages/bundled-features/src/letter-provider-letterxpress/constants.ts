export const LETTERXPRESS_FEATURE = "letter-provider-letterxpress" as const;
export const LETTERXPRESS_PROVIDER_NAME = "letterxpress" as const;

export const LETTERXPRESS_HOST = "api.letterxpress.de";
export const LETTERXPRESS_BASE_URL = `https://${LETTERXPRESS_HOST}/v3`;

export const LETTERXPRESS_ENV = {
  username: "LETTERXPRESS_USERNAME",
  apiKey: "LETTERXPRESS_API_KEY",
} as const;

// API doc p. 3: a PDF may not exceed 50 MB per request.
export const LETTERXPRESS_MAX_BYTES = 50 * 1024 * 1024;

// The provider price list carries letters up to 190 sheets (Maxisendung); larger items ship as a parcel and are not offered. The API doc names no limit.
export const LETTERXPRESS_MAX_SHEETS = 190;

// API doc p. 7: the C4 envelope can be asked for "under 9 sheets". What a larger letter ships in is not documented.
export const LETTERXPRESS_C4_MAX_SHEETS = 8;

// API doc p. 15 and 19: an order is editable and deletable only within 15 minutes after transmission.
export const LETTERXPRESS_CANCEL_WINDOW_SECONDS = 900;

// The price API answers gross; net follows from the German standard rate.
export const LETTERXPRESS_VAT_PERCENT = 19;

export const LETTERXPRESS_CURRENCY = "EUR";

// API doc p. 3: 120 requests per minute. The foundation caps the poll run below that, so no limiter here.
export const LETTERXPRESS_TIMEOUT_MS = 30_000;
export const LETTERXPRESS_SUBMIT_TIMEOUT_MS = 120_000;

// The list API answers 50 orders per page, newest first.
export const LETTERXPRESS_FIND_MAX_PAGES = 4;

// A 429 on submit means nothing was created. The provider limits per minute, so one minute of waiting reaches a new window; the client waits Retry-After (whole seconds) once, capped, or the default without the header.
export const LETTERXPRESS_RATE_LIMIT_DEFAULT_WAIT_MS = 60_000;
export const LETTERXPRESS_RATE_LIMIT_MAX_WAIT_MS = 60_000;

export const LETTERXPRESS_MODES = ["test", "live"] as const;
export type LetterXpressMode = (typeof LETTERXPRESS_MODES)[number];

export const LETTERXPRESS_LIST_FILTERS = ["queue", "hold", "done", "canceled", "draft"] as const;
export type LetterXpressListFilter = (typeof LETTERXPRESS_LIST_FILTERS)[number];

export const LETTERXPRESS_JOB_STATUSES = ["draft", "queue", "hold", "done", "canceled"] as const;
export type LetterXpressJobStatus = (typeof LETTERXPRESS_JOB_STATUSES)[number];

export const LETTERXPRESS_REGISTERED = ["r1", "r2"] as const;
export type LetterXpressRegistered = (typeof LETTERXPRESS_REGISTERED)[number];

export const LETTERXPRESS_NO_TRACKING_STATUS = "--";
