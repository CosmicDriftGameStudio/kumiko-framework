import { type ReactNode, useContext } from "react";
import { cn } from "../lib/cn.js";
import { HeaderOverflowMenuContext } from "./header-overflow-menu.js";

export type HeaderActionGroupProps = {
  readonly children: ReactNode;
  readonly className?: string;
};

export function HeaderActionGroup({ children, className }: HeaderActionGroupProps): ReactNode {
  const inOverflowMenu = useContext(HeaderOverflowMenuContext);
  return (
    <div
      className={cn(
        inOverflowMenu ? "flex flex-col items-stretch gap-1" : "flex items-center gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
