// Layout-Primitives für Custom-Screens: ein Ort für vertikale Abstände und
// Screen-Padding, damit Consumer nicht `flex flex-col gap-*` / `p-6` per Hand
// streuen. Bewusst dünn — kein generisches Box-mit-20-props-System.

import type { ReactNode } from "react";
import { cn } from "../lib/cn";

const STACK_GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6" } as const;

type StackGap = keyof typeof STACK_GAP;

type StackProps = {
  readonly gap?: StackGap;
  readonly className?: string;
  readonly children?: ReactNode;
  readonly testId?: string;
};

export function Stack({ gap = "md", className, children, testId }: StackProps): ReactNode {
  return (
    <div data-testid={testId} className={cn("flex flex-col", STACK_GAP[gap], className)}>
      {children}
    </div>
  );
}

type PageSectionProps = {
  readonly className?: string;
  readonly children?: ReactNode;
  readonly testId?: string;
};

export function PageSection({ className, children, testId }: PageSectionProps): ReactNode {
  return (
    <div data-testid={testId} className={cn("p-6", className)}>
      {children}
    </div>
  );
}
