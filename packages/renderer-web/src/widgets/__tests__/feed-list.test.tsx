import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { FeedList, type FeedRow } from "../feed-list";

const rows: FeedRow[] = [
  { id: "r1", primary: "First row", trailing: "3 min" },
  { id: "r2", primary: "Second row" },
];

describe("FeedList", () => {
  test("renders one list item per row with primary text", () => {
    render(<FeedList rows={rows} testId="feed" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("First row")).toBeTruthy();
    expect(screen.getByText("Second row")).toBeTruthy();
  });

  test("renders trailing content only when defined", () => {
    render(<FeedList rows={rows} testId="feed" />);
    expect(screen.getByText("3 min")).toBeTruthy();
  });

  test("renders the empty state when there are no rows", () => {
    render(<FeedList rows={[]} testId="feed" emptyContent={<p>Nothing here</p>} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});
