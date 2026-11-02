import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import {
  ContentPreviewsProvider,
  PREVIEW_TARGETS,
  PreviewPane,
  type PreviewRendererProps,
} from "../content-previews.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

// The text fallback shows the substituted content in a read-only textarea.
const textareaInput: ComponentType<InputProps> = (props) =>
  props.kind === "textarea" ? (
    <textarea data-testid="fallback-text" value={props.value} readOnly />
  ) : null;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: passChildren,
  Field: passChildren,
  Input: textareaInput,
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

function WithPrimitives({ children }: { readonly children: ReactNode }): ReactNode {
  return <PrimitivesProvider value={testPrimitives}>{children}</PrimitivesProvider>;
}

const BODY_SUBJECT = { kind: "body" } as const;

function Marker({ content, variables }: PreviewRendererProps): ReactNode {
  return (
    <div data-testid="registered-preview">
      {content}|{JSON.stringify(variables)}
    </div>
  );
}

afterEach(cleanup);

describe("PreviewPane", () => {
  test("mounts the renderer registered for the target with the content and variables", () => {
    render(
      <WithPrimitives>
        <ContentPreviewsProvider value={{ web: Marker }}>
          <PreviewPane
            target="web"
            content="Hello"
            editFormat="plain"
            variables={{ name: "Ada" }}
            subject={BODY_SUBJECT}
          />
        </ContentPreviewsProvider>
      </WithPrimitives>,
    );
    expect(screen.getByTestId("registered-preview").textContent).toBe('Hello|{"name":"Ada"}');
  });

  test("a target without a renderer falls back to the text preview with the variables filled in", () => {
    render(
      <WithPrimitives>
        <ContentPreviewsProvider value={{ web: Marker }}>
          <PreviewPane
            target="pdf"
            content="Dear {{name}}"
            editFormat="plain"
            variables={{ name: "Ada" }}
            subject={BODY_SUBJECT}
          />
        </ContentPreviewsProvider>
      </WithPrimitives>,
    );
    expect(screen.queryByTestId("registered-preview")).toBeNull();
    expect((screen.getByTestId("fallback-text") as HTMLTextAreaElement).value).toBe("Dear Ada");
  });

  test("without any provider every target previews as text", () => {
    for (const target of PREVIEW_TARGETS) {
      const { unmount } = render(
        <WithPrimitives>
          <PreviewPane
            target={target}
            content="Plain words"
            editFormat="plain"
            variables={{}}
            subject={BODY_SUBJECT}
          />
        </WithPrimitives>,
      );
      expect((screen.getByTestId("fallback-text") as HTMLTextAreaElement).value).toBe(
        "Plain words",
      );
      unmount();
    }
  });
});
