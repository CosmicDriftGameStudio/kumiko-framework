import type { AppSchema } from "@cosmicdrift/kumiko-renderer";
import {
  toAppSchema,
  usePrimitives,
  useSessionEndedSignal,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useRef, useState } from "react";

// Mirrors framework's api-constants Routes.schema, same pattern as
// dispatcher-live's PATH_* constants — the one place that spells out the
// wire path both sides agree on.
export const APP_SCHEMA_API_PATH = "/api/schema";

function isFeatureSchemaPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (!("featureName" in value) || typeof value.featureName !== "string") return false;
  return "screens" in value && Array.isArray(value.screens);
}

export function isAppSchemaPayload(value: unknown): value is AppSchema {
  if (typeof value !== "object" || value === null) return false;
  if (!("features" in value) || !Array.isArray(value.features)) return false;
  return value.features.every((feature: unknown) => isFeatureSchemaPayload(feature));
}

export type AppSchemaFetchResult =
  | { readonly kind: "loaded"; readonly app: AppSchema }
  | { readonly kind: "session-ended" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "failed" };

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Rejects only on abort (caller-cancelled) — every other failure mode
// (network error, non-2xx, unparseable/invalid body) resolves to
// `{ kind: "failed" }` so callers get one uniform result shape to branch
// on instead of a mix of thrown errors and resolved results.
export async function fetchAppSchema(signal: AbortSignal): Promise<AppSchemaFetchResult> {
  let res: Response;
  try {
    res = await fetch(APP_SCHEMA_API_PATH, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { kind: "failed" };
  }
  if (res.status === 401) return { kind: "session-ended" };
  if (res.status === 403) return { kind: "unauthorized" };
  if (!res.ok) return { kind: "failed" };
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { kind: "failed" };
  }
  if (!isAppSchemaPayload(payload)) return { kind: "failed" };
  return { kind: "loaded", app: toAppSchema(payload) };
}

// Boots the app once the caller (AppSchemaBoundary, itself inside the
// clientFeature gates) decides to mount it — a login gate renders its own
// placeholder instead of children, so this component (and its fetch) never
// mounts until the user is authenticated.
export function AppSchemaFetchBoot({
  onLoaded,
}: {
  readonly onLoaded: (app: AppSchema) => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Button } = usePrimitives();
  const [status, setStatus] = useState<"loading" | "session-ended" | "unauthorized" | "failed">(
    "loading",
  );
  const sessionEndedSignal = useSessionEndedSignal();
  const [attempt, setAttempt] = useState(0);
  // Ref instead of an effect dependency: onLoaded is a fresh closure on
  // every KumikoAppRoot render (it captures setApp) — depending on it
  // directly would refetch on every unrelated re-render.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger, never read in the body — bumping it is how the Retry button re-fires this effect.
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    fetchAppSchema(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind === "loaded") {
          onLoadedRef.current(result.app);
          return;
        }
        setStatus(result.kind);
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus("failed");
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (status === "session-ended") sessionEndedSignal?.notify();
  }, [status, sessionEndedSignal]);

  if (status === "loading") {
    return (
      <div role="status" aria-busy="true">
        {t("kumiko.app-boot.loading")}
      </div>
    );
  }

  if (status === "unauthorized" || status === "session-ended") {
    // No auto-retry/reload here on purpose — a signed-out user retrying
    // the same request just gets the same 401 again; the login gate that
    // wraps this component is the actual way out. For session-ended the
    // notify above normally swaps this banner for the login screen; the
    // banner stays as fallback when no session provider is mounted.
    return (
      <Banner variant="error" padded>
        {t("kumiko.app-boot.unauthorized")}
      </Banner>
    );
  }

  return (
    <Banner
      variant="error"
      padded
      actions={
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t("kumiko.actions.reload")}
        </Button>
      }
    >
      {t("kumiko.app-boot.failed")}
    </Banner>
  );
}
