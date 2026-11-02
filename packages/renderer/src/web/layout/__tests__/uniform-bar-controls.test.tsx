import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../../primitives/index.tsx";
import {
  SHELL_HEADER_CONTROLS_CLASSES,
  UNIFORM_BAR_CONTROLS_CLASSES,
} from "../uniform-bar-controls.ts";

const { DataTable, Button, PageHeader } = defaultPrimitives;

function hasUniformControlClasses(element: Element | null): boolean {
  if (element === null) return false;
  return UNIFORM_BAR_CONTROLS_CLASSES.split(" ").every((token) =>
    element.className.includes(token),
  );
}

describe("header and toolbar controls share one height", () => {
  test("header actions container forces the uniform height onto every button", () => {
    render(
      PageHeader === undefined ? null : <PageHeader actions={<Button testId="ai">AI</Button>} />,
    );

    expect(hasUniformControlClasses(screen.getByTestId("ai").parentElement)).toBe(true);
  });

  test("list toolbar forces the uniform height onto search and buttons", () => {
    render(
      <DataTable
        columns={[]}
        rows={[]}
        testId="tbl"
        toolbarStart={<div>search</div>}
        toolbarEnd={<Button testId="tbl-action">Action</Button>}
      />,
    );

    expect(hasUniformControlClasses(screen.getByTestId("tbl-toolbar"))).toBe(true);
  });

  test("phones keep the 44 px touch height for inputs and text buttons", () => {
    for (const classes of [UNIFORM_BAR_CONTROLS_CLASSES, SHELL_HEADER_CONTROLS_CLASSES]) {
      expect(classes).toContain("max-md:[&_[data-slot=input]]:h-11");
      expect(classes).toContain("max-md:[&_[data-slot=button]:not([data-size^=icon])]:h-11");
    }
  });
});
