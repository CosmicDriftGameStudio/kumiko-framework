// Regression: timestamp fields without locatedBy were validated server-side as
// z.iso.datetime() (UTC with `Z`), but the native datetime-local input emitted
// offset-free local time ("2026-06-08T21:09"), so every save ended in 422
// invalid_format.
// These assertions use the actual Zod schemas from schema-builder.ts
// (z.iso.datetime / z.iso.datetime({local:true})).

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import * as z from "zod";
import { defaultPrimitives } from "../primitives/index.tsx";
import { inputValueToTimestamp, timestampToInputValue } from "../primitives/timestamp-input.tsx";
import { render } from "./test-utils.tsx";

const utcSchema = z.iso.datetime();
const wallClockSchema = z.iso.datetime({ local: true });
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

describe("timestamp Konvertierung (Helpers)", () => {
  test("UTC: local input emits a Z instant, instant remains unchanged", () => {
    const emitted = inputValueToTimestamp("2026-06-08T21:09", false);
    if (emitted === undefined) throw new Error("expected emitted value");
    expect(utcSchema.safeParse(emitted).success).toBe(true);
    expect(emitted.endsWith("Z")).toBe(true);
    expect(new Date(emitted).getTime()).toBe(new Date("2026-06-08T21:09").getTime());
  });

  test("wallClock: input passes through without an offset and matches the local schema", () => {
    const emitted = inputValueToTimestamp("2026-06-08T21:09", true);
    expect(emitted).toBe("2026-06-08T21:09");
    expect(wallClockSchema.safeParse(emitted).success).toBe(true);
  });

  test("empty input → undefined (field cleared)", () => {
    expect(inputValueToTimestamp("", false)).toBeUndefined();
    expect(inputValueToTimestamp("", true)).toBeUndefined();
  });

  test("UTC instant from the server is displayed as a local wall clock", () => {
    const display = timestampToInputValue("2026-06-08T19:09:00.000Z");
    expect(display).toMatch(DATETIME_LOCAL);
    expect(new Date(`${display}`).getTime()).toBe(new Date("2026-06-08T19:09:00.000Z").getTime());
  });

  test("offset-less value is truncated to minutes only", () => {
    expect(timestampToInputValue("2026-06-08T21:09:33")).toBe("2026-06-08T21:09");
    expect(timestampToInputValue("")).toBe("");
  });
});

describe("Input kind=timestamp (Primitive)", () => {
  // Separate date input (editable, directly accepts ISO) and time input instead
  // of native datetime-local. inputs[0] = date, inputs[1] = type=time. The
  // wire conversion (UTC↔Wall-Clock) is unchanged and pinned above through the
  // helpers. This controlled wrapper makes `value` flow back as it does in a
  // real form.
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
