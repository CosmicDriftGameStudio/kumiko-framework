import { describe, expect, test } from "bun:test";
import { type ReactNode, useState } from "react";
import { fireEvent, render, screen } from "../../__tests__/test-utils";
import { PlainContentEditor } from "../plain-content-editor";

function Controlled({ initial }: { readonly initial: string }): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <PlainContentEditor value={value} onChange={setValue} variables={["name"]} readOnly={false} />
  );
}

describe("PlainContentEditor", () => {
  test("renders the textarea plus one chip per variable", () => {
    render(
      <PlainContentEditor value="" onChange={() => {}} variables={["name"]} readOnly={false} />,
    );
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByText("{{name}}")).toBeTruthy();
  });

  test("no variables → no chip bar", () => {
    render(<PlainContentEditor value="" onChange={() => {}} variables={[]} readOnly={false} />);
    expect(screen.queryByTestId("variable-chips")).toBeNull();
  });

  test("chip click inserts the placeholder at the caret, not appended", () => {
    render(<Controlled initial="Hello  world" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // Caret between the two spaces (index 6), so the insert must land there —
    // an append-only implementation would put it at the string's end instead.
    textarea.setSelectionRange(6, 6);
    fireEvent.click(screen.getByText("{{name}}"));
    expect(textarea.value).toBe("Hello {{name}} world");
  });

  test("chip click replaces a selection instead of inserting alongside it", () => {
    render(<Controlled initial="Hello world" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 11); // selects "world"
    fireEvent.click(screen.getByText("{{name}}"));
    expect(textarea.value).toBe("Hello {{name}}");
  });
});
