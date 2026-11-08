import type { NavIconKey, SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
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
  /** Shown instead of `text` below the sm breakpoint. */
  readonly narrowText?: string;
  readonly tone?: SelectOptionTone;
  /** Leads the sentence; the sentence then has no bordered box. */
  readonly icon?: NavIconKey;
  readonly testId?: string;
};

/** Grid of image tiles; each tile shows a stored file and its own action buttons underneath. */
export type PhotoGridProps = {
  readonly tiles: readonly {
    readonly id: string;
    /** FileRef id of the image; a tile without one shows a placeholder. */
    readonly imageId?: string;
    readonly caption?: string;
    /** Short text shown as a warn badge on the image's top left. */
    readonly badge?: string;
    /** Moves the tile to the front on a phone (below `sm`); the DOM order stays. */
    readonly leadsOnNarrow?: true;
    readonly actions?: ReactNode;
  }[];
  readonly testId?: string;
};

/** Vertical numbered steps joined by a line; each step has a title, an optional status pill and
 *  a description line. */
export type StepListProps = {
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly status?: string;
    readonly statusTone?: SelectOptionTone;
    readonly description?: string;
  }[];
  readonly testId?: string;
};

/** "Next steps" panel; an item's `reason` sits behind a toggle labelled `reasonLabel`. */
export type RecordStepsProps = {
  readonly title: string;
  readonly subtitle?: string;
  /** Shown instead of the list when there are no items. */
  readonly emptyLabel: string;
  readonly reasonLabel: string;
  /** Below the sm breakpoint only this many steps show; the rest sits behind a toggle. */
  readonly narrowLimit?: number;
  /** Toggle label for the hidden steps; receives their count. */
  readonly moreLabel?: (hiddenCount: number) => string;
  readonly lessLabel?: string;
  /** Label before the further actions of each item. */
  readonly moreActionsLabel?: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    /** Replaces `title` below the sm breakpoint. */
    readonly narrowTitle?: string;
    readonly detail?: string;
    /** Replaces `detail` below the sm breakpoint. */
    readonly narrowDetail?: string;
    readonly tone?: SelectOptionTone;
    readonly reason?: string;
    /** With `reason`: the box stands open from `sm` up. */
    readonly reasonOpen?: true;
    /** Bold lead-in of the reason paragraph. */
    readonly reasonTitle?: string;
    /** Main action: a small button on the title row. */
    readonly actions?: ReactNode;
    /** Further actions as text links on the title row, before the main action; hidden below sm. */
    readonly moreActions?: ReactNode;
  }[];
  /** Total number of steps, shown small beside the heading even when `narrowLimit` shortens the list. */
  readonly count?: number;
  readonly testId?: string;
};
