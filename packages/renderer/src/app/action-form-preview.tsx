import type { ActionFormPreview } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useMemo } from "react";
import {
  isCurrencyOnlyMoney,
  type ListColumnViewModel,
  type ListRowViewModel,
  type Translate,
} from "../headless/index.ts";
import { REFERENCE_SEARCH_DEBOUNCE_MS } from "../hooks/reference-limits.ts";
import { useDebouncedValue } from "../hooks/use-debounced-value.ts";
import { useQuery } from "../hooks/use-query.ts";
import { usePrimitives } from "../primitives.tsx";
import { ActionFormFacts, resolveSuccessFacts } from "./action-form-support.tsx";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { dispatcherErrorText } from "./write-failed-error.ts";

type FormValueMap = Readonly<Record<string, unknown>>;

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    isCurrencyOnlyMoney(value)
  );
}

/** Empty optional fields stay out: an untouched date input holds "", which a query schema rejects instead of reading it as absent. */
function pickPayload(values: FormValueMap, fieldNames: readonly string[]): FormValueMap {
  const payload: Record<string, unknown> = {};
  for (const name of fieldNames) {
    if (Object.hasOwn(values, name) && !isEmptyValue(values[name])) payload[name] = values[name];
  }
  return payload;
}

/** Required fields of the payload that are still empty: the query would only answer a validation error. */
function missingRequired(
  payload: FormValueMap,
  fieldNames: readonly string[],
  fields: Readonly<Record<string, unknown>>,
): boolean {
  return fieldNames.some(
    (name) => propertyOf(fields[name], "required") === true && isEmptyValue(payload[name]),
  );
}

function parsePayload(serialized: string): FormValueMap {
  const parsed: unknown = JSON.parse(serialized);
  return isPlainObject(parsed) ? parsed : {};
}

function previewRows(data: unknown, listField: string): readonly ListRowViewModel[] {
  const entries = propertyOf(data, listField);
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry, index) =>
    isPlainObject(entry) ? [{ id: String(index), values: entry }] : [],
  );
}

/** Shows what the submit would do, from a query over the live form values. A failed query is a hint only. */
export function ActionFormPreviewPanel({
  preview,
  fields,
  values,
  translate,
  locale,
}: {
  readonly preview: ActionFormPreview;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly values: FormValueMap;
  readonly translate: Translate;
  readonly locale: string;
}): ReactNode {
  const { Banner, DataTable, Grid } = usePrimitives();
  const fieldNames = useMemo(() => preview.fields ?? Object.keys(fields), [preview.fields, fields]);
  const serialized = useDebouncedValue(
    JSON.stringify(pickPayload(values, fieldNames)),
    REFERENCE_SEARCH_DEBOUNCE_MS,
  );
  const payload = useMemo(() => parsePayload(serialized), [serialized]);
  const incomplete = missingRequired(payload, fieldNames, fields);
  const query = useQuery<unknown>(preview.query, payload, { enabled: !incomplete });

  const facts = useMemo(
    () => resolveSuccessFacts(preview.facts, query.data, translate, locale),
    [preview.facts, query.data, translate, locale],
  );
  const columns = useMemo<readonly ListColumnViewModel[]>(
    () =>
      (preview.list?.columns ?? []).map((column) => ({
        field: column.field,
        label: translate(column.label),
        type: column.type ?? "text",
        sortable: false,
      })),
    [preview.list, translate],
  );
  const rows = useMemo(
    () => (preview.list === undefined ? [] : previewRows(query.data, preview.list.field)),
    [preview.list, query.data],
  );

  if (incomplete) return null;
  if (query.error !== null) {
    return (
      <Banner variant="warning" testId="action-form-preview-error">
        {dispatcherErrorText(query.error, translate)}
      </Banner>
    );
  }
  if (query.data === null) return query.loading ? <QueryLoadingBanner /> : null;
  return (
    <Banner
      variant="hint"
      testId="action-form-preview"
      {...(preview.title !== undefined && { title: translate(preview.title) })}
    >
      <Grid columns={1}>
        <ActionFormFacts facts={facts} testIdPrefix="action-form-preview-fact" />
        {preview.list !== undefined && <DataTable columns={columns} rows={rows} />}
      </Grid>
    </Banner>
  );
}
