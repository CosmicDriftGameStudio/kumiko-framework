import { createContext, type ReactNode, useContext, useId, useState } from "react";
import type { ListColumnHintViewModel } from "../../headless/index.ts";
import { ReasonBox } from "./reason-box.tsx";
import { useIsBelowSmViewport } from "./use-narrow-viewport.ts";

export type HintReasonRowControl = {
  readonly hint: ListColumnHintViewModel;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly boxId: string;
};

const HintReasonRowContext = createContext<HintReasonRowControl | undefined>(undefined);

/**
 * Set when the row of `hint` owns the reason state, because it draws the box as a row of its own.
 * The match is by object identity: the scope and the cell must both take `hint` from the same
 * `m.columns` entry, so a copy such as `cardHint` deliberately does not match.
 */
export function useHintReasonRowControl(
  hint: ListColumnHintViewModel,
): HintReasonRowControl | undefined {
  const control = useContext(HintReasonRowContext);
  return control?.hint === hint ? control : undefined;
}

export function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export type HintReason = { readonly text: string; readonly title: string | undefined };

export function hintReasonOf(
  hint: ListColumnHintViewModel,
  row: Readonly<Record<string, unknown>>,
): HintReason | undefined {
  const text = hint.reasonField === undefined ? undefined : nonEmptyText(row[hint.reasonField]);
  if (text === undefined) return undefined;
  const title =
    hint.reasonTitleField === undefined ? undefined : nonEmptyText(row[hint.reasonTitleField]);
  return { text, title };
}

export function isReasonOpenByDefault(
  hint: ListColumnHintViewModel,
  row: Readonly<Record<string, unknown>>,
): boolean {
  return hint.reasonOpenField !== undefined && row[hint.reasonOpenField] === true;
}

/**
 * Keeps the open state of a row's reason and draws the box as a row below the row, over its full
 * width. Without a `hint` it only renders its children, so the row does not remount when a reason
 * appears or disappears. The default-open state counts at the first render only, and not below sm.
 */
export function HintReasonRowScope({
  hint,
  row,
  renderBoxRow,
  children,
}: {
  readonly hint: ListColumnHintViewModel | undefined;
  readonly row: Readonly<Record<string, unknown>>;
  readonly renderBoxRow: (box: ReactNode) => ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const belowSm = useIsBelowSmViewport();
  const boxId = useId();
  const [open, setOpen] = useState(
    () => hint !== undefined && !belowSm && isReasonOpenByDefault(hint, row),
  );
  const reason = hint === undefined ? undefined : hintReasonOf(hint, row);
  const control: HintReasonRowControl | undefined =
    hint === undefined ? undefined : { hint, open, onToggle: () => setOpen((was) => !was), boxId };
  return (
    <HintReasonRowContext.Provider value={control}>
      {children}
      {open &&
        reason !== undefined &&
        renderBoxRow(
          <ReasonBox
            id={boxId}
            data-hint-reason="true"
            {...(reason.title !== undefined && { title: reason.title })}
          >
            {reason.text}
          </ReasonBox>,
        )}
    </HintReasonRowContext.Provider>
  );
}
