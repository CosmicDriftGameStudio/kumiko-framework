// @runtime client
// CustomFieldsFormSection — extension-section component für entityEdit-
// Screens. Lädt die fieldDefinition-Liste des Tenants, filtert auf die
// host-Entity, rendert pro Definition einen typed Input, dispatched
// `custom-fields:write:set-custom-field` pro non-empty Value beim Save.
//
// Mount via createKumikoApp({ clientFeatures: [customFieldsClient()] })
// — der clientFeature-Factory registriert diese Component unter dem
// Namen `CustomFieldsFormSection`, den die App im Screen-Schema via
// `component: { react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME } }`
// referenziert.

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { CustomFieldsHandlers, CustomFieldsQueries } from "../constants";

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
}: {
  readonly entityName: string;
  readonly entityId: string | null;
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

  const matchingFields = (query.data?.rows ?? [])
    .filter((f) => f.entityName === entityName)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);

  if (matchingFields.length === 0) {
    return (
      <Banner variant="info" testId="custom-fields-form-empty">
        <Text>{t("custom-fields.form.empty", { entityName })}</Text>
      </Banner>
    );
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setErrorKey(null);
    try {
      for (const field of matchingFields) {
        const raw = pending[field.fieldKey];
        if (raw === undefined || raw === "") continue;
        const value = coerceValue(field.type, raw);
        const result = await dispatcher.write(CustomFieldsHandlers.setCustomField, {
          entityName,
          entityId,
          fieldKey: field.fieldKey,
          value,
        });
        if (!result.isSuccess) {
          setErrorKey(result.error?.i18nKey ?? "custom-fields.errors.saveFailed");
          return;
        }
      }
      setPending({});
    } finally {
      setSaving(false);
    }
  };

  const dirty = Object.values(pending).some((v) => v !== "");

  return (
    <div data-testid="custom-fields-form-section">
      {matchingFields.map((field) => (
        <Field
          key={field.id}
          id={`custom-field-${field.fieldKey}`}
          label={field.fieldKey}
          required={field.required}
        >
          {renderInputFor(field, pending[field.fieldKey] ?? "", (v) =>
            setPending((p) => ({ ...p, [field.fieldKey]: v })),
          )}
        </Field>
      ))}
      <Button
        variant="primary"
        onClick={() => void handleSave()}
        disabled={saving || !dirty}
        testId="custom-fields-form-save"
      >
        {saving ? t("custom-fields.form.saving") : t("custom-fields.form.save")}
      </Button>
      {errorKey !== null && (
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
