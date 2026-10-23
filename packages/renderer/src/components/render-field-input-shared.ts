import type { ReactNode } from "react";
import type { EditFieldViewModel } from "../headless/index.ts";
import type { useTranslation } from "../i18n.tsx";
import type { InputFillAction, usePrimitives } from "../primitives.tsx";
import { resolveAffix } from "./render-field-values.ts";

type Primitives = ReturnType<typeof usePrimitives>;

export type RenderInputArgs = {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: Primitives["Input"];
  readonly appLocale: string;
  readonly Banner: Primitives["Banner"];
  readonly Text: Primitives["Text"];
  readonly JsonView: Primitives["JsonView"];
  readonly t: ReturnType<typeof useTranslation>;
  readonly row?: Readonly<Record<string, unknown>>;
  readonly fill?: InputFillAction;
};

export type SharedInputProps = {
  readonly common: {
    readonly id: string;
    readonly name: string;
    readonly disabled: boolean;
    readonly required: boolean;
    readonly hasError: boolean;
  };
  readonly placeholderProp: { readonly placeholder?: string };
  readonly affixProps: {
    readonly prefix?: string;
    readonly suffix?: string;
    readonly fill?: InputFillAction;
  };
};

export type InputRenderer = (args: RenderInputArgs, shared: SharedInputProps) => ReactNode;

export function sharedInputProps({
  field,
  id,
  hasError,
  row,
  fill,
}: RenderInputArgs): SharedInputProps {
  const prefix = resolveAffix(field.prefix, row);
  const suffix = resolveAffix(field.suffix, row);
  return {
    common: {
      id,
      name: field.field,
      disabled: field.readOnly,
      required: field.required,
      hasError,
    },
    placeholderProp: field.placeholder !== undefined ? { placeholder: field.placeholder } : {},
    affixProps: {
      ...(prefix !== undefined && { prefix }),
      ...(suffix !== undefined && { suffix }),
      ...(fill !== undefined && { fill }),
    },
  };
}
