// Primitives-Contract — the minimal set of UI building blocks every
// renderer must provide. A "primitive" is a unit the standard-renderers
// (entityList, entityEdit, etc.) call into without knowing which library
// implements it. On web that's shadcn; on mobile it's react-native-paper;
// both packages (primitives-shadcn, primitives-paper) implement this
// contract and the app wires one of them into the renderer via context.
//
// Why a contract here (in ui-core) instead of in each renderer:
// ui-core's view-model builder and form-controller produce metadata
// (field-type, validation-state, label, placeholder) that the renderer
// translates into primitive invocations. Having the contract shape in
// ui-core means the metadata can carry references to primitives by name
// ("text-input", "select") and the translation is a pure map-lookup on
// the renderer side, not a switch statement that re-derives UI intent
// from entity-schema.
//
// Runtime-free: every primitive is expressed as its input contract only
// (what props it takes). Concrete components live in each primitives-*
// package and depend on React / React Native / etc.; ui-core never
// imports them.

// Common props every primitive accepts. Renderers pass down the
// current field-state (visible/readonly/required from FormController)
// through these — a primitive that honours them doesn't need to know
// about Kumiko's form-controller, it just renders according to flags.
export type PrimitiveCommonProps = {
  readonly id?: string;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  // Accessible label / placeholder / helper text. These are already
  // localized strings — the renderer resolves i18n keys via useTranslation
  // before handing them to the primitive.
  readonly label?: string;
  readonly placeholder?: string;
  readonly helperText?: string;
  // One or more issue messages to display. Localised; the renderer
  // picked them up from FormSnapshot.errors and ran them through
  // i18n.
  readonly errors?: readonly string[];
};

export type TextInputProps = PrimitiveCommonProps & {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onBlur?: () => void;
  readonly type?: "text" | "email" | "url" | "tel" | "password";
  readonly maxLength?: number;
  readonly autoComplete?: string;
};

export type NumberInputProps = PrimitiveCommonProps & {
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
  readonly onBlur?: () => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
};

export type SelectOption<TValue extends string = string> = {
  readonly value: TValue;
  readonly label: string;
};

export type SelectProps<TValue extends string = string> = PrimitiveCommonProps & {
  readonly value: TValue | null;
  readonly onChange: (next: TValue | null) => void;
  readonly options: readonly SelectOption<TValue>[];
};

export type ToggleProps = PrimitiveCommonProps & {
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
};

export type DatePickerProps = PrimitiveCommonProps & {
  // ISO-8601 date string (YYYY-MM-DD) or null. The primitive translates
  // to/from the native date widget on each platform; ui-core stays
  // platform-free by using the serialized string form.
  readonly value: string | null;
  readonly onChange: (next: string | null) => void;
  readonly minDate?: string;
  readonly maxDate?: string;
};

// Container primitives — layout / feedback that renderers compose but
// don't directly bind to a form field. Props stay minimal: anything that
// feels like "more variants" (destructive button, soft button, ghost
// button) gets a `variant` prop the primitive interprets.

export type ButtonProps = {
  readonly onPress: () => void;
  readonly label: string;
  readonly variant?: "primary" | "secondary" | "destructive" | "ghost";
  readonly disabled?: boolean;
  readonly loading?: boolean;
  // Left/right icons addressed by name through the Icon primitive.
  readonly leftIcon?: string;
  readonly rightIcon?: string;
};

export type ModalProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly description?: string;
};

export type ToastIntent = "info" | "success" | "warning" | "error";
export type ToastProps = {
  readonly intent: ToastIntent;
  readonly title: string;
  readonly description?: string;
  readonly onDismiss?: () => void;
};

export type BadgeProps = {
  readonly label: string;
  readonly intent?: ToastIntent;
};

export type CardProps = {
  readonly title?: string;
  readonly description?: string;
};

// Icons are referenced by string name so ui-core doesn't own an icon set.
// primitives-shadcn maps "check" → `<Check />` from lucide-react;
// primitives-paper maps "check" → `<Icon source="check" />`. The set of
// names is deliberately open — renderer-level code can introduce feature-
// specific icons without a ui-core round-trip.
export type IconProps = {
  readonly name: string;
  readonly size?: number;
};

// The full contract. A primitives package implements each member — the
// renderer consumes them from a single context object (PrimitivesProvider).
// Adding a new primitive to the contract is a breaking change for all
// primitives-* packages; removing one is not (renderers just stop using
// it). Keep the surface small: something that only one or two renderers
// need (masked input, signature pad, chart) should live in the feature
// module, not here.
export type PrimitivesContract<TPrimitive = unknown> = {
  readonly TextInput: TPrimitive;
  readonly NumberInput: TPrimitive;
  readonly Select: TPrimitive;
  readonly Toggle: TPrimitive;
  readonly DatePicker: TPrimitive;
  readonly Button: TPrimitive;
  readonly Modal: TPrimitive;
  readonly Toast: TPrimitive;
  readonly Badge: TPrimitive;
  readonly Card: TPrimitive;
  readonly Icon: TPrimitive;
};
