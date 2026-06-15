// Regression Bug-Bash-2 (2026-06-08): timestamp-Felder ohne locatedBy
// werden server-seitig als z.iso.datetime() (UTC mit `Z`) validiert,
// das native datetime-local-Input emittierte aber offset-lose lokale
// Zeit ("2026-06-08T21:09") → jeder Save endete in 422 invalid_format.
// Die Assertions laufen gegen die ECHTEN Zod-Schemas aus
// schema-builder.ts (z.iso.datetime / z.iso.datetime({local:true})).

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";
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
  // Seit #369: getrennte Datums- (tippbar, ISO direkt akzeptiert) und
  // Uhrzeit-Eingabe statt nativem datetime-local. inputs[0] = Datum,
  // inputs[1] = type=time. Die Wire-Konvertierung (UTC↔Wall-Clock) ist
  // unverändert und oben über die Helpers gepinnt. Kontrollierter Wrapper,
  // damit `value` wie in einer echten Form zurückfließt.
  function ControlledTimestamp({
    wallClock,
    onEmit,
  }: {
    readonly wallClock?: boolean;
    readonly onEmit: (v: string | undefined) => void;
  }) {
    const { Input } = defaultPrimitives;
    const [v, setV] = useState("");
    return (
      <Input
        kind="timestamp"
        id="ts"
        name="ts"
        value={v}
        {...(wallClock === true && { wallClock: true })}
        onChange={(nv) => {
          onEmit(nv);
          setV(nv ?? "");
        }}
      />
    );
  }

  test("Datum + Uhrzeit tippen → valider Z-Instant (UTC-Variante)", () => {
    let last: string | undefined;
    const view = render(<ControlledTimestamp onEmit={(v) => (last = v)} />);
    const [dateInput, timeInput] = view.container.querySelectorAll("input");
    if (!dateInput || !timeInput) throw new Error("expected date + time input");

    fireEvent.change(dateInput, { target: { value: "2026-06-08" } });
    fireEvent.change(timeInput, { target: { value: "21:09" } });

    if (last === undefined) throw new Error("expected emitted value");
    expect(last.endsWith("Z")).toBe(true);
    expect(utcSchema.safeParse(last).success).toBe(true);
  });

  test("wallClock-Variante emittiert offset-lose Wall-Clock", () => {
    let last: string | undefined;
    const view = render(<ControlledTimestamp wallClock onEmit={(v) => (last = v)} />);
    const [dateInput, timeInput] = view.container.querySelectorAll("input");
    if (!dateInput || !timeInput) throw new Error("expected date + time input");

    fireEvent.change(dateInput, { target: { value: "2026-06-08" } });
    fireEvent.change(timeInput, { target: { value: "10:00" } });

    expect(last).toBe("2026-06-08T10:00");
    expect(wallClockSchema.safeParse(last).success).toBe(true);
  });
});
