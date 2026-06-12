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
  type ExtensionSubmitResult,
  useDispatcher,
  useExtensionFormSubmit,
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
  initialValues,
}: {
  readonly entityName: string;
  readonly entityId: string | null;
  /** Bereits gespeicherte customField-Werte der Entity (aus der detail-
   *  row durchgereicht). Ohne sie wäre die Section write-only — die Inputs
   *  zeigen den Bestand beim Edit. `pending` trackt nur Änderungen, also
   *  bleibt der Save-Button bis zur ersten Eingabe disabled. */
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

  // Vor den early-returns berechnet, weil useExtensionFormSubmit (Hook) davor
  // laufen muss. matchingFields ist während des Loadings []; dirty bleibt dann
  // false. Dirty = weicht vom GESPEICHERTEN Wert ab (nicht von ""), sonst ist
  // das Leeren eines Bestandswerts unsichtbar und würde übersprungen statt
  // gecleart.
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

  // Schreibt alle geänderten Felder via set/clear. Genutzt vom composed-Submit
  // (Haupt-Form ruft den Handler nach dem Entity-Write) UND vom standalone-
  // Button (wenn die Section ohne umgebende composed-Form gemountet ist).
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

  // composed = innerhalb eines entityEdit-Forms → kein eigener Save-Button,
  // die Section schreibt beim Haupt-Save mit (Bug-Bash 3 #1). Außerhalb einer
  // composed-Form (composed === false) bleibt der standalone-Button.
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

// Umkehrung von coerceValue: gespeicherter jsonb-Wert → string-Form für den
// Input. number/boolean/date/text werden so dargestellt, wie der Input sie
// erwartet; fehlende Werte werden zu "".
function displayValue(type: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "boolean") return value === true ? "true" : "false";
  return String(value);
}
