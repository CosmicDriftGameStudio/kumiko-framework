import { describe, expect, test } from "bun:test";
import { CONTENT_EDITOR_ELEMENT_ID } from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "../../__tests__/test-utils";
import { RichContentEditor } from "../rich-content-editor";

describe("RichContentEditor", () => {
  test("falls back to the plain textarea while the tiptap chunk loads, then swaps in the editor", async () => {
    render(
      <RichContentEditor
        value="<p>hello</p>"
        onChange={() => {}}
        variables={[]}
        readOnly={false}
      />,
    );
    // The textarea id proves #1794's "never an empty panel" fallback is the
    // Suspense boundary — a null fallback would leave nothing to find here.
    expect(document.getElementById(CONTENT_EDITOR_ELEMENT_ID)).not.toBeNull();
    expect(await screen.findByText("hello")).toBeTruthy();
  });
});
