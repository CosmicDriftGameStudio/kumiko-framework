// CustomFieldsFormSection — extension-section component for entityEdit-
// screens. Loads the tenant's fieldDefinition list, filters it to the
// host entity, renders a typed input per definition, and dispatches
// `custom-fields:write:set-custom-field` for each non-empty value on save.
//
// Mount via createKumikoApp({ clientFeatures: [customFieldsClient()] })
// — the clientFeature factory registers this component under the name
// `CustomFieldsFormSection`, which the app references in the screen schema
// via `component: { react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME } }`.

import {
  type ExtensionSubmitResult,
  useDispatcher,
  useExtensionFormSubmit,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { CustomFieldsHandlers, CustomFieldsQueries } from "./constants.ts";

type FieldDefinitionRow = {
  readonly id: string;
  readonly entityName: string;
  readonly fieldKey: string;
  readonly type: string;
  readonly required: boolean;
  readonly displayOrder: number;
};

type FieldDefinitionListResponse = {
  readonly rows: readonly FieldDefinitionRow[];
};

export function CustomFieldsFormSection({
  entityName,
  entityId,
  initialValues,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
  /** The entity's previously saved customField values, passed through from the
   * detail row. Without them, the section would be write-only: the inputs
   * would not show existing values while editing. `pending` tracks only
   * changes, so the Save button remains disabled until the first edit. */
  readonly initialValues?: Readonly<Record<string, unknown>>;
}): ReactNode {
  const { Banner, Button, Field, Input, Text } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const query = useQuery<FieldDefinitionListResponse>(
    CustomFieldsQueries.fieldDefinitionList,
    {},
    { enabled: entityId !== null },
  );
  const [pending, setPending] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // Computed before the early returns because useExtensionFormSubmit (a Hook)
  // must run before them. matchingFields is [] while loading, so dirty remains
  // false. Dirty means differing from the SAVED value (not from ""); otherwise
  // clearing an existing value would be invisible and skipped instead of
  // cleared.
  const matchingFields = (query.data?.rows ?? [])
    .filter((f) => f.entityName === entityName)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const initialDisplay = (field: (typeof matchingFields)[number]): string =>
    displayValue(field.type, initialValues?.[field.fieldKey]);
  const changedFields = matchingFields.filter((field) => {
    const raw = pending[field.fieldKey];
    return raw !== undefined && raw !== initialDisplay(field);
  });
  const dirty = changedFields.length > 0;

  // Writes all changed fields via set/clear. Used by the composed submit
  // (the main form calls the handler after the entity write) and by the
  // standalone button when the section is mounted without a surrounding
  // composed form.
  const flushChanges = async (targetEntityId: string): Promise<ExtensionSubmitResult> => {
    for (const field of changedFields) {
      const raw = pending[field.fieldKey] ?? "";
      const result =
        raw === ""
          ? await dispatcher.write(CustomFieldsHandlers.clearCustomField, {
              entityName,
              entityId: targetEntityId,
              fieldKey: field.fieldKey,
            })
          : await dispatcher.write(CustomFieldsHandlers.setCustomField, {
              entityName,
              entityId: targetEntityId,
              fieldKey: field.fieldKey,
              value: coerceValue(field.type, raw),
            });
      if (!result.isSuccess) {
        return {
          isSuccess: false,
          errorKey: result.error?.i18nKey ?? "custom-fields.errors.saveFailed",
        };
      }
    }
    setPending({});
    return { isSuccess: true };
  };

  // composed = inside an entityEdit form, so there is no separate Save button;
  // the section writes along with the main save. Outside a composed form
  // (composed === false), the standalone button remains available.
  const composed = useExtensionFormSubmit({
    dirty,
    onSubmit: (ctx) => flushChanges(ctx.entityId),
  });

  if (entityId === null) {
    return (
      <Banner variant="info" testId="custom-fields-form-create-mode">
        <Text>{t("custom-fields.form.createMode")}</Text>
      </Banner>
    );
  }
  if (query.loading && query.data === null) {
    return (
      <Banner variant="loading" testId="custom-fields-form-loading">
        <Text>{t("custom-fields.form.loading")}</Text>
      </Banner>
    );
  }
  if (query.error) {
    return (
      <Banner variant="error" testId="custom-fields-form-error">
        <Text>{t(query.error.i18nKey, query.error.i18nParams)}</Text>
      </Banner>
    );
  }
  if (matchingFields.length === 0) {
    return (
      <Banner variant="info" testId="custom-fields-form-empty">
        <Text>{t("custom-fields.form.empty", { entityName })}</Text>
      </Banner>
    );
  }

  const handleStandaloneSave = async (): Promise<void> => {
    setSaving(true);
    setErrorKey(null);
    try {
      const result = await flushChanges(entityId);
      if (!result.isSuccess) {
        setErrorKey(result.errorKey ?? "custom-fields.errors.saveFailed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="custom-fields-form-section">
      {matchingFields.map((field) => (
        <Field
          key={field.id}
          id={`custom-field-${field.fieldKey}`}
          label={field.fieldKey}
          required={field.required}
        >
          {renderInputFor(
            field,
            pending[field.fieldKey] ?? displayValue(field.type, initialValues?.[field.fieldKey]),
            (v) => setPending((p) => ({ ...p, [field.fieldKey]: v })),
          )}
        </Field>
      ))}
      {!composed && (
        <Button
          variant="primary"
          onClick={() => void handleStandaloneSave()}
          disabled={saving || !dirty}
          testId="custom-fields-form-save"
        >
          {saving ? t("custom-fields.form.saving") : t("custom-fields.form.save")}
        </Button>
      )}
      {!composed && errorKey !== null && (
        <Banner variant="error" testId="custom-fields-form-save-error">
          <Text>{t(errorKey)}</Text>
        </Banner>
      )}
    </div>
  );

  function renderInputFor(
    field: FieldDefinitionRow,
    raw: string,
    onChange: (v: string) => void,
  ): ReactNode {
    const id = `custom-field-${field.fieldKey}`;
    const name = field.fieldKey;
    if (field.type === "number") {
      return (
        <Input
          kind="number"
          id={id}
          name={name}
          value={raw === "" ? "" : Number(raw)}
          onChange={(v) => onChange(v === undefined ? "" : String(v))}
        />
      );
    }
    if (field.type === "boolean") {
      return (
        <Input
          kind="boolean"
          id={id}
          name={name}
          value={raw === "true"}
          onChange={(v) => onChange(v ? "true" : "false")}
        />
      );
    }
    if (field.type === "date") {
      return (
        <Input kind="date" id={id} name={name} value={raw} onChange={(v) => onChange(v ?? "")} />
      );
    }
    return <Input kind="text" id={id} name={name} value={raw} onChange={onChange} />;
  }
}

function coerceValue(type: string, raw: string): unknown {
  if (type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

// Inverse of coerceValue: converts a stored jsonb value to the string form
// expected by the input. number/boolean/date/text are represented as their
// inputs expect; missing values become "".
function displayValue(type: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "boolean") return value === true ? "true" : "false";
  return String(value);
}
