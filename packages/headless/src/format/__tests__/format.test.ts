import { describe, expect, test } from "bun:test";
import { applyFormatSpec, UNIT_FORMAT_KEYS } from "../index";

describe("applyFormatSpec — priority", () => {
  test("rendert emptyLabel für undefined/null/leer/0 (nicht den globalen ''-Collapse)", () => {
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

describe("applyFormatSpec — leere Werte anderer Formate", () => {
  test("collapsen zu ''", () => {
    expect(applyFormatSpec({ format: "boolean" }, undefined)).toBe("");
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, null)).toBe("");
    expect(applyFormatSpec({ format: "timestamp" }, "")).toBe("");
  });
});

describe("applyFormatSpec — boolean/currency", () => {
  test("boolean mit Default- und Custom-Labels", () => {
    expect(applyFormatSpec({ format: "boolean" }, true)).toBe("✓");
    expect(applyFormatSpec({ format: "boolean" }, false)).toBe("");
    expect(applyFormatSpec({ format: "boolean", trueLabel: "ja", falseLabel: "nein" }, false)).toBe(
      "nein",
    );
  });

  test("currency hängt Symbol an", () => {
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, 12)).toBe("12 €");
    expect(applyFormatSpec({ format: "currency" }, 12)).toBe("12");
  });
});

describe("applyFormatSpec — timestamp/date (formatDateCell-Pfad)", () => {
  // Mittag UTC: das Datum kippt in keiner Zeitzone UTC-11..UTC+11 —
  // deterministisch auf CI (UTC) und lokal (CET).
  const instant = "2026-01-15T12:00:00Z";

  test("timestamp mit locale+dateStyle+timeStyle rendert lokalisiert", () => {
    const out = applyFormatSpec(
      { format: "timestamp", locale: "en-US", dateStyle: "long", timeStyle: "short" },
      instant,
    );
    expect(out).toContain("January");
    expect(out).toContain("2026");
  });

  test("date mit locale de-DE rendert deutschen Monatsnamen", () => {
    const out = applyFormatSpec({ format: "date", locale: "de-DE", dateStyle: "long" }, instant);
    expect(out).toContain("Januar");
    expect(out).toContain("2026");
  });

  test("timestamp ohne Optionen nutzt das kompakte Default-Format", () => {
    const out = applyFormatSpec({ format: "timestamp", locale: "en-US" }, instant);
    expect(out).toContain("2026");
    expect(out).not.toBe(instant);
  });

  test("unparsebarer Wert fällt auf den Rohstring zurück", () => {
    expect(applyFormatSpec({ format: "timestamp" }, "kein-datum")).toBe("kein-datum");
    expect(applyFormatSpec({ format: "date" }, "kein-datum")).toBe("kein-datum");
  });

  test("offset-lose Timestamps (kein Z/Offset) fallen NICHT auf den Rohstring zurück", () => {
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

  test("offset-loser Timestamp im date-Format fällt NICHT auf den Rohstring zurück", () => {
    const withoutOffset = "2026-01-15T12:00:00";
    const out = applyFormatSpec({ format: "date", locale: "en-US" }, withoutOffset);
    expect(out).not.toBe(withoutOffset);
    expect(out).toContain("2026");
  });
});

describe("applyFormatSpec — unit (fw#2187)", () => {
  test("km/m/kg/percent gehen über Intl.NumberFormat(style:'unit'), locale-korrekt", () => {
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

  test("mi (Meilen) geht über Intl.NumberFormat(style:'unit') genau wie km", () => {
    expect(applyFormatSpec({ format: "unit", unit: "mi" }, 58)).toBe(
      new Intl.NumberFormat(undefined, {
        style: "unit",
        unit: "mile",
        unitDisplay: "short",
      }).format(58),
    );
    expect(applyFormatSpec({ format: "unit", unit: "mi", locale: "en-US" }, 12)).toBe("12 mi");
  });

  test("m2 hat kein ECMA-402-sanktioniertes Intl-Unit (RangeError für 'square-meter') — Zahl + literales Suffix", () => {
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

  test("nicht-numerischer Wert fällt auf String zurück", () => {
    expect(applyFormatSpec({ format: "unit", unit: "km" }, "not-a-number")).toBe("not-a-number");
  });

  test("fehlende/unbekannte unit fällt auf String zurück, statt zu werfen", () => {
    expect(applyFormatSpec({ format: "unit" }, 58)).toBe("58");
    expect(applyFormatSpec({ format: "unit", unit: "does-not-exist" }, 58)).toBe("58");
  });

  test("Prototype-Chain-Keys (toString, constructor) zählen NICHT als unit — Object.hasOwn statt `in`", () => {
    expect(applyFormatSpec({ format: "unit", unit: "toString" }, 58)).toBe("58");
    expect(applyFormatSpec({ format: "unit", unit: "constructor" }, 58)).toBe("58");
  });

  test("leerer Wert collapst zu '' wie jedes andere Nicht-priority-Format", () => {
    expect(applyFormatSpec({ format: "unit", unit: "km" }, null)).toBe("");
    expect(applyFormatSpec({ format: "unit", unit: "km" }, "")).toBe("");
  });
});

describe("applyFormatSpec — enumOption (fw#2315)", () => {
  const spec = { format: "enumOption", keyPrefix: "contact:entity:contact:field:status:option:" };

  test("übersetzter Key gewinnt gegen den Rohwert", () => {
    const translate = (key: string) =>
      key === "contact:entity:contact:field:status:option:active" ? "Aktiv" : key;
    expect(applyFormatSpec(spec, "active", translate)).toBe("Aktiv");
  });

  test("unbekannter Key fällt auf den Rohwert zurück (translate gibt den Key unverändert zurück)", () => {
    const translate = (key: string) => key;
    expect(applyFormatSpec(spec, "active", translate)).toBe("active");
  });

  test("ohne translate-Parameter fällt auf den Rohwert zurück", () => {
    expect(applyFormatSpec(spec, "active")).toBe("active");
  });

  test("ohne keyPrefix fällt auf den Rohwert zurück, auch mit translate", () => {
    const translate = (key: string) => `translated:${key}`;
    expect(applyFormatSpec({ format: "enumOption" }, "active", translate)).toBe("active");
  });

  test("nicht-string-Wert wird vor der Key-Bildung stringifiziert", () => {
    const translate = (key: string) =>
      key === "contact:entity:contact:field:status:option:1" ? "Eins" : key;
    expect(applyFormatSpec(spec, 1, translate)).toBe("Eins");
  });

  test("leerer Wert collapst zu '' wie jedes andere Nicht-priority-Format", () => {
    expect(applyFormatSpec(spec, null, (k) => k)).toBe("");
    expect(applyFormatSpec(spec, "", (k) => k)).toBe("");
  });
});

describe("unit format keys stay in lockstep with UnitKey", () => {
  // Mirror of packages/types/src/screen.ts UnitKey — keep lists equal without
  // adding a kumiko-types dependency to headless.
  const TYPE_UNIT_KEYS = ["m2", "km", "m", "kg", "percent", "mi"] as const;
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
