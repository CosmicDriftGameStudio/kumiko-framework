import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type ButtonProps, type CorePrimitives, PrimitivesProvider } from "../../primitives";
import { VariableChips } from "../variable-chips";

const captureButton: ComponentType<ButtonProps> = ({ children, onClick, ariaLabel, disabled }) => (
  <button type="button" aria-label={ariaLabel} onClick={() => void onClick?.()} disabled={disabled}>
    {children}
  </button>
);

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: captureButton,
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: passChildren,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
      <PrimitivesProvider value={testPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("VariableChips", () => {
  test("renders no chips when there are no variables", () => {
    render(<VariableChips variables={[]} onInsert={() => {}} />, { wrapper: Wrapper });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("renders one chip per variable and reports a click by name", () => {
    const inserted: string[] = [];
    render(
      <VariableChips
        variables={["customerName", "orderId"]}
        onInsert={(name) => inserted.push(name)}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByText("{{orderId}}"));
    expect(inserted).toEqual(["orderId"]);
  });

  test("disabled propagates to every chip", () => {
    render(<VariableChips variables={["a"]} onInsert={() => {}} disabled />, { wrapper: Wrapper });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
