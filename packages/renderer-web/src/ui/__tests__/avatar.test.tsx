import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "../avatar";

describe("ui/Avatar", () => {
  test.each(["default", "sm", "lg"] as const)("size=%s sets data-size on root", (size) => {
    render(
      <Avatar size={size} data-testid="av">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId("av").getAttribute("data-size")).toBe(size);
    expect(document.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  test("AvatarImage with failed load shows AvatarFallback", () => {
    render(
      <Avatar>
        <AvatarImage src="/photo.png" alt="User" />
        <AvatarFallback>FB</AvatarFallback>
      </Avatar>,
    );
    // happy-dom does not load images — Radix keeps the fallback visible
    expect(screen.getByText("FB")).toBeTruthy();
    expect(document.querySelector('[data-slot="avatar-fallback"]')).not.toBeNull();
  });

  test("AvatarBadge renders inside avatar", () => {
    render(
      <Avatar data-testid="av">
        <AvatarFallback>AB</AvatarFallback>
        <AvatarBadge data-testid="badge">!</AvatarBadge>
      </Avatar>,
    );
    expect(screen.getByTestId("badge")).toBeTruthy();
    expect(document.querySelector('[data-slot="avatar-badge"]')).not.toBeNull();
  });

  test("AvatarGroup stacks avatars and AvatarGroupCount shows overflow", () => {
    render(
      <AvatarGroup data-testid="group">
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>B</AvatarFallback>
        </Avatar>
        <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    expect(screen.getByTestId("group")).toBeTruthy();
    expect(screen.getByTestId("count").textContent).toBe("+3");
    expect(document.querySelector('[data-slot="avatar-group"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="avatar-group-count"]')).not.toBeNull();
  });
});

