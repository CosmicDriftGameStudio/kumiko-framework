import type { ReactNode } from "react";
import type { FormSectionNavItem } from "../../primitives.tsx";
import { cn } from "../lib/cn.ts";
import { FormSectionNav } from "../primitives/form.tsx";
import { screenFormColumnWidthClassName } from "../primitives/layout.tsx";

export type SectionNavLayoutProps = {
  /** One entry per section; `id` must equal the DOM `id` of the section element in `children`. */
  readonly items: readonly FormSectionNavItem[];
  readonly children: ReactNode;
  /** Content column width, default "4xl". */
  readonly width?: keyof typeof screenFormColumnWidthClassName;
  readonly testId?: string;
};

/** Content column plus an "On this page" navigation in a right column (from xl), for custom
 *  screens. The same navigation the screen forms use; the active entry follows the scroll position. */
export function SectionNavLayout({
  items,
  children,
  width = "4xl",
  testId,
}: SectionNavLayoutProps): ReactNode {
  return (
    <div data-testid={testId} className="flex gap-18">
      <div
        className={cn("flex w-full min-w-0 flex-col gap-9", screenFormColumnWidthClassName[width])}
      >
        {children}
      </div>
      {items.length > 0 && <FormSectionNav items={items} />}
    </div>
  );
}
