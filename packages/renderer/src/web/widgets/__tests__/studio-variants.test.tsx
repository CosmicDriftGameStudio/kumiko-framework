import { describe, expect, mock, test } from "bun:test";
import { usePrimitives } from "../../../index.ts";
import { fireEvent, render, screen } from "../../__tests__/test-utils.tsx";
import { Composer } from "../composer.tsx";
import { DetailList } from "../detail-list.tsx";
import { TextareaField } from "../form-fields.tsx";
import { ModeSwitch } from "../mode-switch.tsx";

function Primitives() {
  const { Heading, Banner } = usePrimitives();
  return (
    <>
      <Heading variant="group" testId="group-heading">
        Group
      </Heading>
      <Banner
        variant="warning"
        icon="alert-triangle"
        parts={[{ text: "Please " }, { text: "back up", strong: true }]}
        testId="banner"
      />
    </>
  );
}

describe("Heading group and Banner parts", () => {
  test("group heading is 16px semibold without uppercase", () => {
    render(<Primitives />);
    const classes = screen.getByTestId("group-heading").className.split(" ");
    expect(classes).toContain("text-base");
    expect(classes).toContain("font-semibold");
    expect(classes).not.toContain("uppercase");
  });

  test("banner renders the icon and strong parts without markup strings", () => {
    render(<Primitives />);
    const banner = screen.getByTestId("banner");
    expect(banner.querySelector("svg")).not.toBeNull();
    expect(banner.querySelector("strong")?.textContent).toBe("back up");
    expect(banner.textContent).toBe("Please back up");
  });
});

describe("DetailList options", () => {
  test("normal value weight drops font-medium; sidebar right-aligns the value", () => {
    render(
      <DetailList
        rows={[{ label: "Plan", value: "Team" }]}
        valueWeight="normal"
        layout="sidebar"
      />,
    );
    const value = screen.getByText("Team").className.split(" ");
    expect(value).not.toContain("font-medium");
    expect(value).toContain("text-right");
  });

  test("defaults keep the emphasized value", () => {
    render(<DetailList rows={[{ label: "Plan", value: "Team" }]} />);
    expect(screen.getByText("Team").className.split(" ")).toContain("font-medium");
  });
});

describe("ModeSwitch disabled and tone", () => {
  test("a disabled option is aria-disabled and does not fire onChange", () => {
    const onChange = mock();
    render(
      <ModeSwitch
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true, tone: "warning" },
        ]}
      />,
    );
    const disabled = screen.getByText("B");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.className.split(" ")).toContain("ring-status-warn");
    fireEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TextareaField placeholder and Composer", () => {
  test("TextareaField passes the placeholder through", () => {
    render(
      <TextareaField
        label="Note"
        id="n"
        name="n"
        value=""
        onChange={() => {}}
        placeholder="Hint"
      />,
    );
    expect(screen.getByPlaceholderText("Hint")).toBeTruthy();
  });

  test("Composer submits through the send button and is disabled while empty", () => {
    const onSubmit = mock();
    const { rerender } = render(
      <Composer value="" onChange={() => {}} onSubmit={onSubmit} submitLabel="Send" />,
    );
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    rerender(<Composer value="Hi" onChange={() => {}} onSubmit={onSubmit} submitLabel="Send" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
