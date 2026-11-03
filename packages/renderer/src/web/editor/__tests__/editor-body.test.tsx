import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { EditorBody } from "../editor-frame.tsx";

describe("EditorBody", () => {
  test("three columns keep the DOM order left, center, right", () => {
    render(
      <EditorBody
        testId="body"
        left={<button type="button">left-rail</button>}
        center={<button type="button">center-page</button>}
        right={<button type="button">right-rail</button>}
      />,
    );
    const labels = Array.from(screen.getByTestId("body").querySelectorAll("button")).map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(["left-rail", "center-page", "right-rail"]);
  });
});
