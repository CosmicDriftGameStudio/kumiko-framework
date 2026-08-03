import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives";
import { type ContentEditorProps, ContentEditorsProvider } from "../content-editors";
import { ContentPreview, substituteVariables } from "../content-preview";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const captureInput: ComponentType<InputProps> = (props) => {
  if (props.kind !== "textarea") return null;
  return (
    <textarea data-testid="cp-textarea" value={props.value} disabled={props.disabled} readOnly />
  );
};

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: captureInput,
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
  return <PrimitivesProvider value={testPrimitives}>{children}</PrimitivesProvider>;
}

describe("substituteVariables", () => {
  test("replaces every {{name}} with its example value", () => {
    expect(
      substituteVariables("Hi {{customerName}}, order {{orderId}} shipped.", {
        customerName: "Max Mustermann",
        orderId: "A-1042",
      }),
    ).toBe("Hi Max Mustermann, order A-1042 shipped.");
  });

  test("a name with no example value stays as the literal placeholder", () => {
    expect(substituteVariables("Hi {{customerName}}", {})).toBe("Hi {{customerName}}");
  });

  test("no variables in the content → content passes through unchanged", () => {
    expect(substituteVariables("Just plain text.", { customerName: "Max" })).toBe(
      "Just plain text.",
    );
  });
});

describe("ContentPreview", () => {
  test("renders the format's registered editor read-only, with variables substituted", () => {
    function RichEditor({ value, readOnly }: ContentEditorProps): ReactNode {
      return (
        <div data-testid="cp-rich" data-readonly={readOnly}>
          {value}
        </div>
      );
    }

    render(
      <ContentEditorsProvider value={{ rich: RichEditor }}>
        <ContentPreview
          content="Hallo {{customerName}}"
          variables={{ customerName: "Max Mustermann" }}
          contentFormat="rich"
        />
      </ContentEditorsProvider>,
      { wrapper: Wrapper },
    );

    const el = screen.getByTestId("cp-rich");
    expect(el.textContent).toBe("Hallo Max Mustermann");
    expect(el.dataset["readonly"]).toBe("true");
  });

  test("no editor registered for the format → falls back to the textarea, still substituted", () => {
    render(
      <ContentPreview
        content="Hi {{orderId}}"
        variables={{ orderId: "A-1042" }}
        contentFormat="plain"
      />,
      { wrapper: Wrapper },
    );

    const el = screen.getByTestId("cp-textarea") as HTMLTextAreaElement;
    expect(el.value).toBe("Hi A-1042");
    expect(el.disabled).toBe(true);
  });

  test("rich format: an example value with markup characters is escaped, not injected as HTML", () => {
    function RichEditor({ value }: ContentEditorProps): ReactNode {
      // biome-ignore lint/security/noDangerouslySetInnerHtml: proves the substituted value is escaped, not injected — the whole point of this test.
      return <div data-testid="cp-rich" dangerouslySetInnerHTML={{ __html: value }} />;
    }

    render(
      <ContentEditorsProvider value={{ rich: RichEditor }}>
        <ContentPreview
          content="Preis: {{price}}"
          variables={{ price: "<b>0</b> & up" }}
          contentFormat="rich"
        />
      </ContentEditorsProvider>,
      { wrapper: Wrapper },
    );

    const el = screen.getByTestId("cp-rich");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe("Preis: <b>0</b> & up");
  });

  test("plain format: an example value with markup characters passes through unescaped", () => {
    render(
      <ContentPreview
        content="Preis: {{price}}"
        variables={{ price: "<b>0</b>" }}
        contentFormat="plain"
      />,
      { wrapper: Wrapper },
    );

    const el = screen.getByTestId("cp-textarea") as HTMLTextAreaElement;
    expect(el.value).toBe("Preis: <b>0</b>");
  });
});
