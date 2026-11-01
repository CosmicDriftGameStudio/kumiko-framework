import {
  type ApiExampleFile,
  ApiExampleFileSchema,
  type WebhookExampleFile,
  WebhookExampleFileSchema,
} from "@cosmicdrift/kumiko-types/api-example";

export const EXAMPLE_TIMESTAMP = "2026-01-15T09:30:00.000Z";
export const EXAMPLE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
export const EXAMPLE_CURSOR = "CURSOR";
export const EXAMPLE_TOKEN = "kpat_EXAMPLE";
export const EXAMPLE_SECRET = "REDACTED";

// Recordings are committed and published, so credentials sent in a payload never reach the file.
const SECRET_KEY = /password|secret|mfaCode/i;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const PAT_TOKEN = /kpat_[A-Za-z0-9_-]+/g;

function placeholderUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One walker per recording: UUIDs are numbered by first occurrence across everything it walks. */
function createExampleWalker(): (value: unknown) => unknown {
  const uuids = new Map<string, string>();
  const normalizeString = (text: string): string =>
    text
      .replace(PAT_TOKEN, EXAMPLE_TOKEN)
      .replace(UUID, (found) => {
        const key = found.toLowerCase();
        const known = uuids.get(key);
        if (known !== undefined) return known;
        const created = placeholderUuid(uuids.size + 1);
        uuids.set(key, created);
        return created;
      })
      .replace(ISO_TIMESTAMP, EXAMPLE_TIMESTAMP);

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return normalizeString(value);
    if (Array.isArray(value)) return value.map(walk);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]): [string, unknown] => {
        if (SECRET_KEY.test(key) && typeof entry === "string") return [key, EXAMPLE_SECRET];
        if (key === "requestId") return [key, EXAMPLE_REQUEST_ID];
        if (key === "timestamp") return [key, EXAMPLE_TIMESTAMP];
        if (key === "nextCursor" && entry !== null && entry !== undefined) {
          return [key, EXAMPLE_CURSOR];
        }
        return [key, walk(entry)];
      }),
    );
  };
  return walk;
}

/** Makes a recording stable across runs: the same input shape always yields the same file. */
export function normalizeApiExample(example: ApiExampleFile): ApiExampleFile {
  // Numbered by first occurrence, request before response; the same UUID keeps its number.
  const walk = createExampleWalker();
  const request = walk(example.request);
  const response = walk(example.response);
  return ApiExampleFileSchema.parse({ request, response });
}

export function normalizeWebhookExample(example: WebhookExampleFile): WebhookExampleFile {
  const walk = createExampleWalker();
  return WebhookExampleFileSchema.parse({ ...example, payload: walk(example.payload) });
}
