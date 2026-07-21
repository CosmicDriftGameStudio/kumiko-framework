import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context";

// React wrapper around dispatcher.stream (#1382). Accumulates yielded
// chunks into `chunks` (unlike useQuery({live:true}), which only
// invalidates and re-fetches). Each start() owns an AbortController;
// a newer start() / unmount aborts the previous run so late chunks
// cannot clobber fresher state.

export type StreamStatus = "idle" | "streaming" | "done" | "error";

export type UseStreamHandlerResult<TChunk> = {
  readonly chunks: readonly TChunk[];
  readonly status: StreamStatus;
  readonly error: DispatcherError | null;
  readonly start: (payload?: unknown) => Promise<void>;
  readonly abort: () => void;
  readonly reset: () => void;
};

export type UseStreamHandlerOptions = {
  // When true, start() runs once on mount with the initial payload.
  // Default false — streams are usually user-triggered (unlike queries).
  readonly autoStart?: boolean;
};

export function useStreamHandler<TChunk = unknown>(
  type: string,
  payload: unknown = {},
  options: UseStreamHandlerOptions = {},
): UseStreamHandlerResult<TChunk> {
  const dispatcher = useDispatcher();
  const { autoStart = false } = options;

  const [chunks, setChunks] = useState<readonly TChunk[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<DispatcherError | null>(null);

  const activeCtrl = useRef<AbortController | null>(null);
  const payloadKey = JSON.stringify(payload);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const abort = useCallback((): void => {
    activeCtrl.current?.abort();
    activeCtrl.current = null;
  }, []);

  const reset = useCallback((): void => {
    abort();
    setChunks([]);
    setStatus("idle");
    setError(null);
  }, [abort]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: payload via payloadKey / payloadRef
  const start = useCallback(
    async (overridePayload?: unknown): Promise<void> => {
      activeCtrl.current?.abort();
      const ctrl = new AbortController();
      activeCtrl.current = ctrl;

      setChunks([]);
      setError(null);
      setStatus("streaming");

      const body = overridePayload !== undefined ? overridePayload : payloadRef.current;
      try {
        const accumulated: TChunk[] = [];
        for await (const chunk of dispatcher.stream<TChunk>(type, body, { signal: ctrl.signal })) {
          if (ctrl.signal.aborted) return;
          accumulated.push(chunk);
          setChunks([...accumulated]);
        }
        if (ctrl.signal.aborted) return;
        setStatus("done");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const mapped = asDispatcherError(e);
        if (mapped.code === "aborted") return;
        setError(mapped);
        setStatus("error");
      }
    },
    [dispatcher, type, payloadKey],
  );

  useEffect(() => {
    if (!autoStart) return;
    void start();
    return () => {
      activeCtrl.current?.abort();
    };
  }, [autoStart, start]);

  useEffect(() => {
    return () => {
      activeCtrl.current?.abort();
    };
  }, []);

  return { chunks, status, error, start, abort, reset };
}

function asDispatcherError(e: unknown): DispatcherError {
  if (e && typeof e === "object" && "code" in e && "message" in e && "i18nKey" in e) {
    return e as DispatcherError;
  }
  return {
    code: "stream_error",
    httpStatus: 0,
    i18nKey: "errors.unknown",
    message: e instanceof Error ? e.message : String(e),
  };
}
