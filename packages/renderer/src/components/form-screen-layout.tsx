import type { ReactNode } from "react";
import { type FormWidth, usePrimitives } from "../primitives.tsx";

const FORM_SCREEN_LAYOUT_PROPS = {
  screenForm: true,
  fillHeight: true,
  stickyActions: true,
} as const;

export type FormScreenLayoutProps = {
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly secondaryActions?: ReactNode;
  readonly onSubmit?: () => void;
  readonly width?: FormWidth;
  readonly testId?: string;
};

const NOOP = (): void => {};

/** For custom screens: the standard form screen layout; fill it with `Section` (title, icon, subtitle). */
export function FormScreenLayout({
  children,
  description,
  actions,
  secondaryActions,
  onSubmit = NOOP,
  width,
  testId,
}: FormScreenLayoutProps): ReactNode {
  const { Form } = usePrimitives();
  return (
    <Form
      onSubmit={onSubmit}
      {...FORM_SCREEN_LAYOUT_PROPS}
      {...(description !== undefined && { subtitle: description })}
      {...(actions !== undefined && { actions })}
      {...(secondaryActions !== undefined && { secondaryActions })}
      {...(width !== undefined && { width })}
      {...(testId !== undefined && { testId })}
    >
      {children}
    </Form>
  );
}
