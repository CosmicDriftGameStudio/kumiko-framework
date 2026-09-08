// Layout primitives for custom screens: one place for vertical spacing and
// screen padding, so consumers don't hand-roll `flex flex-col gap-*` / `p-6`.
// Deliberately thin — not a generic box-with-20-props system.

import type { FormWidth } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type ScreenWidth = FormWidth;

// Shared 3xl/4xl/full → max-w-*/mx-auto map. FormScreenShell
// (primitives/index.tsx) reuses this instead of keeping its own copy —
// same width tokens must render the same class everywhere (fw#2640).
export const screenWidthClassName: Record<ScreenWidth, string> = {
  "3xl": "max-w-3xl mx-auto",
  "4xl": "max-w-4xl mx-auto",
  full: "max-w-full",
};

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
  readonly maxWidth?: ScreenWidth;
};

export function PageSection({
  className,
  children,
  testId,
  maxWidth = "full",
}: PageSectionProps): ReactNode {
  return (
    <div data-testid={testId} className={cn("p-6", screenWidthClassName[maxWidth], className)}>
      {children}
    </div>
  );
}
