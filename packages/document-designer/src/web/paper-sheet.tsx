import type { PdfTableStyle } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { cn } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { PageRuler } from "./page-ruler.tsx";
import {
  applyCssVariables,
  type MarginsMm,
  type PaperLook,
  type PaperSize,
  paperVariables,
} from "./paper-geometry.ts";

const RULER_GUTTER_REM = 1;

// Text in the outer columns sits on the text margin; a header background is a visible box whose
// edge is flush instead, so its th keep the padding.
const FLUSH_CELLS_CLASS = "[&_tr>:first-child]:pl-0 [&_tr>:last-child]:pr-0";
const FLUSH_BODY_CELLS_CLASS = "[&_tr>td:first-child]:pl-0 [&_tr>td:last-child]:pr-0";

// Same grey as the PDF table rule (TABLE_LINE in document-pdf-style.ts).
const PRINT_RULE_COLOR_CLASS = "[&_td]:border-[#bbb] [&_th]:border-[#bbb]";

const TABLE_STYLE_CLASS: Readonly<Record<PdfTableStyle, string>> = {
  plain: "[&_td]:border-0 [&_th]:border-0",
  lines: `[&_td]:border-0 [&_th]:border-0 [&_td]:border-b [&_th]:border-b ${PRINT_RULE_COLOR_CLASS}`,
  header: `[&_td]:border-0 [&_th]:border-0 [&_th]:border-b ${PRINT_RULE_COLOR_CLASS}`,
  grid: `[&_td]:border [&_th]:border ${PRINT_RULE_COLOR_CLASS}`,
};

/** The measured container is the outer element; the paper child fills it so cq lengths resolve for it and everything inside. */
export function PaperSheet({
  size,
  margins,
  look,
  testId,
  className,
  children,
}: {
  readonly size: PaperSize;
  readonly margins: MarginsMm;
  readonly look: PaperLook;
  readonly testId: string;
  readonly className?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className="@container w-full max-w-(--paper-outer-max) pt-4 pl-4"
      ref={(element) =>
        applyCssVariables(element, {
          "--paper-outer-max": `calc(${size.widthMm}mm + ${RULER_GUTTER_REM}rem)`,
        })
      }
    >
      <div
        data-testid={testId}
        data-document-paper=""
        data-paper-width-mm={size.widthMm}
        data-paper-margin-left-mm={margins.left}
        data-paper-margin-right-mm={margins.right}
        data-paper-margin-top-mm={margins.top}
        className={cn(
          "relative flex min-h-(--paper-height) w-full flex-col bg-card text-(length:--paper-font-size) text-(color:--paper-text-color) font-(family-name:--paper-font-family) shadow-md [&_th]:bg-(--paper-table-header)",
          TABLE_STYLE_CLASS[look.tableStyle],
          look.tableStyle !== "grid" &&
            (look.tableHeaderBackground === null ? FLUSH_CELLS_CLASS : FLUSH_BODY_CELLS_CLASS),
          className,
        )}
        ref={(element) => applyCssVariables(element, paperVariables({ size, margins, look }))}
      >
        <PageRuler size={size} margins={margins} />
        {children}
      </div>
    </div>
  );
}
