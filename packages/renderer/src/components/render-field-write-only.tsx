import type { ReactNode } from "react";
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
  const { Input } = usePrimitives();
  const t = useTranslation();
  const isSet = field.value === true;
  const isMarkedForRemoval = field.value === null && changed;

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
