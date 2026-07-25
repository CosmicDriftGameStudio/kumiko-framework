import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import { mapServerError } from "./error-mapping";

// Parse the SSE wire format produced by Hono `streamSSE` for POST /api/stream:
//   event: chunk|ping|done|error
//   data: <json-or-empty>
//   <blank line>
//
// Exported for unit tests — live dispatcher is the only production caller.

export type SseFrame = {
  readonly event: string;
  readonly data: string;
};

export function parseSseBlock(block: string): SseFrame | null {
  const trimmed = block.trim();
  if (trimmed.length === 0) return null;
  const event = /^event: (.*)$/m.exec(trimmed)?.[1] ?? "";
  const data = /^data: (.*)$/m.exec(trimmed)?.[1] ?? "";
  return { event, data };
}

/** Split a complete SSE body (tests / non-streaming buffers) into frames. */
export function parseSseFrames(text: string): SseFrame[] {
  return text
    .split("\n\n")
    .map(parseSseBlock)
    .filter((f): f is SseFrame => f !== null);
}

/**
 * Incremental SSE reader over a fetch body. Yields `chunk` payloads as
 * parsed JSON; swallows `ping`; returns on `done`; throws DispatcherError
 * on `error` frames. Caller is responsible for aborting the underlying
 * fetch via AbortSignal.
 */
export async function* iterateSseChunks<TChunk>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<TChunk, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const frame = parseSseBlock(part);
        if (frame === null) continue;
        if (frame.event === "ping") continue;
        // skip: terminal SSE done frame — end the generator cleanly
        if (frame.event === "done") {
          sawDone = true;
          return;
        }
        if (frame.event === "error") {
          throw frameDataToDispatcherError(frame.data);
        }
        if (frame.event === "chunk") {
          yield parseChunkData<TChunk>(frame.data);
        }
      }
    }
    // Trailing buffer without final blank line (some runtimes).
    const frame = parseSseBlock(buffer);
    if (frame?.event === "chunk") {
      yield parseChunkData<TChunk>(frame.data);
    } else if (frame?.event === "error") {
      throw frameDataToDispatcherError(frame.data);
    } else if (frame?.event === "done") {
      sawDone = true;
    }
    if (!sawDone) {
      throw buildTruncatedStreamError();
    }
  } finally {
    // cancel() releases the reader's lock too (safe on an already-drained
    // stream) and, unlike releaseLock() alone, tells the underlying HTTP
    // response to close instead of leaving the connection open until the
    // server finishes writing a body no one is reading anymore.
    await reader.cancel().catch(() => {});
  }
}

function parseChunkData<TChunk>(data: string): TChunk {
  try {
    return JSON.parse(data) as TChunk;
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw {
      code: "stream_error",
      httpStatus: 200,
      i18nKey: "errors.unknown",
      message: `malformed chunk frame: ${cause}`,
    } satisfies DispatcherError;
  }
}

function buildTruncatedStreamError(): DispatcherError {
  return {
    code: "stream_error",
    httpStatus: 200,
    i18nKey: "errors.unknown",
    message: "stream ended without a done frame",
  };
}

function frameDataToDispatcherError(data: string): DispatcherError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {
      code: "stream_error",
      httpStatus: 200,
      i18nKey: "errors.unknown",
      message: data.length > 0 ? data : "stream error frame",
    };
  }
  // Server serializeError shape — mapServerError expects the same fields
  // as /api/query failures (httpStatus may be absent; reinject 200 for
  // mid-stream gates that flush SSE headers first).
  const err = parsed as Parameters<typeof mapServerError>[0];
  return mapServerError({
    ...err,
    httpStatus: err.httpStatus ?? 200,
  });
}
