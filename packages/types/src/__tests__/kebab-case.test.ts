import { describe, expect, test } from "bun:test";
import { toKebab } from "../kebab-case.ts";

describe("toKebab", () => {
  test.each([
    ["task.create", "task-create"],
    ["ticketAssigned", "ticket-assigned"],
    ["aiURLCheck", "ai-url-check"],
    ["SSEBroadcast", "sse-broadcast"],
    ["task:create", "task:create"],
    ["already-kebab", "already-kebab"],
  ])("%s -> %s", (input, expected) => {
    expect(toKebab(input)).toBe(expected);
  });
});
