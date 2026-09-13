// kumiko-screen-akte-bedienkonzept: Ctrl/Cmd+Enter submits a textarea
// (InputProps.onSubmitShortcut) instead of inserting a newline. Plain Enter
// keeps inserting a newline — asserted here via the keydown event's
// defaultPrevented state, since fireEvent.keyDown does not itself simulate
// the browser's native newline insertion.
import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Input } = defaultPrimitives;
const noop = () => {};

function renderTextarea(onSubmitShortcut?: () => void): HTMLTextAreaElement {
  const { container } = render(
    <Input
      kind="textarea"
      id="notes"
      name="notes"
      value=""
      onChange={noop}
      {...(onSubmitShortcut !== undefined && { onSubmitShortcut })}
    />,
  );
  const textarea = container.querySelector("textarea");
  if (textarea === null) throw new Error("no textarea rendered");
  return textarea;
}

describe("textarea onSubmitShortcut (Ctrl/Cmd+Enter)", () => {
  test("Ctrl+Enter calls onSubmitShortcut and prevents the default newline", () => {
    let calls = 0;
    const textarea = renderTextarea(() => {
      calls += 1;
    });
    // fireEvent.keyDown returns the DOM dispatchEvent() result — false once
    // preventDefault() was called on the (cancelable) event.
    const notPrevented = fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(calls).toBe(1);
    expect(notPrevented).toBe(false);
  });

  test("Cmd+Enter (metaKey) calls onSubmitShortcut and prevents the default newline", () => {
    let calls = 0;
    const textarea = renderTextarea(() => {
      calls += 1;
    });
    const notPrevented = fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(calls).toBe(1);
    expect(notPrevented).toBe(false);
  });

  test("plain Enter does not call onSubmitShortcut and leaves the newline insertion alone", () => {
    let calls = 0;
    const textarea = renderTextarea(() => {
      calls += 1;
    });
    const notPrevented = fireEvent.keyDown(textarea, { key: "Enter" });
    expect(calls).toBe(0);
    expect(notPrevented).toBe(true);
  });

  test("without onSubmitShortcut, no aria-keyshortcuts is advertised", () => {
    const textarea = renderTextarea();
    expect(textarea.getAttribute("aria-keyshortcuts")).toBeNull();
  });

  test("with onSubmitShortcut, aria-keyshortcuts advertises both chords", () => {
    const textarea = renderTextarea(() => {});
    expect(textarea.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
  });
});
