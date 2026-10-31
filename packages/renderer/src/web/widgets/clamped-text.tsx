import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";

const DEFAULT_CLAMP_LINES = 16;

/** Clamps content to `lines`; the toggle shows only while the content actually overflows. */
export function ClampedText({
  children,
  lines = DEFAULT_CLAMP_LINES,
  moreLabelKey = "kumiko.widget.message-thread.showMore",
  testId,
}: {
  readonly children: ReactNode;
  readonly lines?: number;
  /** Translation key of the toggle while the content is clamped. */
  readonly moreLabelKey?: string;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Expanded content never overflows its own box, so only the clamped state is measured.
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (element === null || expanded) return undefined;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div data-testid={testId} className="flex flex-col items-start gap-1">
      <div
        ref={contentRef}
        className="w-full"
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
                overflow: "hidden",
              }
        }
      >
        {children}
      </div>
      {(overflows || expanded) && (
        <Button
          variant="link"
          size="sm"
          expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {t(expanded ? "kumiko.widget.message-thread.showLess" : moreLabelKey)}
        </Button>
      )}
    </div>
  );
}
