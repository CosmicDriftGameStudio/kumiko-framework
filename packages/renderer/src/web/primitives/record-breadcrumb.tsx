import { Fragment, type ReactNode, useContext } from "react";
import { uniqueLabelKeys } from "../../app/unique-label-keys.ts";
import type { RecordBreadcrumbProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { DefaultLink } from "./layout-elements.tsx";
import { InsideScreenFormColumnContext } from "./metric.tsx";

export function DefaultRecordBreadcrumb({
  items,
  ariaLabel,
  testId,
}: RecordBreadcrumbProps): ReactNode {
  const insideScreenFormColumn = useContext(InsideScreenFormColumnContext);
  const keys = uniqueLabelKeys(items.map((item) => item.label));
  return (
    <nav
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 text-[13px] text-muted-foreground",
        !insideScreenFormColumn && "px-6 pt-3.5",
      )}
    >
      {items.map((item, index) => (
        <Fragment key={keys[index]}>
          {index > 0 && <span aria-hidden="true">›</span>}
          {item.link !== undefined ? (
            <DefaultLink
              href={item.link.href}
              onPress={item.link.onPress}
              className="text-foreground-secondary"
            >
              {item.label}
            </DefaultLink>
          ) : (
            <span className="font-medium text-foreground">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
