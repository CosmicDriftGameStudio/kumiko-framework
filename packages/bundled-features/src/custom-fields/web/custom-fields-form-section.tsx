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
  useLocale,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { formatMoney } from "@cosmicdrift/kumiko-renderer/headless";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useState } from "react";
import { CustomFieldsHandlers, CustomFieldsQueries } from "./constants.ts";

type FieldDefinitionRow = {
  readonly id: string;
  readonly entityName: string;
  readonly fieldKey: string;
  readonly type: string;
  readonly required: boolean;
  readonly displayOrder: number;
  readonly serializedField?: string;
};

// The renderer's money inputs fall back to EUR the same way.
const FALLBACK_MONEY_CURRENCY = "EUR";

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
  const appLocale = useLocale().locale();
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
    staleMoneyOf(field, initialValues?.[field.fieldKey]) === null
      ? displayValue(field.type, initialValues?.[field.fieldKey])
      : "";
  // A stale money value starts as an empty input, so any touch is a change:
  // typing replaces it, typing and emptying clears it.
  const changedFields = matchingFields.filter((field) => {
    const raw = pending[field.fieldKey];
    if (raw === undefined) return false;
    return (
      raw !== initialDisplay(field) || staleMoneyOf(field, initialValues?.[field.fieldKey]) !== null
    );
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
              value: coerceValue(
                field.type,
                raw,
                moneyCurrencyOf(field, initialValues?.[field.fieldKey]),
              ),
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
      {matchingFields.map((field) => {
        const staleMoney = staleMoneyOf(field, initialValues?.[field.fieldKey]);
        return (
          <Field
            key={field.id}
            id={`custom-field-${field.fieldKey}`}
            label={field.fieldKey}
            required={field.required}
            {...(staleMoney !== null && {
              description: t("custom-fields.form.moneyStoredInOtherCurrency", {
                stored: formatMoney(staleMoney.amount, staleMoney.currency, { locale: appLocale }),
                currency: staleMoney.definitionCurrency,
              }),
            })}
          >
            {renderInputFor(field, pending[field.fieldKey] ?? initialDisplay(field), (v) =>
              setPending((p) => ({ ...p, [field.fieldKey]: v })),
            )}
          </Field>
        );
      })}
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
    if (field.type === "money") {
      return (
        <Input
          kind="money"
          id={id}
          name={name}
          value={raw === "" ? "" : Number(raw)}
          onChange={(v) => onChange(v === undefined ? "" : String(v))}
          currency={moneyCurrencyOf(field, initialValues?.[field.fieldKey])}
          locale={appLocale}
        />
      );
    }
    return <Input kind="text" id={id} name={name} value={raw} onChange={onChange} />;
  }
}

// set-custom-field accepts only the definition's currency when it declares one
// (value-schema.ts), and any default currency otherwise, so only then does a
// stored value keep its own.
function moneyCurrencyOf(field: FieldDefinitionRow, stored: unknown): string {
  const storedCurrency = propertyOf(stored, "currency");
  return (
    declaredCurrencyOf(field.serializedField) ??
    (typeof storedCurrency === "string" ? storedCurrency : FALLBACK_MONEY_CURRENCY)
  );
}

type StaleMoney = {
  readonly amount: number;
  readonly currency: string;
  readonly definitionCurrency: string;
};

// A value written before the definition's currency changed: 12.50 GBP must not
// turn into 12.50 EUR, so it is shown as stored and only a new entry replaces it.
function staleMoneyOf(field: FieldDefinitionRow, stored: unknown): StaleMoney | null {
  if (field.type !== "money") return null;
  const definitionCurrency = declaredCurrencyOf(field.serializedField);
  const amount = propertyOf(stored, "amount");
  const currency = propertyOf(stored, "currency");
  if (definitionCurrency === undefined || typeof amount !== "number") return null;
  if (typeof currency !== "string" || currency === definitionCurrency) return null;
  return { amount, currency, definitionCurrency };
}

function declaredCurrencyOf(serializedField: string | undefined): string | undefined {
  if (serializedField === undefined) return undefined;
  try {
    const currency = propertyOf(JSON.parse(serializedField), "currency");
    return typeof currency === "string" ? currency : undefined;
  } catch {
    // skip: an unparseable definition falls back like one without a currency
    return undefined;
  }
}

// Money travels as minor units, the same as built-in money fields.
function coerceValue(type: string, raw: string, moneyCurrency: string): unknown {
  if (type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === "boolean") return raw === "true";
  if (type === "money") return { amount: Number(raw), currency: moneyCurrency };
  return raw;
}

// Inverse of coerceValue: converts a stored jsonb value to the string form
// expected by the input. number/boolean/date/text are represented as their
// inputs expect; money as its minor-unit amount; missing values become "".
function displayValue(type: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "boolean") return value === true ? "true" : "false";
  if (type === "money") {
    const amount = propertyOf(value, "amount");
    return typeof amount === "number" ? String(amount) : "";
  }
  return String(value);
}
