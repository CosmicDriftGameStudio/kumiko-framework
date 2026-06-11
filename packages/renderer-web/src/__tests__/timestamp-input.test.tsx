// Regression Bug-Bash-2 (2026-06-08): timestamp-Felder ohne locatedBy
// werden server-seitig als z.iso.datetime() (UTC mit `Z`) validiert,
// das native datetime-local-Input emittierte aber offset-lose lokale
// Zeit ("2026-06-08T21:09") → jeder Save endete in 422 invalid_format.
// Die Assertions laufen gegen die ECHTEN Zod-Schemas aus
// schema-builder.ts (z.iso.datetime / z.iso.datetime({local:true})).
import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { z } from "zod";
import { defaultPrimitives } from "../primitives";
import { inputValueToTimestamp, timestampToInputValue } from "../primitives/timestamp-input";
import { render } from "./test-utils";

const utcSchema = z.iso.datetime();
const wallClockSchema = z.iso.datetime({ local: true });
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

describe("timestamp Konvertierung (Helpers)", () => {
  test("UTC: lokale Eingabe wird als Z-Instant emittiert, Instant bleibt erhalten", () => {
    const emitted = inputValueToTimestamp("2026-06-08T21:09", false);
    if (emitted === undefined) throw new Error("expected emitted value");
    expect(utcSchema.safeParse(emitted).success).toBe(true);
    expect(emitted.endsWith("Z")).toBe(true);
    expect(new Date(emitted).getTime()).toBe(new Date("2026-06-08T21:09").getTime());
  });

  test("wallClock: Eingabe geht offset-los durch und passt das local-Schema", () => {
    const emitted = inputValueToTimestamp("2026-06-08T21:09", true);
    expect(emitted).toBe("2026-06-08T21:09");
    expect(wallClockSchema.safeParse(emitted).success).toBe(true);
  });

  test("leere Eingabe → undefined (Feld geleert)", () => {
    expect(inputValueToTimestamp("", false)).toBeUndefined();
    expect(inputValueToTimestamp("", true)).toBeUndefined();
  });

  test("UTC-Instant aus dem Server wird als lokale Wall-Clock angezeigt", () => {
    const display = timestampToInputValue("2026-06-08T19:09:00.000Z");
    expect(display).toMatch(DATETIME_LOCAL);
    expect(new Date(`${display}`).getTime()).toBe(new Date("2026-06-08T19:09:00.000Z").getTime());
  });

  test("offset-loser Wert wird nur auf Minuten gekürzt", () => {
    expect(timestampToInputValue("2026-06-08T21:09:33")).toBe("2026-06-08T21:09");
    expect(timestampToInputValue("")).toBe("");
  });
});

describe("Input kind=timestamp (Primitive)", () => {
  test("rendert UTC-Wert als valides datetime-local und emittiert Z-Instant", () => {
    const { Input } = defaultPrimitives;
    const emitted: (string | undefined)[] = [];
    const view = render(
      <Input
        kind="timestamp"
        id="ts"
        name="ts"
        value="2026-06-08T19:09:00Z"
        onChange={(v) => emitted.push(v)}
      />,
    );
    const input = view.container.querySelector("input");
    if (!input) throw new Error("expected input");
    // datetime-local akzeptiert keine Z-Suffixe — der angezeigte Wert
    // muss konvertiert sein, sonst zeigt der Browser ein leeres Feld.
    expect(input.value).toMatch(DATETIME_LOCAL);

    fireEvent.change(input, { target: { value: "2026-06-08T21:09" } });
    expect(emitted).toHaveLength(1);
    const value = emitted[0];
    if (value === undefined) throw new Error("expected emitted value");
    expect(utcSchema.safeParse(value).success).toBe(true);
  });

  test("wallClock-Variante emittiert offset-lose Wall-Clock", () => {
    const { Input } = defaultPrimitives;
    const emitted: (string | undefined)[] = [];
    const view = render(
      <Input
        kind="timestamp"
        id="ts"
        name="ts"
        value=""
        wallClock
        onChange={(v) => emitted.push(v)}
      />,
    );
    const input = view.container.querySelector("input");
    if (!input) throw new Error("expected input");
    fireEvent.change(input, { target: { value: "2026-06-08T10:00" } });
    expect(emitted).toEqual(["2026-06-08T10:00"]);
    expect(wallClockSchema.safeParse(emitted[0]).success).toBe(true);
  });
});
