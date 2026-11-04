import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import {
  collectPinnedHeaderActions,
  HeaderActionPinned,
  isOnlyPinnedHeaderActions,
} from "../header-action-pinned.tsx";
import { HeaderOverflowMenuContext } from "../header-overflow-menu.ts";

describe("HeaderActionPinned", () => {
  test("finds markers through fragments and ignores other actions", () => {
    const node = (
      <>
        <HeaderActionPinned>
          <button type="button">AI</button>
        </HeaderActionPinned>
        <button type="button">Other</button>
      </>
    );
    expect(collectPinnedHeaderActions(node)).toHaveLength(1);
    expect(isOnlyPinnedHeaderActions(node)).toBe(false);
  });

  test("a fragment holding only markers counts as only pinned", () => {
    const node = (
      <>
        <>
          <HeaderActionPinned>
            <button type="button">AI</button>
          </HeaderActionPinned>
        </>
      </>
    );
    expect(collectPinnedHeaderActions(node)).toHaveLength(1);
    expect(isOnlyPinnedHeaderActions(node)).toBe(true);
  });

  test("an empty fragment is not only pinned", () => {
    expect(isOnlyPinnedHeaderActions(<></>)).toBe(false);
  });

  test("a lone marker counts as only pinned", () => {
    const node = (
      <HeaderActionPinned>
        <button type="button">AI</button>
      </HeaderActionPinned>
    );
    expect(isOnlyPinnedHeaderActions(node)).toBe(true);
  });

  test("renders in the bar and nothing inside the overflow menu", () => {
    const { unmount } = render(
      <HeaderActionPinned>
        <button type="button">AI</button>
      </HeaderActionPinned>,
    );
    expect(screen.getByText("AI")).toBeTruthy();
    unmount();
    render(
      <HeaderOverflowMenuContext.Provider value={true}>
        <HeaderActionPinned>
          <button type="button">AI</button>
        </HeaderActionPinned>
      </HeaderOverflowMenuContext.Provider>,
    );
    expect(screen.queryByText("AI")).toBeNull();
  });
});
