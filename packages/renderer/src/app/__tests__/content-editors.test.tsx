import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives";
import {
  CONTENT_EDITOR_ELEMENT_ID,
  type ContentEditorProps,
  ContentEditorsProvider,
  TextareaContentEditor,
  useContentEditor,
} from "../content-editors";

const captureInput: ComponentType<InputProps> = (props) => {
  if (props.kind !== "textarea") return null;
  return (
    <textarea
      data-testid="ca-textarea"
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      readOnly
    />
  );
};

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

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

function RichEditor({ value }: ContentEditorProps): ReactNode {
  return <div data-testid="ca-rich">{value}</div>;
}

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return <PrimitivesProvider value={testPrimitives}>{children}</PrimitivesProvider>;
}

function Probe({ contentFormat }: { readonly contentFormat?: string }): ReactNode {
  const Editor = useContentEditor(contentFormat);
  return <Editor value="hello" onChange={() => {}} variables={[]} readOnly={false} />;
}

describe("useContentEditor", () => {
  test("no editor registered for the format → falls back to the textarea", () => {
    render(<Probe contentFormat="plain" />, { wrapper: Wrapper });
    expect(screen.getByTestId("ca-textarea")).toBeTruthy();
    expect(screen.getByTestId("ca-textarea").id).toBe(CONTENT_EDITOR_ELEMENT_ID);
  });

  test("undefined contentFormat behaves like plain", () => {
    render(<Probe />, { wrapper: Wrapper });
    expect(screen.getByTestId("ca-textarea")).toBeTruthy();
  });

  test("an app-registered editor for the format wins over the textarea fallback", () => {
    render(
      <ContentEditorsProvider value={{ rich: RichEditor }}>
        <Probe contentFormat="rich" />
      </ContentEditorsProvider>,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId("ca-rich").textContent).toBe("hello");
    expect(screen.queryByTestId("ca-textarea")).toBeNull();
  });

  test("a registered editor only applies to its own format — other formats stay on the fallback", () => {
    render(
      <ContentEditorsProvider value={{ rich: RichEditor }}>
        <Probe contentFormat="plain" />
      </ContentEditorsProvider>,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId("ca-textarea")).toBeTruthy();
    expect(screen.queryByTestId("ca-rich")).toBeNull();
  });
});

describe("TextareaContentEditor", () => {
  test("passes value + disabled=readOnly through to the primitives Input", () => {
    render(
      <TextareaContentEditor value="draft" onChange={() => {}} variables={[]} readOnly={true} />,
      { wrapper: Wrapper },
    );
    const el = screen.getByTestId("ca-textarea") as HTMLTextAreaElement;
    expect(el.value).toBe("draft");
    expect(el.disabled).toBe(true);
  });
});
