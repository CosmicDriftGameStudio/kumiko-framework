import { type ReactNode, useEffect, useState } from "react";
import type { EditFieldViewModel } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";

// Wire value of a writeOnly field is `true` (set) / `null` (empty), never the
// secret. Typing sets a new value; an untouched or emptied input submits
// nothing / "" which the server reads as "keep". `null` after a loaded `true`
// (changed) means "remove on save".
export function WriteOnlyTextInput({
  field,
  id,
  hasError,
  onChange,
  changed,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly changed: boolean;
}): ReactNode {
  const { Input, Button, Text, Grid } = usePrimitives();
  const t = useTranslation();
  const isSet = field.value === true;
  const isMarkedForRemoval = field.value === null && changed;
  const [replacing, setReplacing] = useState(false);

  // A save turns the wire value back into `true`; the masked row returns with it.
  useEffect(() => {
    if (isSet) setReplacing(false);
  }, [isSet]);

  if (isSet && !replacing && !field.readOnly) {
    return (
      <Grid columns="auto">
        <Text testId={`field-write-only-set-${field.field}`}>
          {t("kumiko.field.writeOnly.maskedSet")}
        </Text>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setReplacing(true)}
          testId={`field-write-only-replace-${field.field}`}
        >
          {t("kumiko.field.writeOnly.replace")}
        </Button>
      </Grid>
    );
  }

  if (isMarkedForRemoval) {
    return (
      <Input
        kind="password"
        id={id}
        name={field.field}
        disabled
        hasError={hasError}
        value=""
        onChange={() => {}}
        autoComplete="new-password"
        placeholder={t("kumiko.field.writeOnly.willRemove")}
        testId={`field-write-only-removal-${field.field}`}
        trailingAction={{
          icon: "undo",
          label: t("kumiko.field.writeOnly.undo"),
          onPress: () => onChange(true),
        }}
      />
    );
  }

  return (
    <Input
      kind="password"
      id={id}
      name={field.field}
      disabled={field.readOnly}
      required={field.required && !isSet}
      hasError={hasError}
      value={typeof field.value === "string" ? field.value : ""}
      onChange={(v) => onChange(v)}
      autoComplete="new-password"
      {...(isSet && { placeholder: t("kumiko.field.writeOnly.setPlaceholder") })}
      {...(isSet &&
        !field.required &&
        !field.readOnly && {
          trailingAction: {
            icon: "clear",
            label: t("kumiko.field.writeOnly.remove"),
            onPress: () => onChange(null),
          },
        })}
    />
  );
}
