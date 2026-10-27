import { dispatcherErrorText, useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";
import { useCallback, useState } from "react";
import { isTenantOverrideDeniedError } from "./tenant-override.ts";

export type TenantScopedWrite = {
  readonly response: ContentWriteResponse;
  /** The override the write was accepted with; undefined after a denied override fell back to the session tenant. */
  readonly tenantIdOverride: string | undefined;
};

export type ContentWriteResponse = {
  readonly slug: string;
  readonly locale: string;
  readonly isNew: boolean;
};

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// A validation failure names the offending field with its own message; prefer that over the generic one.
function writeErrorText(error: DispatcherError, t: Translate): string {
  const issue = error.details?.fields?.[0];
  if (issue !== undefined) {
    const translated = t(issue.i18nKey, issue.params);
    if (translated !== issue.i18nKey) return translated;
  }
  return dispatcherErrorText(error, t) || t("template-resolver.editor.saveFailed");
}

// Dispatches a content set and keeps the submit state; `write` resolves to the response,
// or null after the failure text has been set in `error`.
export function useContentWrite() {
  const dispatcher = useDispatcher();
  const t = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writeScoped = async (
    handler: string,
    payload: Readonly<Record<string, unknown>>,
    requestedOverride: string | undefined,
  ): Promise<TenantScopedWrite | null> => {
    setSubmitting(true);
    setError(null);
    try {
      let tenantIdOverride = requestedOverride;
      let result = await dispatcher.write<ContentWriteResponse>(handler, {
        ...payload,
        ...(tenantIdOverride !== undefined && { tenantIdOverride }),
      });
      if (
        !result.isSuccess &&
        tenantIdOverride !== undefined &&
        isTenantOverrideDeniedError(result.error)
      ) {
        tenantIdOverride = undefined;
        result = await dispatcher.write<ContentWriteResponse>(handler, payload);
      }
      if (result.isSuccess) return { response: result.data, tenantIdOverride };
      setError(writeErrorText(result.error, t));
      return null;
    } catch (e) {
      // Network blip / dispatcher throw — otherwise submitting stays true and
      // the save button is locked forever with no feedback.
      setError(e instanceof Error ? e.message : t("template-resolver.editor.networkError"));
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const write = async (
    handler: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ContentWriteResponse | null> =>
    (await writeScoped(handler, payload, undefined))?.response ?? null;

  const clearError = useCallback(() => setError(null), []);

  return { submitting, error, clearError, write, writeScoped };
}
