import { describe, expect, spyOn, test } from "bun:test";
import { mergeSearchParamsIntoInitial } from "../app/kumiko-screen";

type FieldDef = {
  type?: string;
  default?: unknown;
  sensitive?: boolean;
  options?: readonly string[];
  multiple?: boolean;
  schema?: Record<string, { type?: string; options?: readonly string[] }>;
  maxItems?: number;
};

describe("mergeSearchParamsIntoInitial", () => {
  test("raw string param merges in as-is for a text field", () => {
    const fields: Record<string, FieldDef> = { name: { type: "text" } };
    const result = mergeSearchParamsIntoInitial(fields, { name: "Alice" });
    expect(result["name"]).toBe("Alice");
  });

  test("number-type field coerces a numeric string", () => {
    const fields: Record<string, FieldDef> = { age: { type: "number" } };
    const result = mergeSearchParamsIntoInitial(fields, { age: "42" });
    expect(result["age"]).toBe(42);
  });

  test("invalid number string falls back to field default", () => {
    const fields: Record<string, FieldDef> = { count: { type: "number", default: 7 } };
    const result = mergeSearchParamsIntoInitial(fields, { count: "not-a-number" });
    expect(result["count"]).toBe(7);
  });

  test("boolean field coerces 'true' and 'false'", () => {
    const fields: Record<string, FieldDef> = { active: { type: "boolean" } };
    expect(mergeSearchParamsIntoInitial(fields, { active: "true" })["active"]).toBe(true);
    expect(mergeSearchParamsIntoInitial(fields, { active: "false" })["active"]).toBe(false);
  });

  test("sensitive field is skipped even when a matching searchParam exists", () => {
    const fields: Record<string, FieldDef> = { password: { type: "text", sensitive: true } };
    const result = mergeSearchParamsIntoInitial(fields, { password: "secret" });
    expect(result["password"]).toBe("");
  });

  test("field with no matching searchParam keeps its buildInitialValues default", () => {
    const fields: Record<string, FieldDef> = { total: { type: "number", default: 100 } };
    const result = mergeSearchParamsIntoInitial(fields, {});
    expect(result["total"]).toBe(100);
  });

  test("money-type field without a defaultCurrency coerces a bare numeric string (legacy callers, e.g. config-edit/action-form)", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, { price: "19.99" });
    expect(result["price"]).toBe(19.99);
  });

  test("money-type field WITH a defaultCurrency merges the entityEdit payload shape (#1923)", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, { price: "19.99" }, undefined, "USD");
    expect(result["price"]).toEqual({ amount: 19.99, currency: "USD" });
  });

  test("money-type field WITH a defaultCurrency but no matching searchParam still defaults to the object shape", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, {}, undefined, "USD");
    expect(result["price"]).toEqual({ amount: 0, currency: "USD" });
  });

  test("renderableFields set given: searchParam for a non-rendered field is ignored (#1708)", () => {
    const fields: Record<string, FieldDef> = {
      status: { type: "text", default: "draft" },
      ownerId: { type: "text" },
    };
    const result = mergeSearchParamsIntoInitial(
      fields,
      { status: "approved", ownerId: "user-123" },
      new Set(["status"]),
    );
    expect(result["status"]).toBe("approved");
    expect(result["ownerId"]).toBe("");
  });

  test("no renderableFields set given (undefined): behaves as before, all fields eligible", () => {
    const fields: Record<string, FieldDef> = { ownerId: { type: "text" } };
    const result = mergeSearchParamsIntoInitial(fields, { ownerId: "user-123" });
    expect(result["ownerId"]).toBe("user-123");
  });

  test("multiSelect coerces comma-separated searchParam to string[]", () => {
    const fields: Record<string, FieldDef> = { roles: { type: "multiSelect" } };
    expect(mergeSearchParamsIntoInitial(fields, { roles: "TenantAdmin" })["roles"]).toEqual([
      "TenantAdmin",
    ]);
    expect(mergeSearchParamsIntoInitial(fields, { roles: "Admin,User" })["roles"]).toEqual([
      "Admin",
      "User",
    ]);
  });

  test("multiSelect coerces JSON-array searchParam to string[]", () => {
    const fields: Record<string, FieldDef> = { roles: { type: "multiSelect" } };
    expect(
      mergeSearchParamsIntoInitial(fields, { roles: JSON.stringify(["Admin", "Editor"]) })["roles"],
    ).toEqual(["Admin", "Editor"]);
  });

  test("multiSelect defaults to [] when unset", () => {
    const fields: Record<string, FieldDef> = { roles: { type: "multiSelect" } };
    expect(mergeSearchParamsIntoInitial(fields, {})["roles"]).toEqual([]);
  });

  test("multiSelect prefers JSON parse even without '[' prefix for quoted strings", () => {
    const fields: Record<string, FieldDef> = { tags: { type: "multiSelect" } };
    expect(
      mergeSearchParamsIntoInitial(fields, { tags: JSON.stringify("Berlin, Germany") })["tags"],
    ).toEqual(["Berlin, Germany"]);
  });

  test("multiSelect filters unknown option values when options are set", () => {
    const fields: Record<string, FieldDef> = {
      roles: { type: "multiSelect", options: ["Admin", "User"] },
    };
    expect(
      mergeSearchParamsIntoInitial(fields, { roles: JSON.stringify(["Admin", "Hacker"]) })["roles"],
    ).toEqual(["Admin"]);
  });

  test("money-type field parses a JSON {amount, currency} param without a defaultCurrency (fw#2763)", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(fields, {
      price: JSON.stringify({ amount: 19.99, currency: "CHF" }),
    });
    expect(result["price"]).toEqual({ amount: 19.99, currency: "CHF" });
  });

  test("money-type field: explicit JSON currency wins over defaultCurrency", () => {
    const fields: Record<string, FieldDef> = { price: { type: "money" } };
    const result = mergeSearchParamsIntoInitial(
      fields,
      { price: JSON.stringify({ amount: 19.99, currency: "CHF" }) },
      undefined,
      "USD",
    );
    expect(result["price"]).toEqual({ amount: 19.99, currency: "CHF" });
  });

  test("money-type field: bare number without a defaultCurrency keeps the number and warns (fw#2763)", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fields: Record<string, FieldDef> = { price: { type: "money" } };
      const result = mergeSearchParamsIntoInitial(fields, { price: "19.99" });
      expect(result["price"]).toBe(19.99);
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0]?.[0]).toContain("price");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("money-type field: JSON object with a broken shape falls back to the default and warns", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fields: Record<string, FieldDef> = {
        price: { type: "money", default: { amount: 0, currency: "EUR" } },
      };
      const result = mergeSearchParamsIntoInitial(fields, { price: JSON.stringify({ amount: 5 }) });
      expect(result["price"]).toEqual({ amount: 0, currency: "EUR" });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("money-type field: JSON object with a malformed currency code falls back to the default and warns", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fields: Record<string, FieldDef> = {
        price: { type: "money", default: { amount: 0, currency: "EUR" } },
      };
      const result = mergeSearchParamsIntoInitial(fields, {
        price: JSON.stringify({ amount: 5, currency: "<script>" }),
      });
      expect(result["price"]).toEqual({ amount: 0, currency: "EUR" });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("money-type field: a non-finite bare number falls back to the default (fw#2763)", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fields: Record<string, FieldDef> = {
        price: { type: "money", default: { amount: 0, currency: "EUR" } },
      };
      const result = mergeSearchParamsIntoInitial(fields, { price: "1e999" });
      expect(result["price"]).toEqual({ amount: 0, currency: "EUR" });
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe("embeddedList prefill (fw#2764)", () => {
    const linesField = (extra: Partial<FieldDef> = {}): Record<string, FieldDef> => ({
      lines: {
        type: "embedded",
        multiple: true,
        schema: {
          accountId: { type: "text" },
          amount: { type: "money" },
          qty: { type: "number" },
          posted: { type: "boolean" },
          kind: { type: "select", options: ["debit", "credit"] },
        },
        ...extra,
      },
    });

    test("a JSON row list from params.map arrives complete in the field", () => {
      const rows = [
        { accountId: "bank", amount: 1299, qty: 2, posted: true, kind: "debit" },
        { accountId: "cash", amount: -1299, qty: 1, posted: false, kind: "credit" },
      ];
      const result = mergeSearchParamsIntoInitial(linesField(), { lines: JSON.stringify(rows) });
      expect(result["lines"]).toEqual(rows);
    });

    test("money cells stay signed minor-unit integers", () => {
      const result = mergeSearchParamsIntoInitial(linesField(), {
        lines: JSON.stringify([{ accountId: "bank", amount: -4200 }]),
      });
      expect(result["lines"]).toEqual([{ accountId: "bank", amount: -4200 }]);
    });

    test("a fractional money cell rejects the whole prefill and warns", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = mergeSearchParamsIntoInitial(linesField(), {
          lines: JSON.stringify([{ accountId: "bank", amount: 12.99 }]),
        });
        expect(result["lines"]).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
        expect(warnSpy.mock.calls[0]?.[0]).toContain("lines");
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a non-JSON param leaves the field empty and warns", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = mergeSearchParamsIntoInitial(linesField(), { lines: "not-json-at-all" });
        expect(result["lines"]).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a JSON object instead of an array leaves the field empty and warns", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = mergeSearchParamsIntoInitial(linesField(), {
          lines: JSON.stringify({ accountId: "bank" }),
        });
        expect(result["lines"]).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a row that is not an object leaves the field empty and warns", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = mergeSearchParamsIntoInitial(linesField(), {
          lines: JSON.stringify([1, 2]),
        });
        expect(result["lines"]).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a select cell outside the declared options rejects the prefill and warns", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = mergeSearchParamsIntoInitial(linesField(), {
          lines: JSON.stringify([{ accountId: "bank", kind: "sudo" }]),
        });
        expect(result["lines"]).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("undeclared row keys are dropped instead of reaching the form", () => {
      const result = mergeSearchParamsIntoInitial(linesField(), {
        lines: JSON.stringify([{ accountId: "bank", secretFlag: "yes" }]),
      });
      expect(result["lines"]).toEqual([{ accountId: "bank" }]);
    });

    test("a __proto__ key in a row pollutes nothing", () => {
      const result = mergeSearchParamsIntoInitial(linesField(), {
        lines: '[{"accountId":"bank","__proto__":{"polluted":true}}]',
      });
      expect(result["lines"]).toEqual([{ accountId: "bank" }]);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.getPrototypeOf((result["lines"] as unknown[])[0])).toBe(Object.prototype);
    });

    test("more rows than maxItems leaves the field empty and warns", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = mergeSearchParamsIntoInitial(linesField({ maxItems: 2 }), {
          lines: JSON.stringify([{ accountId: "a" }, { accountId: "b" }, { accountId: "c" }]),
        });
        expect(result["lines"]).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("an embedded list without a matching param defaults to an empty array", () => {
      const result = mergeSearchParamsIntoInitial(linesField(), {});
      expect(result["lines"]).toEqual([]);
    });

    test("a sensitive embedded list ignores the param", () => {
      const result = mergeSearchParamsIntoInitial(linesField({ sensitive: true }), {
        lines: JSON.stringify([{ accountId: "bank" }]),
      });
      expect(result["lines"]).toEqual([]);
    });
  });
});
