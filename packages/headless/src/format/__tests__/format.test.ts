import { describe, expect, test } from "bun:test";
import { applyFormatSpec } from "../index";

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
