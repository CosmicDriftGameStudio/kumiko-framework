import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import { type ContentEditorProps, ContentEditorsProvider } from "../content-editors.tsx";
import { ContentPreview, substituteVariables } from "../content-preview.tsx";

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
    expect(substituteVariables("Hi {{constructor}}", {})).toBe("Hi {{constructor}}");
  });

  test("no variables in the content → content passes through unchanged", () => {
    expect(substituteVariables("Just plain text.", { customerName: "Max" })).toBe(
      "Just plain text.",
    );
  });
});

describe("ContentPreview", () => {
  test("renders the format's registered editor read-only, with variables substituted", () => {
    function PlainEditor({ value, readOnly }: ContentEditorProps): ReactNode {
      return (
        <div data-testid="cp-plain" data-readonly={readOnly}>
          {value}
        </div>
      );
    }

    render(
      <ContentEditorsProvider value={{ plain: PlainEditor }}>
        <ContentPreview
          content="Hallo {{customerName}}"
          variables={{ customerName: "Max Mustermann" }}
          contentFormat="plain"
        />
      </ContentEditorsProvider>,
      { wrapper: Wrapper },
    );

    const el = screen.getByTestId("cp-plain");
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
    expect(el.readOnly).toBe(true);
    expect(el.disabled).toBe(false);
  });

  test("document format passes the content to the editor without substituting placeholders", () => {
    function DocumentEditor({ value }: ContentEditorProps): ReactNode {
      return <div data-testid="cp-document">{value}</div>;
    }
    const body = '<a data-button="" href="{{url}}">Go</a><span data-variable="name"></span>';

    render(
      <ContentEditorsProvider value={{ document: DocumentEditor }}>
        <ContentPreview
          content={body}
          variables={{ url: "https://x.test" }}
          contentFormat="document"
        />
      </ContentEditorsProvider>,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("cp-document").textContent).toBe(body);
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
