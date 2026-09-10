import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { DataTable, Button } = defaultPrimitives;

// coa-mapping-list / statement-upload-list on a 390px viewport: toolbarEnd's
// rightmost button got cut off because neither the toolbar container nor its
// toolbarEnd wrapper allowed wrapping. happy-dom doesn't compute real layout
// (no measured widths here), so this pins the classes that make wrapping
// possible instead: both containers carry flex-wrap, and toolbarEnd's
// buttons sit inside that wrapping container rather than one that would
// force them onto a single non-wrapping row.
describe("DataTable toolbar wraps instead of overflowing on narrow viewports", () => {
  test("toolbar container and toolbarEnd wrapper both allow wrapping", () => {
    render(
      <DataTable
        columns={[]}
        rows={[]}
        testId="tbl"
        toolbarStart={<div>search</div>}
        toolbarEnd={<Button testId="tbl-action">Action</Button>}
      />,
    );

    const toolbar = screen.getByTestId("tbl-toolbar");
    expect(toolbar.className).toContain("flex-wrap");

    const actionButton = screen.getByTestId("tbl-action");
    const toolbarEndWrapper = actionButton.parentElement;
    expect(toolbarEndWrapper).not.toBeNull();
    expect(toolbarEndWrapper?.className).toContain("flex-wrap");
    expect(toolbarEndWrapper?.parentElement).toBe(toolbar);
  });
});
