import type { SelectOptionTone } from "./fields.ts";
import type { RowAction } from "./screen-entity-list.ts";

// Guidance blocks of a projectionDetail screen. `field` names a column of the
// query row; the column holds the wire shape documented per block.

export type RecordBreadcrumbItem = {
  readonly label: string;
  /** With `id`, the item links to that record's detail screen when the user may open it. */
  readonly entity?: string;
  readonly id?: string;
};

/**
 * A banner or step action. `hideIcon` keeps the icon out of the drawn button (text only); it
 * stays registered for the `screen/action-icon` rule and for icon-only or menu renderings.
 */
export type RecordGuidanceAction = RowAction & {
  readonly hideIcon?: true;
  /** i18n key shown as the button label below `sm` (a shorter word, e.g. "Plan" for "Plan handover"). */
  readonly narrowLabel?: string;
};

export type RecordNotice = {
  readonly title: string;
  readonly text?: string;
  /** Shown instead of `title` below `sm`. */
  readonly narrowTitle?: string;
  /** Shown instead of `text` below `sm`. */
  readonly narrowText?: string;
  readonly tone?: SelectOptionTone;
  // Extra row fields feed the banner actions' show/enabled predicates only; they are never rendered.
  readonly [field: string]: unknown;
};

export type RecordStep = {
  readonly id: string;
  readonly title: string;
  /** Shown instead of `title` below `sm`. */
  readonly narrowTitle?: string;
  readonly detail?: string;
  /** Shown instead of `detail` below `sm`. */
  readonly narrowDetail?: string;
  readonly tone?: SelectOptionTone;
  /** Explanation behind a toggle next to the step. */
  readonly why?: string;
  /** With `why`: the explanation stands open as a box under the step from `sm` up; the toggle closes it. */
  readonly whyOpen?: true;
  /** Bold lead-in of the `why` paragraph. */
  readonly whyTitle?: string;
  // Extra row fields feed the step actions' show/enabled predicates only; they are never rendered.
  readonly [field: string]: unknown;
};

/** Path above the header; `field` holds `RecordBreadcrumbItem[]`. */
export type RecordBreadcrumbSpec = { readonly field: string };

/** One emphasized sentence below the header; `field` holds a string. */
export type RecordSummarySpec = {
  readonly field: string;
  /** Row field holding a SelectOptionTone for the sentence's accent. */
  readonly toneField?: string;
  /** Row field with a shorter sentence shown instead of `field` below `sm`. */
  readonly narrowField?: string;
};

export type RecordBannerSpec = {
  /** Holds `RecordNotice | null`; null shows no banner. */
  readonly field: string;
  readonly actions?: readonly RecordGuidanceAction[];
};

export type RecordStepsSpec = {
  /** Holds `RecordStep[]`. */
  readonly field: string;
  /** i18n key, default `kumiko.detail.steps.title`. */
  readonly title?: string;
  /** Record field with a plain-text subtitle. */
  readonly subtitleField?: string;
  /** i18n key for an empty list, default `kumiko.detail.steps.empty`. */
  readonly emptyLabel?: string;
  /** Below `sm` only the first n steps show; the rest sits behind a "k more steps" toggle. */
  readonly narrowLimit?: number;
  /** Plural base key for the toggle of the hidden rest: define `<key>.one` and `<key>.other` (the latter with `{count}`). Default `kumiko.detail.steps.more`. */
  readonly narrowMoreLabel?: string;
  readonly actions?: readonly RecordGuidanceAction[];
};

export type RecordProgressStep = {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  readonly detail?: string;
};

/** A process chain the record is part of. `currentIndex` points at the first open step. */
export type RecordProgress = {
  readonly title: string;
  readonly steps: readonly RecordProgressStep[];
  readonly currentIndex: number;
};

export type RecordProgressSpec = {
  /** Holds `RecordProgress[]`; an empty array shows no block. */
  readonly field: string;
  /** "beside-steps": the chains sit as a vertical stage list in a 4/12 column next to the steps panel (8/12) from lg, stacked below it under lg. Needs `steps`; without it the chains keep their own row. */
  readonly placement?: "beside-steps";
  /** Leaves the chains out below `sm`. */
  readonly hideOnNarrow?: true;
};
