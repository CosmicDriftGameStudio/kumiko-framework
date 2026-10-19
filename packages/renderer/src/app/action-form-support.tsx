import type { ActionFormLoad } from "@cosmicdrift/kumiko-framework/ui-types";
import type { DispatcherError, Translate } from "@cosmicdrift/kumiko-headless";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "../hooks/use-query.ts";
import { usePrimitives } from "../primitives.tsx";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { dispatcherErrorText } from "./write-failed-error.ts";

const DEFAULT_LOAD_ID_PARAM = "id";

function nonEmptyId(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  return typeof value === "number" ? String(value) : undefined;
}

/** Record id of a `load` form: the route path id, else the drawer prefill `id`
 *  (the clicked row), else the URL `id` param. Only the id is read from these
 *  sources, never another value. */
export function resolveActionFormRecordId(sources: {
  readonly routeEntityId: string | undefined;
  readonly drawerOverrides: Readonly<Record<string, unknown>> | undefined;
  readonly searchParams: Readonly<Record<string, string>>;
}): string | undefined {
  return (
    nonEmptyId(sources.routeEntityId) ??
    nonEmptyId(sources.drawerOverrides?.[DEFAULT_LOAD_ID_PARAM]) ??
    nonEmptyId(sources.searchParams[DEFAULT_LOAD_ID_PARAM])
  );
}

export type ActionFormLoadState =
  | { readonly status: "missing-id" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: DispatcherError }
  | { readonly status: "missing-record" }
  | { readonly status: "ready"; readonly values: Readonly<Record<string, unknown>> };

/** A sensitive, writeOnly or password field never takes a value from a loaded
 *  record: the form must not echo a secret back into an input. */
export function isSecretFormField(field: unknown): boolean {
  return (
    propertyOf(field, "sensitive") === true ||
    propertyOf(field, "writeOnly") === true ||
    propertyOf(field, "format") === "password"
  );
}

function pickDeclaredFields(
  record: unknown,
  fieldNames: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof record !== "object" || record === null) return {};
  const picked: Record<string, unknown> = {};
  for (const name of fieldNames) {
    const value: unknown = Object.hasOwn(record, name) ? Reflect.get(record, name) : undefined;
    if (value !== undefined && value !== null) picked[name] = value;
  }
  return picked;
}

/** Loads the initial values of an actionForm declaring `load`; undefined for a
 *  form without `load`. */
export function useActionFormLoad(
  load: ActionFormLoad | undefined,
  recordId: string | undefined,
  fieldNames: readonly string[],
): ActionFormLoadState | undefined {
  const query = useQuery<unknown>(
    load?.query ?? "",
    { [load?.idParam ?? DEFAULT_LOAD_ID_PARAM]: recordId },
    { enabled: load !== undefined && recordId !== undefined },
  );
  const values = useMemo(
    () => pickDeclaredFields(query.data, fieldNames),
    [query.data, fieldNames],
  );
  if (load === undefined) return undefined;
  if (recordId === undefined) return { status: "missing-id" };
  if (query.error !== null) return { status: "error", error: query.error };
  if (query.loading) return { status: "loading" };
  if (query.data === null) return { status: "missing-record" };
  return { status: "ready", values };
}

/** Banner for every `load` state that is not "ready". */
export function ActionFormLoadStatus({
  state,
  screenId,
  translate,
}: {
  readonly state: Exclude<ActionFormLoadState, { readonly status: "ready" }>;
  readonly screenId: string;
  readonly translate: Translate;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  switch (state.status) {
    case "loading":
      return <QueryLoadingBanner />;
    case "error":
      return (
        <Banner padded variant="error" testId="kumiko-screen-error">
          {dispatcherErrorText(state.error, translate)}
        </Banner>
      );
    case "missing-record":
      return (
        <Banner padded variant="error" testId="kumiko-screen-record-missing">
          {translate("kumiko.record.not-found.title")}
        </Banner>
      );
    case "missing-id":
      return (
        <Banner padded variant="error" testId="kumiko-screen-action-form-missing-id">
          Screen <Text variant="code">{screenId}</Text> (actionForm with load) needs a record id in
          the path or the clicked row.
        </Banner>
      );
  }
}

export type ResolvedSuccessLink = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly onPress: () => void;
};

export type ActionFormSuccessState = {
  readonly text: string;
  readonly links: readonly ResolvedSuccessLink[];
};

export function ActionFormSuccessBanner({
  success,
}: {
  readonly success: ActionFormSuccessState;
}): ReactNode {
  const { Banner, Link } = usePrimitives();
  return (
    <Banner variant="info" testId="action-form-success">
      {success.text}
      {success.links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          onPress={link.onPress}
          className="ml-2 underline"
          testId={`action-form-success-link-${link.key}`}
        >
          {link.label}
        </Link>
      ))}
    </Banner>
  );
}
