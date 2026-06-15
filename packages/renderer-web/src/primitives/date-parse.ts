// Gemeinsame Datums-Parse/Format-Utils für die Web-Date-Primitives
// (DateInput, TimestampInput). PlainDate-Semantik: lokale Date-Objekte
// ohne Timezone-Konvertierung — "2026-04-25" bleibt der 25., egal in
// welcher Zone der Browser läuft. Die TZ-/Wall-Clock-Konvertierung für
// timestamp-Felder lebt bewusst weiter in timestamp-input.tsx (Wire-
// Boundary, eigener Test); hier ist reines Kalender-Datum.

export function guessLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// new Date(y, m-1, d) akzeptiert Überläufe (31. Feb → 3. März) und
// interpretiert 0–99 als 1900+y. Beides hier als ungültig abweisen, damit
// getippte Datümer nicht still in ein anderes Datum kippen.
function makeLocalDate(y: number, m: number, d: number): Date | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return undefined;
  }
  return date;
}

export function parseIso(v: string): Date | undefined {
  if (v === "") return undefined;
  const parts = v.split("-");
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  ) {
    return undefined;
  }
  return makeLocalDate(y, m, d);
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Editierbare, wieder-parsebare Anzeige (numerisches Locale-Format, z.B.
// de "25.04.2026", en-US "04/25/2026"). Bewusst NICHT month:"long" — der
// User soll den angezeigten Text direkt überschreiben können.
export function formatDateForInput(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

type DateSlot = "y" | "m" | "d";

// Feld-Reihenfolge des numerischen Locale-Formats. de → [d,m,y],
// en-US → [m,d,y], ISO-ähnliche Locales → [y,m,d].
function localeDateOrder(locale: string): readonly DateSlot[] {
  const ref = new Date(2026, 0, 2); // Tag 2, Monat 1 — alle Felder eindeutig
  const order: DateSlot[] = [];
  for (const part of new Intl.DateTimeFormat(locale).formatToParts(ref)) {
    if (part.type === "year") order.push("y");
    else if (part.type === "month") order.push("m");
    else if (part.type === "day") order.push("d");
  }
  return order;
}

// Getippte Eingabe → Date. Akzeptiert ISO (yyyy-mm-dd) direkt sowie drei
// numerische Tokens in Locale-Reihenfolge mit beliebigem Trenner
// (".", "/", "-", " "). Zweistellige Jahre → 2000er. Teil-/Fehl-Eingaben
// → undefined (Caller behält dann den Roh-Text, committet nichts).
export function parseTypedDate(input: string, locale: string): Date | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;

  const iso = parseIso(trimmed);
  if (iso !== undefined) return iso;

  const tokens = trimmed.split(/\D+/).filter((t) => t !== "");
  if (tokens.length !== 3) return undefined;
  const nums = tokens.map(Number);
  if (nums.some(Number.isNaN)) return undefined;

  const order = localeDateOrder(locale);
  if (order.length !== 3) return undefined;

  let y = 0;
  let m = 0;
  let d = 0;
  order.forEach((slot, i) => {
    const val = nums[i] ?? 0;
    if (slot === "y") y = val;
    else if (slot === "m") m = val;
    else d = val;
  });
  if (y < 100) y += 2000;

  return makeLocalDate(y, m, d);
}
