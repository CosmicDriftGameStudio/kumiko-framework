import { type ReactNode, useContext } from "react";
import type { InputProps } from "../../index.ts";
import "../react-css-custom-properties.ts";
import { FieldDescriptionContext, FieldLayoutContext } from "./contexts.tsx";
import { renderBooleanKind, renderComboboxKind, renderSelectKind } from "./input-choice-kinds.tsx";
import { renderFileKind, renderFilesDropzoneKind } from "./input-file-kinds.tsx";
import { renderMoneyKind, renderNumberKind, renderRangeKind } from "./input-number-kinds.tsx";
import {
  commonInputAttrs,
  type DefaultInputShared,
  type InputKind,
  type KindRenderer,
  type PropsOfKind,
} from "./input-shared.ts";
import {
  renderDateKind,
  renderLocatedTimestampKind,
  renderTimestampKind,
  renderTzKind,
} from "./input-temporal-kinds.tsx";
import {
  renderCodeKind,
  renderEmailKind,
  renderMonthKind,
  renderPasswordKind,
  renderTextareaKind,
  renderTextKind,
} from "./input-text-kinds.tsx";
import { useFocusOnMount } from "./use-focus-on-mount.ts";

type KindRenderers = { readonly [K in InputKind]: KindRenderer<K> };

const KIND_RENDERERS: KindRenderers = {
  text: renderTextKind,
  code: renderCodeKind,
  email: renderEmailKind,
  month: renderMonthKind,
  password: renderPasswordKind,
  number: renderNumberKind,
  range: renderRangeKind,
  boolean: renderBooleanKind,
  file: renderFileKind,
  image: renderFileKind,
  "files-dropzone": renderFilesDropzoneKind,
  date: renderDateKind,
  select: renderSelectKind,
  combobox: renderComboboxKind,
  money: renderMoneyKind,
  timestamp: renderTimestampKind,
  locatedTimestamp: renderLocatedTimestampKind,
  tz: renderTzKind,
  textarea: renderTextareaKind,
};

function renderKind<K extends InputKind>(
  kind: K,
  props: PropsOfKind<K>,
  shared: DefaultInputShared,
): ReactNode {
  return KIND_RENDERERS[kind](props, shared);
}

export function DefaultInput(props: InputProps): ReactNode {
  // Vendored ui/input + ui/checkbox style errors via `aria-invalid`
  // themselves, no manual border-destructive needed anymore.
  const booleanLayout = useContext(FieldLayoutContext);
  const describedBy = useContext(FieldDescriptionContext);
  const textInputRef = useFocusOnMount(props.kind === "text" ? props.autoFocus : undefined);
  const common = commonInputAttrs(props, describedBy);
  if (!Object.hasOwn(KIND_RENDERERS, props.kind)) return undefined;
  return renderKind(props.kind, props, { common, textInputRef, booleanLayout });
}
