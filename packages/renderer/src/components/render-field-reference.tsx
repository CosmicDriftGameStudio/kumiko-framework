import {
  SYSTEM_REFERENCE_LABELS,
  UNRESOLVED_REFERENCE_LABEL_KEYS,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { Fragment, type ReactNode } from "react";
import { useReferenceLinkResolver } from "../app/reference-link.ts";
import { type EditFieldViewModel, EMPTY_VALUE_PLACEHOLDER } from "../headless/index.ts";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits.ts";
import { useQuery } from "../hooks/use-query.ts";
import {
  isCompleteRowPage,
  referenceOptionSource,
  referenceRowsByIdsPayload,
} from "../hooks/use-reference-lookup.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { ReferenceCreateDialog } from "./reference-create-dialog.tsx";
import { selectedReferenceIds, stringArrayOf } from "./render-field-values.ts";
import { useReferenceInputState } from "./use-reference-input-state.ts";

// ReferenceInput renders a searchable combobox populated by a live query for
// the referenced entity. With the default limit of 200, larger datasets miss
// the tail in the dropdown; a server-side debounced search query comes later.
//   - Display = row[refLabelField], default labelField "id".
//   - During loading, the dropdown is empty and the field is disabled.
//   - In multiple mode (field.refMultiple), value is a UUID array and the
//     combobox renders tags.
//
// Storage: the UI value is a UUID (row.id), or a UUID array in multiple mode.
// Server schema: z.uuid() or z.array(z.uuid()).
// REFERENCE_COMBOBOX_LIMIT is centralized in hooks/reference-limits.ts
// (see there for the rationale behind the default values).

export function ReferenceInput({
  field,
  id,
  hasError,
  onChange,
  Input,
  featureName,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: ReturnType<typeof usePrimitives>["Input"];
  readonly featureName: string;
}): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  const state = useReferenceInputState(field, featureName, onChange);
  const { options, createTarget } = state;
  // Single mode uses a String/null value; multiple mode uses an array. Coerce
  // to the shape expected by the combobox so storage drift (for example, an
  // old String from the server where an array is now expected) cannot crash it.
  const baseInputProps = {
    id,
    name: field.field,
    // Disable the input during the initial load; subsequent loads show a
    // loading indicator in the popover.
    disabled: field.readOnly || (state.loading && options.length === 0),
    required: field.required,
    hasError,
    options,
    onSearchChange: state.handleSearchChange,
    loading: state.loading,
    ...(createTarget !== undefined && {
      onCreate: () => state.setCreateOpen(true),
      createLabel: t("kumiko.actions.create"),
    }),
  } as const;
  const createDialog = (
    <>
      {createTarget !== undefined && (
        <ReferenceCreateDialog
          open={state.createOpen}
          onClose={() => state.setCreateOpen(false)}
          onCreated={state.handleCreated}
          featureName={state.refFeature}
          screen={createTarget.screen}
          entity={createTarget.entity}
        />
      )}
      {state.createdWithoutIdWarning && (
        <Banner variant="error">{t("kumiko.field.reference-created-no-id")}</Banner>
      )}
    </>
  );
  if (state.isMultiple) {
    const arrayValue: readonly string[] = stringArrayOf(field.value);
    return (
      <>
        <Input
          kind="combobox"
          {...baseInputProps}
          multiple
          value={arrayValue}
          onChange={(v) => onChange(v)}
        />
        {createDialog}
      </>
    );
  }
  const stringValue = field.value === undefined || field.value === null ? "" : String(field.value);
  return (
    <>
      <Input
        kind="combobox"
        {...baseInputProps}
        value={stringValue}
        onChange={(v) => onChange(v === "" ? null : v)}
      />
      {createDialog}
    </>
  );
}

// Read-only text for `type: "reference"` — resolves the referenced row's
// label via the same lookup query as ReferenceInput's combobox, but shows
// plain text instead of mounting an (unusable, disabled) combobox.
export function ReadOnlyReferenceValue({
  field,
  featureName,
}: {
  readonly field: EditFieldViewModel;
  readonly featureName: string;
}): ReactNode {
  const { Text, Link } = usePrimitives();
  const t = useTranslation();
  const resolveReferenceLink = useReferenceLinkResolver();
  const refEntity = field.refEntity ?? "";
  const refFeature = field.refFeature ?? featureName;
  const { queryQn, labelKey } = referenceOptionSource(field, refFeature, refEntity);
  const ids = selectedReferenceIds(field);
  // An author-supplied `refOptionsQuery` is only contracted for `{ limit, search? }`.
  const queryResult = useQuery<{
    rows: ReadonlyArray<Record<string, unknown>>;
    nextCursor?: string | null;
  }>(
    queryQn,
    field.refOptionsQuery === undefined
      ? referenceRowsByIdsPayload(ids, REFERENCE_COMBOBOX_LIMIT)
      : { limit: REFERENCE_COMBOBOX_LIMIT },
    { enabled: ids.length > 0 },
  );
  if (ids.length === 0)
    return <Text testId={`field-value-${field.field}`}>{EMPTY_VALUE_PLACEHOLDER}</Text>;
  const rows = queryResult.data?.rows ?? [];
  // System-scope ids (e.g. SYSTEM_TENANT_ID) never have a backing row —
  // same central fallback as useReferenceLookup (render-list.tsx), so a
  // reference field showing one on the detail path also gets a label
  // instead of the raw id.
  const systemLabel = SYSTEM_REFERENCE_LABELS[`${refFeature}:${refEntity}`];
  const parts = ids.map((id) => {
    if (systemLabel !== undefined && (id === systemLabel.id || systemLabel.aliases?.includes(id))) {
      return { id, label: t(systemLabel.labelKey), link: undefined };
    }
    const row = rows.find((r) => String(r["id"] ?? "") === id);
    if (row === undefined) {
      const unknownKey = UNRESOLVED_REFERENCE_LABEL_KEYS[`${refFeature}:${refEntity}`];
      const label =
        unknownKey !== undefined &&
        !queryResult.loading &&
        queryResult.error === null &&
        isCompleteRowPage(queryResult.data)
          ? t(unknownKey)
          : id;
      return { id, label, link: undefined };
    }
    return { id, label: String(row[labelKey] ?? id), link: resolveReferenceLink(refEntity, id) };
  });
  return (
    <Text testId={`field-value-${field.field}`}>
      {parts.map(({ id, label, link }, index) => (
        <Fragment key={id}>
          {index > 0 && ", "}
          {link === undefined ? (
            label
          ) : (
            <Link
              href={link.href}
              onPress={link.onPress}
              testId={`field-link-${field.field}-${id}`}
            >
              {label}
            </Link>
          )}
        </Fragment>
      ))}
    </Text>
  );
}
