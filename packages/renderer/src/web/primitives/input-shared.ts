import type { ContextType, ReactNode } from "react";
import type { InputProps } from "../../index.ts";
import type { FieldDescriptionContext, FieldLayoutContext } from "./contexts.tsx";
import type { useFocusOnMount } from "./use-focus-on-mount.ts";

export type InputKind = InputProps["kind"];

// Distributive, so `kind: "file" | "image"` resolves for both of its kinds,
// which `Extract<InputProps, { kind: K }>` would turn into `never`.
export type PropsOfKind<K extends InputKind> = InputProps extends infer P
  ? P extends { readonly kind: infer PK }
    ? K extends PK
      ? P
      : never
    : never
  : never;

export function commonInputAttrs(
  props: InputProps,
  describedBy: ContextType<typeof FieldDescriptionContext>,
) {
  return {
    id: props.id,
    name: props.name,
    disabled: props.disabled,
    "aria-describedby": describedBy,
    "aria-required": props.required,
    "aria-invalid": props.hasError === true ? true : undefined,
  } as const;
}

export type DefaultInputShared = {
  readonly common: ReturnType<typeof commonInputAttrs>;
  readonly textInputRef: ReturnType<typeof useFocusOnMount>;
  readonly booleanLayout: ContextType<typeof FieldLayoutContext>;
};

export type KindRenderer<K extends InputKind> = (
  props: PropsOfKind<K>,
  shared: DefaultInputShared,
) => ReactNode;
