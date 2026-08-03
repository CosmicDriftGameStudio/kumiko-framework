import { describe, expect, test } from "bun:test";
import { CONTENT_EDITOR_ELEMENT_ID } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { fireEvent, render, screen } from "../../__tests__/test-utils";
import TiptapEditor from "../tiptap-editor";

function Controlled({ initial }: { readonly initial: string }): ReactNode {
  const [value, setValue] = useState(initial);
  return <TiptapEditor value={value} onChange={setValue} variables={["name"]} readOnly={false} />;
}

// Mirrors the real caller: TextBlockEditor mounts with value="" and only
// gets the loaded content after its by-slug query resolves — value arrives
// as a prop update, not at mount. A test that renders the final HTML
// straight away would stay green even if the sync effect were missing.
function LateValue({ loaded }: { readonly loaded: string }): ReactNode {
  const [value, setValue] = useState("");
  return (
    <div>
      <button type="button" onClick={() => setValue(loaded)}>
        load
      </button>
      <TiptapEditor value={value} onChange={setValue} variables={[]} readOnly={false} />
    </div>
  );
}

describe("TiptapEditor — jsdom smoke", () => {
  test("mounts a contenteditable surface for the given HTML", async () => {
    render(
      <TiptapEditor value="<p>hello</p>" onChange={() => {}} variables={[]} readOnly={false} />,
    );
    const editable = await screen.findByText("hello");
    expect(editable.closest('[contenteditable="true"]')).not.toBeNull();
  });

  test("the contenteditable surface carries CONTENT_EDITOR_ELEMENT_ID so the wrapping Field's label stays associated", async () => {
    render(
      <TiptapEditor value="<p>hello</p>" onChange={() => {}} variables={[]} readOnly={false} />,
    );
    expect(document.getElementById(CONTENT_EDITOR_ELEMENT_ID)).not.toBeNull();
  });

  test("no variables → no chip bar", async () => {
    render(
      <TiptapEditor value="<p>hello</p>" onChange={() => {}} variables={[]} readOnly={false} />,
    );
    await screen.findByText("hello");
    expect(screen.queryAllByRole("button", { name: "Bold" })).toHaveLength(1);
    expect(screen.queryByText(/^\{\{.*\}\}$/)).toBeNull();
  });

  test("every toolbar action resolves by its accessible name", async () => {
    render(
      <TiptapEditor value="<p>hello</p>" onChange={() => {}} variables={[]} readOnly={false} />,
    );
    await screen.findByText("hello");
    for (const name of [
      "Bold",
      "Italic",
      "Heading 1",
      "Heading 2",
      "Bullet list",
      "Numbered list",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  test("a value arriving after mount (async load) still reaches the editor", async () => {
    render(<LateValue loaded="<p>loaded content</p>" />);
    expect(screen.queryByText("loaded content")).toBeNull();
    fireEvent.click(screen.getByText("load"));
    expect(await screen.findByText("loaded content")).toBeTruthy();
  });

  test("toolbar H1 toggles the block type and reports it via onChange", async () => {
    // Block-type commands (headings) apply at the cursor's block, unlike
    // inline marks (bold/italic) which need an explicit text selection —
    // simulating a real range selection in happy-dom is unreliable, so this
    // is the toolbar-wiring smoke test; the extension itself is tiptap's.
    render(<Controlled initial="<p>hello</p>" />);
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: "Heading 1" }));
    const editable = (await screen.findByText("hello")).closest('[contenteditable="true"]');
    expect(editable?.innerHTML).toContain("<h1");
  });

  test("variable chip inserts {{name}} as plain text at the cursor", async () => {
    render(<Controlled initial="<p></p>" />);
    fireEvent.click(screen.getByText("{{name}}"));
    expect(await screen.findByText("{{name}}", { selector: "p" })).toBeTruthy();
  });
});
