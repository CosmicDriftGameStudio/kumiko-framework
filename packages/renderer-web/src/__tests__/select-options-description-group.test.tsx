import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { ComboboxInput } from "../primitives/combobox.js";
import { defaultPrimitives } from "../primitives/index.js";
import { groupOptions } from "../primitives/option-groups.js";
import { render, screen, within } from "./test-utils.js";

const { Input } = defaultPrimitives;

const OPTIONS = [
  { value: "solo", label: "Solo", description: "Ungrouped choice" },
  { value: "a", label: "Alpha", description: "First of the cloud", group: "Cloud" },
  { value: "b", label: "Beta", description: "Runs on your hardware", group: "Local" },
  { value: "c", label: "Gamma", group: "Cloud" },
] as const;

describe("groupOptions", () => {
  test("ungrouped options come first, groups follow in order of first occurrence", () => {
    const sections = groupOptions([
      { value: "1", group: "B" },
      { value: "2" },
      { value: "3", group: "A" },
      { value: "4", group: "B" },
      { value: "5", group: "" },
    ]);
    expect(sections.map((s) => [s.heading, s.options.map((o) => o.value)])).toEqual([
      [undefined, ["2", "5"]],
      ["B", ["1", "4"]],
      ["A", ["3"]],
    ]);
  });
});

describe("ComboboxInput description and group", () => {
  test("renders group headings and the description as a second line; trigger shows the label only", async () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        defaultOpen
      />,
    );
    expect(await screen.findByText("Cloud")).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getByText("Runs on your hardware")).toBeTruthy();
    expect(screen.getByTestId("combobox-combo").textContent).toBe("Alpha");
  });

  test("local search also matches the description", async () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={OPTIONS}
        defaultOpen
      />,
    );
    const searchInput = await screen.findByRole("combobox");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "hardware" } });
    });
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  test("multi-mode keeps working with grouped options", async () => {
    const picked: (readonly string[])[] = [];
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        multiple
        value={["a"]}
        onChange={(v) => picked.push(v)}
        options={OPTIONS}
        defaultOpen
      />,
    );
    await act(async () => {
      fireEvent.click(await screen.findByText("Gamma"));
    });
    expect(picked).toEqual([["a", "c"]]);
  });
});

describe("select Input presentation with description or group", () => {
  const plain = [
    { value: "x", label: "X" },
    { value: "y", label: "Y" },
  ];

  test("without description or group two short options stay segmented", () => {
    render(<Input kind="select" id="s" name="s" value="x" onChange={() => {}} options={plain} />);
    expect(screen.getByTestId("segmented-s")).toBeTruthy();
  });

  test("display radio with a description renders the radio list, not the segmented control", () => {
    render(
      <Input
        kind="select"
        id="s"
        name="s"
        value="x"
        display="radio"
        onChange={() => {}}
        options={[
          { value: "x", label: "X", description: "Explains X" },
          { value: "y", label: "Y" },
        ]}
      />,
    );
    expect(screen.queryByTestId("segmented-s")).toBeNull();
    expect(screen.getByTestId("radio-list-s")).toBeTruthy();
  });

  test("the heuristic also switches to the radio list when an option has a group", () => {
    render(
      <Input
        kind="select"
        id="s"
        name="s"
        value="x"
        onChange={() => {}}
        options={[
          { value: "x", label: "X", group: "G" },
          { value: "y", label: "Y" },
        ]}
      />,
    );
    expect(screen.queryByTestId("segmented-s")).toBeNull();
    expect(screen.getByTestId("radio-list-s")).toBeTruthy();
  });

  test("display dropdown stays a dropdown despite descriptions", () => {
    render(
      <Input
        kind="select"
        id="s"
        name="s"
        value="x"
        display="dropdown"
        onChange={() => {}}
        options={[
          { value: "x", label: "X", description: "Explains X" },
          { value: "y", label: "Y" },
        ]}
      />,
    );
    expect(screen.getByTestId("combobox-s")).toBeTruthy();
    expect(screen.queryByTestId("radio-list-s")).toBeNull();
  });

  test("radio list: description linked by aria-describedby, groups as headings in one radiogroup", () => {
    render(
      <Input
        kind="select"
        id="s"
        name="s"
        value="a"
        display="radio"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    const group = screen.getByRole("radiogroup");
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    const alpha = screen.getByTestId("radio-list-s-a");
    const describedBy = alpha.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("First of the cloud");
    expect(screen.getByTestId("radio-list-s-b").getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByTestId("radio-list-s-c").getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByTestId("radio-list-s-group-Cloud")).toBeTruthy();
    expect(screen.getByTestId("radio-list-s-group-Local")).toBeTruthy();
    // Ungrouped first, then Cloud, then Local — the DOM order drives native arrow navigation.
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value")),
    ).toEqual(["solo", "a", "c", "b"]);
  });

  test("radio list card variant shows the description too", () => {
    render(
      <Input
        kind="select"
        id="s"
        name="s"
        value="a"
        radioVariant="card"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    expect(screen.getByText("Runs on your hardware")).toBeTruthy();
  });
});
