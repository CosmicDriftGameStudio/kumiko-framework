// Tracks server-Crashes in einem rollenden Zeitfenster und entscheidet,
// ob der dev-wrapper noch respawnen darf oder den Crash-Loop aufgeben
// muss. Liegt als eigener File, damit `kumiko-dev.ts` (bin-Script ohne
// Test-Setup) eine pure, injizierbare API bekommt — die Logik ist
// testbar via createCrashTracker, ohne den Wrapper-Prozess fahren zu
// müssen.
//
// Semantik: ein Crash "zählt im Fenster", wenn er innerhalb der letzten
// `windowMs` ms vor `now` registriert wurde. Wenn nach Aufnahme des
// neuen Crashes mehr als `maxCrashes` im Fenster liegen, gibt der
// Tracker `false` zurück → Wrapper soll aufgeben.

export type CrashTrackerOptions = {
  readonly maxCrashes: number;
  readonly windowMs: number;
};

export type CrashTracker = {
  /** Crash bei `now` registrieren. Returns `true` wenn der Wrapper
   *  noch respawnen darf, `false` wenn das Limit überschritten ist.
   *
   *  Der Crash wird IMMER aufgenommen, auch wenn `false` zurückkommt —
   *  der Caller terminiert in dem Fall normalerweise eh. Reuse mit
   *  "rejected → state unchanged"-Semantik wird nicht unterstützt. */
  readonly noteCrash: (now: number) => boolean;
  /** Anzahl Crashes im Fenster relativ zu `now` — prunt lazy, damit
   *  der Aufruf auch ohne vorheriges noteCrash konsistent ist. */
  readonly crashCountInWindow: (now: number) => number;
};

export function createCrashTracker(options: CrashTrackerOptions): CrashTracker {
  const timestamps: number[] = [];

  const pruneBefore = (cutoff: number): void => {
    // Crashes älter als `cutoff` raus. Gleicher Timestamp wie cutoff
    // bleibt drin (`<` statt `<=`) — symmetrisch zur Fenster-Definition
    // "innerhalb der letzten windowMs", also Endpoint inklusive.
    while (timestamps.length > 0) {
      const head = timestamps[0];
      if (head !== undefined && head < cutoff) timestamps.shift();
      else break;
    }
  };

  return {
    noteCrash: (now) => {
      pruneBefore(now - options.windowMs);
      timestamps.push(now);
      return timestamps.length <= options.maxCrashes;
    },
    crashCountInWindow: (now) => {
      pruneBefore(now - options.windowMs);
      return timestamps.length;
    },
  };
}
