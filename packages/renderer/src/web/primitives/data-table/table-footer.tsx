import type { PointerEvent, ReactNode } from "react";
import { useOptionalTranslation } from "../../../index.ts";
import { TABLE_FOOTER_BAR_CLASS } from "../pager.tsx";

export function DataTableFooter({
  count,
  itemNoun,
  testId,
}: {
  readonly count: number;
  readonly itemNoun?: (count: number) => string;
  readonly testId: string;
}): ReactNode {
  const t = useOptionalTranslation();
  const noun = itemNoun?.(count);
  const label =
    noun !== undefined
      ? (t?.("kumiko.list.count.noun", { count: count.toLocaleString(), noun }) ??
        `${count.toLocaleString()} ${noun}`)
      : count === 1
        ? (t?.("kumiko.list.count.one") ?? "1 entry")
        : (t?.("kumiko.list.count.other", { count: count.toLocaleString() }) ??
          `${count.toLocaleString()} entries`);
  return (
    <div data-testid={testId} className={TABLE_FOOTER_BAR_CLASS}>
      <span data-testid={`${testId}-count`}>{label}</span>
    </div>
  );
}

// Cell content is a ReactNode, so the tooltip text is read from the rendered DOM.
export function showFullTextOnHover(event: PointerEvent<HTMLElement>): void {
  const element = event.currentTarget;
  element.title = element.scrollWidth > element.clientWidth ? (element.textContent ?? "") : "";
}
