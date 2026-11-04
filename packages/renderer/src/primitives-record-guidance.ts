import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { CellLink } from "./headless/index.ts";

/** Path above a record header; an item with a `link` is a link, the last item without one names the current record. */
export type RecordBreadcrumbProps = {
  readonly items: readonly { readonly label: string; readonly link?: CellLink }[];
  readonly ariaLabel: string;
  readonly testId?: string;
};

/** One emphasized sentence below a record header; `tone` sets the accent color. */
export type RecordSummaryProps = {
  readonly text: string;
  readonly tone?: SelectOptionTone;
  readonly testId?: string;
};

/** "Next steps" panel; an item's `reason` sits behind a toggle labelled `reasonLabel`. */
export type RecordStepsProps = {
  readonly title: string;
  readonly subtitle?: string;
  /** Shown instead of the list when there are no items. */
  readonly emptyLabel: string;
  readonly reasonLabel: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly detail?: string;
    readonly tone?: SelectOptionTone;
    readonly reason?: string;
    readonly actions?: ReactNode;
  }[];
  readonly testId?: string;
};
