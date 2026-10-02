import type { Dispatcher, DispatcherError } from "@cosmicdrift/kumiko-headless";
import { createContext, type ReactNode, useContext } from "react";

// Only auth-layer 401s end a session. Handlers never throw 401 otherwise and
// 403 means "authenticated but not allowed", which must not log the user out.
export const SESSION_ENDED_ERROR_CODES = [
  "session_invalid",
  "invalid_token",
  "missing_token",
  "unauthenticated",
] as const;

export function isSessionEndedError(error: Pick<DispatcherError, "code" | "httpStatus">): boolean {
  return (
    error.httpStatus === 401 &&
    SESSION_ENDED_ERROR_CODES.some((sessionEndedCode) => sessionEndedCode === error.code)
  );
}

function isSessionEndedThrow(thrown: unknown): boolean {
  if (typeof thrown !== "object" || thrown === null) return false;
  if (!("code" in thrown) || !("httpStatus" in thrown)) return false;
  const { code, httpStatus } = thrown;
  return typeof code === "string" && typeof httpStatus === "number"
    ? isSessionEndedError({ code, httpStatus })
    : false;
}

export type SessionEndedSignal = {
  notify(): void;
  subscribe(listener: () => void): () => void;
};

export function createSessionEndedSignal(): SessionEndedSignal {
  const listeners = new Set<() => void>();
  return {
    notify() {
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type ResultWithError = { readonly isSuccess: boolean; readonly error?: DispatcherError };

export function withSessionEndedDetection(
  dispatcher: Dispatcher,
  signal: SessionEndedSignal,
): Dispatcher {
  async function detect<TResult extends ResultWithError>(
    pending: Promise<TResult>,
  ): Promise<TResult> {
    const result = await pending;
    if (!result.isSuccess && result.error !== undefined && isSessionEndedError(result.error)) {
      signal.notify();
    }
    return result;
  }

  return {
    write: (type, payload, opts) => detect(dispatcher.write(type, payload, opts)),
    query: (type, payload, opts) => detect(dispatcher.query(type, payload, opts)),
    batch: (commands, opts) => detect(dispatcher.batch(commands, opts)),
    async *stream<TChunk = unknown>(
      type: string,
      payload: unknown,
      opts?: Parameters<Dispatcher["stream"]>[2],
    ) {
      try {
        yield* dispatcher.stream<TChunk>(type, payload, opts);
      } catch (thrown) {
        if (isSessionEndedThrow(thrown)) signal.notify();
        throw thrown;
      }
    },
    statusStore: dispatcher.statusStore,
    pendingWrites: () => dispatcher.pendingWrites(),
    pendingFiles: () => dispatcher.pendingFiles(),
  };
}

const SessionEndedSignalContext = createContext<SessionEndedSignal | undefined>(undefined);

export type SessionEndedSignalProviderProps = {
  readonly signal: SessionEndedSignal;
  readonly children: ReactNode;
};

export function SessionEndedSignalProvider({
  signal,
  children,
}: SessionEndedSignalProviderProps): ReactNode {
  return <SessionEndedSignalContext value={signal}>{children}</SessionEndedSignalContext>;
}

export function useSessionEndedSignal(): SessionEndedSignal | undefined {
  return useContext(SessionEndedSignalContext);
}
