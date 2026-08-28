// Delegates keyboard nav + ARIA (role=tablist/tab) to Radix instead of hand-rolling it.

import type { TabsProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export function DefaultTabs({ items, activeId, onSelect, testId }: TabsProps): ReactNode {
  return (
    <Tabs value={activeId} onValueChange={onSelect} data-testid={testId}>
      <TabsList variant="line">
        {items.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            data-testid={testId !== undefined ? `${testId}-${item.id}` : undefined}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
