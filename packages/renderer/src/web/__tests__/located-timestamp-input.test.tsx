// LocatedTimestampInput (kind:"locatedTimestamp") — Wall-Clock + IANA zone.
// Pins the emitted `at` to the actual server schema (the
// locatedTimestamp write union from schema-builder.ts uses
// z.iso.datetime({ local: true }) for `at`). A located timestamp is pure
// wall-clock time — the UI performs NO UTC conversion.

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import * as z from "zod";
import { defaultPrimitives } from "../primitives/index.tsx";
import type { LocatedTimestampValue } from "../primitives/located-timestamp-input.tsx";
import { render } from "./test-utils.tsx";

const atSchema = z.iso.datetime({ local: true });

function ControlledLocated({
  initial,
  onEmit,
}: {
  readonly initial: LocatedTimestampValue | "";
  readonly onEmit: (v: { at: string; tz: string } | undefined) => void;
}) {
  const { Input } = defaultPrimitives;
  const [v, setV] = useState<LocatedTimestampValue | "">(initial);
  return (
    <Input
      kind="locatedTimestamp"
      id="lt"
      name="lt"
      value={v}
      onChange={(nv) => {
        onEmit(nv);
        setV(nv ?? "");
      }}
    />
  );
}

function inputs(container: Element): { date: HTMLInputElement; time: HTMLInputElement } {
  const date = container.querySelector<HTMLInputElement>('input:not([type="time"])');
  const time = container.querySelector<HTMLInputElement>('input[type="time"]');
  if (!date || !time) throw new Error("expected date + time input");
  return { date, time };
}

describe("Input kind=locatedTimestamp", () => {
  test("Enter date + time → { at: Wall-Clock, tz }, matching the local schema", () => {
    let last: { at: string; tz: string } | undefined;
    const view = render(
      <ControlledLocated initial={{ at: "", tz: "Europe/Lisbon" }} onEmit={(v) => (last = v)} />,
    );
    const { date, time } = inputs(view.container);

    fireEvent.change(date, { target: { value: "2026-04-03" } });
    fireEvent.change(time, { target: { value: "10:00" } });

    if (last === undefined) throw new Error("expected emitted value");
    expect(last.tz).toBe("Europe/Lisbon");
    expect(last.at).toBe("2026-04-03T10:00");
    expect(atSchema.safeParse(last.at).success).toBe(true);
    // A located timestamp is pure wall-clock time, with no offset or Z.
    expect(last.at).not.toContain("Z");
    expect(last.at).not.toContain("+");
  });

  test("READ value with seconds is displayed and re-emitted without an offset", () => {
    let last: { at: string; tz: string } | undefined;
    const view = render(
      <ControlledLocated
        initial={{ at: "2026-04-03T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-03T09:00:00Z" }}
        onEmit={(v) => (last = v)}
      />,
    );
    const { time } = inputs(view.container);
    expect(time.value).toBe("10:00");

    fireEvent.change(time, { target: { value: "11:30" } });
    if (last === undefined) throw new Error("expected emitted value");
    expect(last.at).toBe("2026-04-03T11:30");
    expect(last.tz).toBe("Europe/Lisbon");
    expect(atSchema.safeParse(last.at).success).toBe(true);
  });

  test("no input → no onChange yet (sanity check, initial value remains sentinel)", () => {
    let last: { at: string; tz: string } | undefined | "sentinel" = "sentinel";
    render(<ControlledLocated initial="" onEmit={(v) => (last = v)} />);
    expect(last).toBe("sentinel");
  });

  test("Datum + Uhrzeit wieder leeren (Zone nie gesetzt) → onChange(undefined)", () => {
    const seen: Array<{ at: string; tz: string } | undefined> = [];
    const view = render(<ControlledLocated initial="" onEmit={(v) => seen.push(v)} />);
    const { date, time } = inputs(view.container);

    fireEvent.change(date, { target: { value: "2026-04-03" } });
    fireEvent.change(time, { target: { value: "10:00" } });
    expect(seen.at(-1)?.at).toBe("2026-04-03T10:00");

    // Both fields cleared again — the emit() undefined-branch (`nextAt === ""
    // && nextTz === ""`) has zero coverage otherwise; the test above only
    // checks that NO change fires before any input, not the clear-after-fill path.
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.change(time, { target: { value: "" } });
    expect(seen.at(-1)).toBeUndefined();
  });

  test("sichtbarer Zonen-Hinweis", () => {
    const view = render(<ControlledLocated initial="" onEmit={() => {}} />);
    expect(view.container.textContent ?? "").toMatch(/lokal|local/i);
  });
});
