import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives/index.js";
import { render, screen } from "./test-utils.js";

const { Modal, Form, Button } = defaultPrimitives;

describe("DefaultModal hosting a form", () => {
  test("shows the modal title and renders the form bare, without a card or its own title", () => {
    render(
      <Modal open onOpenChange={() => {}} title="Create customer" testId="m">
        <Form
          onSubmit={() => {}}
          title="Create customer"
          actions={<Button>Save</Button>}
          testId="f"
        >
          <div>body</div>
        </Form>
      </Modal>,
    );
    const dialog = screen.getByTestId("m");
    expect(screen.getByRole("heading", { name: "Create customer" })).toBeTruthy();
    expect(dialog.querySelector("[data-slot=card]")).toBeNull();
    expect(dialog.querySelector("[data-testid=f-title]")).toBeNull();
    expect(dialog.querySelector(".max-w-4xl")).toBeNull();
  });
});
