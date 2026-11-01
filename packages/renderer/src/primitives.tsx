// Primitives contract. Platform-neutral: the types describe the semantic
// surface, while the concrete implementation (HTML) comes from `@cosmicdrift/kumiko-renderer/web`.
//
// Renderers (RenderEdit, RenderList, RenderField, KumikoScreen) consume only
// this context. There is NO default registry here—each app must provide a
// complete registry; platform packages supply defaultPrimitives, which are
// passed through by createKumikoApp.
//
// Core primitives (used by Kumiko's own components):
//
//   Button    — submit/button, disabled, onClick, variant
//   Banner    — role=alert box for errors/info, with optional actions
//   Field     — label + issues around an input control
//   Input     — discriminated union for text/number/boolean/date
//   DataTable — columns + rows + onRowClick, with an internal empty state
//   EmbeddedListInput — row array + totals table for createEmbeddedListField
//   Form      — submit wrapper (<form> + onSubmit)
//   Section   — titled group of fields (Web: <fieldset>+<legend>)
//   Grid      — column-based layout within a Section
//   Text      — semantic text variants (body/small/code/required-mark)
//
// App primitives (supplied by the app developer):
//
// The `AppPrimitives` interface is empty—developers extend it through
// module augmentation with their own components. They are automatically added
// to `PrimitivesRegistry`, and `usePrimitives()` returns them with types.
// Kumiko's components do NOT use or know about them, but app code gets a
// consistent primitive vocabulary across core and custom primitives.

import type {
  ConfigCascade,
  ConfigScope,
  ConfigValueSource,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  FieldIconKey,
  FormWidth,
  IconKey,
  NavIconKey,
  RowActionDisplay,
  SelectOptionTone,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  type ComponentType,
  createContext,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useContext,
} from "react";
import type { DataTableBulk } from "./data-table-bulk-types.ts";
import type { DataTableDateRangeFacet, DataTableFacet } from "./data-table-facet-types.ts";
import type { DataTableTableBlock } from "./data-table-view-types.ts";
import type { EmbeddedListInputProps } from "./embedded-list-types.ts";
import type {
  FieldIssue,
  ListColumnViewModel,
  ListRowViewModel,
  RuntimeRenderer,
} from "./headless/index.ts";
import type { MetricBandProps, MetricProps } from "./metric-types.ts";
import type { StatusBadgeOptionTone, StatusTone } from "./status-tone.ts";

export type {
  EmbeddedListCellType,
  EmbeddedListColumn,
  EmbeddedListInputProps,
  EmbeddedListTotal,
} from "./embedded-list-types.ts";
export type { RuntimeRenderer };

// ---- Prop types (the primitive contract surface) ----

/** Escape hatch for `data-*` test hooks (e.g. an E2E selector) that don't
 *  warrant a dedicated typed prop. Web merges these onto the rendered
 *  element. */
export type DataAttributes = Readonly<Record<`data-${string}`, string>>;

/** Structural marker a top-level `actions` node can carry so DefaultForm's
 *  sticky-footer split treats it as the pinned primary action even
 *  though it isn't a `Button` with `type="submit"` — e.g. RenderEdit's
 *  footer-slot mount, whose actual rendered button is opaque app code the
 *  split can't inspect (see `ScreenSlots.footerPrimary`). */
export const STICKY_PRIMARY_ACTION_PROP = "kumikoStickyPrimaryAction" as const;

export type StickyPrimaryActionMarker = Partial<Record<typeof STICKY_PRIMARY_ACTION_PROP, boolean>>;

export type FooterActionRole = "back" | "primary";

/** Tells the pinned phone footer which node is Back and which is the primary
 *  action, for buttons that are not `type="submit"` (e.g. the wizard Back). */
export const FOOTER_ACTION_ROLE_PROP = "kumikoFooterActionRole" as const;

/** Short label a footer action uses instead of its children below `sm`. */
export const NARROW_LABEL_PROP = "kumikoNarrowLabel" as const;

export type FooterActionMarker = {
  readonly [FOOTER_ACTION_ROLE_PROP]?: FooterActionRole;
  readonly [NARROW_LABEL_PROP]?: string;
};

/** Standard button. `loading` displays a spinner instead of the children and
 *  should be combined with `disabled` when the action must remain blocked until
 *  loading finishes (for example, during an async submit). Native
 *  implementations may render the spinner as an activity indicator. */
export type ButtonProps = ButtonBaseProps &
  (
    | { readonly children: ReactNode }
    | {
        readonly children?: undefined;
        readonly icon: NavIconKey;
        readonly ariaLabel: string;
      }
  );

type ButtonBaseProps = {
  readonly type?: "button" | "submit";
  readonly onClick?: () => void | Promise<void>;
  readonly disabled?: boolean;
  /** Render a spinner instead of the children. Callers should also set
   *  `disabled` when the action is blocked until loading completes, preventing
   *  double submission. */
  readonly loading?: boolean;
  /** Semantic class — default="primary". Custom impls decide what this
   *  becomes visually; the renderers use "primary" for Save, "danger" for
   *  Delete, "secondary" for a Confirm state, "link" for inline actions in
   *  running text (no background, underline), "danger-ghost" for a
   *  destructive action as red text instead of a red fill, "ghost" for a
   *  low-emphasis primary-colored text action beside a filled primary. */
  readonly variant?: "primary" | "secondary" | "danger" | "link" | "danger-ghost" | "ghost";
  /** Size—default="md". "sm" is for compact inline actions (toolbars,
   *  list rows); "icon" is for square icon-only buttons. */
  readonly size?: "sm" | "md" | "icon";
  /** Accessible label—required for icon-only buttons (when children contain
   *  only an icon or character), otherwise the button has no accessible name. */
  readonly ariaLabel?: string;
  /** Tooltip — rendered as the `title` attribute. */
  readonly title?: string;
  /** Toggle state for toggle buttons — web sets `aria-pressed`; leave unset for plain buttons. */
  readonly pressed?: boolean;
  /** Disclosure state for buttons that open a menu or panel — web sets `aria-expanded`. */
  readonly expanded?: boolean;
  /** Width—default="auto" (content width). "full" stretches CTA buttons to
   *  the container width (cards/panels). Other widths belong to the container's
   *  layout, not to a button prop; the kit excludes arbitrary sizing here. */
  readonly width?: "full" | "auto";
  readonly testId?: string;
  /** Layout extras, merged via cn(). */
  readonly className?: string;
  /** DOM ref on the button — escape hatch for cases that need more than
   *  a click (e.g. binding a drop-target handler). Forwarded to the element. */
  readonly ref?: Ref<HTMLButtonElement>;
  /** Icon before the label. */
  readonly icon?: NavIconKey;
  /** Icon after the label (e.g. "Continue →"). */
  readonly iconEnd?: NavIconKey;
  readonly dataAttributes?: DataAttributes;
};

/** Navigation link. `variant="button"` applies button styling to a semantic
 *  anchor (for example, “Zum Login" after reset success); `muted` makes it a
 *  subtle secondary link. Internal SPA navigation uses the browser default;
 *  history integration belongs to the navigation layer, not this primitive. */
export type LinkProps = {
  readonly href: string;
  readonly variant?: "default" | "button" | "muted";
  /** `_blank` makes the web impl set `rel="noopener noreferrer"` unless
   *  `rel` is set explicitly. */
  readonly target?: "_blank" | "_self" | "_parent" | "_top";
  readonly rel?: string;
  /** Plain left-click handler (SPA navigation); `href` stays set for
   *  modifier/middle clicks, which the browser handles itself. */
  readonly onPress?: () => void;
  /** Layout extras (self-center, text-xs), merged via cn(). */
  readonly className?: string;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly dataAttributes?: DataAttributes;
};

/** Banner for an inline message or page state (for example, "Loading…" or
 *  "Screen not found"). `padded` adds outer spacing so the banner does not
 *  touch the main border edge to edge, which matters because `<main>` no
 *  longer provides its own padding. */
export type BannerProps = {
  /** "error" for alerts (conflict, network error), "info" for neutral
   *  placeholders (not-found, loading), "loading" for load states, "warning"
   *  for a non-blocking but attention-grabbing notice (e.g. secretMint's
   *  "this is shown only once"), "primary" for a call-to-action notice (neutral
   *  background, accent in the primary color; pair it with `title` and `actions`),
   *  "hint" for a quiet aside on a muted background (e.g. per-entry results of
   *  a submit, with an "Open" link in `actions`). */
  readonly variant?: "error" | "info" | "loading" | "warning" | "primary" | "hint";
  /** Bold heading above `children`, inside the text column. */
  readonly title?: ReactNode;
  readonly titleTestId?: string;
  readonly children?: ReactNode;
  /** Structured text after `children`; `strong` parts render emphasized.
   *  Use instead of markup in strings. */
  readonly parts?: readonly { readonly text: string; readonly strong?: boolean }[];
  /** Leading icon, for example `"alert-triangle"` on a warning. */
  readonly icon?: NavIconKey;
  /** Optional—additional buttons or elements to the right of the text (for
   *  example, "Neu laden"). Inline, not a separate block. */
  readonly actions?: ReactNode;
  /** Adds outer spacing around the banner for page states where it renders
   *  alone in the main area (KumikoScreen "not-found", "loading", etc.). The
   *  web implementation adds p-6 as margin around the banner. */
  readonly padded?: boolean;
  readonly testId?: string;
  /** Set when a `<Field>` wraps this Banner as its control (no actual
   *  input exists for the label to target — see render-field.tsx's
   *  unsupported-field-type fallback). The web implementation uses
   *  it to derive `role="group"` + `aria-labelledby`, not `htmlFor`: a
   *  `<label for>` on a non-labelable element like a `<div>` is inert for
   *  screen readers. */
  readonly id?: string;
};

export type FieldProps = {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly issues?: readonly FieldIssue[];
  readonly labelAppendix?: ReactNode;
  readonly fieldAppendix?: ReactNode;
  /** Where `fieldAppendix` sits relative to the control. Default
   *  `above-control` (a disclosure panel belongs under its label-row
   *  trigger); `below-control` keeps sibling inputs on one line when the
   *  appendix is a status line or an expanded detail. */
  readonly appendixPlacement?: "above-control" | "below-control";
  /** Help text directly under the label, above the control. */
  readonly description?: ReactNode;
  /** Status pill at the right end of the label row (e.g. "Saved", "Not set"). */
  readonly status?: {
    readonly tone: StatusTone;
    readonly label: string;
    readonly testId?: string;
  };
  readonly children: ReactNode;
  /** Label layout. `stacked` (default) places the label above the control.
   *  `inline` places the control and label beside each other (box left, label
   *  right), for checkbox/switch fields (boolean), following the shadcn pattern. */
  readonly layout?: "stacked" | "inline" | "row";
  /** Marks a field whose value is set at this level (differs from the
   *  inherited one). Only `layout="row"` draws it: a 2px primary line on the
   *  row's left edge. Ignored by the other layouts. */
  readonly accent?: boolean;
  /** Collapses the visible label to `sr-only` — stays associated via
   *  `htmlFor` (no separate `aria-label` needed). For tables/grids whose
   *  column header already carries the label for each row. */
  readonly hideLabel?: boolean;
  /** Marks the field as edited relative to its saved value — the label row
   *  shows a "changed" marker. Set only in edit mode for fields present in
   *  the form's change set. */
  readonly changed?: boolean;
  readonly testId?: string;
};

/** Discriminated union: each input kind has its own value/onChange
 *  signature. Custom implementations can dispatch internally, render a
 *  different control (toggle instead of checkbox), or customize individual
 *  kinds. */
/** Button inside the right edge of a text input: an icon (e.g. a microphone)
 *  or, with `label`, a small primary text button that submits what was typed. */
export type InputEndAction = {
  readonly onClick: () => void;
  /** Toggle state, e.g. a microphone that is currently recording. */
  readonly pressed?: boolean;
} & (
  | { readonly icon: ReactNode; readonly ariaLabel: string; readonly label?: undefined }
  | { readonly label: string; readonly icon?: undefined; readonly ariaLabel?: undefined }
);

/** Button beside a single-line text/number input that fills it with a
 *  suggestion. Stays usable on a `disabled` input (the readOnly+fill case). */
export type InputFillAction = {
  readonly label: string;
  readonly onPress: () => void;
  /** A suggestion is being fetched: the button shows a spinner and is inert. */
  readonly busy?: boolean;
  /** The surrounding form is locked as a whole. */
  readonly disabled?: boolean;
  readonly testId?: string;
};

export type TrailingInputAction = {
  readonly icon: "clear" | "undo";
  readonly label: string;
  readonly onPress: () => void;
  readonly testId?: string;
};

/** Platform-neutral view of a picked file; the DOM `File` satisfies it. */
export type PickedFile = {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly webkitRelativePath: string;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
};

export type InputProps =
  | {
      readonly kind: "text";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly autoFocus?: boolean;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Hint text shown when the field is empty. Used for search inputs in
       *  toolbars ("Suchen…") where no label is practical. */
      readonly placeholder?: string;
      /** Browser autofill / native keyboard hint. Web applies this to
       *  `<input autocomplete=...>`; native applies it to `textContentType`. */
      readonly autoComplete?: string;
      /** Sets `data-testid` on the actual `<input>` so app tests can address the
       *  element directly (getByTestId + readOnly/disabled assertions). */
      readonly testId?: string;
      /** Read-only input (for example, a generated free-tier slug). Not
       *  `disabled`, so it remains focusable and copyable. */
      readonly readOnly?: boolean;
      /** Closed FieldIconKey vocabulary (FIELD_ICONS registry, renderer/web). */
      readonly icon?: FieldIconKey;
      /** Resolved inline text before/after the input (EditFieldSpec.prefix/suffix). */
      readonly prefix?: string;
      readonly suffix?: string;
      readonly fill?: InputFillAction;
      readonly endAction?: InputEndAction;
      readonly dataAttributes?: DataAttributes;
      /** Raw keydown access (e.g. Enter-to-submit at the field instead of
       *  the surrounding Form). Forwarded to the element. */
      readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    }
  | {
      /** Fixed-length numeric one-time code. `onComplete` fires once when input,
       *  paste or autofill brings the value to full length; the value holds
       *  digits only. */
      readonly kind: "code";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly length: number;
      readonly onComplete?: (code: string) => void;
      readonly autoFocus?: boolean;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly testId?: string;
      /** Default "one-time-code". */
      readonly autoComplete?: string;
    }
  | {
      readonly kind: "email";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly placeholder?: string;
      /** Default "email". Apps that need "username" (a username-or-email login
       *  form) pass that value through. */
      readonly autoComplete?: string;
      readonly testId?: string;
    }
  | {
      /** Month picker; the value is `YYYY-MM` (empty string when unset). */
      readonly kind: "month";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly testId?: string;
    }
  | {
      readonly kind: "password";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Hint text shown when the field is empty (analog to kind:"text"). */
      readonly placeholder?: string;
      /** "current-password" for login, "new-password" for reset/signup—browser
       *  password managers use this to decide whether to save the value.
       *  Native uses textContentType="password" / "newPassword". */
      readonly autoComplete?: "current-password" | "new-password";
      /** Icon button inside the field's trailing edge (clear a stored value,
       *  undo a pending removal). `label` is its accessible name + tooltip. */
      readonly trailingAction?: TrailingInputAction;
      readonly testId?: string;
    }
  | {
      readonly kind: "number";
      readonly id: string;
      readonly name: string;
      readonly value: number | "";
      readonly onChange: (v: number | undefined) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Hint text shown when the field is empty (analog to kind:"text"). */
      readonly placeholder?: string;
      readonly testId?: string;
      /** Closed FieldIconKey vocabulary (FIELD_ICONS registry, renderer/web). */
      readonly icon?: FieldIconKey;
      /** `<input step>`. "any" disables the native stepMismatch constraint
       *  (needed for decimal fields — integer fields leave this unset).
       *  Ignored by the web renderer, whose number input is a text field. */
      readonly step?: number | "any";
      /** BCP-47 tag for the grouped display and the decimal separator when typing. */
      readonly locale?: string;
      /** `false` shows the value without a thousands separator (e.g. a year). */
      readonly grouping?: boolean;
      /** Integer-only entry (bigInt): fractional drafts are not emitted via `onChange`. */
      readonly integer?: boolean;
      /** Resolved display suffix (static or from a sibling field) — never
       *  part of the numeric value. */
      readonly unit?: string;
      readonly prefix?: string;
      readonly suffix?: string;
      readonly fill?: InputFillAction;
    }
  | {
      readonly kind: "range";
      readonly id: string;
      readonly name: string;
      readonly value: number;
      readonly onChange: (v: number) => void;
      readonly min: number;
      readonly max: number;
      readonly step?: number;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "boolean";
      readonly id: string;
      readonly name: string;
      readonly value: boolean;
      readonly onChange: (v: boolean) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "file" | "image";
      readonly id: string;
      readonly name: string;
      /** FileRef UUID (stored file) or null (no upload). */
      readonly value: string | null;
      /** Implementations must offer their own remove control that calls
       *  `onChange(null)`: FileListField relies on it to drop a file from an
       *  `images`/`files` field. */
      readonly onChange: (fileId: string | null) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Erlaubte Extensions/MIME (z.B. ["jpg","png"]) → `accept`-Attribut. */
      readonly accept?: readonly string[];
      readonly maxSize?: string;
      /** For the upload POST `/api/files`: the endpoint validates maxSize/accept
       *  against the field definition for (entityType, fieldName). */
      readonly entityType?: string;
      /** Screen QN of the actionForm the field belongs to; sent as `actionForm` instead of
       *  `entityType`, so the upload stays pending for that form's field. */
      readonly uploadActionForm?: string;
      /** Must be sent as the `entityId` part of the upload so the FileRef is
       *  attached to the record (qr overlays and access guards need it). */
      readonly entityId?: string;
      readonly fieldName?: string;
      /** Only for kind:"image" — variant name for the preview
       *  (`/api/files/:id/variant/:name`). Absent → the original. */
      readonly imageVariant?: string;
      /** Only for kind:"image" — forwarded to the file input's `capture`
       *  attribute so a phone opens the camera instead of the file picker. */
      readonly capture?: "environment" | "user";
      /** Web-only folder picker: the picked files (with `webkitRelativePath`)
       *  go to `onFilesPicked` and nothing is uploaded. */
      readonly directory?: boolean;
      readonly onFilesPicked?: (files: readonly PickedFile[]) => void;
      /** Translated label of the pick button; absent → the upload/change default. */
      readonly pickLabel?: string;
      /** Hidden file input gets `${testId}-input`, the pick button `${testId}-pick`. */
      readonly testId?: string;
    }
  | {
      /** Drop zone for a `files` / `images` field: the value is the list of uploaded FileRef ids,
       *  the implementation offers multi-pick, drag and drop and a remove control per file. */
      readonly kind: "files-dropzone";
      readonly id: string;
      readonly name: string;
      readonly value: readonly string[];
      readonly onChange: (fileIds: readonly string[]) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly accept?: readonly string[];
      readonly maxSize?: string;
      readonly maxCount?: number;
      /** Upload target, same meaning as on the `file` kind. */
      readonly entityType?: string;
      readonly uploadActionForm?: string;
      readonly entityId?: string;
      readonly fieldName?: string;
      readonly testId?: string;
    }
  | {
      readonly kind: "date";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string | undefined) => void;
      /** Locale for display and input parsing. Default = browser locale via
       *  navigator.language. Apps with their own LocaleResolver can pass through
       *  their current locale. */
      readonly locale?: string;
      /** Datumsgrenzen als ISO `yyyy-mm-dd` — begrenzen Picker (Jahres-
       *  Dropdown-Range + ausgegraute Tage). */
      readonly min?: string;
      readonly max?: string;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "select";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      /** Allowed values. An empty array produces a dropdown with no options, so a
       *  required field cannot be satisfied (an author warning, not an end-user
       *  message). The string form is for static lists (value == label); the
       *  {value,label} form is for database-backed references. */
      readonly options:
        | readonly string[]
        | readonly {
            readonly value: string;
            readonly label: string;
            /** Muted second line under the label (radio list and dropdown items;
             *  the dropdown search matches it too). */
            readonly description?: string;
            /** Group heading. Groups form in order of first occurrence; options
             *  without a group stay ungrouped and come before all groups. Options
             *  with description or group never render as a segmented control. */
            readonly group?: string;
            /** Not choosable and visibly muted. A disabled option that is the
             *  current `value` stays displayed as the selection. */
            readonly disabled?: boolean;
          }[];
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** `"card"` renders the radio group as bordered cards with label plus
       *  optional description per option and always uses the radio group,
       *  regardless of option count or `display`. Default `"list"`. */
      readonly radioVariant?: "list" | "card";
      /** Requested presentation. `"radio"` renders the options as a visible
       *  radio group (WAI-ARIA radiogroup, one click per choice),
       *  `"dropdown"` renders the combobox. Omitted = the implementation
       *  decides; the web impl keeps its short-option-set heuristic. Custom
       *  impls may ignore it — it is a request, not a contract. */
      readonly display?: "radio" | "dropdown";
      /** Tone per option value; the selected segment of a radio presentation takes its colors. */
      readonly optionTones?: Readonly<Partial<Record<string, SelectOptionTone>>>;
    }
  | ({
      // Combobox / searchable select. Single mode (`multiple` false or omitted)
      // uses a string value and onChange string. Multi mode (`multiple: true`)
      // uses string[] for both. Reference fields use this without explicitly
      // selecting combobox; the renderer chooses it automatically for reference
      // field types.
      // The `multiple` discriminant gives single and multi modes distinct
      // signatures, so callers must choose the mode when building the value;
      // the compiler enforces the matching signature.
      readonly kind: "combobox";
      readonly id: string;
      readonly name: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly placeholder?: string;
      readonly searchPlaceholder?: string;
      readonly emptyText?: string;
      /** Remote search: when set, the combobox uses remote mode (local cmdk
       *  filtering is disabled and the search input calls the caller's
       *  debounced onSearchChange). */
      readonly onSearchChange?: (q: string) => void;
      readonly loading?: boolean;
      /** Fixed "+ createLabel" footer row that fires instead of
       *  selecting an option — omit for the plain select-existing
       *  combobox. */
      readonly onCreate?: () => void;
      readonly createLabel?: string;
    } & (
      | {
          readonly multiple?: false;
          readonly value: string;
          readonly onChange: (v: string) => void;
        }
      | {
          readonly multiple: true;
          readonly value: readonly string[];
          readonly onChange: (v: readonly string[]) => void;
        }
    ))
  | {
      readonly kind: "money";
      readonly id: string;
      readonly name: string;
      /** Internal format: cents/minor units as an integer (for example, 1299 for
       *  12,99 EUR). The renderer converts this to major units for the UI with
       *  locale-formatted decimal places. Empty state = `""`. */
      readonly value: number | "";
      readonly onChange: (v: number | undefined) => void;
      /** ISO-4217 currency code, for example "EUR" / "USD" / "CHF". Default
       *  "EUR". The renderer displays the symbol as a suffix and formats the
       *  decimal places accordingly (EUR/USD/CHF use 2; JPY uses 0). */
      readonly currency?: string;
      /** Locale for number formatting. Default "de-DE" (comma as the decimal
       *  separator). Apps with their own LocaleResolver can pass through their
       *  current locale. */
      readonly locale?: string;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "timestamp";
      readonly id: string;
      readonly name: string;
      /** ISO-8601 datetime string. A UTC instant uses `Z`
       *  ("2026-04-25T13:45:00Z"); a wall-clock value has no offset
       *  ("2026-04-25T13:45", only with wallClock). Empty state = `""`.
       *  Web renders separate date (typable + calendar) and time inputs and
       *  converts the result. */
      readonly value: string;
      readonly onChange: (v: string | undefined) => void;
      /** true = locatedTimestamp (wall-clock without an offset; the server
       *  validates z.iso.datetime({local:true})). false/undefined = a UTC
       *  instant; onChange MUST emit a `Z` suffix. */
      readonly wallClock?: boolean;
      /** Locale for displaying and parsing the date portion. Default = browser
       *  locale. */
      readonly locale?: string;
      /** Date bounds as ISO datetimes; they constrain the calendar to day-level
       *  granularity. */
      readonly min?: string;
      readonly max?: string;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "locatedTimestamp";
      readonly id: string;
      readonly name: string;
      /** Located-timestamp value: wall-clock `at` (without an offset) plus an IANA
       *  `tz`. `utc` is present when reading (computed by the server) and ignored
       *  when writing. Empty state = `""`. onChange emits `{ at, tz }`. */
      readonly value: { readonly at: string; readonly tz: string; readonly utc?: string } | "";
      readonly onChange: (v: { readonly at: string; readonly tz: string } | undefined) => void;
      /** Locale for the date portion. Default = browser locale. */
      readonly locale?: string;
      /** Date bounds as ISO datetimes; they constrain the calendar. */
      readonly min?: string;
      readonly max?: string;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "tz";
      readonly id: string;
      readonly name: string;
      /** IANA zone name, e.g. "Europe/Berlin". Empty-state = "". */
      readonly value: string;
      readonly onChange: (v: string | undefined) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "textarea";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      /** Visible rows. Acts as a minimum height — the field starts this tall
       *  and still grows with its content. Omitted, the default primitive
       *  falls back to its own floor. */
      readonly rows?: number;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Hint text shown when the field is empty (analog to kind:"text"). */
      readonly placeholder?: string;
      /** Read-only Textarea. Not `disabled` — remains focusable and
       *  copyable (analogous to kind:"text"). */
      readonly readOnly?: boolean;
      /** Ctrl/Cmd+Enter submits instead of inserting a newline. Plain
       *  Enter still inserts a newline. */
      readonly onSubmitShortcut?: () => void;
      readonly dataAttributes?: DataAttributes;
      /** Raw keydown access (e.g. plain-Enter-submits/Shift+Enter-newline at
       *  the field instead of the surrounding Form). Composes with
       *  `onSubmitShortcut` — both fire on the same keystroke when set. Forwarded
       *  to the element. */
      readonly onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    };

// Sort wire format. `null` distinguishes “the user has not sorted yet” from
// “sort by X”; this is required for the 3-state toggle
// (asc → desc → null → asc …). The renderer reads the current sort and calls
// onSortChange when the user clicks a sortable header.
export type DataTableSortDir = "asc" | "desc";
export type DataTableSort = {
  readonly field: string;
  readonly dir: DataTableSortDir;
};

// Rendering mode for the row-action column (see DataTableProps.rowActionMode).
export type DataTableRowActionMode = "adaptive" | "inline";

// Resolved row action (KumikoScreen builds it from
// EntityListScreenDefinition.rowActions): labels are already translated and the handler QN is
// resolved to an onTrigger function that knows the dispatcher. DataTable can
// render it without additional i18n or dispatcher knowledge.
export type DataTableRowAction = {
  /** Stable ID for aria-labels and data-testids. */
  readonly id: string;
  /** Translated Label. */
  readonly label: string;
  /** Visual style — "danger" renders the red variant in the default
   *  primitive. Whether it also forces a confirm dialog is governed by
   *  `confirmRequired` (falls back to `style === "danger"` when unset). */
  readonly style?: "primary" | "secondary" | "danger";
  /** Translated confirmation prompt (dialog description). When set, a modal
   *  opens before execution. For style=danger without an explicit confirm,
   *  the renderer should show a generic default. */
  readonly confirm?: string;
  /** Translated confirm-button label in the dialog. Defaults to `label`
   *  (the action label is reused). */
  readonly confirmLabel?: string;
  /** Overrides the default "danger implies a confirm dialog" rule. Schema-driven
   *  navigate/drawer actions set it to false: the colour marks the action as
   *  destructive, but the target form is the confirmation. */
  readonly confirmRequired?: boolean;
  /** Called with the clicked row's `ListRowViewModel`. May be async, allowing
   *  the renderer to show a loading state on the button while the promise resolves. */
  readonly onTrigger: (row: ListRowViewModel) => Promise<void> | void;
  /** Controls per-row visibility (e.g. show "Start" only when
   *  `status==="scheduled"`). */
  readonly isVisible?: (row: ListRowViewModel) => boolean;
  /** This action is what a click on the row does. With `onRowClick` the table
   *  (except `"inline"` mode or editable cells) and the card layout drop it
   *  from the row menu, since the row itself is already the click target. */
  readonly rowClick?: boolean;
  /** Resolved icon (author `RowAction.icon` or the id-derived default) —
   *  drives both the icon-left-of-text render and the icon-only collapse
   *  rule (see `shouldRenderActionsIconOnly`). */
  readonly icon?: IconKey;
  /** Author-chosen inline form (`RowAction.display`). Set: the action stays
   *  inline even in the adaptive layout and is exempt from the automatic
   *  icon-only collapse. */
  readonly display?: RowActionDisplay;
};

/** Teil-C action-icon collapse rule: a group of more than two actions where
 *  every member carries an icon renders icon-only instead of wall-to-wall
 *  text buttons; any icon-less member keeps the whole group on text so it
 *  doesn't fall apart visually mid-group. */
export function shouldRenderActionsIconOnly(
  actions: readonly { readonly icon?: IconKey }[],
): boolean {
  return actions.length > 2 && actions.every((a) => a.icon !== undefined);
}

export type {
  BulkRowOutcome,
  DataTableBulk,
  DataTableBulkAction,
} from "./data-table-bulk-types.ts";
export type {
  DataTableDateRangeFacet,
  DataTableFacet,
  DataTableFacetChip,
} from "./data-table-facet-types.ts";
export type { MetricBandProps, MetricProps } from "./metric-types.ts";

export type DataTableProps = {
  readonly columns: readonly ListColumnViewModel[];
  readonly rows: readonly ListRowViewModel[];
  /** Tints a row. Renderers without row tinting ignore it. */
  readonly rowTone?: (row: ListRowViewModel) => SelectOptionTone | undefined;
  readonly onRowClick?: (row: ListRowViewModel) => void;
  /** Current sorting, or null when unsorted. If columns contain a
   *  `sortable: true` field and `onSortChange` is set, the renderer makes
   *  headers clickable and shows ascending/descending indicators. Without
   *  `onSortChange`, header clicks remain disabled and `columns.sortable` is
   *  only semantic metadata. */
  readonly sort?: DataTableSort | null;
  /** Called with the next sort state after a header click.
   *  The conventional three-state cycle is asc → desc → null. The caller
   *  uses it to update URL state or a query parameter and refetch. */
  readonly onSortChange?: (next: DataTableSort | null) => void;
  /** Per-row actions rendered in a right-hand column as inline buttons
   *  (≤2 actions) or a kebab dropdown (>2). The caller supplies the resolved
   *  form, with translated labels and wired `onTrigger`; DataTable handles
   *  only rendering and the confirmation dialog. */
  readonly rowActions?: readonly DataTableRowAction[];
  /** How the row-action column renders:
   *  - `"adaptive"` (default): with `onRowClick` all actions except the
   *    `rowClick` one go in the kebab (no kebab or column if none remain);
   *    without it the primary action is a link button and the rest go in the
   *    kebab (a single action gets no kebab).
   *  - `"inline"`: ALWAYS inline buttons, left-aligned, even with >2 (no
   *    kebab). Actions then sit at the same x-position across all rows
   *    (no drifting with label width) and all lists in an app look alike. */
  readonly rowActionMode?: DataTableRowActionMode;
  /** Present: row checkboxes plus a selection bar that runs these actions once per selected row. */
  readonly bulk?: DataTableBulk;
  /** Custom empty-state content (e.g. Icon + Heading + CTA-Button).
   *  The default renderer wraps it in a dashed-border box. */
  readonly emptyState?: ReactNode;
  /** Optional title slot at the left of the toolbar, typically the screen
   *  title ("Items", "Bestellungen"). The web renderer uses a medium-weight heading. */
  readonly toolbarTitle?: ReactNode;
  /** Toolbar slot in the middle, typically a search input. The renderer
   *  controls the layout; the web implementation gives it `flex-1` with a
   *  maximum width, while native implementations may use a header search bar. */
  readonly toolbarStart?: ReactNode;
  /** Toolbar slot on the right, typically for a + New button, filters, or a
   *  view switch. The web implementation moves the cluster to the right edge
   *  with `ml-auto`. */
  readonly toolbarEnd?: ReactNode;
  /** Faceted filter dropdowns for select/boolean fields. The renderer places
   *  them beside the search input; an empty or undefined value renders no filters. */
  readonly filterFacets?: readonly DataTableFacet[];
  /** Currently selected values for each facet field, supplied by URL state. */
  readonly filterValues?: Readonly<Record<string, readonly string[]>>;
  /** Toggling a facet value: the caller updates URL state and refetches. */
  readonly onFilterChange?: (field: string, values: readonly string[]) => void;
  /** Clears all active facets. The renderer shows the reset button only when
   *  at least one facet is active. */
  readonly onFilterReset?: () => void;
  /** Time-range filters beside the facet dropdowns. */
  readonly dateRangeFacets?: readonly DataTableDateRangeFacet[];
  /** One bound changed ("" clears it) → caller writes URL state + refetch. */
  readonly onDateRangeChange?: (field: string, bound: "from" | "to", value: string) => void;
  /** Pagination state and callback. When set, the renderer shows a pager below
   *  the table (web: a footer bar with ← 1 ... N →). `total`, `limit`, and
   *  `page` are one-based for the UI; the caller translates them to
   *  `offset = (page-1)*limit` for the server. The caller should clamp a page
   *  greater than `total/limit` beforehand. */
  readonly pager?: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly onPageChange: (next: number) => void;
    /** Offered page sizes; with `onPageSizeChange` the footer shows a
     *  "N per page" select. */
    readonly pageSizeOptions?: readonly number[];
    readonly onPageSizeChange?: (next: number) => void;
  };
  /** Hint at the left of the toolbar (relatedList tab description). */
  readonly toolbarDescription?: string;
  /** Noun for the footer count ("1–19 of 19 leases", "1 position"),
   *  resolved for the given count. Omitted = generic "entries" wording. */
  readonly itemNoun?: (count: number) => string;
  /** Infinite-scroll callback. When set, the renderer adds a bottom sentinel
   *  and calls `onReachEnd` when it enters the viewport (web:
   *  `IntersectionObserver`). The caller manages accumulation, the cursor, and
   *  `hasMore`. `loadingMore=true` shows a spinner below the table while the
   *  next page loads. Incompatible with `pager`: use either pagination or
   *  infinite scrolling, not both. */
  readonly onReachEnd?: () => void;
  readonly loadingMore?: boolean;
  /** When false and `onReachEnd` is set, the renderer shows an end-of-list
   *  message instead of the sentinel. Defaults to true. */
  readonly hasMore?: boolean;
  readonly testId?: string;
  /** Wires an edit path into a component column-renderer: `DataTableCell`
   *  passes this down as `ColumnRendererProps.onChange` for that cell,
   *  bound to `(rowId, column.field)`. Renderers without a component
   *  renderer (format-spec, type-default) ignore it — read-only stays
   *  read-only unless the column has a custom renderer that reads
   *  `onChange`. */
  readonly onCellChange?: (rowId: string, field: string, value: unknown) => void;
  /** Overrides the row `data-testid` (default `row-${row.id}`) — for a
   *  screen that already has its own DOM-test/e2e naming scheme. */
  readonly getRowTestId?: (row: ListRowViewModel) => string;
  /** Overrides the cell `data-testid` (default `cell-${row.id}-${field}`). */
  readonly getCellTestId?: (row: ListRowViewModel, field: string) => string;
  /** Drops the table's own rounded/border/card background — for a host
   *  that already provides the surrounding boundary (a tab panel)
   *  and would otherwise show a card nested inside that boundary. Default
   *  false: unchanged card-framed table. */
  readonly chromeless?: boolean;
  /** Fills the available height of its flex container and scrolls rows
   *  internally instead of growing with row count — for a host that would
   *  otherwise have a long table stretch the whole page, or a short table
   *  leave dead space below it (a tab panel). Requires the same
   *  flex-fill chain FormProps.fillHeight sets up above it; without that
   *  ancestor chain this collapses to zero height (Web: `flex-1 min-h-0`
   *  has no effect outside a sized flex-col ancestor). When true the table
   *  also takes the full board layout: the wrapper fills its container
   *  (`h-full`), toolbar and footer (pager or entry count) stay pinned
   *  outside the scrolling body, no card frame and no outer padding.
   *  Default false: unchanged document-flow table that grows with its
   *  content, pager below the last row. */
  readonly scrollBody?: boolean;
  /** Uses the shared screen padding (wider bottom inset) instead of the
   *  table's symmetric embedded inset — for a table that IS the screen body
   *  (entityList/projectionList), so a list screen ends at the same footer
   *  distance as a form or custom screen. Ignored when
   *  `scrollBody` is true: the wider bottom inset would compete with
   *  `scrollBody`'s flex-fill height budget.
   *  Default false: unchanged symmetric inset for an embedded table. */
  readonly screenPadding?: boolean;
  /** Ids of the rows whose expansion area is currently open (controlled by
   *  the host; several rows can be open at once). Only meaningful together
   *  with `renderExpandedRow` + `onToggleRowExpanded`. */
  readonly expandedRowIds?: ReadonlySet<string>;
  /** User toggled a row's expand control. With `renderExpandedRow` this makes
   *  every row expandable: the renderer adds a toggle (button with
   *  `aria-expanded`) that does not trigger `onRowClick`. */
  readonly onToggleRowExpanded?: (rowId: string) => void;
  /** Content of the area under an expanded row. Native renderers implement
   *  the same three props. */
  readonly renderExpandedRow?: (row: ListRowViewModel) => ReactNode;
} & DataTableTableBlock;

export type DataTableTableBlockProps = Pick<DataTableProps, keyof DataTableTableBlock>;

export type { FormWidth };

/** One entry of a form's "on this page" navigation: `id` matches the
 *  `SectionProps.id` of the section it scrolls to. */
export type FormSectionNavItem = {
  readonly id: string;
  readonly title: string;
};

/** Submit wrapper. Web: `<form onSubmit>`, native: a View that triggers an
 *  onSubmit callback via button press. `onSubmit` gets an abstract
 *  signature (no FormEvent) so native impls can fill it meaningfully.
 *
 *  `title`: slot in the card header. `actions`: optional slot for the
 *  primary form actions (Save, Cancel) — renders as a footer row at the
 *  end of the card (normal document flow). */
export type FormProps = {
  readonly onSubmit: (e?: FormEvent) => void;
  /** Bumped by the host each time a submit fails on field errors; the form
   *  then moves focus to its first invalid control. Native forms may ignore it. */
  readonly focusFirstErrorKey?: number;
  readonly children: ReactNode;
  readonly title?: ReactNode;
  /** Optional muted subtitle below the title (e.g. "Add a new item to
   *  your catalog"), providing context in the form header rather than only
   *  a label. */
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  /** Secondary, record-related actions — rendered on the left on desktop,
   *  on their own row below the primary action on a narrow viewport. */
  readonly secondaryActions?: ReactNode;
  readonly testId?: string;
  /** Max width of the form container. Default "full" — see FormWidth
   *  (`packages/types/src/screen.ts`, EditLayout.width). */
  readonly width?: FormWidth;
  /** Pins `actions` to the viewport bottom on narrow screens (`<640px`)
   *  instead of normal document flow, so it stays reachable when a virtual
   *  keyboard shrinks the visible viewport. Desktop/tablet
   *  unaffected. */
  readonly stickyActions?: boolean;
  /** Extra content rendered above the card, inside the same page padding
   *  the card itself sits in — for a host that needs its own header region
   *  (title/metrics/tabs) to share the form's left padding and width
   *  instead of rendering as unpadded siblings before it. */
  readonly headerRegion?: ReactNode;
  /** Compact content on the right of the form title, same row — status
   *  chips or allowance badges that belong to the screen, not to a field. */
  readonly titleAction?: ReactNode;
  /** Sizes the form to fill its container's height (instead of the page's
   *  natural content height) so a single scrolling child — a lone
   *  relatedList tab's table — can scroll internally instead of stretching
   *  the whole page. Set by RenderEdit for a lone relatedList tab
   *  section and for screens that fill the shell height (together with
   *  `stickyActions`: sections scroll, footer stays pinned without
   *  `position: fixed`); every other caller leaves it unset and keeps normal
   *  document-flow height. */
  readonly fillHeight?: boolean;
  /** Drops the surrounding card (bg/border/rounded, title/subtitle block,
   *  footer border) so sections+footer render as siblings of `headerRegion`
   *  on the page background instead of inside a nested card — a tabbed
   *  projectionDetail's tab content is a sibling of the head card, not its
   *  child (bedienkonzept A1), so it must look like a standalone screen
   *  instead of a form embedded in another card. Default false: unchanged
   *  card chrome. */
  readonly chromeless?: boolean;
  /** Set by RenderEdit for entityEdit/actionForm screens that fill the shell
   *  height: the form renders without a surrounding card, in a padded scroll
   *  surface with a fixed-width form column. Requires `fillHeight`; projection
   *  detail screens (which also fill the height) do not set it. */
  readonly screenForm?: boolean;
  /** Number of unsaved changes, shown in the pinned footer; 0 shows the quiet
   *  "No unsaved changes" status. Omitted (create mode) — no status at all. */
  readonly unsavedCount?: number;
  /** Drawer-hosted forms: context box above the fields. */
  readonly summary?: { readonly title: string; readonly subtitle?: string };
  /** Titled sections for the "on this page" navigation next to a
   *  `screenForm`. The web impl shows it only with three or more entries. */
  readonly sectionNav?: readonly FormSectionNavItem[];
  /** Leading column next to the scroll surface of a `screenForm` (wizard step
   *  navigation). */
  readonly sideRail?: ReactNode;
};

/** Titled group of fields. Web: `<fieldset>` + `<legend>`; native
 *  implementations use a `View` with header text and may render the title as
 *  an accordion or collapsible section. */
export type SectionProps = {
  /** DOM id — the scroll target of a form's "on this page" navigation. */
  readonly id?: string;
  /** Optional; without a title, the Section renders only the grouping and no
   *  header. RenderEdit omits it when it would exactly repeat the screen title
   *  in the action bar. */
  readonly title?: string;
  /** Optional muted subtitle below the title, providing section context rather
   *  than only a label (analogous to `FormProps.subtitle`). */
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  /** Rendered top-right in the title row — never a footer. A
   *  title-less/subtitle-less Section still draws the row when `actions`
   *  is set, so a hideTitle tabs-Section with actions isn't stranded. */
  readonly actions?: ReactNode;
  /** "settings-list": title + subtitle form a left header column and the
   *  children (field rows) the right one on `md:` and up. Default "stacked". */
  readonly layout?: "stacked" | "settings-list";
  /** "destructive" marks the Section as a warning/danger area (e.g. account
   *  deletion, restrict processing) — border color only, no content change.
   *  Default "default" (normal card border). */
  readonly variant?: "default" | "destructive";
  readonly testId?: string;
  /** Rendered left of the title, `text-muted-foreground`, same optical
   *  size as the title. No effect without a `title` — an icon alone would
   *  have nothing to sit next to. */
  readonly icon?: IconKey;
};

/** Chromeless flex-fill layout host — no title, no card frame, no padding,
 *  just a container that sizes to its content and, once the ancestor chain
 *  is height-constrained, shrinks so one scrolling child can scroll
 *  internally instead of the page growing. Web:
 *  `<div className="flex min-h-0 flex-col">`. Native: Views are
 *  already flex-column and the parent is already a bounded viewport there,
 *  so a native impl may render this as a bare Fragment. Used only as the
 *  terminal link in `RenderEdit`'s `fillHeight` chain (`RelatedListSection`'s
 *  `hideTitle` branch) — `Section`/`Card` were rejected here because both
 *  carry title/padding/border chrome this spot doesn't want and would double
 *  up with the table's own padding. */
export type FillContainerProps = {
  readonly children: ReactNode;
  readonly testId?: string;
  /** Claims the remaining height of the flex chain (`flex-1`) instead of
   *  sizing to its content, so a footer inside the child sits at the bottom
   *  edge even with few rows. Set only when the screen fills the shell
   *  height. */
  readonly grow?: boolean;
};

/** Column-based layout. Web uses CSS grid; native implementations use
 *  flex-wrap with percentages or react-native-grid. Direct children can be
 *  wrapped in `GridCell` to control their span.
 *
 *  `columns: "auto"` disables the N-column stretch layout: children retain
 *  their content width and wrap onto new lines (for example, self-sized
 *  metric tiles or an inline label-and-badge row) instead of stretching into
 *  equal-width tracks. `GridCell` span wrapping is meaningless in this mode
 *  and should be skipped. */
export type GridProps = {
  readonly columns: number | "auto";
  readonly children: ReactNode;
  readonly testId?: string;
  /** Rows visible before the grid becomes vertically scrollable. Omitted =
   *  the grid grows with its content and never scrolls. Ignored when
   *  `columns` is "auto". */
  readonly maxRows?: number;
  /** Fields flow left to right in wrapping rows sized by `GridCell.width`
   *  instead of equal-width tracks (screen forms and drawers). */
  readonly flow?: boolean;
  /** One full-width row per child, separated by hairlines — the field rows of
   *  a `settings-list` section. Wins over `columns`/`flow`. */
  readonly list?: boolean;
  /** Id of the element naming this grid (a Field label). Turns the grid into
   *  a `role="group"` so a Field whose control is a set of inputs (checkbox
   *  group) still gives screen readers a group name. */
  readonly ariaLabelledBy?: string;
};

/** Width class of a field cell inside a `flow` grid: sized by what the field holds. */
export type FieldCellWidth =
  | "text"
  | "number"
  | "money"
  | "date"
  | "timestamp"
  | "select"
  | "full"
  | "toggle";

/** Span wrapper for a child within a grid. Web: `style={{gridColumn: span N}}`;
 *  native implementations calculate the width themselves. */
export type GridCellProps = {
  readonly span?: number;
  /** Only read inside a `flow` grid. */
  readonly width?: FieldCellWidth;
  readonly children: ReactNode;
};

/** Semantic text. Variants map to standard typography roles: `body` is
 *  the default, `small` for secondary labels, `code` for inline monospace
 *  (entityId, screen-id), `required-mark` for the asterisk after labels,
 *  `muted` for dimmed body text (text-sm muted-foreground). Custom impls map
 *  these to their own type scale. */
export type TextProps = {
  readonly variant?: "body" | "small" | "code" | "required-mark" | "muted";
  /** Pure ornament (e.g. a separator glyph): hidden from assistive tech. */
  readonly decorative?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Heading with three roles: `page` is a page title (web: h1), `section`
 *  is a group subheading (web: h2 with uppercase and muted styling) and `group`
 *  is a plain 16px semibold sub-title (web: h2, normal case). Native
 *  implementations map these to `<Text>` with the corresponding font weight
 *  and size. */
export type HeadingProps = {
  readonly variant?: "page" | "section" | "group";
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Modal dialog for confirmations or compact sub-forms. The web renderer
 *  uses Radix Dialog with focus trapping, Escape-to-close, and overlay-click
 *  handling; native implementations may use a native modal. Apps control it
 *  through external state (`open` + `onOpenChange`); confirmation runs through
 *  `onConfirm`, while cancellation closes it via `onOpenChange(false)`.
 *
 *  Variant `danger` visually marks destructive confirmations with a red
 *  confirm-button class; `default` is for neutral dialogs. */
export type DialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** Optional description, typically a sentence explaining the consequence
   *  ("This action cannot be undone."). */
  readonly description?: string;
  /** Confirm-button label. Defaults to the i18n value
   *  (`kumiko.dialog.confirm`). */
  readonly confirmLabel?: string;
  /** Cancel-Button-Label. Default `kumiko.dialog.cancel`. */
  readonly cancelLabel?: string;
  /** `default` = Confirm primary, `danger` = Confirm danger. */
  readonly variant?: "default" | "danger";
  /** Which button takes focus on open. Default: Confirm for a bare dialog
   *  (Cancel when `variant` is `danger`), the browser/Radix default when
   *  `children` are present. `"cancel"` for
   *  dialogs where the safe choice must be the one Enter triggers. */
  readonly initialFocus?: "confirm" | "cancel";
  /** Called when the user confirms. Async functions are supported; the dialog
   *  automatically sets a loading state and then calls `onOpenChange(false)`. */
  readonly onConfirm: () => void | Promise<void>;
  /** Optional additional content between the description and buttons, such as
   *  an input when the dialog also collects data. */
  readonly children?: ReactNode;
  readonly testId?: string;
};

/** Bare content shell for hosting an existing self-contained form/widget
 *  (own submit/cancel buttons) inside a modal overlay — unlike `Dialog`,
 *  it renders no footer buttons of its own. Web renders the same
 *  focus-trapped Radix overlay as `Dialog`, just without the button row. */
export type ModalProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Screen-reader-only accessible title (required by the underlying
   *  dialog primitive) — not shown visually since the hosted content
   *  is expected to render its own heading. */
  readonly title: string;
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Side panel for hosting an existing self-contained form/widget (own
 *  submit/cancel buttons) without leaving the underlying screen — e.g. a
 *  toolbar action's `kind: "drawer"` mounts an actionForm here instead of
 *  navigating to a full page. Same "bare content shell, no
 *  footer buttons of its own" contract as `Modal`, slide-in instead of
 *  centered overlay. */
export type DrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: string;
  /** Muted line under the title. */
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly testId?: string;
};

export type LightboxImage = { readonly src: string; readonly alt: string };

type LightboxBaseProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly testId?: string;
  /** Controls for the shown image, e.g. a download button. Rendered in the
   *  top-left corner; with a set the app picks the image from its `index`. */
  readonly actions?: ReactNode;
  /** `false` hides the `{current} / {total}` counter of a set, for images
   *  that carry their own. Default `true`. */
  readonly showPosition?: boolean;
};

/** Image lightbox — full-size preview on click. Web renders Radix overlay;
 *  trigger (thumbnail) and open state live in the app. Takes either one image
 *  (`src`/`alt`) or a browsable set (`images` + controlled `index`);
 *  navigation wraps around at both ends. */
export type LightboxProps = LightboxBaseProps &
  (
    | { readonly src: string; readonly alt: string }
    | {
        readonly images: readonly LightboxImage[];
        readonly index: number;
        readonly onIndexChange: (index: number) => void;
      }
  );

/** Source-badge for one cascade step (User / Tenant / System / …).
 *  Used inline next to a config value to indicate where it came from.
 *  Requires a LocaleProvider above it (labels run through useTranslation)
 *  — createKumikoApp wires one; standalone consumers must wrap. */
export type ConfigSourceBadgeProps = {
  readonly source: ConfigValueSource;
  /** Scope of the hosting screen. Non-system screens collapse sources
   *  ABOVE their scope (system-row/app-override/computed) into the neutral
   *  default badge — operator internals stay invisible to tenants, same
   *  rule as ConfigCascadeView's toDisplayLevels. */
  readonly screenScope?: ConfigScope;
};

/** Cascade view for a config-edit field: one origin line ("Set for this
 *  tenant", "Uses the default", …), a reset action for an own value, and a
 *  disclosure listing every level. Owns its disclosure state. */
export type ConfigCascadeViewProps = {
  readonly cascade: ConfigCascade;
  readonly screenScope: ConfigScope;
  readonly onReset?: (key: string, scope: ConfigScope) => void;
  readonly qualifiedKey?: string;
  /** The key declares `required: true` — a missing value reads "Not set. Required.". */
  readonly required?: boolean;
  /** Display form of a level value (e.g. a select's label instead of its raw
   *  value). Absent = the raw value; a missing value keeps the no-value text. */
  readonly renderValue?: (value: string | number | boolean) => ReactNode;
};

/** Card slots are named content regions, all optional. Adding slots is
 *  additive, so consumers do not need migration. `header` is an escape hatch:
 *  a raw node replaces the default header (`title`/`subtitle`/`headerActions`)
 *  when the convenience slots are insufficient. */
export type CardSlots = {
  readonly header?: ReactNode;
  readonly title?: ReactNode;
  readonly subtitle?: ReactNode;
  /** Free-form block content in its own full-width row below the
   *  title/subtitle/`headerActions` row, within the same header block — for a
   *  host-supplied header (projectionDetail `slots.header`). */
  readonly headerContent?: ReactNode;
  /** Right-aligned header slot, for example a range switcher, filter, or badge. */
  readonly headerActions?: ReactNode;
  /** Footer content, separated by a top border; aligned to the right by default. */
  readonly footer?: ReactNode;
};

/** Card-Options — Verhalten/Optik, ebenfalls additiv erweiterbar. */
export type CardOptions = {
  /** Body-Padding (px-6 py-6). false = randlos (Tabelle/eigene Tiles). Default true. */
  readonly padded?: boolean;
  /** Eckenradius. Default "xl" (= Entity-Card). */
  readonly radius?: "lg" | "xl";
  /** Separates the footer with `border-t` and `bg-muted/30`. Defaults to true. */
  readonly footerBordered?: boolean;
  /** Footer horizontal padding. false = none, so footer content aligns with the card edge. Default true. */
  readonly footerInset?: boolean;
  /** Joins the ancestor fillHeight flex chain — a tabs-mode
   *  relatedList table sizing to the panel instead of the page — instead of
   *  normal document-flow height. Default false. */
  readonly fillHeight?: boolean;
  /** false drops border, background, shadow and radius but keeps padding and
   *  header slots — a panel inside a host surface such as a tab panel. Default true. */
  readonly framed?: boolean;
  /** The card is the whole screen body (secretMint reveal and done phase):
   *  no frame, the shared screen insets and width of form screens, children
   *  stacked with a gap. Without it such a screen sits raw against the
   *  shell edge. Default false. */
  readonly screenBody?: boolean;
};

/** Generic card chrome (border/background/radius/shadow plus
 *  header/body/footer) as a primitive, providing one implementation for all
 *  card surfaces. It is slot- and option-based so the contract can evolve
 *  additively. */
export type CardProps = {
  readonly slots?: CardSlots;
  readonly options?: CardOptions;
  /** Body content in the normal case; header and footer are supplied through
   *  `slots`. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  readonly dataAttributes?: DataAttributes;
};

/** Determinate progress bar (e.g. wizard step progress). `value` is a
 *  0..1 fraction, not a percentage — implementations scale for display.
 *  `tone` controls the fill color; omitted defaults to "default" (backward
 *  compatible with callers predating this field). */
export type ProgressTone = "default" | "success" | "warn" | "danger";

export type ProgressProps = {
  readonly value: number;
  readonly tone?: ProgressTone;
  readonly ariaLabel?: string;
  readonly testId?: string;
};

/** Wizard step overview — numbered chips, one per step label, with the
 *  active step highlighted. With `onStepSelect`, completed steps become
 *  buttons (every non-current step with `selectableSteps: "all"`); the caller
 *  owns the validation gate for forward jumps. Implementations render a
 *  narrow-viewport fallback showing `compactLabel` instead (caller
 *  supplies it pre-translated, e.g. "Step 2 of 5 · Industry"). With
 *  `onStepSelect` and `selectableSteps: "all"` that fallback is a dropdown
 *  listing all steps so narrow viewports can jump too — which of
 *  the two is visible is a responsive layout choice owned by the
 *  implementation, not this contract. */
export type StepBarProps = {
  readonly steps: readonly string[];
  readonly currentIndex: number;
  readonly compactLabel: string;
  readonly onStepSelect?: (index: number) => void;
  /** Explicit done state per step index. Absent: a step is done when its
   *  index is below `currentIndex`. The current step is never done. */
  readonly doneSteps?: readonly boolean[];
  /** "done" (default): only done steps are jump targets. "all": every
   *  non-current step is, when `onStepSelect` is set; the compact label then
   *  becomes a step picker. */
  readonly selectableSteps?: "done" | "all";
  /** "label" (default) swaps the step row for `compactLabel` on narrow
   *  viewports; "steps" keeps the row there too — for short wizards whose
   *  labels fit a phone and whose done steps must stay tappable. */
  readonly narrowLayout?: "label" | "steps";
  /** "vertical" renders a step rail (from `lg`, with `compactLabel` as the
   *  single line below it) instead of the chip row. Default "horizontal". */
  readonly orientation?: "horizontal" | "vertical";
  /** Vertical only: rail heading ("Step 4 of 6") and optional description. */
  readonly heading?: string;
  readonly description?: string;
  /** Vertical only: line under each step label, same order as `steps`. */
  readonly subtitles?: readonly (string | undefined)[];
  /** Vertical only: box under the rail announcing the next step. */
  readonly upNext?: {
    readonly heading: string;
    readonly title: string;
    readonly subtitle?: string;
  };
  readonly testId?: string;
  readonly compactTestId?: string;
};

/** Wraps a single wizard step so it stays mounted but inert while off-
 *  screen — `hidden` visually hides it, and implementations that have a
 *  native constraint-validation concept (web: `<fieldset disabled>`, spec-
 *  guaranteed to also bar descendants from participating) must bar it too,
 *  or a `type="submit"` step-advance button triggers the browser's
 *  full-form check against fields on unvisited, unfocusable steps.
 *  Implementations without that concept can gate
 *  on `hidden` alone. */
export type WizardStepGroupProps = {
  readonly hidden: boolean;
  /** Pads the step content (tab panels sit full-bleed under the tab strip). */
  readonly inset?: boolean;
  readonly children: ReactNode;
};

/** Tab strip for a projectionDetail `layout.mode: "tabs"`. Renders only the
 *  strip, not the content — the caller mounts the active section separately.
 *  Keyboard/ARIA (role=tablist/tab, arrow-key navigation) is the
 *  implementation's job. */
export type TabsProps = {
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    /** Shown dimmed after the label (e.g. an open-items count). Omit for
     *  tabs without a counter. */
    readonly count?: number;
    /** Rendered before the label. */
    readonly icon?: ReactNode;
    /** Small muted text after the label, e.g. "4 Seiten". */
    readonly detail?: string;
  }[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  /** "pill" (default) = count badge, 44px strip. "plain" = count as plain muted number, 40px strip
   *  flush with its content (tabs that switch a reader). "filter" = the plain look inset by 6px with
   *  no gap between tabs (the filter strip of a list pane). */
  readonly appearance?: "pill" | "plain" | "filter";
  readonly testId?: string;
};

export {
  type StatusBadgeOptionTone,
  type StatusTone,
  statusToneForOptionTone,
  statusToneForValue,
} from "./status-tone.ts";

/** Status pill. `value` is the raw column value — tone-mapping is the app's job. */
export type StatusBadgeProps = {
  readonly value: string;
  readonly tone?: StatusBadgeOptionTone;
  readonly testId?: string;
};

/** Structured JSON display (audit payload/metadata, job logs, unsupported
 *  jsonb/embedded field fallback). Takes the raw value, not a pre-stringified
 *  one — the implementation owns `JSON.stringify` (and must not throw on
 *  circular refs / BigInt / other non-serializable input). `indent` mirrors
 *  `JSON.stringify`'s space-count param, default 2. */
export type JsonViewProps = {
  readonly value: unknown;
  readonly indent?: number;
  readonly testId?: string;
};

/** Read-only list of stored files (FileRef ids): name, download link and, for
 *  PDFs, an inline preview. Used for `renderer: { format: "file" }` on a detail field. */
export type FileValueListProps = {
  readonly fileIds: readonly string[];
  /** Starts the inline PDF preview of the newest file open; uploads append, so that is the last id. */
  readonly previewOpenByDefault?: boolean;
  readonly testId?: string;
};

/** Page title area rendered by the app shell's header instead of inside the
 *  screen: `title` replaces the last breadcrumb, `status` sits right after it,
 *  `actions` at the right edge. Renders nothing itself; without a shell slot
 *  (see `usePageHeaderSlotAvailable`) callers keep their previous placement. */
export type PageHeaderProps = {
  readonly title?: string;
  /** Name of the loaded record; shown as an extra breadcrumb before the last one. */
  readonly recordTitle?: string;
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  /** Land in the shell header's overflow menu at phone width. */
  readonly overflowItems?: readonly ActionMenuItemSpec[];
  /** Hide the shell header's breadcrumb while mounted, for a screen that stands in
   *  for the one the route names (a locked screen's fallback). */
  readonly hideBreadcrumb?: boolean;
  /** Label the breadcrumb with this screen (id as in the route) instead of the one
   *  the route names, for a locked screen's fallback. Wins over `hideBreadcrumb`. */
  readonly breadcrumbScreenId?: string;
};

/** One item in an `ActionOverflowMenu` (header/row actions beyond the
 *  primary one collapse into this menu instead of a wall of buttons). */
export type ActionMenuItemSpec = {
  readonly id: string;
  readonly label: string;
  /** Icon name, resolved by the implementation (same names as row actions). */
  readonly icon?: IconKey;
  readonly disabled?: boolean;
  readonly variant?: "default" | "danger";
  readonly testId?: string;
  readonly onSelect: () => void;
};

export type ActionOverflowMenuProps = {
  readonly items: readonly ActionMenuItemSpec[];
  /** aria-label for the three-dots trigger. */
  readonly label: string;
  readonly testId?: string;
};

/** One revealed value on a `secretMint` screen's confirm phase. */
export type SecretRevealValue = {
  readonly label: string;
  readonly value: string;
  readonly copyable: boolean;
  readonly multiline: boolean;
  /** Render `value` as a scannable QR code instead of monospaced text — for
   *  an otpauth://-style enrollment URI. Platforms without a QR-capable
   *  SecretReveal primitive fall back to the monospaced display. */
  readonly qr?: boolean;
};

/** One-time secret reveal — mint-form confirm phase. Renders each value
 *  monospaced (multiline splits it one line per entry, for recovery codes),
 *  with a per-value copy control when `copyable`. */
export type SecretRevealProps = {
  readonly values: readonly SecretRevealValue[];
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly testId?: string;
};

/** Thumb-reach action row for custom screens: pinned to the bottom edge on
 *  narrow viewports (above the device's safe-area inset), inline otherwise.
 *  `children` are the forward actions and share the remaining width; `back`
 *  renders an icon-only back control in front of them. */
export type StickyActionBarProps = {
  readonly children: ReactNode;
  readonly back?: { readonly onBack: () => void; readonly label: string };
  readonly testId?: string;
};

/** Copies `text` to the clipboard; the label flips to `copiedLabel` once
 *  the platform confirmed the write. */
export type CopyButtonProps = {
  readonly text: string;
  readonly label: string;
  readonly copiedLabel: string;
  readonly variant?: "primary" | "secondary";
  /** Layout extras, merged via cn(). */
  readonly className?: string;
  readonly testId?: string;
};

/** Hands `text` to another app. "whatsapp" opens a WhatsApp chat prefilled
 *  with the text (to `phone` when given, otherwise the contact picker);
 *  "system" opens the platform share sheet and renders nothing where the
 *  platform has none. */
export type ShareButtonProps = {
  readonly text: string;
  readonly label: string;
  readonly variant?: "primary" | "secondary";
  /** Layout extras, merged via cn(). */
  readonly className?: string;
  readonly testId?: string;
} & (
  | { readonly target: "whatsapp"; readonly phone?: string }
  | { readonly target: "system"; readonly title?: string; readonly url?: string }
);

export type PromoPanelAction =
  | { readonly label: string; readonly href: string; readonly testId?: string }
  | { readonly label: string; readonly onClick: () => void; readonly testId?: string };

/** Offer surface for upsells (e.g. "create an account"): its own tinted
 *  panel with eyebrow, headline, benefit content and one call to action, so
 *  an offer never reads like an info or error banner. */
export type PromoPanelProps = {
  readonly title: string;
  readonly eyebrow?: string;
  readonly children?: ReactNode;
  readonly action?: PromoPanelAction;
  readonly testId?: string;
};

// ---- Core-Registry (Kumiko-eigene Primitives) ----

export type CorePrimitives = {
  readonly Button: ComponentType<ButtonProps>;
  readonly Banner: ComponentType<BannerProps>;
  readonly Field: ComponentType<FieldProps>;
  readonly Input: ComponentType<InputProps>;
  readonly DataTable: ComponentType<DataTableProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly EmbeddedListInput?: ComponentType<EmbeddedListInputProps>;
  readonly Form: ComponentType<FormProps>;
  readonly Section: ComponentType<SectionProps>;
  readonly Card: ComponentType<CardProps>;
  readonly Grid: ComponentType<GridProps>;
  readonly GridCell: ComponentType<GridCellProps>;
  readonly Text: ComponentType<TextProps>;
  readonly Heading: ComponentType<HeadingProps>;
  readonly Dialog: ComponentType<DialogProps>;
  readonly Modal: ComponentType<ModalProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly Drawer?: ComponentType<DrawerProps>;
  readonly Lightbox: ComponentType<LightboxProps>;
  readonly ConfigSourceBadge: ComponentType<ConfigSourceBadgeProps>;
  readonly ConfigCascadeView: ComponentType<ConfigCascadeViewProps>;
  readonly Link: ComponentType<LinkProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly Progress?: ComponentType<ProgressProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly StepBar?: ComponentType<StepBarProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly WizardStepGroup?: ComponentType<WizardStepGroupProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly Tabs?: ComponentType<TabsProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly StatusBadge?: ComponentType<StatusBadgeProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly Metric?: ComponentType<MetricProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly JsonView?: ComponentType<JsonViewProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly FileValueList?: ComponentType<FileValueListProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly FillContainer?: ComponentType<FillContainerProps>;
  /** Optional — additive rollout, see StickyActionBar. Without it, header
   *  content stays where the screen always rendered it. */
  readonly PageHeader?: ComponentType<PageHeaderProps>;
  /** Optional — additive rollout, see StickyActionBar. */
  readonly MetricBand?: ComponentType<MetricBandProps>;
  /** Optional: without an implementation, callers with >2 header/row
   *  actions fall back to today's all-buttons-inline rendering. */
  readonly ActionOverflowMenu?: ComponentType<ActionOverflowMenuProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly SecretReveal?: ComponentType<SecretRevealProps>;
  /** Optional (unlike the other Core-Primitives) so existing partial
   *  CorePrimitives mocks in tests keep compiling — additive rollout of
   *  a new primitive shouldn't force every test double to grow a stub. */
  readonly StickyActionBar?: ComponentType<StickyActionBarProps>;
  /** Optional — additive rollout, see StickyActionBar. */
  readonly CopyButton?: ComponentType<CopyButtonProps>;
  /** Optional — additive rollout, see StickyActionBar. */
  readonly ShareButton?: ComponentType<ShareButtonProps>;
  /** Optional — additive rollout, see StickyActionBar. */
  readonly PromoPanel?: ComponentType<PromoPanelProps>;
};

/** Extension point for app-owned primitives. Developers extend this
 *  interface through TypeScript module augmentation:
 *
 *    declare module "@cosmicdrift/kumiko-renderer" {
 *      interface AppPrimitives {
 *        Chip: ComponentType<ChipProps>;
 *        Accordion: ComponentType<AccordionProps>;
 *      }
 *    }
 *
 *  After augmentation, the keys appear in `PrimitivesRegistry`,
 *  `createKumikoApp({ primitives: { Chip, Accordion } })`, and
 *  `usePrimitives().Chip` with TypeScript support. Kumiko's own components
 *  use only `CorePrimitives`; app primitives are exclusively for developer
 *  code such as custom screens, shells, and app-owned components. */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface AppPrimitives {}

export type PrimitivesRegistry = CorePrimitives & AppPrimitives;

// ---- Context + Provider + Hook ----

const PrimitivesContext = createContext<PrimitivesRegistry | undefined>(undefined);

export type PrimitivesProviderProps = {
  readonly children: ReactNode;
  readonly value: PrimitivesRegistry;
};

export function PrimitivesProvider({ children, value }: PrimitivesProviderProps): ReactNode {
  return <PrimitivesContext.Provider value={value}>{children}</PrimitivesContext.Provider>;
}

/** Like `usePrimitives`, but `undefined` outside a provider — for components that also render standalone. */
export function useOptionalPrimitives(): PrimitivesRegistry | undefined {
  return useContext(PrimitivesContext);
}

export function usePrimitives(): PrimitivesRegistry {
  const registry = useContext(PrimitivesContext);
  if (registry === undefined) {
    throw new Error(
      "usePrimitives: no <PrimitivesProvider> mounted. Wrap your app in one (createKumikoApp does this for you with defaultPrimitives from @cosmicdrift/kumiko-renderer/web).",
    );
  }
  return registry;
}
