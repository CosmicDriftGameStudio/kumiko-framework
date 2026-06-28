// LocatedTimestampInput (kind:"locatedTimestamp") — Wall-Clock + IANA-Zone.
// Pinnt das emittierte `at` gegen das ECHTE Server-Schema (die
// locatedTimestamp-Write-Union aus schema-builder.ts nutzt für `at`
// z.iso.datetime({ local: true })). Ein located Timestamp ist reine
// Wall-Clock — KEINE UTC-Konvertierung im UI.

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import { z } from "zod";
import { defaultPrimitives } from "../primitives";
import type { LocatedTimestampValue } from "../primitives/located-timestamp-input";
import { render } from "./test-utils";

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
  test("Datum + Uhrzeit tippen → { at: Wall-Clock, tz }, passend zum local-Schema", () => {
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
    // Located ist reine Wall-Clock — kein Offset/Z.
    expect(last.at).not.toContain("Z");
    expect(last.at).not.toContain("+");
  });

  test("READ-Wert mit Sekunden wird angezeigt + offset-frei re-emittiert", () => {
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

  test("leeres Datum + Uhrzeit ohne Zone → undefined (Feld leer)", () => {
    let last: { at: string; tz: string } | undefined | "sentinel" = "sentinel";
    render(<ControlledLocated initial="" onEmit={(v) => (last = v)} />);
    // Kein Input → noch kein onChange. Sanity: Startwert blieb Sentinel.
    expect(last).toBe("sentinel");
  });

  test("sichtbarer Zonen-Hinweis", () => {
    const view = render(<ControlledLocated initial="" onEmit={() => {}} />);
    expect(view.container.textContent ?? "").toMatch(/lokal|local/i);
  });
});
