import { describe, expect, test } from "vitest";
import {
  isKebabSegment,
  isValidQn,
  type ParsedQn,
  parseQn,
  QnTypes,
  qn,
  toKebab,
} from "../qualified-name";

describe("qn()", () => {
  test("builds scope:type:name string", () => {
    expect(qn("tasks", QnTypes.write, "task:create")).toBe("tasks:write:task:create");
    expect(qn("system", QnTypes.hook, "audit-trail")).toBe("system:hook:audit-trail");
    expect(qn("billing", QnTypes.notify, "invoice-assigned")).toBe(
      "billing:notify:invoice-assigned",
    );
  });

  test("name can contain colons for sub-structure", () => {
    expect(qn("tasks", "write", "task:create")).toBe("tasks:write:task:create");
    expect(qn("hr", "write", "employee:promote")).toBe("hr:write:employee:promote");
  });

  test("name without colons works (standalone handlers, config, etc)", () => {
    expect(qn("admin", "write", "reset")).toBe("admin:write:reset");
    expect(qn("system", "hook", "audit-trail")).toBe("system:hook:audit-trail");
  });

  test("rejects invalid scope", () => {
    expect(() => qn("Tasks", QnTypes.write, "create")).toThrow("Invalid QN scope");
    expect(() => qn("", QnTypes.write, "create")).toThrow("Invalid QN scope");
    expect(() => qn("my.feature", QnTypes.write, "create")).toThrow("Invalid QN scope");
  });

  test("rejects invalid name segment", () => {
    expect(() => qn("tasks", QnTypes.write, "Create")).toThrow("Invalid QN name");
    expect(() => qn("tasks", QnTypes.write, "")).toThrow("Invalid QN name");
    expect(() => qn("tasks", QnTypes.write, "task_create")).toThrow("Invalid QN name");
  });

  test("allows numbers and dashes in segments", () => {
    expect(qn("feature2", QnTypes.job, "sync-v2")).toBe("feature2:job:sync-v2");
    expect(qn("my-app", QnTypes.event, "user:created")).toBe("my-app:event:user:created");
  });
});

describe("parseQn()", () => {
  test("parses 3-segment QN (no sub-structure in name)", () => {
    const result: ParsedQn = parseQn("system:hook:audit-trail");
    expect(result).toEqual({ scope: "system", type: "hook", name: "audit-trail" });
  });

  test("parses 4-segment QN (entity:action in name)", () => {
    const result = parseQn("tasks:write:task:create");
    expect(result).toEqual({ scope: "tasks", type: "write", name: "task:create" });
  });

  test("parses all built-in QN types", () => {
    for (const type of Object.values(QnTypes)) {
      const result = parseQn(`scope:${type}:name`);
      expect(result.type).toBe(type);
    }
  });

  test("accepts custom types (types are open)", () => {
    const result = parseQn("billing:workflow:invoice:approval");
    expect(result).toEqual({ scope: "billing", type: "workflow", name: "invoice:approval" });
  });

  test("rejects fewer than 3 segments", () => {
    expect(() => parseQn("tasks:write")).toThrow("expected at least 3");
    expect(() => parseQn("justonestring")).toThrow("expected at least 3");
  });

  test("rejects invalid type format", () => {
    expect(() => parseQn("tasks:WRITE:name")).toThrow("Invalid QN type");
    expect(() => parseQn("tasks:my_type:name")).toThrow("Invalid QN type");
  });

  test("rejects invalid scope or name in parsed string", () => {
    expect(() => parseQn("Tasks:write:name")).toThrow("Invalid QN scope");
    expect(() => parseQn("tasks:write:Name")).toThrow("Invalid QN name");
  });
});

describe("isValidQn()", () => {
  test("returns true for valid QNs", () => {
    expect(isValidQn("tasks:write:task:create")).toBe(true);
    expect(isValidQn("system:hook:audit-trail")).toBe(true);
    expect(isValidQn("a:write:b")).toBe(true);
  });

  test("returns true for custom types", () => {
    expect(isValidQn("billing:workflow:invoice:approval")).toBe(true);
    expect(isValidQn("auth:rule:must-be-admin")).toBe(true);
  });

  test("returns false for invalid QNs", () => {
    expect(isValidQn("tasks.write.create")).toBe(false);
    expect(isValidQn("")).toBe(false);
    expect(isValidQn("tasks:write")).toBe(false);
    expect(isValidQn("Tasks:write:name")).toBe(false);
  });
});

describe("toKebab()", () => {
  test("converts dot-separated to kebab-case", () => {
    expect(toKebab("task.create")).toBe("task-create");
    expect(toKebab("billingPeriod.create")).toBe("billing-period-create");
  });

  test("converts camelCase to kebab-case", () => {
    expect(toKebab("ticketAssigned")).toBe("ticket-assigned");
    expect(toKebab("monthlyReport")).toBe("monthly-report");
  });

  test("leaves kebab-case unchanged", () => {
    expect(toKebab("task-create")).toBe("task-create");
    expect(toKebab("audit-trail")).toBe("audit-trail");
  });

  test("preserves colons", () => {
    expect(toKebab("task:create")).toBe("task:create");
    expect(toKebab("invoice:markPaid")).toBe("invoice:mark-paid");
  });

  test("handles mixed patterns", () => {
    expect(toKebab("invoice.markPaid")).toBe("invoice-mark-paid");
  });

  test("handles uppercase sequences", () => {
    expect(toKebab("parseJSON")).toBe("parse-json");
    expect(toKebab("SSEBroadcast")).toBe("sse-broadcast");
    expect(toKebab("getHTTPResponse")).toBe("get-http-response");
  });
});

describe("isKebabSegment()", () => {
  test("accepts valid kebab segments", () => {
    expect(isKebabSegment("task")).toBe(true);
    expect(isKebabSegment("task-create")).toBe(true);
    expect(isKebabSegment("audit-trail-v2")).toBe(true);
    expect(isKebabSegment("a")).toBe(true);
    expect(isKebabSegment("x1")).toBe(true);
  });

  test("rejects camelCase", () => {
    expect(isKebabSegment("taskCreate")).toBe(false);
    expect(isKebabSegment("auditTrail")).toBe(false);
  });

  test("rejects dots", () => {
    expect(isKebabSegment("task.create")).toBe(false);
  });

  test("rejects underscores (toKebab leaves them through — regex catches it)", () => {
    expect(isKebabSegment("task_create")).toBe(false);
    expect(isKebabSegment("my_projection")).toBe(false);
  });

  test("rejects uppercase", () => {
    expect(isKebabSegment("Task")).toBe(false);
    expect(isKebabSegment("TASK")).toBe(false);
  });

  test("rejects non-letter starts", () => {
    expect(isKebabSegment("1task")).toBe(false);
    expect(isKebabSegment("-task")).toBe(false);
    expect(isKebabSegment("")).toBe(false);
  });

  test("rejects colons (single-segment check, not full QN)", () => {
    expect(isKebabSegment("task:create")).toBe(false);
  });
});
