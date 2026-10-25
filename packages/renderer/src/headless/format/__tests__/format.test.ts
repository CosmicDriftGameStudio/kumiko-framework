import { describe, expect, spyOn, test } from "bun:test";
import type { UnitKey } from "@cosmicdrift/kumiko-framework/engine";
import { applyFormatSpec, UNIT_FORMAT_KEYS } from "../index.ts";

describe("applyFormatSpec — json", () => {
  test("honors a numeric indent and defaults to 2", () => {
    expect(applyFormatSpec({ format: "json", indent: 4 }, { a: 1 })).toBe('{\n    "a": 1\n}');
    expect(applyFormatSpec({ format: "json" }, { a: 1 })).toBe('{\n  "a": 1\n}');
    expect(applyFormatSpec({ format: "json", indent: "4" }, { a: 1 })).toBe('{\n  "a": 1\n}');
  });

  test("falls back to text for BigInt and circular values instead of throwing", () => {
    expect(applyFormatSpec({ format: "json" }, 10n)).toBe("10");
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(applyFormatSpec({ format: "json" }, circular)).toBe("[object Object]");
  });
});

describe("applyFormatSpec — priority", () => {
  test("renders emptyLabel for undefined/null/empty/0 (not the global '' collapse)", () => {
    expect(applyFormatSpec({ format: "priority" }, undefined)).toBe("—");
    expect(applyFormatSpec({ format: "priority" }, null)).toBe("—");
    expect(applyFormatSpec({ format: "priority" }, "")).toBe("—");
    expect(applyFormatSpec({ format: "priority" }, 0)).toBe("—");
  });

  test("custom emptyLabel + prefix", () => {
    expect(applyFormatSpec({ format: "priority", emptyLabel: "none" }, null)).toBe("none");
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 2)).toBe("P2");
  });
});

describe("applyFormatSpec — empty values for other formats", () => {
  test("collapse to ''", () => {
    expect(applyFormatSpec({ format: "boolean" }, undefined)).toBe("");
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, null)).toBe("");
    expect(applyFormatSpec({ format: "timestamp" }, "")).toBe("");
  });
});

describe("applyFormatSpec — boolean/currency", () => {
  test("boolean with default and custom labels", () => {
    expect(applyFormatSpec({ format: "boolean" }, true)).toBe("✓");
    expect(applyFormatSpec({ format: "boolean" }, false)).toBe("");
    expect(applyFormatSpec({ format: "boolean", trueLabel: "ja", falseLabel: "nein" }, false)).toBe(
      "nein",
    );
  });

  test("currency appends symbol", () => {
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, 12)).toBe("12 €");
    expect(applyFormatSpec({ format: "currency" }, 12)).toBe("12");
  });
});

describe("applyFormatSpec — number grouping", () => {
  test("groups thousands by default", () => {
    expect(applyFormatSpec({ format: "number" }, 2021)).toBe("2,021");
    expect(applyFormatSpec({ format: "number", locale: "de-DE" }, 2021)).toBe("2.021");
  });

  test("grouping: false renders no thousands separator", () => {
    expect(applyFormatSpec({ format: "number", grouping: false }, 2021)).toBe("2021");
    expect(applyFormatSpec({ format: "number", locale: "de-DE", grouping: false }, 2021)).toBe(
      "2021",
    );
  });

  test("decimal/bigInt share the same grouping path", () => {
    expect(applyFormatSpec({ format: "decimal", locale: "de-DE" }, 2021)).toBe("2.021");
    expect(applyFormatSpec({ format: "bigInt", locale: "de-DE", grouping: false }, 2021)).toBe(
      "2021",
    );
  });
});

describe("applyFormatSpec — number fraction digits", () => {
  test("maximumFractionDigits keeps small values visible", () => {
    expect(applyFormatSpec({ format: "decimal", locale: "en-US" }, 0.0004)).toBe("0");
    expect(
      applyFormatSpec({ format: "decimal", locale: "en-US", maximumFractionDigits: 4 }, 0.0004),
    ).toBe("0.0004");
    expect(
      applyFormatSpec({ format: "number", locale: "de-DE", maximumFractionDigits: 4 }, 0.0004),
    ).toBe("0,0004");
  });

  test("minimumFractionDigits pads", () => {
    expect(
      applyFormatSpec({ format: "number", locale: "en-US", minimumFractionDigits: 2 }, 5),
    ).toBe("5.00");
  });

  test("invalid options fall back to the default", () => {
    const base = { format: "number", locale: "en-US" };
    expect(applyFormatSpec({ ...base, maximumFractionDigits: 21 }, 1.23456)).toBe("1.235");
    expect(applyFormatSpec({ ...base, maximumFractionDigits: -1 }, 1.23456)).toBe("1.235");
    expect(applyFormatSpec({ ...base, maximumFractionDigits: 1.5 }, 1.23456)).toBe("1.235");
    expect(
      applyFormatSpec({ ...base, minimumFractionDigits: 4, maximumFractionDigits: 2 }, 1.23456),
    ).toBe("1.235");
  });
});

describe("applyFormatSpec — timestamp/date (formatDateCell-Pfad)", () => {
  // Noon UTC: the date does not roll over in any UTC-11..UTC+11 time zone,
  // making the test deterministic in CI (UTC) and locally (CET).
  const instant = "2026-01-15T12:00:00Z";

  test("timestamp with locale+dateStyle+timeStyle renders localized", () => {
    const out = applyFormatSpec(
      { format: "timestamp", locale: "en-US", dateStyle: "long", timeStyle: "short" },
      instant,
    );
    expect(out).toContain("January");
    expect(out).toContain("2026");
  });

  test("date with locale de-DE renders German month name", () => {
    const out = applyFormatSpec({ format: "date", locale: "de-DE", dateStyle: "long" }, instant);
    expect(out).toContain("Januar");
    expect(out).toContain("2026");
  });

  test("date without dateStyle renders day and month with two digits", () => {
    expect(applyFormatSpec({ format: "date", locale: "de-DE" }, "2026-03-05")).toBe("05.03.2026");
  });

  test("timestamp without options uses the compact default format", () => {
    const out = applyFormatSpec({ format: "timestamp", locale: "en-US" }, instant);
    expect(out).toContain("2026");
    expect(out).not.toBe(instant);
  });

  test("timestamp with timeZone renders in the specified zone, regardless of the runtime zone", () => {
    const lateEveningUtc = "2026-12-31T23:30:00Z";
    const berlin = applyFormatSpec(
      {
        format: "timestamp",
        locale: "en-US",
        timeZone: "Europe/Berlin",
        dateStyle: "short",
        timeStyle: "short",
      },
      lateEveningUtc,
    );
    const losAngeles = applyFormatSpec(
      {
        format: "timestamp",
        locale: "en-US",
        timeZone: "America/Los_Angeles",
        dateStyle: "short",
        timeStyle: "short",
      },
      lateEveningUtc,
    );
    expect(berlin).toContain("1/1/27");
    expect(berlin).toContain("12:30");
    expect(losAngeles).toContain("12/31/26");
    expect(losAngeles).toContain("3:30");
  });

  test("timestamp with timeZone without dateStyle uses the zone in the default format", () => {
    const out = applyFormatSpec(
      { format: "timestamp", locale: "en-US", timeZone: "Europe/Berlin" },
      "2026-12-31T23:30:00Z",
    );
    expect(out).toContain("Jan");
    expect(out).toContain("2027");
  });

  test("invalid timeZone falls back to the raw string instead of throwing", () => {
    const instant = "2026-12-31T23:30:00Z";
    expect(applyFormatSpec({ format: "timestamp", timeZone: "Not/AZone" }, instant)).toBe(instant);
    expect(
      applyFormatSpec({ format: "timestamp", timeZone: "Not/AZone", dateStyle: "short" }, instant),
    ).toBe(instant);
  });

  test("unparseable value falls back to the raw string", () => {
    expect(applyFormatSpec({ format: "timestamp" }, "kein-datum")).toBe("kein-datum");
    expect(applyFormatSpec({ format: "date" }, "kein-datum")).toBe("kein-datum");
  });

  test("offset-less timestamps (no Z/Offset) do NOT fall back to the raw string", () => {
    // Temporal.Instant.from is stricter than the old `new Date(raw)` —
    // without a UTC designator/offset it throws. Both forms must still
    // format instead of passing through raw (see toInstant fallback in
    // index.ts).
    const withoutOffset = "2026-01-15T12:00:00";
    const withoutTime = "2026-01-15 12:00:00";
    for (const raw of [withoutOffset, withoutTime]) {
      const out = applyFormatSpec({ format: "timestamp", locale: "en-US" }, raw);
      expect(out).not.toBe(raw);
      expect(out).toContain("2026");
    }
  });

  test("offset-less timestamp in date format does NOT fall back to the raw string", () => {
    const withoutOffset = "2026-01-15T12:00:00";
    const out = applyFormatSpec({ format: "date", locale: "en-US" }, withoutOffset);
    expect(out).not.toBe(withoutOffset);
    expect(out).toContain("2026");
  });
});

describe("applyFormatSpec — unit", () => {
  test("km/m/kg/percent go through Intl.NumberFormat(style:'unit'), correctly localized", () => {
    expect(applyFormatSpec({ format: "unit", unit: "km" }, 58)).toBe(
      new Intl.NumberFormat(undefined, {
        style: "unit",
        unit: "kilometer",
        unitDisplay: "short",
      }).format(58),
    );
    expect(applyFormatSpec({ format: "unit", unit: "km", locale: "de-DE" }, 58)).toBe("58 km");
    expect(applyFormatSpec({ format: "unit", unit: "kg", locale: "de-DE" }, 2.5)).toBe("2,5 kg");
    // de-DE percent uses a narrow no-break space (U+202F) before "%", not a
    // plain space — assert against Intl's own output rather than guessing.
    expect(applyFormatSpec({ format: "unit", unit: "percent", locale: "de-DE" }, 12)).toBe(
      new Intl.NumberFormat("de-DE", {
        style: "unit",
        unit: "percent",
        unitDisplay: "short",
      }).format(12),
    );
    // Ratio 0.15 must NOT become 15 % — unit:"percent" is percent-points.
    expect(applyFormatSpec({ format: "unit", unit: "percent", locale: "de-DE" }, 0.15)).toBe(
      new Intl.NumberFormat("de-DE", {
        style: "unit",
        unit: "percent",
        unitDisplay: "short",
      }).format(0.15),
    );
  });

  test("mi (miles) goes through Intl.NumberFormat(style:'unit') just like km", () => {
    expect(applyFormatSpec({ format: "unit", unit: "mi" }, 58)).toBe(
      new Intl.NumberFormat(undefined, {
        style: "unit",
        unit: "mile",
        unitDisplay: "short",
      }).format(58),
    );
    expect(applyFormatSpec({ format: "unit", unit: "mi", locale: "en-US" }, 12)).toBe("12 mi");
  });

  test("m2 has no ECMA-402-sanctioned Intl-Unit (RangeError for 'square-meter') — number + literal suffix", () => {
    expect(applyFormatSpec({ format: "unit", unit: "m2", locale: "de-DE" }, 58)).toBe("58 m²");
    expect(applyFormatSpec({ format: "unit", unit: "m2", locale: "de-DE" }, 1234.5)).toBe(
      "1.234,5 m²",
    );
  });

  test("unitDisplay steuert long", () => {
    expect(
      applyFormatSpec({ format: "unit", unit: "km", locale: "en-US", unitDisplay: "long" }, 3),
    ).toBe("3 kilometers");
    expect(
      applyFormatSpec({ format: "unit", unit: "km", locale: "en-US", unitDisplay: "narrow" }, 3),
    ).toBe(
      new Intl.NumberFormat("en-US", {
        style: "unit",
        unit: "kilometer",
        unitDisplay: "narrow",
      }).format(3),
    );
  });

  test("non-numeric value falls back to a string", () => {
    expect(applyFormatSpec({ format: "unit", unit: "km" }, "not-a-number")).toBe("not-a-number");
  });

  test("missing/unknown unit falls back to a string instead of throwing", () => {
    expect(applyFormatSpec({ format: "unit" }, 58)).toBe("58");
    expect(applyFormatSpec({ format: "unit", unit: "does-not-exist" }, 58)).toBe("58");
  });

  test("Prototype-chain keys (toString, constructor) do NOT count as unit — Object.hasOwn instead of `in`", () => {
    expect(applyFormatSpec({ format: "unit", unit: "toString" }, 58)).toBe("58");
    expect(applyFormatSpec({ format: "unit", unit: "constructor" }, 58)).toBe("58");
  });

  test("empty value collapses to '' like every other non-priority format", () => {
    expect(applyFormatSpec({ format: "unit", unit: "km" }, null)).toBe("");
    expect(applyFormatSpec({ format: "unit", unit: "km" }, "")).toBe("");
  });
});

describe("applyFormatSpec — enumOption", () => {
  const spec = { format: "enumOption", keyPrefix: "contact:entity:contact:field:status:option:" };

  test("translated key wins over the raw value", () => {
    const translate = (key: string) =>
      key === "contact:entity:contact:field:status:option:active" ? "Aktiv" : key;
    expect(applyFormatSpec(spec, "active", translate)).toBe("Aktiv");
  });

  test("unknown key falls back to the raw value (translate returns the key unchanged)", () => {
    const translate = (key: string) => key;
    expect(applyFormatSpec(spec, "active", translate)).toBe("active");
  });

  test("without a translate parameter, falls back to the raw value", () => {
    expect(applyFormatSpec(spec, "active")).toBe("active");
  });

  test("without keyPrefix, falls back to the raw value, even with translate", () => {
    const translate = (key: string) => `translated:${key}`;
    expect(applyFormatSpec({ format: "enumOption" }, "active", translate)).toBe("active");
  });

  test("non-string value is stringified before key construction", () => {
    const translate = (key: string) =>
      key === "contact:entity:contact:field:status:option:1" ? "Eins" : key;
    expect(applyFormatSpec(spec, 1, translate)).toBe("Eins");
  });

  test("Array value: each entry is translated individually and joined with commas", () => {
    const translate = (key: string) =>
      key === "contact:entity:contact:field:status:option:active" ? "Aktiv" : key;
    expect(applyFormatSpec(spec, ["active", "other"], translate)).toBe("Aktiv, other");
  });

  test("empty value collapses to '' like every other non-priority format", () => {
    expect(applyFormatSpec(spec, null, (k) => k)).toBe("");
    expect(applyFormatSpec(spec, "", (k) => k)).toBe("");
  });
});

describe("applyFormatSpec — boolean labels through translate", () => {
  const TRUE_KEY = "managed-pages:entity:page:field:published:option:true";
  const FALSE_KEY = "managed-pages:entity:page:field:published:option:false";
  const spec = { format: "boolean", trueLabel: TRUE_KEY, falseLabel: FALSE_KEY };
  const translate = (key: string): string => {
    if (key === TRUE_KEY) return "Published";
    if (key === FALSE_KEY) return "Draft";
    return key;
  };

  test("an i18n key as trueLabel renders translated", () => {
    expect(applyFormatSpec(spec, true, translate)).toBe("Published");
  });

  test("an i18n key as falseLabel renders translated", () => {
    expect(applyFormatSpec(spec, false, translate)).toBe("Draft");
  });

  test("without translate the declared labels stay verbatim", () => {
    expect(applyFormatSpec(spec, true)).toBe(TRUE_KEY);
    expect(applyFormatSpec(spec, false)).toBe(FALSE_KEY);
  });

  test("a plain-text label is not mangled by a pass-through translate", () => {
    const plain = { format: "boolean", trueLabel: "Yes", falseLabel: "No" };
    expect(applyFormatSpec(plain, true, (k) => k)).toBe("Yes");
    expect(applyFormatSpec(plain, false, (k) => k)).toBe("No");
  });

  test("undeclared labels keep the ✓ / empty defaults even with translate", () => {
    expect(applyFormatSpec({ format: "boolean" }, true, translate)).toBe("✓");
    expect(applyFormatSpec({ format: "boolean" }, false, translate)).toBe("");
  });
});

describe("unit format keys stay in lockstep with UnitKey", () => {
  // Record<UnitKey, true> fails typecheck when UnitKey gains or loses a member,
  // so the runtime key list below can't drift from the type.
  const UNIT_KEY_PARITY: Record<UnitKey, true> = {
    m2: true,
    km: true,
    m: true,
    kg: true,
    percent: true,
    mi: true,
  };
  const TYPE_UNIT_KEYS = Object.keys(UNIT_KEY_PARITY);
  test("every UnitKey formats with a non-bare number", () => {
    for (const k of TYPE_UNIT_KEYS) {
      expect(UNIT_FORMAT_KEYS.includes(k)).toBe(true);
      expect(applyFormatSpec({ format: "unit", unit: k }, 1)).not.toBe("1");
    }
  });
  test("no extra runtime keys beyond UnitKey", () => {
    expect([...UNIT_FORMAT_KEYS].sort()).toEqual([...TYPE_UNIT_KEYS].sort());
  });
});

describe("applyFormatSpec — image and file", () => {
  test("fall back to the raw id outside the web list cell, joining arrays", () => {
    expect(applyFormatSpec({ format: "image", variant: "thumb" }, "abc")).toBe("abc");
    expect(applyFormatSpec({ format: "file" }, ["a", "b"])).toBe("a, b");
  });
});

describe("applyFormatSpec — inherited member names", () => {
  test("a format named like an Object.prototype member takes the unknown-format path", () => {
    // The warning fires only when NODE_ENV !== "production"; set it explicitly
    // instead of relying on the test runner preset.
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(applyFormatSpec({ format: "toString" }, 42)).toBe("42");
      expect(applyFormatSpec({ format: "constructor" }, true)).toBe("true");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]?.[0]).toContain('unknown format key "toString"');
    } finally {
      warn.mockRestore();
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});

describe("applyFormatSpec — i18nText", () => {
  const translate = (key: string, params?: Readonly<Record<string, string | number>>) =>
    key === "check.passed" ? `${params?.["ok"]} of ${params?.["total"]} passed` : `T(${key})`;

  test("a server-built text is translated with its params", () => {
    const value = { i18nKey: "check.passed", i18nParams: { ok: 3, total: 4 } };
    expect(applyFormatSpec({ format: "i18nText" }, value, translate)).toBe("3 of 4 passed");
  });

  test("a plain string is translated as a key", () => {
    expect(applyFormatSpec({ format: "i18nText" }, "area.mail", translate)).toBe("T(area.mail)");
  });

  test("non-text params are dropped instead of stringified", () => {
    const seen: unknown[] = [];
    applyFormatSpec(
      { format: "i18nText" },
      { i18nKey: "x", i18nParams: { ok: 1, nested: { a: 1 } } },
      (key, params) => {
        seen.push(params);
        return key;
      },
    );
    expect(seen).toEqual([{ ok: 1 }]);
  });
});
