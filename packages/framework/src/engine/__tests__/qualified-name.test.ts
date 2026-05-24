import { describe, expect, test } from "bun:test";
import {
  isKebabSegment,
  isValidQn,
  type ParsedQn,
  parseQn,
  QnTypes,
  qn,
  toKebab,
} from "../qualified-name";
import type { CamelToKebab } from "../types/handlers";

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
    expect(toKebab("billing-period.create")).toBe("billing-period-create");
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

describe("CamelToKebab type === toKebab() runtime", () => {
  // Each test cross-checks the compile-time type and the runtime function
  // for the same input. Two layers of guarantee:
  //
  //   1. `expect(toKebab(X)).toBe(Y)` — runtime equality.
  //   2. `const _: Equals<CamelToKebab<X>, Y> = true` — compile-time
  //      equality. If the type doesn't reduce to exactly `Y`, the
  //      assignment fails to type-check (`true` doesn't fit `false`).
  //
  // Both must agree — otherwise apps with such names get inconsistent
  // augmentation keys. The Equals helper uses the function-bivariance
  // trick to catch `never` divergence (a one-way `extends` check would
  // silently pass `never extends X`).
  type Equals<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

  test("plain camelCase", () => {
    expect(toKebab("orders")).toBe("orders");
    expect(toKebab("driverOrders")).toBe("driver-orders");
    expect(toKebab("monthlyReport")).toBe("monthly-report");
    const _t1: Equals<CamelToKebab<"orders">, "orders"> = true;
    const _t2: Equals<CamelToKebab<"driverOrders">, "driver-orders"> = true;
    const _t3: Equals<CamelToKebab<"monthlyReport">, "monthly-report"> = true;
    void _t1;
    void _t2;
    void _t3;
  });

  test("consecutive uppercase before camel-hump (the SSEFoo case)", () => {
    expect(toKebab("SSEBroadcast")).toBe("sse-broadcast");
    expect(toKebab("XMLId")).toBe("xml-id");
    expect(toKebab("IOPort")).toBe("io-port");
    expect(toKebab("getHTTPResponse")).toBe("get-http-response");
    expect(toKebab("parseJSON")).toBe("parse-json");
    const _t1: Equals<CamelToKebab<"SSEBroadcast">, "sse-broadcast"> = true;
    const _t2: Equals<CamelToKebab<"XMLId">, "xml-id"> = true;
    const _t3: Equals<CamelToKebab<"IOPort">, "io-port"> = true;
    const _t4: Equals<CamelToKebab<"getHTTPResponse">, "get-http-response"> = true;
    const _t5: Equals<CamelToKebab<"parseJSON">, "parse-json"> = true;
    void _t1;
    void _t2;
    void _t3;
    void _t4;
    void _t5;
  });

  test("trailing uppercase run (no camel-hump)", () => {
    expect(toKebab("IO")).toBe("io");
    expect(toKebab("URL")).toBe("url");
    expect(toKebab("userID")).toBe("user-id");
    const _t1: Equals<CamelToKebab<"IO">, "io"> = true;
    const _t2: Equals<CamelToKebab<"URL">, "url"> = true;
    const _t3: Equals<CamelToKebab<"userID">, "user-id"> = true;
    void _t1;
    void _t2;
    void _t3;
  });

  test("dot-separated", () => {
    expect(toKebab("billing.period")).toBe("billing-period");
    expect(toKebab("billing.PeriodCreate")).toBe("billing-period-create");
    const _t1: Equals<CamelToKebab<"billing.period">, "billing-period"> = true;
    const _t2: Equals<CamelToKebab<"billing.PeriodCreate">, "billing-period-create"> = true;
    void _t1;
    void _t2;
  });

  test("digits in name", () => {
    expect(toKebab("MD5Hash")).toBe("md5-hash");
    expect(toKebab("oauth2Provider")).toBe("oauth2-provider");
    const _t1: Equals<CamelToKebab<"MD5Hash">, "md5-hash"> = true;
    const _t2: Equals<CamelToKebab<"oauth2Provider">, "oauth2-provider"> = true;
    void _t1;
    void _t2;
  });

  test("already kebab-case (idempotent)", () => {
    expect(toKebab("task-create")).toBe("task-create");
    expect(toKebab("audit-trail")).toBe("audit-trail");
    const _t1: Equals<CamelToKebab<"task-create">, "task-create"> = true;
    const _t2: Equals<CamelToKebab<"audit-trail">, "audit-trail"> = true;
    void _t1;
    void _t2;
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
