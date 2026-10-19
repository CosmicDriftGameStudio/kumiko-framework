import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-Standard-Helper: clsx für konditionales Zusammenstecken,
 *  tailwind-merge für Konfliktauflösung (z.B. `px-2 px-4` → `px-4`).
 *  Jedes Primitive nutzt das um Consumer-Klassen mit Default-Klassen
 *  zu mergen ohne Duplikate. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
