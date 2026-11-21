// A "document" field without a registered document editor falls back to a textarea but keeps an HTML value.

import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import { createStubPrimitives } from "../../testing.ts";
import { DocumentFieldEditor } from "../document-field-editor.tsx";

const Textarea: ComponentType<InputProps> = (props) =>
  props.kind === "textarea" ? (
    <textarea
      data-testid="fallback"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ) : null;

const primitives = createStubPrimitives({ Input: Textarea });

function Harness({
  initial,
  seen,
}: {
  readonly initial: string;
  readonly seen: unknown[];
}): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <PrimitivesProvider value={primitives}>
      <DocumentFieldEditor
        id="body"
        value={value}
        readOnly={false}
        onChange={(next) => {
          seen.push(next);
          setValue(String(next));
        }}
      />
    </PrimitivesProvider>
  );
}

function textarea(): HTMLTextAreaElement {
  const element = screen.getByTestId("fallback");
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("expected a textarea");
  return element;
}

describe("DocumentFieldEditor without a registered document editor", () => {
  test("shows the HTML value as plain text", () => {
    render(<Harness initial={"<p>Dear &lt;you&gt;,</p><p>a<br>b</p>"} seen={[]} />);
    expect(textarea().value).toBe("Dear <you>,\n\na\nb");
  });

  test("typed text is reported as escaped HTML paragraphs and keeps a trailing blank", () => {
    const seen: unknown[] = [];
    render(<Harness initial="" seen={seen} />);
    fireEvent.change(textarea(), { target: { value: "a < b " } });
    expect(seen).toEqual(["<p>a &lt; b</p>"]);
    expect(textarea().value).toBe("a < b ");
  });

  test("clearing the text reports an empty string", () => {
    const seen: unknown[] = [];
    render(<Harness initial="<p>x</p>" seen={seen} />);
    fireEvent.change(textarea(), { target: { value: "" } });
    expect(seen).toEqual([""]);
  });
});
