import type { StickyActionBarProps } from "@cosmicdrift/kumiko-renderer";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button as UiButton } from "../ui/button";

// env(safe-area-inset-bottom) is 0 unless the page's viewport meta sets
// viewport-fit=cover; with it, the home indicator would otherwise cover the bar.
export const STICKY_FOOTER_SAFE_AREA_CLASS = "max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]";

// Keeps the last content row reachable above the fixed bar (one 44px button
// row plus the bar's own padding), grown by the same safe-area inset.
export const STICKY_FOOTER_SPACER_CLASS = "max-sm:pb-[calc(6rem_+_env(safe-area-inset-bottom))]";

export function StickyActionBar({ children, back, testId }: StickyActionBarProps): ReactNode {
  return (
    <>
      <div aria-hidden="true" className={cn("sm:hidden", STICKY_FOOTER_SPACER_CLASS)} />
      <div
        data-testid={testId}
        className={cn(
          "flex items-center gap-3",
          "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:border-t max-sm:border-border max-sm:bg-background max-sm:px-4 max-sm:pt-3",
          STICKY_FOOTER_SAFE_AREA_CLASS,
        )}
      >
        {back !== undefined && (
          <UiButton
            type="button"
            variant="outline"
            size="icon"
            aria-label={back.label}
            onClick={back.onBack}
            data-testid={testId !== undefined ? `${testId}-back` : undefined}
            className="size-13 shrink-0 rounded-full"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </UiButton>
        )}
        <div className="flex min-w-0 flex-1 gap-2 [&>*]:min-h-13 [&>*]:flex-1">{children}</div>
      </div>
    </>
  );
}
