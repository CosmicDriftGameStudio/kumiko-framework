// Unit-Tests für createCrashTracker — die rollende-Fenster-Logik aus
// kumiko-dev. Hier steckt der Crash-Loop-Schutz, der entscheidet ob der
// Wrapper aufgibt oder noch eine Runde respawnt; off-by-one am Fenster-
// Rand würde im Bin-Skript schlecht auffallen.

import { describe, expect, test } from "vitest";
import { createCrashTracker } from "../crash-tracker";

describe("createCrashTracker", () => {
  test("erste maxCrashes Crashes sind erlaubt, der nächste nicht", () => {
    const t = createCrashTracker({ maxCrashes: 3, windowMs: 10_000 });
    expect(t.noteCrash(1000)).toBe(true);
    expect(t.noteCrash(1100)).toBe(true);
    expect(t.noteCrash(1200)).toBe(true);
    // 4. Crash innerhalb des Fensters → über Limit
    expect(t.noteCrash(1300)).toBe(false);
  });

  test("alte Crashes außerhalb des Fensters werden geprunt", () => {
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(500);
    // bei t=1500 ist t=0 raus (1500 - 1000 = 500, alles < 500 fliegt),
    // im Fenster bleibt nur t=500. Mit dem neuen Crash bei 1500 sind
    // wir bei 2 → noch im Limit.
    expect(t.noteCrash(1500)).toBe(true);
    expect(t.crashCountInWindow(1500)).toBe(2);
  });

  test("crashCountInWindow zählt nur, was im Fenster liegt", () => {
    const t = createCrashTracker({ maxCrashes: 5, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(0);
    t.noteCrash(2000); // pruned beide alten weg
    expect(t.crashCountInWindow(2000)).toBe(1);
  });

  test("crashCountInWindow prunt lazy auch ohne vorheriges noteCrash", () => {
    // Wichtig: crashCountInWindow muss eigenständig korrekt sein, nicht
    // nur als Folge eines vorangegangenen noteCrash. Sonst lügt der Name.
    const t = createCrashTracker({ maxCrashes: 5, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(100);
    // Direkter Aufruf bei now=2000 — alle alten Crashes sind raus.
    expect(t.crashCountInWindow(2000)).toBe(0);
    // Idempotent: zweiter Aufruf liefert dasselbe.
    expect(t.crashCountInWindow(2000)).toBe(0);
  });

  test("Boundary: Crash genau am Fenster-Endpoint bleibt im Fenster", () => {
    // Endpoint inklusive: cutoff = now - windowMs. Crash bei t=cutoff
    // soll noch zählen. Hier: now=1000, windowMs=1000 → cutoff=0.
    // Ein vorheriger Crash bei t=0 darf nicht als "alt" geprunt werden.
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    t.noteCrash(0);
    expect(t.noteCrash(1000)).toBe(true);
    expect(t.crashCountInWindow(1000)).toBe(2);
    // Dritter Crash bei 1000 → 3 im Fenster, über Limit
    expect(t.noteCrash(1000)).toBe(false);
  });

  test("Mehrere Crashes am gleichen Timestamp zählen einzeln", () => {
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    expect(t.noteCrash(500)).toBe(true);
    expect(t.noteCrash(500)).toBe(true);
    expect(t.noteCrash(500)).toBe(false);
  });

  test("Nach Wartezeit > windowMs ist das Limit zurückgesetzt", () => {
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(100);
    expect(t.noteCrash(200)).toBe(false); // über Limit
    // Wartezeit, alte Crashes raus
    expect(t.noteCrash(2000)).toBe(true);
    expect(t.crashCountInWindow(2000)).toBe(1);
  });

  test("maxCrashes=1 erlaubt genau einen Crash pro Fenster", () => {
    const t = createCrashTracker({ maxCrashes: 1, windowMs: 1000 });
    expect(t.noteCrash(0)).toBe(true);
    expect(t.noteCrash(500)).toBe(false);
    // Bei t=1600 sind beide vorigen Crashes (0 und 500) außerhalb
    // (cutoff = 600, 0 < 600 und 500 < 600), Tracker ist leer
    // bevor der neue gepusht wird.
    expect(t.noteCrash(1600)).toBe(true);
    expect(t.crashCountInWindow(1600)).toBe(1);
  });
});
