import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  appendEventInTenantDb,
  getStreamVersionInTenantDb,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  DOCUMENT_EXTRACT_AGGREGATE_TYPE,
  documentExtractFailedPayloadSchema,
  documentExtractReadyPayloadSchema,
} from "./events.ts";

export type ExistingDocumentExtract = {
  readonly id: string;
  readonly meta: { readonly error?: unknown } | null;
};

export type AppendMissingExtractEventDeps = {
  readonly tenantDb: TenantDb;
  readonly registry: Registry;
  readonly actor: SessionUser;
  readonly tenantId: string;
};

export type AppendMissingExtractEventOptions = {
  readonly readyEventQn: string;
  readonly failedEventQn: string;
  readonly mapError?: (error: string) => string;
};

export type AppendMissingExtractEventResult =
  | "appended-ready"
  | "appended-failed"
  | "already-terminal";

// Version 1 of the stream is the extract's created event; anything beyond it is the terminal event.
const CREATED_ONLY_STREAM_VERSION = 1;
const UNKNOWN_EXTRACT_ERROR = "unknown extract error";

// A previous delivery created the extract but died before appending its ready/failed event.
// Without the event, consumers waiting on it hang forever.
export async function appendMissingDocumentExtractEvent(
  deps: AppendMissingExtractEventDeps,
  existing: ExistingDocumentExtract,
  fileRefId: string,
  options: AppendMissingExtractEventOptions,
): Promise<AppendMissingExtractEventResult> {
  if (deps.tenantDb.tenantId !== deps.tenantId) {
    throw new InternalError({
      message: `document-ingest-foundation: tenantDb is bound to tenant ${deps.tenantDb.tenantId}, not ${deps.tenantId}`,
    });
  }
  const version = await getStreamVersionInTenantDb(deps.tenantDb, existing.id);
  // A missing stream means a wrong id; appending would make the terminal event the first event of a new stream.
  if (version === 0) {
    throw new InternalError({
      message: `document-ingest-foundation: no document extract stream for id ${existing.id}`,
    });
  }
  // skip: the terminal event was already written, nothing to catch up
  if (version > CREATED_ONLY_STREAM_VERSION) return "already-terminal";
  const metaError = existing.meta?.error;
  const failed = typeof metaError === "string";
  await appendEventInTenantDb(
    deps.tenantDb,
    {
      aggregateId: existing.id,
      aggregateType: DOCUMENT_EXTRACT_AGGREGATE_TYPE,
      expectedVersion: version,
      type: failed ? options.failedEventQn : options.readyEventQn,
      payload: failed
        ? documentExtractFailedPayloadSchema.parse({
            documentExtractId: existing.id,
            fileRefId,
            error: options.mapError?.(metaError) || metaError || UNKNOWN_EXTRACT_ERROR,
          })
        : documentExtractReadyPayloadSchema.parse({ documentExtractId: existing.id, fileRefId }),
      metadata: { userId: deps.actor.id },
    },
    { registry: deps.registry },
  );
  return failed ? "appended-failed" : "appended-ready";
}
