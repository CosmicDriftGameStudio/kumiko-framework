import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { defaultPrimitives, EmbeddedFormProvider } from "../index.tsx";

function renderEmbedded(unsavedCount: number | undefined): void {
  const { Form } = defaultPrimitives;
  render(
    <EmbeddedFormProvider>
      <Form
        onSubmit={() => {}}
        testId="f"
        actions={<button type="submit">Save</button>}
        {...(unsavedCount !== undefined && { unsavedCount })}
      >
        <span>field</span>
      </Form>
    </EmbeddedFormProvider>,
  );
}

describe("embedded form unsaved status", () => {
  test("shows the unsaved count next to the buttons", () => {
    renderEmbedded(2);
    expect(screen.getByTestId("f-unsaved").textContent).toContain("2");
  });

  test("shows nothing without unsaved changes", () => {
    renderEmbedded(0);
    expect(screen.queryByTestId("f-unsaved")).toBeNull();
  });
});
