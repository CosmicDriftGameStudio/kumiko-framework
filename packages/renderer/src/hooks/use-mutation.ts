import type { DispatcherError, WriteResult } from "@cosmicdrift/kumiko-headless";
import { useCallback, useRef, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context";

// React wrapper around dispatcher.write — the write-side sibling of
// useQuery. One hook instance per handler-type; `mutate` carries the
// payload so a single instance serves list-row actions with varying
// payloads.
//
// `mutate` resolves with the raw WriteResult so callers can branch
// (navigate on success, keep the form open on failure) without waiting
// for a re-render of `error`/`data`.

export type UseMutationResult<TData> = {
  readonly mutate: (payload: unknown) => Promise<WriteResult<TData>>;
  readonly pending: boolean;
  readonly error: DispatcherError | null;
  readonly data: TData | null;
  readonly reset: () => void;
};

export function useMutation<TData = unknown>(type: string): UseMutationResult<TData> {
  const dispatcher = useDispatcher();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DispatcherError | null>(null);
  const [data, setData] = useState<TData | null>(null);
  // Sequence guard: `mutate` has no abort (unlike useQuery's GETs, a write
  // already landed server-side and can't be cancelled). Two overlapping
  // calls on one instance (e.g. two list-row actions) must not let the
  // first-to-resolve clobber pending/error/data set by the second — only
  // the most recently STARTED call's outcome may update shared state.
  const sequence = useRef(0);

  const mutate = useCallback(
    async (payload: unknown): Promise<WriteResult<TData>> => {
      const callSeq = ++sequence.current;
      setPending(true);
      setError(null);
      const result = await dispatcher.write<TData>(type, payload);
      if (callSeq === sequence.current) {
        if (result.isSuccess) {
          setData(result.data);
        } else {
          setError(result.error);
        }
        setPending(false);
      }
      return result;
    },
    [dispatcher, type],
  );

  const reset = useCallback(() => {
    sequence.current++; // invalidate any in-flight mutate's late update
    setPending(false);
    setError(null);
    setData(null);
  }, []);

  return { mutate, pending, error, data, reset };
}
