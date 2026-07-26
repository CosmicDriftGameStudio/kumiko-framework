import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "../../__tests__/test-utils";
import { Drawer } from "../drawer";

describe("Drawer", () => {
  test("rendert Titel + Inhalt wenn open", () => {
    render(
      <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer">
        <div>Body</div>
      </Drawer>,
    );
    expect(screen.getByText("Mail")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  test("open=false rendert nichts", () => {
    render(
      <Drawer open={false} onOpenChange={() => {}} title="Mail">
        <div>Body</div>
      </Drawer>,
    );
    expect(screen.queryByText("Body")).toBeNull();
  });

  test("Escape ruft onOpenChange(false)", () => {
    const onOpenChange = mock((_open: boolean) => {});
    render(
      <Drawer open={true} onOpenChange={onOpenChange} title="Mail" testId="drawer">
        <div>Body</div>
      </Drawer>,
    );
    fireEvent.keyDown(screen.getByTestId("drawer"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
