import { describe, expect, test } from "bun:test";
import { stringifyNavParams } from "../app/row-actions";

describe("stringifyNavParams", () => {
  test("plain object encodes as JSON (fw#2763)", () => {
    const result = stringifyNavParams({ price: { amount: 12.5, currency: "EUR" } });
    expect(result["price"]).toBe(JSON.stringify({ amount: 12.5, currency: "EUR" }));
  });

  test("array stays JSON", () => {
    const result = stringifyNavParams({ roles: ["Admin", "User"] });
    expect(result["roles"]).toBe(JSON.stringify(["Admin", "User"]));
  });

  test("string, number and boolean stringify via String()", () => {
    const result = stringifyNavParams({ name: "Alice", age: 42, active: true });
    expect(result["name"]).toBe("Alice");
    expect(result["age"]).toBe("42");
    expect(result["active"]).toBe("true");
  });

  test("null and undefined become null", () => {
    const result = stringifyNavParams({ a: null, b: undefined });
    expect(result["a"]).toBeNull();
    expect(result["b"]).toBeNull();
  });

  test("a Date instance stays String(date), not JSON", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const result = stringifyNavParams({ createdAt: date });
    expect(result["createdAt"]).toBe(String(date));
  });
});
