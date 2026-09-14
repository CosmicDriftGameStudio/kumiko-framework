// Agent-Panel composer needs "Enter sends, Shift+Enter inserts a newline" at
// the field itself — InputProps.onKeyDown gives kind="text"/"textarea" raw
// keydown access instead of forcing that logic onto a wrapping <form>.
import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("Input onKeyDown", () => {
  test("kind=text: fires with key info on every keydown", () => {
    const events: string[] = [];
    render(
      <Input
        kind="text"
        id="x"
        name="x"
        value=""
        onChange={noop}
        testId="tid"
        onKeyDown={(e) => events.push(e.key)}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("tid"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("tid"), { key: "a" });
    expect(events).toEqual(["Enter", "a"]);
  });

  test("kind=textarea: fires with shiftKey so the caller can distinguish Enter from Shift+Enter", () => {
    const events: Array<{ key: string; shiftKey: boolean }> = [];
    const { container } = render(
      <Input
        kind="textarea"
        id="notes"
        name="notes"
        value=""
        onChange={noop}
        onKeyDown={(e) => events.push({ key: e.key, shiftKey: e.shiftKey })}
      />,
    );
    const textarea = container.querySelector("textarea");
    if (textarea === null) throw new Error("no textarea rendered");
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(events).toEqual([
      { key: "Enter", shiftKey: false },
      { key: "Enter", shiftKey: true },
    ]);
  });

  test("kind=textarea: composes with onSubmitShortcut — both fire on Ctrl+Enter", () => {
    let keyDownCalls = 0;
    let submitCalls = 0;
    const { container } = render(
      <Input
        kind="textarea"
        id="notes"
        name="notes"
        value=""
        onChange={noop}
        onKeyDown={() => {
          keyDownCalls += 1;
        }}
        onSubmitShortcut={() => {
          submitCalls += 1;
        }}
      />,
    );
    const textarea = container.querySelector("textarea");
    if (textarea === null) throw new Error("no textarea rendered");
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(keyDownCalls).toBe(1);
    expect(submitCalls).toBe(1);
  });

  test("without onKeyDown: unchanged default rendering (no crash, no listener)", () => {
    render(<Input kind="text" id="x" name="x" value="" onChange={noop} testId="tid" />);
    expect(() => fireEvent.keyDown(screen.getByTestId("tid"), { key: "Enter" })).not.toThrow();
  });
});
