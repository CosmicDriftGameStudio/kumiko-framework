import { describe, expect, mock, test } from "bun:test";
import { DispatcherProvider } from "@cosmicdrift/kumiko-renderer";
import { type ReactElement, useState } from "react";
import {
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../__tests__/test-utils";
import { AiTextArea, AiTextField, type AiTextFieldProps } from "../ai-text-field";

function renderWithDispatcher(
  ui: ReactElement,
  query: NonNullable<Parameters<typeof createMockDispatcher>[0]>["query"],
) {
  const dispatcher = createMockDispatcher({ query });
  return render(<DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>);
}

// Real controlled-component loop: onChange feeds back into `value` so
// Tab-accept sees the actually-typed text, not a stale prop. Plain
// `mock()`-only setups (no state) can't exercise this — that's a test
// bug we hit and fixed once already (see git history), keep it this way.
function ControlledAiTextField(
  props: Omit<AiTextFieldProps, "value" | "onChange"> & {
    readonly initialValue: string;
    readonly onChangeSpy?: (v: string) => void;
  },
) {
  const { initialValue, onChangeSpy, ...rest } = props;
  const [value, setValue] = useState(initialValue);
  return (
    <AiTextField
      {...rest}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
    />
  );
}

describe("AiTextField", () => {
  test("plain typing calls onChange like a normal text field", () => {
    const onChangeSpy = mock((_v: string) => {});
    renderWithDispatcher(
      <ControlledAiTextField
        label="Title"
        id="title"
        name="title"
        initialValue=""
        onChangeSpy={onChangeSpy}
        actions={[]}
        completion={false}
        testId="title"
      />,
      (async () => ({
        isSuccess: true,
        data: { type: "text", text: "", usage: { inputTokens: 0, outputTokens: 0 } },
      })) as never,
    );
    fireEvent.change(screen.getByTestId("title-input"), { target: { value: "hi" } });
    expect(onChangeSpy).toHaveBeenCalledWith("hi");
  });

  test("ghost-text: shows suggestion, Tab accepts it appended to the typed text", async () => {
    const onChangeSpy = mock((_v: string) => {});
    renderWithDispatcher(
      <ControlledAiTextField
        label="Title"
        id="title"
        name="title"
        initialValue=""
        onChangeSpy={onChangeSpy}
        actions={[]}
        completionDebounceMs={5}
        testId="title"
      />,
      (async () => ({
        isSuccess: true,
        data: { type: "text", text: "fox", usage: { inputTokens: 1, outputTokens: 1 } },
      })) as never,
    );

    const input = screen.getByTestId("title-input");
    fireEvent.change(input, { target: { value: "the quick brown " } });

    await waitFor(() => expect(screen.queryByText("fox")).toBeTruthy(), { timeout: 1000 });

    fireEvent.keyDown(input, { key: "Tab" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("the quick brown fox");
  });

  test("ghost-text: Esc discards the suggestion without calling onChange", async () => {
    const onChangeSpy = mock((_v: string) => {});
    renderWithDispatcher(
      <ControlledAiTextField
        label="Title"
        id="title"
        name="title"
        initialValue=""
        onChangeSpy={onChangeSpy}
        actions={[]}
        completionDebounceMs={5}
        testId="title"
      />,
      (async () => ({
        isSuccess: true,
        data: { type: "text", text: "there", usage: { inputTokens: 1, outputTokens: 1 } },
      })) as never,
    );

    const input = screen.getByTestId("title-input");
    fireEvent.change(input, { target: { value: "hi " } });
    await waitFor(() => expect(screen.queryByText("there")).toBeTruthy(), { timeout: 1000 });

    onChangeSpy.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("there")).toBeNull();
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  test("feature_disabled → toolbar hides, field stays usable (graceful degradation)", async () => {
    const onChangeSpy = mock((_v: string) => {});
    renderWithDispatcher(
      <ControlledAiTextField
        label="Title"
        id="title"
        name="title"
        initialValue=""
        onChangeSpy={onChangeSpy}
        completionDebounceMs={5}
        testId="title"
      />,
      (async () => ({
        isSuccess: false,
        error: { code: "feature_disabled", message: "off", i18nKey: "errors.feature.disabled" },
      })) as never,
    );

    fireEvent.change(screen.getByTestId("title-input"), { target: { value: "hi " } });
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull(), { timeout: 1000 });
    expect(screen.getByTestId("title-input")).toBeTruthy();
  });

  test("correct action: opens dialog, runs immediately, apply calls onChange with the result", async () => {
    const onChangeSpy = mock((_v: string) => {});
    renderWithDispatcher(
      <ControlledAiTextField
        label="Title"
        id="title"
        name="title"
        initialValue="teh cat sat"
        onChangeSpy={onChangeSpy}
        completion={false}
        actions={["correct"]}
        testId="title"
      />,
      (async (_type: string, payload: unknown) => {
        const mode = (payload as { mode: string }).mode;
        if (mode !== "correct") throw new Error(`unexpected mode ${mode}`);
        return {
          isSuccess: true,
          data: { type: "text", text: "the cat sat", usage: { inputTokens: 3, outputTokens: 3 } },
        };
      }) as never,
    );

    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    await waitFor(() => expect(screen.queryByText("the cat sat")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onChangeSpy).toHaveBeenCalledWith("the cat sat");
  });
});

describe("AiTextArea", () => {
  test("renders a textarea with the given rows", () => {
    const onChange = mock((_v: string) => {});
    renderWithDispatcher(
      <AiTextArea
        label="Body"
        id="body"
        name="body"
        value=""
        onChange={onChange}
        rows={6}
        actions={[]}
        completion={false}
        testId="body"
      />,
      (async () => ({ isSuccess: true, data: {} })) as never,
    );
    const el = screen.getByTestId("body-input") as HTMLTextAreaElement;
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.getAttribute("rows")).toBe("6");
  });
});
