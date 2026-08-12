import { describe, expect, test } from "bun:test";
import { CONTENT_EDITOR_ELEMENT_ID } from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "../../__tests__/test-utils";
import { RichContentEditor } from "../rich-content-editor";

describe("RichContentEditor", () => {
  test("falls back to the plain textarea while the tiptap chunk loads, then swaps in the editor", async () => {
    render(
      <RichContentEditor
        id={CONTENT_EDITOR_ELEMENT_ID}
        value="<p>hello</p>"
        onChange={() => {}}
        variables={[]}
        readOnly={false}
      />,
    );
    // The textarea id proves #1794's "never an empty panel" fallback is the
    // Suspense boundary — a null fallback would leave nothing to find here.
    // TiptapEditor puts the same id on its contenteditable, so asserting
    // presence alone wouldn't distinguish the two; assert the tag instead.
    expect(document.getElementById(CONTENT_EDITOR_ELEMENT_ID)?.tagName).toBe("TEXTAREA");
    const editable = await screen.findByText("hello");
    expect(editable.closest('[contenteditable="true"]')).not.toBeNull();
  });
});
