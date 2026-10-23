import { type FieldRenderer, isFormatSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ReactNode } from "react";
import { useColumnRenderer } from "../app/column-renderers.tsx";
import { extensionSectionName } from "../app/extension-sections.tsx";
import { rendererWarn } from "../dev-console.ts";
import { fileIdsOf } from "../file-ids-of.ts";
import {
  applyFormatSpec,
  type EditFieldViewModel,
  EMPTY_VALUE_PLACEHOLDER,
} from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { DISPLAY_TEXT_BY_TYPE, defaultDisplayText } from "./render-field-display-text.ts";
import { stringValue } from "./render-field-values.ts";

// Doesn't resolve the `string` (cross-feature QN) FieldRenderer variant — the
// list-column path (DataTableCell) doesn't either, so this stays in parity.
export function FieldRendererOutput({
  field,
  renderer,
  row,
  appLocale,
}: {
  readonly field: EditFieldViewModel;
  readonly renderer: FieldRenderer;
  readonly row?: Readonly<Record<string, unknown>>;
  readonly appLocale: string;
}): ReactNode {
  const { Text, JsonView, FileValueList } = usePrimitives();
  const t = useTranslation();
  const valueTestId = `field-value-${field.field}`;
  const componentName =
    !isFormatSpec(renderer) && typeof renderer === "object" && renderer !== null
      ? extensionSectionName(renderer)
      : undefined;
  const Component = useColumnRenderer(componentName);
  if (isFormatSpec(renderer)) {
    // format:"json" wants the raw value (JsonView stringifies + highlights
    // itself) — applyFormatSpec's already-indented string is only the
    // fallback for primitives-providers without JsonView.
    if (renderer.format === "json" && JsonView !== undefined) {
      return <JsonView value={field.value} indent={renderer.indent} testId={valueTestId} />;
    }
    if (renderer.format === "file" && FileValueList !== undefined) {
      const fileIds = fileIdsOf(field.value);
      if (fileIds.length === 0) return <Text testId={valueTestId}>{EMPTY_VALUE_PLACEHOLDER}</Text>;
      return (
        <FileValueList
          fileIds={fileIds}
          previewOpenByDefault={renderer.previewOpenByDefault === true}
          testId={valueTestId}
        />
      );
    }
    // App locale as default when the FormatSpec declares none of its own —
    // otherwise locale-sensitive formats (timestamp/date/number/decimal/
    // bigInt/unit) fell back to Intl's runtime default instead of the app
    // language chosen via LocaleProvider. Prefer renderer.locale
    // when set; coalesce undefined (spread override) back to appLocale.
    return (
      <Text testId={valueTestId}>
        {applyFormatSpec(
          {
            ...renderer,
            locale: stringPropertyOf(renderer, "locale") ?? appLocale,
          },
          field.value,
          t,
        )}
      </Text>
    );
  }
  if (componentName !== undefined) {
    if (Component !== undefined) {
      return (
        <Component
          value={field.value}
          row={row ?? { [field.field]: field.value }}
          column={{ field: field.field }}
        />
      );
    }
    rendererWarn(`[kumiko] fieldRenderer "${componentName}" not registered`);
  }
  return <Text testId={valueTestId}>{stringValue(field.value)}</Text>;
}

function stringPropertyOf(value: unknown, key: string): string | undefined {
  const property = propertyOf(value, key);
  return typeof property === "string" ? property : undefined;
}

// Read-only text for a `field.readOnly` field without its own `renderer` —
// per-type formatting that reuses the same value-shaping helpers as the
// editable widgets above, so a text value and its would-be Input widget stay
// derived from the identical parse. `type: "reference"` isn't
// covered here — it needs a live label lookup, see ReadOnlyReferenceValue.
// `isComplexFieldType` types aren't covered either — callers keep those on
// `renderInput`'s existing Banner fallback.
export function readOnlyDisplayText(
  field: EditFieldViewModel,
  appLocale: string,
  t: ReturnType<typeof useTranslation>,
): string {
  const { type, value } = field;
  if (value === undefined || value === null || value === "") return EMPTY_VALUE_PLACEHOLDER;
  if (type === "text" && field.writeOnly === true) return t("kumiko.field.writeOnly.set");
  if (type === "text" && field.format === "password") return "••••••••";
  const toText = DISPLAY_TEXT_BY_TYPE.get(type) ?? defaultDisplayText;
  return toText(field, value, appLocale);
}
