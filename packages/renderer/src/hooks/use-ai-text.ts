import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context";

// AiTextField/AiTextArea's client-side surface. Deliberately duplicates the
// wire-contract shape from kumiko-enterprise's `ai-text` feature instead of
// importing it — this package is public NPM, ai-text is a private Enterprise
// package, and the widgets only ever talk HTTP (ai-text-primitive plan doc,
// Architecture Decision 1). Keep these in lockstep with
// kumiko-enterprise/packages/ai-text/src/{modes,feature}.ts by hand; there's
// no compile-time link between the two repos.

export const AI_TEXT_RUN_QN = "ai-text:query:run";

export type AiTextMode = "complete" | "correct" | "translate" | "rewrite";
export type AiTextRewriteStyle = "formal" | "casual" | "concise" | "expand";

export type AiTextRunPayload =
  | { readonly mode: "complete"; readonly text: string }
  | { readonly mode: "correct"; readonly text: string }
  | { readonly mode: "translate"; readonly text: string; readonly targetLanguage: string }
  | { readonly mode: "rewrite"; readonly text: string; readonly style?: AiTextRewriteStyle };

export type AiTextUsage = { readonly inputTokens: number; readonly outputTokens: number };

export type AiTextRunResult =
  | { readonly type: "text"; readonly text: string; readonly usage: AiTextUsage }
  | { readonly type: "error"; readonly reason: string; readonly usage: AiTextUsage };

// =============================================================================
// useAiTextAction — one-shot request/response, any mode
// =============================================================================
//
// v1 has no streaming (ai-text-primitive plan doc, sequencing note —
// SSE-with-auth-reuse needs a framework-core `r.streamHandler` primitive,
// tracked separately). `complete` goes through this same request/response
// path as correct/translate/rewrite; `useCompletion` below adds debounce on
// top for the ghost-text use-case specifically.

export type AiTextActionState =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "cap-exceeded"
  | "unavailable";

export type UseAiTextActionResult = {
  readonly run: (payload: AiTextRunPayload) => Promise<AiTextRunResult | null>;
  readonly state: AiTextActionState;
  readonly result: AiTextRunResult | null;
  readonly error: DispatcherError | null;
  readonly reset: () => void;
};

function stateForError(error: DispatcherError): AiTextActionState {
  if (error.code === "cap_exceeded" || error.code === "rate_limited") return "cap-exceeded";
  if (error.code === "feature_disabled") return "unavailable";
  return "error";
}

export function useAiTextAction(): UseAiTextActionResult {
  const dispatcher = useDispatcher();
  const [state, setState] = useState<AiTextActionState>("idle");
  const [result, setResult] = useState<AiTextRunResult | null>(null);
  const [error, setError] = useState<DispatcherError | null>(null);

  // Track the in-flight call so a newer `run()` cancels an older one, and
  // unmount doesn't set state after the component is gone — same pattern
  // as useQuery's activeCtrl.
  const activeCtrl = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      activeCtrl.current?.abort();
    };
  }, []);

  const run = useCallback(
    async (payload: AiTextRunPayload): Promise<AiTextRunResult | null> => {
      activeCtrl.current?.abort();
      const ctrl = new AbortController();
      activeCtrl.current = ctrl;

      setState("loading");
      setError(null);

      const res = await dispatcher.query<AiTextRunResult>(AI_TEXT_RUN_QN, payload, {
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return null;

      if (!res.isSuccess) {
        if (res.error.code === "aborted") return null;
        setError(res.error);
        setState(stateForError(res.error));
        return null;
      }

      setResult(res.data);
      setState("success");
      return res.data;
    },
    [dispatcher],
  );

  const reset = useCallback(() => {
    activeCtrl.current?.abort();
    setState("idle");
    setResult(null);
    setError(null);
  }, []);

  return { run, state, result, error, reset };
}

// =============================================================================
// useCompletion — debounced ghost-text for AiTextField/AiTextArea
// =============================================================================
//
// Debounce exists to keep the request-rate down against the monthly cap,
// not for UX polish — every keystroke would otherwise burn a request.

export type UseCompletionResult = {
  readonly suggestion: string | null;
  readonly state: AiTextActionState;
  readonly error: DispatcherError | null;
  /** Debounced — schedules a completion request `debounceMs` after the
   *  last call. Calling again before the timer fires replaces it. */
  readonly requestCompletion: (text: string) => void;
  /** Cancels any pending/in-flight request and clears the suggestion. */
  readonly clear: () => void;
};

const DEFAULT_DEBOUNCE_MS = 500;

export function useCompletion(debounceMs: number = DEFAULT_DEBOUNCE_MS): UseCompletionResult {
  const { run, state, result, error, reset } = useAiTextAction();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const requestCompletion = useCallback(
    (text: string) => {
      clearTimer();
      if (text.length === 0) {
        reset();
        // skip: empty text, state already reset above
        return;
      }
      timerRef.current = setTimeout(() => {
        void run({ mode: "complete", text });
      }, debounceMs);
    },
    [clearTimer, reset, run, debounceMs],
  );

  const clear = useCallback(() => {
    clearTimer();
    reset();
  }, [clearTimer, reset]);

  useEffect(() => clearTimer, [clearTimer]);

  const suggestion = result?.type === "text" ? result.text : null;

  return { suggestion, state, error, requestCompletion, clear };
}
