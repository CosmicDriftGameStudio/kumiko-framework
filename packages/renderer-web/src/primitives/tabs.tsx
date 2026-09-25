// Delegates keyboard nav + ARIA (role=tablist/tab) to Radix instead of hand-rolling it.

import type { TabsProps } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

// A single fade-width both edges share — mask-image needs the same offset
// on each side or the gradient reads as lopsided.
const EDGE_FADE_PX = 24;

function edgeFadeMaskImage(start: boolean, end: boolean): string | undefined {
  if (start && end) {
    return `linear-gradient(to right, transparent, black ${EDGE_FADE_PX}px, black calc(100% - ${EDGE_FADE_PX}px), transparent)`;
  }
  if (start) return `linear-gradient(to right, transparent, black ${EDGE_FADE_PX}px)`;
  if (end) return `linear-gradient(to left, transparent, black ${EDGE_FADE_PX}px)`;
  return undefined;
}

export function DefaultTabs({ items, activeId, onSelect, testId }: TabsProps): ReactNode {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Two primitive booleans instead of one object: setState with a fresh
  // object on every measurement would always change reference and force
  // another render — with the unconditional-per-render effect below that
  // would loop forever. Primitive setState lets React bail out once the
  // value stops changing.
  const [scrollStart, setScrollStart] = useState(false);
  const [scrollEnd, setScrollEnd] = useState(false);

  const updateScrollEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (el === null) {
      setScrollStart(false);
      setScrollEnd(false);
      return;
    }
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    // 1px slack absorbs sub-pixel layout rounding that would otherwise leave
    // a fade permanently on for a strip that doesn't visually overflow.
    setScrollStart(el.scrollLeft > 1);
    setScrollEnd(el.scrollLeft < maxScrollLeft - 1);
  }, []);

  // Gated on [activeId] instead of running unconditionally: an unconditional
  // effect also re-ran this on every render, including the render triggered
  // by the scroll listener's own setScrollStart/End below — so scrolling the
  // strip by hand immediately snapped it back to the active tab, making it
  // impossible to reach any other tab by scrolling (fw#follow-up). Only a
  // mount or an actual activeId change should force the active tab back
  // into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId is the intended re-run trigger even though the DOM query below doesn't reference it directly; updateScrollEdges is a stable useCallback([]) ref and doesn't need to be listed.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    // Radix marks the active trigger via aria-selected — reading it back
    // through the DOM avoids threading a ref through the vendored
    // TabsTrigger wrapper for every item.
    const trigger = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (trigger !== null) {
      const triggerStart = trigger.offsetLeft;
      const triggerEnd = triggerStart + trigger.offsetWidth;
      // scrollIntoView would also scroll the page vertically to reveal the
      // trigger — setting scrollLeft directly touches only this strip.
      if (triggerStart < el.scrollLeft) {
        el.scrollLeft = triggerStart;
      } else if (triggerEnd > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = triggerEnd - el.clientWidth;
      }
    }
    updateScrollEdges();
  }, [activeId]);

  // Edge-fade measurement stays independent of activeId: a changing item
  // count can change scrollWidth without activeId changing (e.g. a count
  // badge finishing a load), and this must not fight the scroll-to-active
  // effect above by re-running on every scroll-driven render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length is the intended re-run trigger even though the effect body doesn't reference it directly.
  useLayoutEffect(() => {
    updateScrollEdges();
  }, [items.length, updateScrollEdges]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    el.addEventListener("scroll", updateScrollEdges, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => el.removeEventListener("scroll", updateScrollEdges);
    }
    // Observes both the scroller and the list: a growing TabsList (e.g. a
    // count badge finishing a load) can change scrollWidth without the
    // scroller's own box ever resizing.
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(el);
    const list = el.firstElementChild;
    if (list !== null) observer.observe(list);
    return () => {
      el.removeEventListener("scroll", updateScrollEdges);
      observer.disconnect();
    };
  }, [updateScrollEdges]);

  const maskImage = edgeFadeMaskImage(scrollStart, scrollEnd);

  return (
    <Tabs value={activeId} onValueChange={onSelect} data-testid={testId} className="min-w-0">
      <div
        ref={scrollerRef}
        data-scroll-start={scrollStart ? "" : undefined}
        data-scroll-end={scrollEnd ? "" : undefined}
        className="relative min-w-0 overflow-x-auto"
        style={maskImage !== undefined ? { maskImage, WebkitMaskImage: maskImage } : undefined}
      >
        <TabsList variant="line">
          {items.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              data-testid={testId !== undefined ? `${testId}-${item.id}` : undefined}
            >
              {item.label}
              {item.count !== undefined && (
                <span
                  className="ml-1.5 text-muted-foreground"
                  data-testid={testId !== undefined ? `${testId}-${item.id}-count` : undefined}
                >
                  {item.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
