// Delegates keyboard nav + ARIA (role=tablist/tab) to Radix instead of hand-rolling it.

import type { TabsProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export function DefaultTabs({ items, activeId, onSelect, testId }: TabsProps): ReactNode {
  // Own horizontal-scroll container: a tab strip wider than the
  // viewport scrolls in itself instead of widening the page — `min-w-0` lets
  // the flex child actually shrink below its content width so overflow-x-auto
  // can kick in instead of being ignored inside a flex row.
  return (
    <Tabs value={activeId} onValueChange={onSelect} data-testid={testId} className="min-w-0">
      <div className="min-w-0 overflow-x-auto">
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
